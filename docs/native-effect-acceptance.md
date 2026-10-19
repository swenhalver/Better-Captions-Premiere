# Native effect acceptance record

Status date: 2026-10-18. Experimental branch; not a replacement release.
The supported target is a genuine Premiere adjustment layer. Official AE 26.5
and Premiere 26.0 SDKs are external build dependencies; no substitute headers or
guessed ABI are used. Premiere 26.5.2 loads the arm64 effect and renders embedded
caption documents with live text/style updates. The opt-in Metal compositor now
passes the SDR Mac adjustment-layer timing, opacity and fractional-cadence cases
below. The software fallback still has the historical wrong-clock failure. This
is an experimental effect, not production-ready.

## Current opt-in Metal acceptance

The separate experimental effect uses the straight-alpha Metal renderer. The
reduced-preview repair was host-tested in diagnostic candidate `3e425102`;
the matching diagnostics-disabled candidate is `8c4ad9b0` (metallib `dd6d2a53`).
The latter is built and signature-verified; its final installation is pending a
coordinated Premiere restart. The timing/alpha receipts below originally used
candidate `a5156eda` and do not alone establish reduced-preview acceptance.
The Better Captions panel remains **0.7.11**. Restoring the failed CPU-only candidate
would remove this verified fix; it is retained only as historical evidence.

- At 30 fps, the baseline at sequence 5, actual UI-Razor right half at sequence 5,
  and moved split at sequence 11 have identical raw RGBA SHA-256
  `3b7dfb88c96d617aa3f8208d31a422bb850d05f5fa2c44310e082dd0aa9cabc8`.
  Moving the whole layer from 0 to 4 renders the earlier “Native” word at sequence 5,
  hash `ee8be3d0e61eac403d8ef2eab4f86741892ab9eecbd909f4304e43a0c3ee6962`.
  Captions therefore move with the adjustment layer in these accepted cases.
- Actual exported PNGs at underlying opacity 100/50/0 match an independent CPU
  straight-source-over reference: R/G/B maximum error 1, alpha exact, and zero
  changes to untouched pixels. All three comparisons pass. Receipt:
  `artifacts/host-scratch/gpu-straight-reference/comparison-receipt.json`.
- Fresh initial attachments at 29.97 transition from “Native” to “captions” on
  frames 59→60; at 23.976 the transition is frames 47→48. Corresponding before/after
  raw RGBA hashes match across rates. Each private fixture captured its origin
  from actual layer `(inPoint-start)` after setting sequence FPS. Changing FPS
  after attachment can snap the host in-point and remains a separate preservation
  limitation; these fixtures do not claim to fix that case.

Additional local receipts: `gpu-straight-timing-receipt.json`,
`gpu-straight-frame-hashes.json`, `gpu-straight-opacity-receipt.json`, and
`gpu-fractional-fresh-fixtures.json` under ignored `artifacts/host-scratch/`.
These receipts support only the tested SDR Apple Silicon/Metal path. HDR/linear
color, installed Windows, 16f host frames, custom UI dragging, copy/paste and
performance remain unaccepted. The CPU software fallback is not a valid timing
fallback for adjustment layers.

After an actual Premiere restart, UI-Razor, whole-layer move and both fractional
fixtures reproduce their earlier pixels exactly. Seeking the base 1→5→1 seconds
also reproduces the expected frame hashes. Receipts: `gpu-straight-reopen-receipt.json`
and `gpu-straight-frame-hashes.json`.

All seven private test sequences were archived in
`gpu-caption-full-acceptance-29-sequences.prproj` and removed from the working
scratch project. Its original 22 full sequence graphs match the fresh checkpoint;
all original playheads and active sequence were restored. Only recorded viewport
floating-point serialization noise (at most 1e-14) is normalized. Four private
control plug-ins were hash/signature verified and moved to a recovery folder while
Premiere was fully quit. The accepted caption bundle remains installed. See
`gpu-caption-final-preservation.json`, `gpu-temporary-sequence-cleanup.json` and
`gpu-temporary-plugin-cleanup.json`. The closed production project and fresh
human-saved baseline retain identical SHA-256
`c4259feec4b32e0a52c1f2a72ef9f049626d74133fa91fee1d2788a62cd97d03`.

