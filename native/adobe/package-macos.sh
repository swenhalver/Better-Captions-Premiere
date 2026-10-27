#!/bin/bash
set -euo pipefail
# Produces a package only. Opening/installing it requires separate coordination.
root="$(cd "$(dirname "$0")/../.." && pwd)"
plugin="$root/artifacts/native/BetterCaptionsNativeProbe.plugin"
test -f "$plugin/Contents/MacOS/BetterCaptionsNativeProbe"
codesign --verify --strict "$plugin"
stage="$(mktemp -d /tmp/better-captions-native-pkg.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
destination="$stage/Library/Application Support/Adobe/Common/Plugins/7.0/MediaCore"
mkdir -p "$destination"
ditto --norsrc --noextattr --noacl "$plugin" "$destination/BetterCaptionsNativeProbe.plugin"
pkgbuild --analyze --root "$stage" "$stage/components.plist"
if /usr/libexec/PlistBuddy -c 'Print :0' "$stage/components.plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c 'Add :0:BundleIsRelocatable bool false' "$stage/components.plist"
fi
# Keep metadata outside the payload root.
mv "$stage/components.plist" "$stage-components.plist"
trap 'rm -rf "$stage"; rm -f "$stage-components.plist"' EXIT
COPYFILE_DISABLE=1 pkgbuild --root "$stage" --install-location / \
  --component-plist "$stage-components.plist" \
  --identifier ca.swen.bettercaptions.nativeprobe.experimental --version 0.1.0 \
  --ownership recommended "$root/artifacts/native/BetterCaptionsNativeProbe.pkg"
pkgutil --payload-files "$root/artifacts/native/BetterCaptionsNativeProbe.pkg"
