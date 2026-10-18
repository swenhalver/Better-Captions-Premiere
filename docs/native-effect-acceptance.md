# Native effect acceptance record

Status date: 2026-10-18. Experimental branch; not a replacement release.
The supported target is a genuine Premiere adjustment layer. Official AE 26.5
and Premiere 26.0 SDKs are external build dependencies; no substitute headers or
guessed ABI are used. Premiere 26.5.2 loads the arm64 effect and renders embedded
caption documents with live text/style updates. **Adjustment-layer Razor timing
is unresolved**, so this is not yet ready for production caption work.

## Verified evidence

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

Regenerate hashes after rebuilding. The diagnostic snapshot is currently installed
for scratch testing; standard builds disable custom UI and all probe logging.
The optional global `.pkg` path was not scanned by this Premiere installation and
is not the verified install route.

## Adjustment-layer timing failure under investigation

The baseline layer is 0–10 s with source in 3600 s and persisted origin 3600 s. At
sequence 5 s it renders the expected current word. After a QE Razor split at 4 s,
the right half has start 4 s/in 3604 s and unchanged embedded data, but the exported
frame at 5 s is blank. Moving that right half to 10 s, with rendered footage beneath
it, produces the expected word at 11 s; its raw pixel hash exactly matches the
baseline 5 s frame. Repeated exports, cache invalidation and reopening have not
established correct unmoved-split rendering.

Evidence: `artifacts/host-scratch/adjustment-final-frame-comparison.json`, baseline
`adjustment-before-razor-final.png`, failing
`adjustment-after-razor-stable-final.png`, matching
`adjustment-after-move-stable-final.png`. These are local ignored test artifacts.
Numeric SDK render diagnostics record only timing/geometry/status counts, no
transcript text. Next host check must use Premiere's actual UI Razor/Add Edit to
separate a QE mutation issue from the adapter's clock mapping. No mapping based
on footage underneath the adjustment layer is accepted.

## Acceptance matrix

| Requirement | Current status |
| --- | --- |
| Bounded versioned document/container identities | BCAP 2 implemented; BCAP 1 reads upgrade with origin 0; independent container IDs/grouping tested. |
| Independent styles/Title Case | Native host frames verified; ASCII-only Title Case preserves source bytes. Full Unicode casing pending. |
| Bottom placement/independent box reflow | Native defaults and width/height behavior verified; broader resolution/pixel-aspect coverage pending. |
| Position/Width/Height animation | Numeric interpolation verified; native Position edit/Undo observed. Complete point keys, easing, Redo and individual reset pending. |
| Program Monitor move/resize | Optional probe draws 4 blue handles. Host drag delivered no click/drag callbacks and changed no native value. Input remains unverified; standard build keeps it off. |
| Embedded document transfer/live update | Exact guarded CEP write/readback and changed native frames verified. Full user-facing panel binding pending. |
| Save/reopen/clone | Transcript retained; BCAP 2 origin retained. Copy/paste, keys and complete pixel persistence remain open. |
| Adjustment-layer trim/Razor/move | Move sample matches baseline pixels; unmoved QE Razor is failing. Not accepted. |
| Adjustment-only application | Live transfer requires exact true role check; manual native effect selection remains a Premiere UI operation. |
| Built-in Transcribe/editable word timing | Existing panel remains separate; native binding pending. |
| One adjustment container above footage | Manually created genuine layer verified. Automatic creation/migration pending. |
| Compact panel/agent hooks | Pure contracts/helpers implemented; installed native panel/agent endpoint binding pending. |
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