The prototype synchronously waits for its Metal command and has no performance
acceptance yet. Uniform preview scaling has the live acceptance recorded below;
unequal X/Y scales are not accepted. Only one experimental bundle with this identifier was loaded during
host testing; module-relative metallib lookup remains a hardening item before
supporting multiple simultaneous copies.

## Live reduced-resolution preview repair

A real Program Monitor scrub reproduced a completely black frame at playback
resolution 1/2 while the same caption effect and footage worked at Full. An empty
adjustment layer did not cause the problem. A behavior-preserving diagnostic
build then recorded raw GPU downsample factors **2 × 2** for 640 × 360 half
playback, and **4 × 4** for 320 × 180 quarter playback. Precompute rejected those
values as `Invalid downsample scale`; the incoming/returned realtime hint stayed
one. This is a renderer validation defect, not a Premiere preference reset.

`previewGeometry` now validates finite SDK divisors of at least one and converts
them to reciprocal pixel scales. Native box dimensions, font sizes, spacing,
outline, bubble and shadow dimensions use those scales. Position still uses the
normalized point and actual requested frame dimensions. Caption bytes and the
verified `inClipTime` clock are unchanged.

Installed repaired diagnostic executable:
`3e42510253893417cf6ac13cb1b51375be4fb3319a092b95e876e90c1a5caf1f`.
Active QE `startScrubbing`/`scrubTo` requests, with screenshots taken before
`endScrubbing`, passed at Full, 1/2 and 1/4. Fresh half and quarter frames reached
both Precompute and Metal Render successfully with no diagnostic exceptions.
No export, width edit or Apply action was used to force those frames. A repeated
seek at the already paused CTI reused a Full cached frame and was excluded from
the half-resolution dispatch proof; a fresh 5.2-second request established it.
The visible highlighted-word bounds match across the three preview resolutions;
spoken-word vertical bounds differ by at most one displayed pixel.

Focused assertions run in the actual Metal ASAN/UBSAN harness cover full/half/
quarter grouping, wrapping, word state, normalized geometry, style dimensions,
CoreText visibility and source-document immutability. Fractional divisors and
independent X/Y box/style scales are tested locally, including invalid input
rejection; these tests do not claim host anisotropic glyph/PAR acceptance.

The diagnostics-disabled executable is
`8c4ad9b0acc11fbec2ef8d3f5b13f01282fce2f6d6891875790e71c348e4dbf4`.
Its renderer overlays, native headers and non-generated compilation inputs match
the tested diagnostic build byte-for-byte. Only the generated diagnostic define
changes from one to zero. All adapter and compositor checks pass; the metallib
is unchanged. Extra per-process scrub-logger strings are absent, while the
pre-existing bounded GPU trace remains.

Local receipts are in `/tmp/better-captions-scrub-1792368450664/`, including
`diagnostic-318-half-summary.json`, `diagnostic-318-quarter-summary.json`,
`fixed-diagnostic-matrix.json`, `fixed-diagnostic-visible-bounds.json` and captured
Program Monitor frames. Reopen preserved all 22 sequence graphs exactly before
the user's subsequent base-footage test move. Those user edits are retained;
old caption fixtures are not restored over them. The production project remained
closed and retained its previously recorded SHA-256.

## Earlier verified evidence

- Earlier panel-integration acceptance used development panel 0.7.9 and the native
  control build on the Mac (the current panel is 0.7.11). Selecting an existing
  native adjustment layer automatically restored its
  timed words/styles without Refresh. A Current-word color edit changed that
  same layer's visible Program Monitor frame without a movie export; the test
  color was then restored. Current/Past/Next groups appear in Effect Controls.
  Current-word Size 100%→150% enlarged the rendered word/bubble and was restored.
  These checks used only the saved scratch project. The production project stayed
  closed and its SHA-256 stayed identical. See [0.7.9 verification](mac-verification-0.7.9.md).
- Portable core and macOS raster CTests pass with ASAN/UBSAN. The compiled adapter
  dynamically loads and renders deterministic premultiplied ARGB 8 frames. SDK
  arbitrary-data tests cover copy, flatten/unflatten, scan, compare and disposal.
- The full JavaScript suite passed 634 tests with 2 skips; Svelte/TypeScript check
  reported 0 errors/warnings, and webview/service production builds passed. These
  results cover the BCAP 2 origin/adjustment-layer guard and exact timeline-rate
  conversion; later isolated changes require their own focused checks.
