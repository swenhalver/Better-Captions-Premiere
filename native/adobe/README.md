# Experimental Adobe effect adapter

`BetterCaptionsEffect.cpp` is an original, narrow AE-effect-API adapter compiled
against Adobe's official 26.5 SDK headers. `BetterCaptionsPiPL.r` uses the SDK's
resource types. No SDK header, utility implementation or sample project is
vendored. Keep SDK downloads outside this repository and retain their license.

## Current experimental Mac status

The opt-in straight-alpha Metal compositor is the installed experimental effect;
the panel remains 0.7.11. The installed diagnostics-disabled preview repair is
`8c4ad9b0`, with metallib prefix `dd6d2a53`. It passed a coordinated Premiere
restart and fresh active Full/half/quarter scrub checks. Diagnostic candidate
`3e425102` established the raw-divisor/error trace. This path is experimental and
separate from the ordinary CPU build below.

Actual SDR Mac host exports now pass 30 fps baseline/UI-Razor/moved-split raw-pixel
equality and whole-layer movement with captions following their adjustment layer.
Opacity 100/50/0 exports match an independent CPU straight-source-over reference
(R/G/B max error 1, alpha exact, untouched pixels unchanged). Fresh initial
attachments also pass the “Native”→“captions” boundary at 29.97 frames 59→60 and
23.976 frames 47→48, with paired hashes identical across rates. Their persisted
origins were captured from actual `(inPoint-start)` after setting FPS; changing
FPS on an already attached document remains a separate preservation limitation.

The GPU renderer consumes Premiere's request
`inClipTime / ticksPerSecond - persistedOrigin`; it does not poll CTI or borrow
the footage clock. The standard
CPU fallback still has the historical adjustment-layer cut/move clock defect.
The verified Metal candidate remains installed rather than restoring that failed
CPU candidate. HDR/linear, 16f host frames, Windows, custom dragging, copy/paste
and performance remain unaccepted. After an actual Premiere restart, UI-Razor,
whole-layer move and both fractional fixtures reproduce the earlier pixels;
out-of-order 1→5→1 second seeks are deterministic. Seven private test sequences
were archived and removed, all 22 original scratch graphs/CTIs were preserved,
and four private control plug-ins were moved to recovery while Premiere was quit.
The production project's SHA-256 is unchanged.

Actual active Program Monitor scrubs at Full, 1/2 and 1/4 resolution now show
both underlying footage and captions. Premiere's GPU downsample fields are
divisors: the observed half/quarter requests report 2/4, respectively. The
renderer converts them to reciprocal geometry/style scales before rendering.
Previously it rejected values above one and returned an error that blacked out
the entire adjustment-layer result. Full-resolution export acceptance alone did
not exercise that failure. The repair changes no caption document or render clock.

The current candidate supports the verified single-bundle setup and uniform
preview scaling. Unequal X/Y glyph/PAR behavior and module-relative metallib
lookup remain hardening items. Synchronous Metal completion has not been
performance-qualified.

Local evidence is under ignored `artifacts/host-scratch/`, including
`gpu-straight-reference/comparison-receipt.json`, `gpu-straight-timing-receipt.json`,
`gpu-straight-frame-hashes.json` and `gpu-fractional-fresh-fixtures.json`.
See [the acceptance record](../../docs/native-effect-acceptance.md) for hashes and
scope. Build the separate compositor only with the explicit experiment script:

```sh
bash native/adobe/build-gpu-caption-probe-macos.sh
```

The SDK environment variables used below are required. This script builds only;
it does not install, restart Premiere, or replace the standard artifact. It adds
Foundation/Metal and an original metallib to the CPU dependencies listed below.
It emits `gpu-caption-provenance.json` with the archived base, actual overlaid
source hashes, effective patched inputs, SDK header hashes, current compiler
versions and output hashes. The accepted candidate also has a retrospective
manifest, explicitly distinguished from contemporaneous build evidence.

For a separate scrub investigation, set `BC_GPU_SCRUB_DIAGNOSTICS=1` and use a
separate `BC_NATIVE_OUTPUT_DIR`. The default is zero. This adds numeric callback
entry/exit/error/duration records, raw preview divisors, quality and realtime
hints to `/tmp/better-captions-native-gpu-scrub-<PID>.log`. The file is owner-only,
bounded to 32 MiB and 65,536 records per process, and uses a nonblocking write
lock. Contended records may be dropped. Caption contents are not logged. The
flag does not alter rendering or realtime hints; the existing bounded legacy
GPU trace is independent of this opt-in logger. Provenance records the flag.

