#!/bin/bash
set -euo pipefail
# Explicit isolated diagnostic only. It does not install or modify the normal build.
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${AE_SDK_EXAMPLES:?Set official AE SDK Examples}"
: "${PREMIERE_SDK_HEADERS:?Set official Premiere SDK Headers}"
probe_ref="${BC_NATIVE_PROBE_REF:-HEAD}"
probe_commit="$(git -C "$root" rev-parse --verify --end-of-options "$probe_ref^{commit}")"
probe_short="${probe_commit:0:7}"
float_probe="${BC_NATIVE_GPU_CLOCK_FLOAT_PROBE:-0}"
case "$float_probe" in 0|1) ;; *) printf '%s\n' 'BC_NATIVE_GPU_CLOCK_FLOAT_PROBE must be 0 or 1' >&2;exit 1;; esac
snapshot="$(mktemp -d "/tmp/bc-gpu-clock-$probe_short.XXXXXX")"
git -C "$root" archive "$probe_commit" | tar -x -C "$snapshot"
for file in source_time.hpp source_time_test.cpp render_time_diagnostics.hpp graph_time_diagnostics.hpp gpu_clock_diagnostics.hpp gpu_clock_test.cpp gpu_float_eligibility.hpp gpu_float_guard_test.cpp; do cp "$root/native/adobe/$file" "$snapshot/native/adobe/$file"; done
printf '#include "gpu_clock_diagnostics.hpp"\n' > "$snapshot/native/adobe/gpu_clock_diagnostics.cpp"
python3 - "$snapshot/native/adobe/build-macos.sh" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text();old='"$root/native/adobe/BetterCaptionsEffect.cpp"';assert old in s;s=s.replace(old,old+' "$root/native/adobe/gpu_clock_diagnostics.cpp"');p.write_text(s)
PY
if test "$float_probe" = 1; then
python3 - "$snapshot/native/adobe" <<'PYFLOAT'
from pathlib import Path
import sys
root=Path(sys.argv[1]);p=root/'BetterCaptionsEffect.cpp';s=p.read_text();s=s.replace('#include "source_time.hpp"','#include "source_time.hpp"\n#include "gpu_float_eligibility.hpp"');old='PF_Err render(PF_InData* in_data, PF_ParamDef* params[], PF_LayerDef* output) {';assert old in s;s=s.replace(old,old+'\n const auto formatError=better_captions::adobe::gpu_float_probe::guard(in_data,params,output);if(formatError)return formatError;');old='out_data->out_flags=PF_OutFlag_NON_PARAM_VARY;';assert old in s;s=s.replace(old,old+'\n {const auto formatError=better_captions::adobe::gpu_float_probe::setup(in_data,out_data);if(formatError)return formatError;}');p.write_text(s)
p=root/'BetterCaptionsPiPL.r';s=p.read_text();assert 'AE_Effect_Global_OutFlags_2 { 0 }' in s;s=s.replace('AE_Effect_Global_OutFlags_2 { 0 }','AE_Effect_Global_OutFlags_2 { 0x00001000 }');p.write_text(s)
PYFLOAT
fi
suffix="";if test "$float_probe" = 1;then suffix="-float";fi
output="${BC_NATIVE_OUTPUT_DIR:-$root/artifacts/native-gpu-clock-diagnostics-$probe_short$suffix}"
BC_NATIVE_OUTPUT_DIR="$output" BC_ENABLE_RENDER_TIME_DIAGNOSTICS=1 BC_ENABLE_CUSTOM_UI_PROBE=0 BC_ENABLE_SOURCE_TIME_PROBE=0 BC_ENABLE_ADJUSTMENT_TIME_PROBE=0 bash "$snapshot/native/adobe/build-macos.sh"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined -I "$PREMIERE_SDK_HEADERS" "$snapshot/native/adobe/gpu_clock_test.cpp" -o "$output/gpu_clock_test"
"$output/gpu_clock_test" "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe"
if test "$float_probe" = 1;then
 xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined -I "$PREMIERE_SDK_HEADERS" -I "$AE_SDK_EXAMPLES/Headers" -I "$AE_SDK_EXAMPLES/Headers/SP" "$snapshot/native/adobe/gpu_float_guard_test.cpp" -o "$output/gpu_float_guard_test"
 "$output/gpu_float_guard_test" "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe"
fi
shasum -a 256 "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe"
printf 'Committed source: %s\nSnapshot: %s\n' "$probe_commit" "$snapshot"