- Actual native frames show independent upcoming/current/spoken font sizes,
  colors, opacity and current-word bubbles. Neutral global size 64/tint white
  preserve per-state styles. Width reflows without font stretching; Height is
  independent. New native instances default to Position 50%/90%, Height 150 px.
- Native Width/Height key interpolation was read back: at 1 s between 0 s/2 s,
  Width 700→420 gives 560 and Height 240→300 gives 270. A native Position UI edit and
  Undo were observed; full point-key/Redo/reset acceptance remains open.
- CEP transfers bounded UTF-16LE `BCDOC1:` documents with exact readback, and the
  next native frame changes without rendering/reimporting a movie. Project reopen
  and sequence cloning preserve transcript data. BCAP 2 origins have survived a
  restart; full trim/copy/paste and both split halves remain an acceptance gate.
  The observed text appears to be the arbitrary parameter's FLATTEN representation;
  the earlier claim that CEP bypasses SCAN was unsupported and is withdrawn.
- Actual adjustment layers report `isAdjustmentLayer() === true` and a default
  one-hour source in-point. The live transfer rejects footage, missing/throwing
  role methods and ambiguous effect instances. Initial application captures a
  persisted origin without rewriting transcript word times. Subsequent document
  edits retain the origin from the exact host-read carrier, even after a move;
  the apply API requires the caller to choose initial attachment or existing edit.
- Caption sampling is driven by the host's requested timeline timestamp. Source
  FPS does not schedule rendering. Fractional 23.976/29.97 regression tests pass;
  the existing movie exporter also uses the active timeline rate and verifies
  encoder output with FFprobe. Legacy timeline metadata no longer truncates
  fractional values or silently falls back to 24 fps.
- Plugin Loading.log confirms loading from the per-user
  `~/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore/` path. The
  install helper backs up only this experimental bundle and verifies signature,
  file equality and hashes without administrator/password authorization.
- Ad-hoc signature and dependency inspection pass: CoreText, CoreGraphics,
  CoreFoundation, libc++ and libSystem only. Native host rendering requires no
  After Effects application, Dynamic Link or MOGRT.
- Original production project bytes and all 6 normalized sequence graphs match
  the fresh human-saved preservation baseline. Native tests use a scratch project.

SDK archive hashes and build provenance are in [native/README.md](../native/README.md).
Build hashes identify snapshots, not acceptance:

| Binary snapshot | SHA-256 |
| --- | --- |
| Standard own-layer-clock candidate | `53943c539d4b9ad6fc6120a8039a38c0bb736edadf647d4faf9c7a4552f41e47` |
| Same mapping with opt-in numeric render diagnostics | `d23470ea5cc798a2de18d8d45bc47e544b57f5bee04e32bc3365748d116ad633` |
| Installed panel-integration/control candidate | `688697ac134ff530f9e02121f4843a53b33346b50c7cba40615631a9c910ec03` |
| Normal typography candidate restored after timing probes | `6312eaabae8795ca9f4efa20a116cac9bf11f09c299b18e0368518ed7f62f74d` |
| Earlier straight-alpha Metal timing/alpha candidate | `a5156eda8b80d317fe1d0bedc07b699a4fd17eb7da1b64144e422c394380c9f0` |
| Installed reduced-preview repair with scrub diagnostics | `3e42510253893417cf6ac13cb1b51375be4fb3319a092b95e876e90c1a5caf1f` |
| Matching diagnostics-disabled reduced-preview repair | `8c4ad9b0acc11fbec2ef8d3f5b13f01282fce2f6d6891875790e71c348e4dbf4` |

The current `CaptionComposite.metallib` SHA-256 is
`dd6d2a53a07ec92e8a43dcd9bab97c53f7370c7ea6e53e53a6dfe88827eff5bd`.
The ignored artifact manifest records actual snapshot/overlay, SDK header and
output hashes and labels its retrospective compiler observations explicitly.

Regenerate hashes after rebuilding. The typography/CPU candidates in this table
are historical snapshots. The current installed effect is the separate opt-in
Metal candidate identified above; standard CPU builds remain a distinct path.
The optional global `.pkg` path was not scanned by this Premiere installation and
is not the verified install route.

## Historical CPU timing failure and GPU diagnostic progression