Install that explicit artifact only after quitting Premiere:

```sh
BC_NATIVE_PLUGIN_SOURCE="/absolute/path/to/BetterCaptionsNativeProbe.plugin" \
  bash native/adobe/install-user-macos.sh
```

This per-user route needs no password or fingerprint prompt. Do not run the
standard CPU installer over the accepted Metal artifact when testing its fix.

## Standard CPU build (historical timing limitation)

```sh
AE_SDK_EXAMPLES="/path/to/AdobeAfterEffectsSDK_26.5_MacOS/Examples" \
  PREMIERE_SDK_HEADERS="/path/to/Premiere Pro 26.0 C++ SDK/Examples/Headers" \
  bash native/adobe/build-macos.sh
```

Requires Xcode command-line tools and an Apple Silicon Mac. The script produces
an ad-hoc signed arm64 plug-in at
`artifacts/native/BetterCaptionsNativeProbe.plugin`, checks its signature, and
runs SDK-structure adapter and arbitrary-data callback smoke tests. It does not
install the plug-in or restart Premiere. Signing is for local development; no
notarization or signed distribution installer is supplied.

After coordinating and quitting Premiere, the observed working user install is:

```sh
bash native/adobe/install-user-macos.sh
```

This installs only the experimental bundle under
`~/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/`, preserves
any previous experimental bundle in `artifacts/native/install-backups/`, and
verifies signature, file equality and binary/resource hashes. It does not quit
or restart apps. Premiere 26.5.2's Plugin Loading.log confirms scanning/loading
this exact per-user path. The SDK-documented global path below was not scanned
by this installation; do not use its package as the verified route here.

To build an optional local, unsigned installer package after the plug-in build:

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
| 5 | Global font size (64 = 1x) | native number; neutral 64 |
| 6 | Global text tint | native color; neutral white |
| 7 | Caption document (experimental) | hidden static arbitrary data |

The visible styles/controls are deliberately limited for the host prototype.
Global font size multiplies each upcoming/current/spoken font size by `value/64`;
64 preserves all document sizes, while 128 doubles each. Each state's independent
font family, sizeScale/enlargement, opacity and color alpha remain intact. Global
text tint multiplies each state's RGB components, so white preserves all colors.
Bubble/outline/shadow colors remain independent. At full resolution, neutral
controls leave the entire document's style encoding byte-identical. Render-local
copies are changed; stored transcript/styles are preserved. Style values that
exceed validated renderer bounds after scaling return an error.

