#!/bin/bash
set -euo pipefail
# Isolated, explicit Metal-caption experiment. Never installs or changes the normal build.
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${AE_SDK_EXAMPLES:?Set official AE SDK Examples}"
: "${PREMIERE_SDK_HEADERS:?Set official Premiere SDK Headers}"
probe_ref="${BC_NATIVE_PROBE_REF:-HEAD}"
probe_commit="$(git -C "$root" rev-parse --verify --end-of-options "$probe_ref^{commit}")"
probe_short="${probe_commit:0:7}"
snapshot="$(mktemp -d "/tmp/bc-gpu-caption-$probe_short.XXXXXX")"
git -C "$root" archive "$probe_commit" | tar -x -C "$snapshot"
# Explicitly owned implementation overlays; unrelated working files are excluded.
for file in gpu_caption_renderer.hpp caption_composite.metal gpu_caption_test.mm gpu_float_eligibility.hpp; do
 cp "$root/native/adobe/$file" "$snapshot/native/adobe/$file"
done
printf '#include "gpu_caption_renderer.hpp"\n' > "$snapshot/native/adobe/gpu_caption_renderer.mm"
python3 - "$snapshot/native/adobe" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'build-macos.sh';s=p.read_text()
old='"$root/native/adobe/BetterCaptionsEffect.cpp"';assert old in s
s=s.replace(old,old+' "$root/native/adobe/gpu_caption_renderer.mm"')
s=s.replace('-framework CoreText -framework CoreGraphics -framework CoreFoundation', '-framework CoreText -framework CoreGraphics -framework CoreFoundation -framework Foundation -framework Metal')
p.write_text(s)
p=root/'BetterCaptionsEffect.cpp';s=p.read_text()
old='#include "source_time.hpp"';assert old in s
s=s.replace(old,old+'\n#include "gpu_float_eligibility.hpp"')
old='PF_Err render(PF_InData* in_data, PF_ParamDef* params[], PF_LayerDef* output) {';assert old in s
s=s.replace(old,old+'\n const auto formatError=better_captions::adobe::gpu_float_probe::guard(in_data,params,output);if(formatError)return formatError;')
old='out_data->out_flags=PF_OutFlag_NON_PARAM_VARY;';assert old in s
s=s.replace(old,old+'\n {const auto formatError=better_captions::adobe::gpu_float_probe::setup(in_data,out_data);if(formatError)return formatError;}')
p.write_text(s)
p=root/'BetterCaptionsPiPL.r';s=p.read_text()
old='AE_Effect_Global_OutFlags_2 { 0 }';assert old in s
s=s.replace(old,'AE_Effect_Global_OutFlags_2 { 0x00001000 }');p.write_text(s)
PY
output="${BC_NATIVE_OUTPUT_DIR:-$root/artifacts/native-gpu-caption-$probe_short}"
resources="$output/BetterCaptionsNativeProbe.plugin/Contents/Resources"
mkdir -p "$resources"
xcrun -sdk macosx metal -std=macos-metal2.4 -mmacosx-version-min=12.0 -c "$snapshot/native/adobe/caption_composite.metal" -o "$output/CaptionComposite.air"
xcrun -sdk macosx metallib "$output/CaptionComposite.air" -o "$resources/CaptionComposite.metallib"
BC_NATIVE_OUTPUT_DIR="$output" BC_ENABLE_RENDER_TIME_DIAGNOSTICS=0 BC_ENABLE_CUSTOM_UI_PROBE=0 BC_ENABLE_SOURCE_TIME_PROBE=0 BC_ENABLE_ADJUSTMENT_TIME_PROBE=0 bash "$snapshot/native/adobe/build-macos.sh"
codesign --verify --deep --strict "$output/BetterCaptionsNativeProbe.plugin"
includes=(-I "$PREMIERE_SDK_HEADERS" -I "$AE_SDK_EXAMPLES/Headers" -I "$AE_SDK_EXAMPLES/Headers/SP" -I "$AE_SDK_EXAMPLES/Util" -I "$AE_SDK_EXAMPLES/Resources")
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
 "$snapshot/native/adobe/gpu_caption_test.mm" "$snapshot/native/core/caption_core.cpp" "$snapshot/native/macos/caption_rasterizer.mm" \
 -framework Metal -framework Foundation -framework CoreText -framework CoreGraphics -framework CoreFoundation -o "$output/gpu_caption_test"
"$output/gpu_caption_test" "$resources/CaptionComposite.metallib"
python3 "$root/native/adobe/write-gpu-caption-provenance.py" \
 --snapshot "$snapshot" --output "$output" --archived-commit "$probe_commit" \
 --ae-sdk-examples "$AE_SDK_EXAMPLES" --premiere-sdk-headers "$PREMIERE_SDK_HEADERS" --at-build
shasum -a 256 "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe" "$resources/CaptionComposite.metallib"
printf 'Archived base commit (plus explicit overlays/patches): %s\nSnapshot: %s\n' "$probe_commit" "$snapshot"
