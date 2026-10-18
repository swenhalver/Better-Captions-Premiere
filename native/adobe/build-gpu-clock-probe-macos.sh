#!/bin/bash
set -euo pipefail
# Explicit isolated diagnostic only. It does not install or modify the normal build.
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${AE_SDK_EXAMPLES:?Set official AE SDK Examples}"
: "${PREMIERE_SDK_HEADERS:?Set official Premiere SDK Headers}"
probe_ref="${BC_NATIVE_PROBE_REF:-HEAD}"
probe_commit="$(git -C "$root" rev-parse --verify --end-of-options "$probe_ref^{commit}")"
probe_short="${probe_commit:0:7}"
snapshot="$(mktemp -d "/tmp/bc-gpu-clock-$probe_short.XXXXXX")"
git -C "$root" archive "$probe_commit" | tar -x -C "$snapshot"
for file in source_time.hpp source_time_test.cpp render_time_diagnostics.hpp graph_time_diagnostics.hpp gpu_clock_diagnostics.hpp gpu_clock_test.cpp; do cp "$root/native/adobe/$file" "$snapshot/native/adobe/$file"; done
printf '#include "gpu_clock_diagnostics.hpp"\n' > "$snapshot/native/adobe/gpu_clock_diagnostics.cpp"
python3 - "$snapshot/native/adobe/build-macos.sh" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text();old='"$root/native/adobe/BetterCaptionsEffect.cpp"';assert old in s;s=s.replace(old,old+' "$root/native/adobe/gpu_clock_diagnostics.cpp"');p.write_text(s)
PY
output="${BC_NATIVE_OUTPUT_DIR:-$root/artifacts/native-gpu-clock-diagnostics-$probe_short}"
BC_NATIVE_OUTPUT_DIR="$output" BC_ENABLE_RENDER_TIME_DIAGNOSTICS=1 BC_ENABLE_CUSTOM_UI_PROBE=0 BC_ENABLE_SOURCE_TIME_PROBE=0 BC_ENABLE_ADJUSTMENT_TIME_PROBE=0 bash "$snapshot/native/adobe/build-macos.sh"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined -I "$PREMIERE_SDK_HEADERS" "$snapshot/native/adobe/gpu_clock_test.cpp" -o "$output/gpu_clock_test"
"$output/gpu_clock_test" "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe"
shasum -a 256 "$output/BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe"
printf 'Committed source: %s\nSnapshot: %s\n' "$probe_commit" "$snapshot"