Font size, padding, radius, outline width, shadow blur/offsets and word spacing
are adjusted for downsampling. Point positions are used directly: the SDK
[PF_InData contract](https://ae-plugins.docsforadobe.dev/effect-basics/PF_InData/)
explicitly states that hosts already adjust point control values for downsampling.
The official SDK's CCU renderer follows the same rule. A compiled full/half render
test passes host-adjusted point values and verifies normalized text placement.
These CPU checks are distinct from the Metal path's live Full/half/quarter
acceptance above. Expanded/cropped buffers remain separate host acceptance cases.

The CEP string carrier is implemented following observed UTF-16 serialized values;
CEP write/readback and edited transcript rendering passed in Premiere on the
preceding schema1 prototype. BCAPv2 origins survived Premiere restart and CEP
readback; adjustment-layer rendering passed before splitting and after moving a
split right half. Those earlier CPU Razor tests failed, as detailed below; the opt-in Metal cases
now pass as recorded above.
`getValue` exposed the
FLATTEN representation, so binary BCAP flattening appeared as truncated text.
The current FLATTEN representation is exact-length UTF-16LE `BCDOC1:` hex.
New instances default to Position 50%/90%, Height 150 px. Existing authored values
and keyframes are not changed by those defaults.

The default document is a synthetic eight-second phrase fixture. Rendering reads
embedded BCAPv2 bytes, with explicit `timeOriginSeconds`; legacy BCAPv1 decodes
with origin0. A null arb value explicitly falls back to the repeating synthetic
demo; invalid non-null bytes return an error. Only full encoded equality to the
built-in fixture bypasses the real-document origin mapping. Its ID alone is not
enough, so a custom transcript cannot accidentally be treated as the demo. All arb
lifecycle selectors are implemented using SDK host handles and bounded portable
serialization. `BCDOC1:` printable hex is carried in UTF-16LE. SDK-created handles
include a NUL; FLATTEN emits exact-length text without it, matching observed CEP
serialization. UNFLATTEN accepts either one trailing NUL or none, rejects embedded
NULs, and also accepts earlier experimental binary BCAP for migration. Binary
BCAP remains the versioned payload inside the `BCDOC1:` text envelope; envelope
version1 and document schemas1–3 are distinct. BCAP3 adds optional weight/italic/relative-B typography without changing the carrier or parameter disk IDs; untouched older documents retain their exact version. The carrier is limited
to 16 MiB, equivalent to 4,194,300 binary document bytes.
Strict checks reject malformed UTF-16, invalid hex, unsupported schema and limits.
Arbitrary-data interpolation
holds the left document until the right endpoint, and the document parameter is
not time varying.

The standard CPU renderer accepts only SDK-baseline premultiplied ARGB 8-bit frames
and converts its CoreGraphics premultiplied RGBA bitmap explicitly. That standard build advertises
no AE16-bit, SmartFX, GPU, Premiere float/YUV or AEGP support; the opt-in Metal
companion above is a separate build. It depends only on
system CoreText, CoreGraphics, CoreFoundation, libc++ and libSystem. Premiere
loading and baseline ARGB caption rendering are verified; remaining formats,
render-time scaling, trim/split times, undo and project persistence require tests.

## Optional custom Program Monitor probe

`BC_ENABLE_CUSTOM_UI_PROBE=1` compiles real SDK custom COMP registration,
Drawbot overlay handles, click hit testing and drag updates to the same native
Position/Width/Height parameters. It is disabled by default. Syntax and mocked
event tests pass; actual Premiere event delivery is unverified. Example isolated
build (do not install concurrently with another host test):

```sh
AE_SDK_EXAMPLES="/path/to/AE/Examples" \
  PREMIERE_SDK_HEADERS="/path/to/Premiere/Examples/Headers" BC_ENABLE_CUSTOM_UI_PROBE=1 \
  BC_NATIVE_OUTPUT_DIR="/tmp/better-captions-ui-probe-build" \
  bash native/adobe/build-macos.sh
```

Premiere has delivered genuine COMP new-context/activate/draw events and displayed
the four blue overlay handles. A host drag attempt did not deliver DO_CLICK/DRAG
callbacks and did not change Position. Therefore drawing is accepted, input/drag
support is unverified and the probe stays off in the standard build.

The probe logs bounded non-content event diagnostics to
`/tmp/better-captions-native-ui-probe.log`. Center moves, right changes width,
bottom changes height, and lower-right changes both independently around the
fixed center. No aspect lock is applied. Host coordinate conversion callbacks
are required; unsupported suites/callbacks leave scalar controls available.
This does not establish keyframe/easing/undo/cancel behavior. A native point
control or rendered rectangle alone is not proof of custom dragging.

## Historical CPU document timing and diagnostic progression

The requested host surface is an actual Premiere adjustment layer. Premiere gives
new adjustment layers a one-hour source in-point; this is not the document's first
word time and must not be guessed away. `timeOriginSeconds` is explicit persisted
document data, captured by panel application from the target clip's in-point and
timeline start without changing word timings. It travels with copies and Razor
splits. Legacy documents keep origin0 until an explicit migration/application.

Observed adjustment-layer timing differs between unmoved and moved split items.
The relationship to underlying footage is a hypothesis, not an established SDK
contract. The historical CPU path uses the queried rendering sequence clock and
this layer's track start. This experimental ordinary-speed mapping remains
unchanged pending controlled host diagnosis:

```text
document seconds = (GetSequenceTime
                  + (GetUnscaledClipStart - GetTrackItemStart) * GetMediaFrameRate)
                 / GetTicksPerSecond - document.timeOriginSeconds
```

`GetUnscaledClipStart` is a frame count in the effect/sequence rate reported by
`GetMediaFrameRate`, not necessarily the original file's frame rate. Host evidence:
a 24 fps source trimmed in at four seconds in a 30 fps sequence reported start120,
effect-frame ticks8467200000, and clock254016000000; local1 maps to source5.
Moving that item to timeline10 leaves its source start120, while track start becomes300.
The original 24 fps rate must not be used to divide that 120-frame value.

Actual adjustment-layer calibration with footage beneath it: a split right half
had source in3604, timeline start10, PF local1 at timeline11, start frame108120,
effect frame ticks8467200000, speed1 and synthetic=true. Persisted document
origin3600 produced word time5 and the expected visible caption in that moved case.
Before splitting, the same document also rendered the expected word at timeline5.

Both an actual Premiere UI Razor cut and a QE cut at4 produce a right half at
timeline start4/source in3604 that renders blank at explicit CTI5. Invalidating a
native control, reopening, moving one frame away/back, applying a fresh effect
instance and cutting the underlying footage at4 did not repair it. The exact UI
cut render reports PF150/30, SDK sequence9, track start4, source start3604 and
origin3600, producing document9 and zero caption alpha. This is correlated render
evidence, not a speculative startup request.

Moving a whole uncut layer from start0 to4 above continuous footage also fails:
sequence5 produces document5 where document1 is required by the move-with-layer
policy. The earlier split item at start10 above footage also starting10 remains
an isolated passing case, not complete move acceptance. Compiled regressions
verify arithmetic under supplied clocks; they do not establish host success.

The bounded graph probe matches this effect's SDK filter-instance ID and finds
Compositor → Adjustment → Clip → Effect. Its own clip edge offset tracks the
layer's start/in-point, but the owner query fails, node start/end properties are
unavailable, tested transforms are identities and root offsets depend on the
requested graph time. None supplies an independent CPU render clock. A controlled
WIDE_TIME_INPUT build reproduced the failure and was rejected.

An isolated GPU companion probe inspects the SDK's explicit per-request sequence
time, clip time and render ticks per frame. It also logs the arbitrary parameter's
type/size/bounded binary prefix and native point units. Its CPU render diagnostics
include optional sequence zero point/duration and PF total/local-step metadata;
those fields never alter the mapping. Build it separately with:

```sh
AE_SDK_EXAMPLES="/path/to/AE/Examples" \
  PREMIERE_SDK_HEADERS="/path/to/Premiere/Examples/Headers" \
  bash native/adobe/build-gpu-clock-probe-macos.sh
```

The script snapshots committed HEAD (or `BC_NATIVE_PROBE_REF`), overlays only the
owned timing diagnostics and runs SDK/GPU ABI checks. It does not modify the
normal artifact, install or restart Premiere. The probe returns no GPU frame;
it is not a renderer or evidence of software fallback. The first host test found
the companion entry and created/disposed GPU instances, but sent no frame requests
during guarded exports, seeking or brief playback in a Mercury Metal project.
CPU sequence zero point/duration metadata did not resolve the timing error.

Set `BC_NATIVE_GPU_CLOCK_FLOAT_PROBE=1` only for a separate eligibility experiment.
It changes the snapshot's format advertisement/PiPL to FLOAT_COLOR_AWARE and
BGRA32f/ARGB8, while guarding the CPU renderer against unsupported float frames
before writing any pixels. GPU device metadata logs use named numeric fields.
This does not implement float rendering or change the normal build.

The subsequent controlled host comparison identified an additional dispatch
condition: writing zero to `PrGPUFilterInstance.outIsRealtime` suppressed
adjustment-layer frame requests. Preserving Premiere's incoming value (observed
as one) enabled them. The diagnostic now preserves that value. A minimal control
with actual Smart Render handlers but still forcing zero did not enable GPU
requests; Adobe's SDK Vignette and the realtime-preserving control did.

