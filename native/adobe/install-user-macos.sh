#!/bin/bash
set -euo pipefail
# Run only after coordinating and quitting Premiere. Does not quit/restart apps.
root="$(cd "$(dirname "$0")/../.." && pwd)"
build_dir="${BC_NATIVE_OUTPUT_DIR:-$root/artifacts/native}"
source="${BC_NATIVE_PLUGIN_SOURCE:-$build_dir/BetterCaptionsNativeProbe.plugin}"
parent="$HOME/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore"
target="$parent/BetterCaptionsNativeProbe.plugin"
test -f "$source/Contents/MacOS/BetterCaptionsNativeProbe"
test -f "$source/Contents/Resources/BetterCaptionsNativeProbe.rsrc"
test -f "$source/Contents/Info.plist"
# Always install this task's unique experimental bundle, never an arbitrary plugin.
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source/Contents/Info.plist")" = ca.swen.bettercaptions.nativeprobe
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$source/Contents/Info.plist")" = BetterCaptionsNativeProbe
codesign --verify --strict "$source"
mkdir -p "$parent" "$root/artifacts/native/install-backups"
stage="$(mktemp -d "$parent/.better-captions-install.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$source" "$stage/BetterCaptionsNativeProbe.plugin"
codesign --verify --strict "$stage/BetterCaptionsNativeProbe.plugin"
diff -qr "$source" "$stage/BetterCaptionsNativeProbe.plugin"
backup=""
if test -e "$target"; then
  backup="$(mktemp -d "$root/artifacts/native/install-backups/previous.XXXXXX")"
  mv "$target" "$backup/BetterCaptionsNativeProbe.plugin"
fi
if ! mv "$stage/BetterCaptionsNativeProbe.plugin" "$target"; then
  if test -n "$backup"; then mv "$backup/BetterCaptionsNativeProbe.plugin" "$target"; fi
  exit 1
fi
codesign --verify --strict "$target"
diff -qr "$source" "$target"
shasum -a 256 "$target/Contents/MacOS/BetterCaptionsNativeProbe" "$target/Contents/Resources/BetterCaptionsNativeProbe.rsrc"
printf 'Installed: %s\nPrevious experimental copy: %s\n' "$target" "${backup:-none}"
