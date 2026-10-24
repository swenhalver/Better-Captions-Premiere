# Native caption experiment

This directory builds a portable C++ caption data/layout core, a macOS
CoreText/CoreGraphics bitmap renderer, and a real compiled experimental Adobe
effect adapter. Premiere 26.5.2 has discovered/applied the native effect and
rendered actual caption frames with live document/style updates. New instances
place text toward the bottom. The intended host is an adjustment layer; the
guarded transfer rejects footage clips. Program Monitor handles draw in an
optional probe, while click/drag input remains unverified. The working
Better Captions release is separate from this experiment.

## Build and test

Use CMake 3.20+ and a C++17 compiler (Apple Clang on macOS, MSVC on Windows, or
Clang/GCC). No Adobe application or SDK is needed for these core tests.

```sh
cmake -S native -B /tmp/better-captions-core-build -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/better-captions-core-build --config Debug
ctest --test-dir /tmp/better-captions-core-build -C Debug --output-on-failure
```

On Windows, choose an external build directory such as
`C:/Temp/better-captions-core-build` instead of `/tmp/...`. `--config Debug`
supports multi-configuration generators such as Visual Studio and Xcode.

Optional Clang/GCC sanitizers:

```sh
cmake -S native -B /tmp/better-captions-core-asan -DCMAKE_BUILD_TYPE=Debug -DBC_ENABLE_SANITIZERS=ON
cmake --build /tmp/better-captions-core-asan --config Debug
ctest --test-dir /tmp/better-captions-core-asan -C Debug --output-on-failure
```

`BUILD_TESTING=OFF` omits tests; macOS also builds `better_captions_macos`. Sanitizers are optional
and fail configuration explicitly on unsupported compiler selections.

## Current core boundary

`core/caption_core.hpp` defines a bounded schema-v3 caption document with a persisted timing origin, independent
upcoming/current/spoken styles, stable container IDs, derived phrase grouping,
versioned binary encode/decode, and frame layout commands. Phrase grouping always
uses the fixed Characters per caption limit, sentence endings and pauses. The panel
can measure width and write a fixed character limit. Layout uses a supplied
text-metrics callback: each platform renderer supplies font shaping and rasterizes
glyphs, bubbles, outlines and shadows. Width changes can reflow commands at the
same font size, including in exported native Premiere frames. Title Case currently
converts ASCII characters only and preserves the source transcript and UTF-8
bytes. It is not a complete language-aware title-casing algorithm.

On macOS, `better_captions_macos` supplies real CoreText metrics and bitmap
rasterization; `caption_rasterizer_test` exercises it outside Premiere. This
platform implementation is linked by `adobe/BetterCaptionsEffect.cpp`. Baseline
ARGB8 host rendering is verified; additional pixel formats and full coordinate
coverage remain pending.

## Build the experimental Adobe effect

```sh
AE_SDK_EXAMPLES="/path/to/AdobeAfterEffectsSDK_26.5_MacOS/Examples" \
PREMIERE_SDK_HEADERS="/path/to/Premiere Pro 26.0 C++ SDK/Examples/Headers" \
  bash native/adobe/build-macos.sh
# After coordinating and quitting Premiere:
bash native/adobe/install-user-macos.sh
```

The first command builds and ad-hoc signs
`artifacts/native/BetterCaptionsNativeProbe.plugin`, then runs a dynamic-load
adapter smoke test and ASAN/UBSAN arbitrary-data lifecycle tests. The second
installs only the uniquely named experimental plug-in in the observed working
per-user `~/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/`,
backs up an existing experimental copy, compares files and verifies signature/hashes.
It requires no administrator access and does not quit/restart applications.
Coordinate host testing before installation. See
[adapter details and limitations](adobe/README.md).

The adapter exposes native Position, Width, Height, Characters, Global font size
(64 = 1x) and Global text tint parameters, plus a hidden static versioned document.
Neutral global size/tint preserve each word state's independent size/color.
Premiere requests each frame at the timeline's rational timestamp; there is no
fixed/source-FPS render scheduler. The existing movie exporter also uses the
active timeline rate and verifies it with FFprobe, including fractional rates.

`PF_Cmd_RENDER` uses embedded caption data; a synthetic fixture is provided for
new probe instances. Guarded CEP scripts have performed an exact read/write and
immediate native-frame update. Arbitrary data uses validated UTF-16LE `BCDOC1:`
hex, with a 16 MiB carrier / 4,194,300-byte document limit. SDK-created handles
include a terminator; project flattening emits exact-length UTF-16 without it,
matching Premiere's observed setter representation. Legacy raw BCAP and earlier
UTF-16 carriers are accepted. Real host save/reopen and sequence cloning have
preserved caption text. Full panel binding and clip copy/paste acceptance remain
pending; see the detailed acceptance record.

`package-macos.sh` optionally produces an unsigned package for the SDK-documented
global `Common/Plugins/7.0/MediaCore` path. In this installed Premiere, the loading
log scanned/loaded the per-user **Plug-ins** path and did not scan that canonical
global **Plugins** path. The package is not the verified installation route here.
Rebuild it after any binary change before using it elsewhere.

## SDK and build provenance

Obtain the SDK using [Adobe's Premiere developer page](https://developer.adobe.com/premiere-pro/)
and its [official download console](https://developer.adobe.com/console/servicesandapis/pr).
The [AE effect SDK download](https://developer.adobe.com/console/servicesandapis/ae)
also uses Adobe Developer Console. Both official SDK archives have now been
acquired through that route. No SDK headers or sample implementations are
vendored here. Adobe documents a Personal-account
workaround for [Restricted Access](https://developer.adobe.com/premiere-pro/access-the-developer-console/).

Downloaded archive SHA-256 (2026-10-18):

| Official archive | SHA-256 |
| --- | --- |
| `AfterEffectsSDK_26.5_MacOS.zip` | `7b837d594696ca0ece1ddba5e15b0fd3bf1ee908a1c7be04d4627180aa7ece7e` |
| `Premiere Pro 26.0 C++ SDK MacOS.zip` | `cd82dcdb4689b542b77f97110985793d05fb8da665ecd27706003894e5dba2c4` |

Built on macOS 26.6.2 (25G83), Xcode 27.1 (27A9275), Apple clang
21.0.0 (`clang-2100.3.34.2`), arm64. The original adapter includes real SDK
headers and resource types from the external installation. SDK samples were
inspected for API/build conventions; Adobe utility implementations are not copied.
Keep licensed SDK files outside the repository unless redistribution is explicitly
permitted. Host loading/rendering must pass before panel migration.

Adobe documents [Premiere support for the AE effect API](https://ae-plugins.docsforadobe.dev/ppro/ppro/).
The binary has loaded and rendered inside Premiere without After Effects,
Dynamic Link, or an AE-authored MOGRT. Do not introduce
AEGP dependencies: Premiere does not support them. See the
[acceptance plan](../docs/native-effect-acceptance.md) before installing anything.