Swen confirmed that captions must **move with their adjustment layer**. A fixed
persisted origin preserves authored word times across edits, but a reliable
per-render layer clock is still required. The CPU mapping described here did not meet
that requirement; the accepted opt-in GPU path is recorded above.

The baseline layer is 0–10 s with source in 3600 s and origin 3600 s. At sequence
5 s it renders the expected word. A real Premiere UI Razor cut at 4 s produces a
right half at start 4 s/in 3604 s with identical embedded data, but its frame at
5 s is blank. The exact render callback reports PF time 5 s, SDK sequence time
9 s, clip start frame 108120, track start frame 120, and computed document time
9 s. That is outside the eight-second document. This confirms the QE result is
also reproducible through Premiere's UI.

Moving the right half one frame away and back, applying a fresh effect instance,
reopening, invalidating width and cutting the underlying footage at the same
position did not repair it. One earlier moved sample at start 10 s above fresh
footage at 10 s produces the expected word at 11 s, but that isolated passing
sample is insufficient: moving a whole uncut layer to 4 s above continuous
footage still displays word 5 at sequence 5 s, where word 1 is required. The move
used the documented Time-object API and preserved the source in-point.

Evidence lives in ignored `artifacts/host-scratch/`:

- `ui-razor-timing-receipt.json` records actual UI cut metadata, callback values
  and raw pixel hashes for baseline/failing variants.
- `ui-razor-before.png` and `ui-razor-after.png` show the same requested frame
  before/after the cut; baseline and moved-good sample hash is `2dfa0277…`,
  while the failed blank hash is `20038153…`.
- `whole-move-before.png` at sequence 1 s and `whole-move-after.png` at sequence
  5 s should match after a 4 s move; their hashes differ.

Numeric diagnostics match the exact SDK filter-instance ID. The Video Segment
owner query fails on the adjustment wrapper with error -2147483643. The exact
ancestor path is Compositor → Adjustment → Clip → Effect; its clip edge offset
reflects the layer's start/in-point, but start/end properties are unavailable
and tested time transforms are identities. Request-dependent root offsets do
not supply an independent render clock. No nearby footage is substituted for
the owning layer.

A controlled `PF_OutFlag_WIDE_TIME_INPUT` build changed both Global Setup/PiPL
flags from 4 to 6 and reproduced the same wrong time and blank pixels. It was
rejected and is absent from the normal build. Diagnostic builds were removed;
the normal typography candidate was restored for the parallel font acceptance.

The first isolated GPU companion probe (`fc682b3b…`) was discovered in Premiere:
it received 18 CreateInstance and 18 DisposeInstance calls. It received no frame
dependency or Render callbacks during the three guarded scratch exports, an
additional seek and brief playback. The saved scratch project specifies Mercury
Metal. That test established neither a GPU frame clock nor the arbitrary-data
representation. The CPU fallback still produced the same failing whole-move/UI-cut
pixels and the same isolated moved-split passing pixels.

The extra CPU metadata reports sequence zero point 0, the actual containing
sequence duration, PF total time equal to clip duration and local step 1. It does
not supply an independent render position. The normal typography bundle was
restored, its hash verified, the bridge restarted with Codex Computer Use and
MCP readback verified. All 22 saved scratch sequence graphs match the fresh
pre-probe checkpoint after the documented sibling-property ordering normalization;
no data was omitted. Receipts are `gpu-clock-timing-receipt.json` and
`gpu-scratch-preservation.json` in ignored `artifacts/host-scratch/`.

The subsequent isolated eligibility probe tested whether the ARGB8-only software format
declaration prevents GPU frame dispatch. It advertises BGRA32f only in a snapshot
and explicitly rejects unsupported CPU float frames before any pixel write. This
is a diagnostic hypothesis, not a float renderer. With `outIsRealtime` forced to
zero, the float probe also received no adjustment-layer frame callbacks. Its
later ordinary-footage callbacks must not be treated as adjustment-layer proof.

A controlled comparison then isolated that callback field: a minimal control
preserving Premiere's incoming value (one) received adjustment-layer dependency
and Render requests; the otherwise matching control forcing zero did not. A
separate control implementing genuine Smart Render handlers while retaining zero
also did not dispatch GPU frames. Adobe's SDK Vignette control rendered and
exported correctly. These private controls were tested above the same visible
underlying footage in scratch clones, without modifying the production project.

