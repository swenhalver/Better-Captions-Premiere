# Experimental Adobe effect adapter

`BetterCaptionsEffect.cpp` is an original, narrow AE-effect-API adapter compiled
against Adobe's official 26.5 SDK headers. `BetterCaptionsPiPL.r` uses the SDK's
resource types. No SDK header, utility implementation or sample project is
vendored. Keep SDK downloads outside this repository and retain their license.

```sh
AE_SDK_EXAMPLES="/path/to/AdobeAfterEffectsSDK_26.5_MacOS/Examples" \
  bash native/adobe/build-macos.sh
```

Requires Xcode command-line tools and an Apple Silicon Mac. The script produces
an ad-hoc signed arm64 plug-in at
`artifacts/native/BetterCaptionsNativeProbe.plugin`, checks its signature, and
runs SDK-structure adapter and arbitrary-data callback smoke tests. It does not
install the plug-in or restart Premiere. Signing is for local development; no
notarization or signed distribution installer is supplied.

To build a local, unsigned installer package after the plug-in build:

```sh
bash native/adobe/package-macos.sh
```

This creates `artifacts/native/BetterCaptionsNativeProbe.pkg` without opening or
installing it. Its only file payload is the uniquely named
`BetterCaptionsNativeProbe.plugin` in
`/Library/Application Support/Adobe/Common/Plugins/7.0/MediaCore/`, the shared
path documented by Premiere SDK 26. It has no install/uninstall scripts and
does not restart apps. Installing requires macOS administrator authorization and
coordinated Premiere testing. The package may replace an existing copy of that
same experimental plug-in name; preserve prior experimental builds separately.

Effect match name: `com.swen.bettercaptions.native.experimental`. Stable disk IDs:

| ID | Parameter | Stream |
| --- | --- | --- |
| 1 | Position | native point, center of caption box |
| 2 | Width | native number, independent pixels |
| 3 | Height | native number, independent pixels |
| 4 | Characters per caption | native number, 1–500 |
| 5 | Font size | native number |
| 6 | Text color | native color |
| 7 | Caption document (experimental) | hidden static arbitrary data |

The visible styles/controls are deliberately limited for the host prototype.
Font size and color override those values in the embedded document. Other style
fields come from the document; there is no panel transcript/style transport yet.
There are no custom Program Monitor drag handles yet. Never interpret a native
point control or a rendered caption rectangle as proof of custom dragging.

The default document is a synthetic eight-second phrase fixture. Rendering reads
embedded schema-v1 bytes when present. A null arb value explicitly falls back to
the repeating synthetic demo; invalid non-null bytes return an error. All arb
lifecycle selectors are implemented using SDK host handles and bounded portable
serialization. `BCDOC1:` printable hex supports the SDK print/scan lifecycle; it
is not an implemented CEP/UXP transport protocol. Arbitrary-data interpolation
holds the left document until the right endpoint, and the document parameter is
not time varying.

The renderer currently accepts only SDK-baseline premultiplied ARGB 8-bit frames
and converts its CoreGraphics premultiplied RGBA bitmap explicitly. It advertises
no AE 16-bit, SmartFX, GPU, Premiere float/YUV or AEGP support. It depends only on
system CoreText, CoreGraphics, CoreFoundation, libc++ and libSystem. Host loading,
format conversion, render-time scaling, trim/split times, undo and project
persistence still require actual Premiere acceptance tests.

`adapter_smoke_test.cpp` dlopens the real binary and exercises its setup and render
entry point using SDK structures. `arbitrary_test.cpp` supplies test host-handle
callbacks and checks copying, flatten/unflatten, malformed data and disposal with
ASAN/UBSAN. These are isolated tests, not evidence that Premiere calls the same
paths correctly. Follow [the host acceptance plan](../../docs/native-effect-acceptance.md).
