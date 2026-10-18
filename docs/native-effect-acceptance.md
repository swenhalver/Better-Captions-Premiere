# Native effect acceptance record

Status date: 2026-10-18. This is an experimental branch, not a replacement release.
Official AE 26.5 and Premiere 26.0 SDKs are acquired. A real arm64 effect bundle
and local installer package have been built against the AE SDK headers/resource
types. No substitute headers or guessed ABI have been used. **Premiere host
acceptance is pending**; compilation, isolated rendering and callback tests do
not establish loading, native UI behavior or project persistence.

## Verified build evidence

- Portable core and macOS raster CTests pass with ASAN/UBSAN.
- Compiled bundle smoke test dynamically loads `EffectMain`, checks setup/version,
  composites visible ARGB output, repeats deterministically and changes rendered
  layout when width changes.
- Arbitrary-data test supplies test host handles and verifies copy, flatten/unflatten,
  printable scan, compare, invalid-data rejection and disposal with ASAN/UBSAN.
- Ad-hoc code signature verifies. `otool -L` lists only CoreText, CoreGraphics,
  CoreFoundation, libc++, and libSystem; no AE/AEGP/Dynamic Link library dependency.
- Local unsigned installer targets only the unique experimental plug-in under
  `/Library/Application Support/Adobe/Common/Plugins/7.0/MediaCore/`. It has no
  installation scripts and does not restart apps. Installation/admin authorization
  is in progress; package creation itself is not installation evidence.

SDK archives, hashes and build/compiler versions are recorded in
[native/README.md](../native/README.md). Current compiled artifact snapshot:

| Artifact | SHA-256 |
| --- | --- |
| `BetterCaptionsNativeProbe.plugin/Contents/MacOS/BetterCaptionsNativeProbe` | `4a1674d8c7c4a10c1c0f8b2e015b37dba822aed6897d1db14047a938e71922af` |
| `BetterCaptionsNativeProbe.pkg` | `dd69f88c75e10a3cc9d0d7feb83b4da55a49d9e8e31d0d3adffbdd5215a2533f` |

Hashes identify this build only; regenerate evidence after a rebuild.

## Acceptance matrix

| Requirement | Current evidence / remaining acceptance |
| --- | --- |
| Bounded, versioned document and manual container identities | Implemented in portable core; encode/decode and grouping tests. Host persistence pending. |
| Punctuation/pause/character-count grouping | Implemented derived grouping in core; changing count must recompute from original words. Panel/host integration pending. |
| Independent word styles and display Title Case | Core models all three styles; macOS bitmap renderer implemented outside host. ASCII Title Case preserves transcript. Full Unicode title casing and host rendering pending. |
| Independent width/height and fixed-size reflow | Bound to independent native parameters in compiled adapter. Width changes tested through compiled renderer; host reflow pending. |
| Native numeric/point/color controls | Compiled registration, real SDK parameter definitions and permanent disk IDs implemented. Actual Premiere controls pending. |
| Position/width/height stopwatches, interpolation and reset | Pending host probe. No second animation system is accepted. |
| Direct move/resize in Program Monitor | Unknown until actual draw/click/drag callbacks and value readback are demonstrated in Premiere. A box drawn into video does not satisfy this. |
| Transcript text/data persistence and panel transfer | Static embedded arb parameter and all lifecycle callbacks implemented/tested in isolation. Premiere persistence and panel transfer unknown. Generic UXP string support does not establish opaque arb transport. |
| Live invalidation without rendered MOV refresh | Pending actual native parameter/document mutation and immediate host render. Sidecar polling alone is insufficient. |
| Native Undo/Redo, save/reopen, copy/paste | Pending scratch-project tests with exact document and keyframe comparisons. |
| Trim and manual Razor splits | Pending host tests; preserve source-relative times and independent copied document state. |
| Built-in Transcribe and editable word timing | Existing panel workflow remains separate; native transport integration pending. |
| One container/clear track above footage by default | Pending explicit native-clip creation workflow; existing clips are not migrated automatically. |
| Compact panel, collapsed advanced/setup controls | Existing panel is not proof of native integration; native binding pending. |
| Bounded local agent hooks | Native contract can be validated without host mutation; installed endpoint integration pending. |
| No AE app/Dynamic Link/MOGRT dependency | Binary dependency inspection and standalone loading pass with system libraries only. Premiere-only loading pending. |
| Windows | Portable CMake supports Windows compilers. Windows host loading, drawing and installation pending; CI is not installed-host verification. |

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