The caption probe then received full-size GPU requests for the exact embedded
adjustment-layer documents. Bounded carrier fingerprints matched MCP readback;
the host supplied UTF-16LE `BCDOC1:` data, decoded as BCAP2 with origin 3600 and
four words. At 30fps the observed `(sequence seconds, clip seconds)` pairs were
uncut `(5,3605)`, whole-layer move `(5,3601)`, actual UI Razor right side
`(5,3605)`, and moved split `(11,3605)`. Thus the GPU candidate can use
`inClipTime / ticksPerSecond - persistedOrigin` for those cases without a graph
or playhead cache. That diagnostic established a request clock, not rendered output. Its frame
exports failed by design. It has since been superseded by the accepted straight
Metal compositor above; software timing remains unresolved.
Detailed test receipts are in
[the acceptance record](../../docs/native-effect-acceptance.md).

The adapter does not infer that every synthetic clip has origin3600. Adjustment
layers need underlying rendered coverage; the host does not render the effect
over an otherwise empty timeline region.

The CPU path is scheduled at the timeline's cadence, despite its unresolved
layer-clock defect. Premiere invokes `PF_Cmd_RENDER`
for its requested sequence frames; the adapter consumes the SDK render-sequence
clock and this layer's timeline start, and returns one bitmap for that request.
PF raw time is used only by the built-in demo and opt-in diagnostics. It creates no
source-FPS frame schedule, frame-index quantization, intermediate movie or encoder
frame-rate setting. `GetMediaFrameRate` is used only to convert the reported trim
frame offset into seconds; the host's cross-FPS probe confirmed that this callback
reports effect/timeline frame ticks in this context. The original source frame
rate is never queried for either scheduling or this conversion.