The caption correlation probe `4729aa15…` preserves incoming realtime and verifies
the real layer's arbitrary-data carrier using a bounded FNV fingerprint and
decoded metadata. PID78385 received full-size Render requests at 30fps with BCAP2
origin3600/four words matching exact MCP carrier readback:

| Adjustment-layer case | Sequence seconds | GPU clip seconds | Clip seconds minus origin |
| --- | ---: | ---: | ---: |
| Uncut layer | 5 | 3605 | 5 |
| Whole layer moved from 0 to 4 | 5 | 3601 | 1 |
| Actual UI Razor right side, start4/in3604 | 5 | 3605 | 5 |
| Split moved to start10/in3604 | 11 | 3605 | 5 |

The carrier is UTF-16LE `BCDOC1:` data in borrowed `PrMemoryPtr` storage; it is
read before another parameter query and never freed or treated as a PF handle.
This establishes the GPU request clock for these cases. The diagnostic returns
no GPU frame and intentionally rejects CPU float input, so its failed frame
exports were expected for that diagnostic-only snapshot. It was superseded by
the accepted compositor above. Its CPU fallback failure remains unresolved.

## Acceptance matrix

| Requirement | Current status |
| --- | --- |
| Bounded versioned document/container identities | BCAP 1–3 supported; persisted origins and typography are versioned; independent container IDs/grouping tested. |
| Independent styles/Title Case | Native host frames verified; ASCII-only Title Case preserves source bytes. Full Unicode casing pending. |
| Bottom placement/independent box reflow | Native defaults and width/height behavior verified; broader resolution/pixel-aspect coverage pending. |
| Position/Width/Height animation | Numeric interpolation verified; native Position edit/Undo observed. Complete point keys, easing, Redo and individual reset pending. |
| Program Monitor move/resize | Optional probe draws 4 blue handles. Host drag delivered no click/drag callbacks and changed no native value. Input remains unverified; standard build keeps it off. |
| Embedded document transfer/live update | Exact guarded CEP write/readback and changed native frames verified. Installed panel adoption and supported color update verified in 0.7.9; native keys/geometry stay host-owned. |
| Save/reopen/clone | Transcript/origin persistence verified. Metal pixels match after actual Premiere restart and out-of-order 1→5→1 seeks. Copy/paste and broader key preservation remain open. |
| Adjustment-layer trim/Razor/move | Opt-in Metal passes 30 fps baseline/UI-Razor/moved-split pixel equality and whole-layer move. Historical CPU fallback fails; broader trim/retime coverage pending. |
| Adjustment-only application | Live transfer requires exact true role check; manual native effect selection remains a Premiere UI operation. |
| Built-in Transcribe/editable word timing | Existing native document words/timing restore into the panel; timing edits have adapter/controller tests. Fresh transcription still follows the existing movie workflow; replacing a native embedded transcript is refused. Full installed native timing-edit acceptance pending. |
| One adjustment container above footage | Manually created genuine layer verified. Automatic creation/migration pending. |
| Compact panel/agent hooks | Installed compact panel and agent get_state/patch_style adopted the existing native layer and changed its visible color. Unsupported native styles are disabled/refused. |
| Retimed/reversed native layers | Explicitly unsupported; callback/speed failures return errors. |
| Additional formats/Windows | Baseline ARGB8 CPU and tested SDR 32f Metal Mac path verified. 16f host, HDR/linear, YUV and installed Windows remain unaccepted. |

## First host probe

1. Acquisition/build stage completed using official SDKs. Preserve archive hashes,
   build provenance and license records. No SDK headers or sample implementations
   enter this repository without a redistribution review. Re-run isolated tests
   after each adapter change before copying a new build into the host test.
2. Coordinate exclusive Premiere test ownership with Swen. Snapshot current project,
   sequence, clip identities/timing and Motion/keyframes read-only. Use a new scratch
   project. Do not close, overwrite or restore an older snapshot over human edits.
   Keep Premiere on the other display; recheck after every dialog/project load/test.
3. Build a minimal Premiere-compatible effect with Position (point), independent Width
   and Height (numbers), and Color. Render a deterministic synthetic fixture through
   `PF_Cmd_RENDER`. Confirm discovery, application, visible output and export.
   Check linked dependencies and demonstrate loading without launching AE.
