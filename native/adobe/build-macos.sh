#!/bin/bash
set -euo pipefail
# Usage: AE_SDK_EXAMPLES=/path/to/official/Examples bash native/adobe/build-macos.sh
root="$(cd "$(dirname "$0")/../.." && pwd)"
: "${AE_SDK_EXAMPLES:?Set AE_SDK_EXAMPLES to the official AE SDK Examples directory}"
test -f "$AE_SDK_EXAMPLES/Headers/AE_Effect.h"
output="$root/artifacts/native/BetterCaptionsNativeProbe.plugin"
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
includes=(-I "$AE_SDK_EXAMPLES/Headers" -I "$AE_SDK_EXAMPLES/Headers/SP" -I "$AE_SDK_EXAMPLES/Util" -I "$AE_SDK_EXAMPLES/Resources")
xcrun clang++ -arch arm64 -std=c++17 -O2 -fvisibility=hidden -bundle \
  "${includes[@]}" "$root/native/adobe/BetterCaptionsEffect.cpp" \
  "$root/native/core/caption_core.cpp" "$root/native/macos/caption_rasterizer.mm" \
  -framework CoreText -framework CoreGraphics -framework CoreFoundation \
  -o "$output/Contents/MacOS/BetterCaptionsNativeProbe"
xcrun Rez -useDF -d __MACH__ -d __arm64__ "${includes[@]}" \
  "$root/native/adobe/BetterCaptionsPiPL.r" -o "$output/Contents/Resources/BetterCaptionsNativeProbe.rsrc"
cat > "$output/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BetterCaptionsNativeProbe</string>
<key>CFBundleIdentifier</key><string>ca.swen.bettercaptions.nativeprobe</string>
<key>CFBundleName</key><string>Better Captions Native Probe</string>
<key>CFBundlePackageType</key><string>eFKT</string>
<key>CFBundleSignature</key><string>FXTC</string>
<key>CFBundleVersion</key><string>0.1.0</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
</dict></plist>
PLIST
codesign --force --sign - "$output"
codesign --verify --strict "$output"
xcrun clang++ -arch arm64 -std=c++17 "${includes[@]}" \
  "$root/native/adobe/adapter_smoke_test.cpp" -o "$root/artifacts/native/adapter_smoke_test"
"$root/artifacts/native/adapter_smoke_test" "$output/Contents/MacOS/BetterCaptionsNativeProbe"
xcrun clang++ -arch arm64 -std=c++17 -fsanitize=address,undefined "${includes[@]}" \
  "$root/native/adobe/arbitrary_test.cpp" "$root/native/core/caption_core.cpp" -o "$root/artifacts/native/arbitrary_test"
"$root/artifacts/native/arbitrary_test"
printf '%s\n' "$output"
