#!/bin/bash
set -euo pipefail
# Usage: AE_SDK_EXAMPLES=/path/to/official/Examples bash native/adobe/build-macos.sh
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${AE_SDK_EXAMPLES:?Set AE_SDK_EXAMPLES to the official AE SDK Examples directory}"
test -f "$AE_SDK_EXAMPLES/Headers/AE_Effect.h"
build_dir="${BC_NATIVE_OUTPUT_DIR:-$root/artifacts/native}"
probe="${BC_ENABLE_CUSTOM_UI_PROBE:-0}"
bounds_ui="${BC_ENABLE_CAPTION_BOUNDS_UI:-1}"
time_probe="${BC_ENABLE_SOURCE_TIME_PROBE:-0}"
adjustment_probe="${BC_ENABLE_ADJUSTMENT_TIME_PROBE:-0}"
render_diagnostics="${BC_ENABLE_RENDER_TIME_DIAGNOSTICS:-0}"
case "$probe" in 0|1) ;; *) printf '%s\n' 'BC_ENABLE_CUSTOM_UI_PROBE must be 0 or 1' >&2; exit 1;; esac
case "$bounds_ui" in 0|1) ;; *) printf '%s\n' 'BC_ENABLE_CAPTION_BOUNDS_UI must be 0 or 1' >&2; exit 1;; esac
case "$time_probe" in 0|1) ;; *) printf '%s\n' 'BC_ENABLE_SOURCE_TIME_PROBE must be 0 or 1' >&2; exit 1;; esac
case "$adjustment_probe" in 0|1) ;; *) printf '%s\n' 'BC_ENABLE_ADJUSTMENT_TIME_PROBE must be 0 or 1' >&2; exit 1;; esac
case "$render_diagnostics" in 0|1) ;; *) printf '%s\n' 'BC_ENABLE_RENDER_TIME_DIAGNOSTICS must be 0 or 1' >&2; exit 1;; esac
output="$build_dir/BetterCaptionsNativeProbe.plugin"
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
includes=(-I "$AE_SDK_EXAMPLES/Headers" -I "$AE_SDK_EXAMPLES/Headers/SP" -I "$AE_SDK_EXAMPLES/Util" -I "$AE_SDK_EXAMPLES/Resources")
: "${PREMIERE_SDK_HEADERS:?Set PREMIERE_SDK_HEADERS to official Premiere SDK Examples/Headers for native source-time mapping}"
test -f "$PREMIERE_SDK_HEADERS/PrSDKAESupport.h"
includes=(-I "$PREMIERE_SDK_HEADERS" "${includes[@]}")
xcrun clang++ -arch arm64 -std=c++17 -O2 -fvisibility=hidden -DBC_ENABLE_CUSTOM_UI_PROBE="$probe" -DBC_ENABLE_CAPTION_BOUNDS_UI="$bounds_ui" -DBC_ENABLE_SOURCE_TIME_PROBE="$time_probe" -DBC_ENABLE_ADJUSTMENT_TIME_PROBE="$adjustment_probe" -DBC_ENABLE_RENDER_TIME_DIAGNOSTICS="$render_diagnostics" -bundle \
  "${includes[@]}" "$root/native/adobe/BetterCaptionsEffect.cpp" \
  "$root/native/core/caption_core.cpp" "$root/native/macos/caption_rasterizer.mm" \
  -framework CoreText -framework CoreGraphics -framework CoreFoundation \
  -o "$output/Contents/MacOS/BetterCaptionsNativeProbe"
xcrun Rez -useDF -d __MACH__ -d __arm64__ -d "BC_ENABLE_CUSTOM_UI_PROBE=$probe" -d "BC_ENABLE_CAPTION_BOUNDS_UI=$bounds_ui" "${includes[@]}" \
  "$root/native/adobe/BetterCaptionsPiPL.r" -o "$output/Contents/Resources/BetterCaptionsNativeProbe.rsrc"
cat > "$output/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BetterCaptionsNativeProbe</string>
<key>CFBundleIdentifier</key><string>ca.swen.bettercaptions.nativeprobe</string>
<key>CFBundleName</key><string>S-Captions</string>
<key>CFBundlePackageType</key><string>eFKT</string>
<key>CFBundleSignature</key><string>FXTC</string>
<key>CFBundleVersion</key><string>0.1.0</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
</dict></plist>
PLIST
codesign --force --sign - "$output"
codesign --verify --strict "$output"
xcrun clang++ -arch arm64 -std=c++17 -DBC_ENABLE_CUSTOM_UI_PROBE="$probe" -DBC_ENABLE_CAPTION_BOUNDS_UI="$bounds_ui" -DBC_ENABLE_SOURCE_TIME_PROBE="$time_probe" "${includes[@]}" \
  "$root/native/adobe/adapter_smoke_test.cpp" "$root/native/core/caption_core.cpp" -o "$build_dir/adapter_smoke_test"
"$build_dir/adapter_smoke_test" "$output/Contents/MacOS/BetterCaptionsNativeProbe"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/arbitrary_test.cpp" "$root/native/core/caption_core.cpp" -o "$build_dir/arbitrary_test"
"$build_dir/arbitrary_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/render_style_test.cpp" "$root/native/core/caption_core.cpp" -o "$build_dir/render_style_test"
"$build_dir/render_style_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/parameter_sections_test.cpp" -o "$build_dir/parameter_sections_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/purposeful_controls_test.cpp" -o "$build_dir/purposeful_controls_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/boundary_parameters_test.cpp" -o "$build_dir/boundary_parameters_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/dimension_defaults_test.cpp" -o "$build_dir/dimension_defaults_test"
"$build_dir/dimension_defaults_test"
"$build_dir/boundary_parameters_test"
"$build_dir/purposeful_controls_test"
"$build_dir/parameter_sections_test"
if test "$probe" = 1 || test "$bounds_ui" = 1; then
  xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
    "$root/native/adobe/custom_ui_test.cpp" -o "$build_dir/custom_ui_test"
  "$build_dir/custom_ui_test"
fi
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/source_time_test.cpp" -o "$build_dir/source_time_test"
"$build_dir/source_time_test"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined \
  "$root/native/adobe/temporary_bounds_test.cpp" -o "$build_dir/temporary_bounds_test"
"$build_dir/temporary_bounds_test"
printf '%s\n' "$output"