4. Record actual Effect Controls defaults, numeric/point/color editing, stopwatches,
   key creation and interpolation. Test Undo/Redo and native reset behavior separately
   from the panel's proposed individual reset. Do not claim default host reset preserves
   a single frame's unrelated keyframes.
5. Query the same component from the panel. Read parameter values and keyframe times,
   mutate one value, read it back and observe Program Monitor invalidation. Test a
   frame-specific edit preserving other key values/interpolation. If interpolation
   metadata cannot be fully read, document that limitation rather than rebuilding keys.
6. Register custom UI using the actual SDK sample. Log context and draw/click/drag
   events in Premiere. Drag center/edge/corner handles, independently change dimensions,
   and read native values/keyframes back. Verify zoom/resolution/pixel-aspect/Retina
   coordinate conversion, undo grouping and cancelled drags. Export must omit UI handles.
7. Probe arbitrary-data copy/flatten/unflatten and panel transfer. Require embedded
   caption content, bounded validation, schema rejection, no uncertain-mutation retries,
   and successful reopen without an external sidecar. Do not silently fall back to MOV.

## Stable parameters and document lifetime

Reserve and version parameter IDs before a distributable effect. Keep Position,
Width and Height as independent native streams; never renumber shipped IDs. Keep
their rows visible: Premiere removes keyframe rows when `PF_PUI_NO_ECW_UI` is used.
Do not set `PF_ParamFlag_CANNOT_TIME_VARY` for these streams. A future panel reset
must define its scope explicitly: static default when unkeyed, or the current
frame's value only when keyed, preserving all unrelated keys and easing. Prove
that behavior before exposing it.

Use host-managed arbitrary-data lifecycle only after testing it. Implement every
required callback using SDK memory APIs and portable bounded flattening. No raw
pointers, process IDs or machine paths should be persisted. The renderer must be
deterministic across out-of-order and concurrent host instances; cache keys must
include document revision, native values, time, dimensions and render quality.

## Migration and regression gate

Migration is explicit and reversible. Copy legacy data into a newly identified
experimental container and retain original clips until Swen accepts the result.
Reject automatic replacement of protected animated captions. Verify no changes
to unrelated Motion, source links, clip identity, timing, presets or transcript.
For save/reopen, copy/paste, trim and Razor tests, compare documents, IDs, times,
native parameter/keyframe states and frame pixels before/after. Test both halves
of a split, edit one half and verify the other remains independent. Test missing
fonts, unsupported schema, oversized/malformed input, offline media and project
recovery. Capture evidence paths/results and distinguish Mac host acceptance from
portable/CI tests. Do not merge or replace the working installed panel at this gate.

## Primary documentation

- [Premiere C++ SDK entry/download](https://developer.adobe.com/premiere-pro/) and
  [Adobe access requirements](https://developer.adobe.com/premiere-pro/access-the-developer-console/).
- [Premiere hosts AE effects](https://ae-plugins.docsforadobe.dev/ppro/ppro/).
  This is an effect programming API choice, not an AE application dependency.
- [Host rendering differences](https://ae-plugins.docsforadobe.dev/ppro/basic-host-differences/):
  speculative and concurrent instances, quality changes, no AEGP suite support.
- [Pixel-format differences](https://ae-plugins.docsforadobe.dev/ppro/bigger-differences/)
  and [unsupported features](https://ae-plugins.docsforadobe.dev/ppro/unsupported-features/):
  no AE SmartFX/16-bit route; implement Premiere 32-bit formats explicitly if needed.
- [Stable IDs and parameter flags](https://ae-plugins.docsforadobe.dev/effect-basics/PF_ParamDef/),
  [arbitrary-data lifecycle](https://ae-plugins.docsforadobe.dev/effect-details/arbitrary-data-parameters/),
  [custom effect UI](https://ae-plugins.docsforadobe.dev/effect-ui-events/effect-ui-events/).
  General AE custom-UI descriptions require Premiere host confirmation.
- [Premiere UXP ComponentParam](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam):
  native values/keyframes and mutation actions; does not document custom opaque arb transfer.

The SDK guide pages are Adobe-copyright documentation; their older examples are
guidance, not proof of every API's behavior in Premiere 26.5.2.
