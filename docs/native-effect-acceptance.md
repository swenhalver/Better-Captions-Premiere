# Native effect acceptance record

Status date: 2026-10-18. Experimental branch; not a replacement release.
The supported target is a genuine Premiere adjustment layer. Official AE 26.5
and Premiere 26.0 SDKs are external build dependencies; no substitute headers or
guessed ABI are used. Premiere 26.5.2 loads the arm64 effect and renders embedded
caption documents with live text/style updates. **Adjustment-layer Razor timing
is unresolved**, so this is not yet ready for production caption work.

## Verified evidence

- Development panel 0.7.9 and the new native control build are installed on the
  Mac. Selecting an existing native adjustment layer automatically restored its
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

Regenerate hashes after rebuilding. The normal typography candidate (hash below) was restored after the timing probes;
standard builds disable custom UI and all probe logging. The earlier diagnostic snapshots are retained as historical
timing evidence.
The optional global `.pkg` path was not scanned by this Premiere installation and
is not the verified install route.

## Adjustment-layer timing failure under investigation

Swen confirmed that captions must **move with their adjustment layer**. A fixed
persisted origin preserves authored word times across edits, but a reliable
per-render layer clock is still required. The current CPU mapping does not meet
that requirement.

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

The next isolated probe adds the official GPU companion entry point to inspect
`PrGPUFilterRenderParams.inClipTime`, `inSequenceTime` and `inRenderTicksPerFrame`.
These explicit request clocks may provide a viable native path, but adjustment-
layer host dispatch, parameter data representation and CPU fallback remain
unverified. A diagnostic that returns no frame is never a usable renderer or
proof of software fallback. No timing fix is accepted yet.

## Acceptance matrix

| Requirement | Current status |
| --- | --- |
| Bounded versioned document/container identities | BCAP 2 implemented; BCAP 1 reads upgrade with origin 0; independent container IDs/grouping tested. |
| Independent styles/Title Case | Native host frames verified; ASCII-only Title Case preserves source bytes. Full Unicode casing pending. |
| Bottom placement/independent box reflow | Native defaults and width/height behavior verified; broader resolution/pixel-aspect coverage pending. |
| Position/Width/Height animation | Numeric interpolation verified; native Position edit/Undo observed. Complete point keys, easing, Redo and individual reset pending. |
| Program Monitor move/resize | Optional probe draws 4 blue handles. Host drag delivered no click/drag callbacks and changed no native value. Input remains unverified; standard build keeps it off. |
| Embedded document transfer/live update | Exact guarded CEP write/readback and changed native frames verified. Installed panel adoption and supported color update verified in 0.7.9; native keys/geometry stay host-owned. |
| Save/reopen/clone | Transcript retained; BCAP 2 origin retained. Copy/paste, keys and complete pixel persistence remain open. |
| Adjustment-layer trim/Razor/move | Actual UI and QE Razor fail; one moved sample passes but whole-layer move over continuous footage fails. Not accepted. |
| Adjustment-only application | Live transfer requires exact true role check; manual native effect selection remains a Premiere UI operation. |
| Built-in Transcribe/editable word timing | Existing native document words/timing restore into the panel; timing edits have adapter/controller tests. Fresh transcription still follows the existing movie workflow; replacing a native embedded transcript is refused. Full installed native timing-edit acceptance pending. |
| One adjustment container above footage | Manually created genuine layer verified. Automatic creation/migration pending. |
| Compact panel/agent hooks | Installed compact panel and agent get_state/patch_style adopted the existing native layer and changed its visible color. Unsupported native styles are disabled/refused. |
| Retimed/reversed native layers | Explicitly unsupported; callback/speed failures return errors. |
| Additional formats/Windows | Baseline ARGB 8 Mac host verified. Float/YUV/GPU and Windows installed-host loading/drawing pending. |

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