Fractional-rate regressions use timeline29.97 (`1001/30000` seconds/frame) and
23.976 (`1001/24000` seconds/frame), exact host-style render-sequence ticks and
queried tick scales. They verify both the trim offset and the next-frame advance;
there is no `1/30`, nominal-FPS rounding or source-FPS conversion in the renderer.

The mapping uses actual external Premiere SDK declarations and queried host time
scale; no constants or guessed timeline offsets. `GetClipSpeed` must report 1.
Retimed/reversed clips, unavailable callbacks, callback failures and invalid frame
rates fail explicitly until separately implemented and host-verified. The build
therefore requires `PREMIERE_SDK_HEADERS` for both standard and diagnostic builds.

`BC_ENABLE_SOURCE_TIME_PROBE=1` adds bounded numeric diagnostics to this mapping.
Additional current-media-time layer candidates0/UINT32_MAX/1 are queried read-only;
they returned errors516/512 in the tested host and do not select a mapping.
Diagnostic failures do not alter the ordinary mapping or hide working frames.

```sh
AE_SDK_EXAMPLES="/path/to/AE/Examples" \
  PREMIERE_SDK_HEADERS="/path/to/Premiere/Examples/Headers" \
  BC_ENABLE_SOURCE_TIME_PROBE=1 BC_NATIVE_OUTPUT_DIR="/tmp/bc-source-time-probe" \
  bash native/adobe/build-macos.sh
```

The opt-in diagnostics write bounded numeric timing/status information only to
`/tmp/better-captions-native-source-time-probe.log`. Mock renders have no host
effect reference and do not write this log. `source_time_test.cpp` verifies the
actual host-calibration numbers, modeled split/moved timing, original-FPS exclusion and
explicit unsupported-speed/error paths under ASAN/UBSAN. The standard binary has
custom UI and diagnostics off; strings/dependency inspection confirms no probe
log-path strings and only the intended system-library dependencies.

After exclusive host-test coordination and quitting Premiere, an explicit probe
build directory can be selected using `BC_NATIVE_OUTPUT_DIR=/absolute/probe-build`
with `install-user-macos.sh`, matching `build-macos.sh`. The more specific
`BC_NATIVE_PLUGIN_SOURCE=/absolute/probe.plugin` takes precedence if supplied.
Default installation still uses `artifacts/native`. Source bundle identity,
executable, resource, signature and file equality are checked. No installer
script starts or quits the host.

`adapter_smoke_test.cpp` dlopens the real binary and exercises its setup and render
entry point using SDK structures. `arbitrary_test.cpp` supplies test host-handle
callbacks and checks copying, flatten/unflatten, malformed data and disposal with
ASAN/UBSAN. These are isolated tests, not evidence that Premiere calls the same
paths correctly. Follow [the host acceptance plan](../../docs/native-effect-acceptance.md).

`render_style_test.cpp` verifies neutral byte equality, independent state
sizes/colors, multiplicative tint, alpha/opacity/enlargement preservation and
half-resolution outline/shadow extents with ASAN/UBSAN.
