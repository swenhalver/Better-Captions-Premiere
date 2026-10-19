# Native effect and caption panel integration

**0.7.13 update:** new transcripts now create an owned Transparent Video carrier
and native effect automatically. Its project-metadata marker positively binds
the generated source identity; a non-adjustment footage clip is never adopted
solely because it has an effect. See [creation notes](release-0.7.13.md) and
[installed Mac acceptance](mac-verification-0.7.13.md). The details below describe
the existing-document adapter, which remains separate from creation.

Development build 0.7.9, 2026-10-18. Installed Premiere 26.5.2 testing confirmed
automatic panel reconnection, a panel color edit reaching the native frame, and
the new Current/Past/Next Effect Controls groups. A native Current-word Size change
from 100% to 150% enlarged the rendered word and bubble, then was restored to 100%.
See the [Mac verification record](mac-verification-0.7.9.md). Adjustment-layer Razor
timing and Program Monitor handle input remain open host acceptance items.

## One document, native animation

`webview-ui/src/lib/native-effect/panel.ts` adopts an existing, positively
identified native effect on an adjustment layer or owned Transparent Video.
The pure adapter never creates a layer, inserts an
effect, converts a generated movie, imports media or executes a host command.

- `rehydrateNativePanel(entry, sequenceInfo)` returns `{session, binding,
  warnings, capabilities}`. Its bounded reader accepts BCAP v1/v2/v3 inside the
  existing `BCDOC1:` carrier, restores timed source words/manual container splits
  and maps supported appearance values into the existing panel session.
- `prepareNativePanelUpdate(binding, editedSession)` returns a validated native
  document. It preserves the persisted timing origin, exact untouched source
  timestamps, fractional native colors/alpha and all unchanged styles. It does
  not build a new animation timeline or write any native parameter.
- `confirmNativePanelUpdate(binding, prepared, editedSession, writeResult)`
  accepts only exact carrier readback and an identity-consistent new revision.
  It returns a new binding; the previous binding remains intact for inspection.

The binding retains the actual CEP project/sequence/clip/parameter locator and
opaque revision. Only GUID braces/case are equivalent when comparing normalized
UXP sequence identity. Non-GUID identifiers remain exact. The JSON document
envelope uses a canonical GUID; binary BCAP stores no sequence ID. Root-owned
host dispatch must check the exact current locator/revision immediately before
one carrier setter and must not retry an uncertain write.

Caption rows carry native source IDs and words, **without** fabricated generated
movie clip IDs, media paths, Motion profiles or render rectangles. Native mode
must bypass the movie exporter, legacy Motion watcher and movie geometry editor.
Reconnection must use the native document instead of overwriting it with a stale
local session. No embedded document read is scheduled as continuous hot polling.

Position, Width, Height, character limit and native appearance overrides stay in
Premiere Effect Controls. Native scalar/color keyframes are sampled by Premiere
for each requested render. A document update does not set, remove, recreate,
retime or flatten those keys, nor change the layer's ordinary Motion effect.

For ordinary-speed layer placement, panel times are document times plus
`persistedOrigin - (clipInSeconds - clipStartSeconds)`; edits invert that mapping.
Untouched word timestamps are copied from the source document rather than
round-tripped through floating offsets. All source words remain present, including
those outside the currently trimmed clip. This is an arithmetic/source regression,
not proof that the unresolved host Razor clock is corrected.

## Supported panel styles and explicit limits

The panel can change each state's font family, numeric weight, relative B mode,
italic, rendered pixel size, text RGB,
opacity, bubble enable/RGB/opacity/padding/radius, and existing outline/shadow
numeric/color values. Shared line height and shared As typed/ASCII Title Case are
supported. Source transcript characters are never rewritten by display case.
Unchanged fractional RGB and separate native text alpha are preserved exactly;
choosing a new RGB color intentionally changes only those RGB channels.

The current BCAP schema has no letter spacing, text alignment, whole-caption
background, per-state case, general upper/lowercase,
or independent outline/shadow enable flags. The adapter returns these capability
limits and refuses edits to them instead of dropping or pretending to render them.
Panel animation presets and geometry/grouping fields cannot be substituted for
the native Effect Controls parameters. Outline/shadow fields cannot implicitly
enable an effect that the panel still says is disabled.

Native word spacing is an explicit **pixel** gap, while the general panel control
is a **percentage of a measured font space**. The adapter retains the exact native
pixel gap, leaves the incompatible percentage control unset, and refuses percentage
edits. It does not guess font metrics or reinterpret the number. Native line height
must satisfy the native renderer's 1–10 range. Fields outside panel ranges remain
preserved until an explicit supported edit validates successfully.

Other base values hidden by explicit word-state overrides cannot be stored independently
in this native schema. Such a base-only edit is refused; choosing All words through
the toolbar updates the actual word-state values. A supported change never silently
removes unrelated unsupported style information from an existing native document.

## Appended native Effect Controls

Existing parameter positions 0–7 and serialization disk IDs 1–7 remain unchanged,
including the hidden static caption document. `BCDOC1:` is unchanged; typography
edits use the backwards-compatible BCAP3 footer described below. `native/adobe/parameters.hpp` records the new compiled parameter order;
CEP/UXP component indexes must still be discovered from actual host metadata.

| State group | Control disk IDs | Group/end disk IDs |
| --- | --- | --- |
| Current word | 8–15 | 100 / 101 |
| Previously spoken words | 16–23 | 102 / 103 |
| Upcoming words | 24–31 | 104 / 105 |

Each group adds, in that order:

1. Size, % — 100 preserves the document size; 1–400 is allowed.
2. Text tint — white is neutral and RGB multiplies the document color.
3. Opacity, % — 100 preserves opacity; 0 hides that word state.
4. Word bubble — Document / On / Off, with Document as the neutral default.
5. Bubble tint — white preserves the document's bubble RGB.
6. Bubble opacity, % — 100 preserves its alpha.
7. Bubble padding, % — 100 preserves padding; 0–400 is allowed.
8. Bubble corners, % — 100 preserves radius; 0 makes square corners.

These are render-local overrides. They leave the embedded styles and transcript
unchanged, so replacing the document does not replace a user's native animation.
Tint controls multiply RGB; changing the absolute base color belongs in the panel.
Opacity and alpha stay independent. Dimensions, extents and global size retain
the existing explicit render-resolution scaling and validation.

## Source/build verification

- Fifteen focused panel-adapter tests cover bounded decoding, legacy v1, Unicode,
  manual splits, exact identity, no-op byte equality, hidden native alpha/floats,
  moved-layer timing without source rounding, scoped edits, unsupported refusals
  and exact readback binding updates.
- Existing native contract/codec/guarded-CEP tests pass independently.
- The official-SDK native build dynamically loads and renders through the compiled
  adapter. Its smoke test confirms a current-word opacity override changes pixels.
- Native style tests cover neutral byte equality, independent state size/tint/
  opacity/bubble values, unrelated state preservation and combined downsampling.
  Arbitrary-data and style tests run with ASAN/UBSAN.

These pure adapters and isolated tests do not establish host acceptance. The Mac
run separately verified discovery of an existing layer in a saved scratch project,
neutral appearance defaults, supported panel color editing with actual frame
changes, and native Current-word Size editing/restoration. Full new-control
keyframing/reset, Undo/Redo, copy/paste, and complete save/reopen pixel persistence
remain open acceptance items; the original geometry/interpolation evidence is
recorded in the [native acceptance record](native-effect-acceptance.md).

## Typography candidate (0.7.10 source/build)

BCAP3 appends optional numeric weight, italic and relative B mode for each state,
plus the shared All words baseline. The JSON protocol remains version 1. Exact
no-op v1/v2 carriers retain their original bytes. Editing typography upgrades the
payload to v3 while preserving origin, transcript, hidden color alpha and unrelated
styles. `fontWeightOffset:100` remains a mode: select the next actual heavier weight
above the shared baseline, such as Arial 400 → 700. Off follows the baseline; an
explicit numeric state weight leaves relative mode. Font-catalog metadata is never
embedded in the document.

The macOS renderer reads actual OpenType weights, supports real variable `wght`
ranges, and prefers the available native italic face for the selected weight. A
regular-only font receives a 12-degree synthetic italic, including its ink overhang
in the measurements used for reflow and bubbles. The legacy unset state keeps the
original named face. Per-frame selection reuse avoids enumerating faces for every
word and has no stale global font cache. Native family names still have an explicit
256 UTF-8-byte limit; all currently inventoried Mac families fit.

Focused source tests cover v3 TS/C++ byte equality, malformed typography flags,
1–1000 and fractional weights, original v1/v2 byte equality, relative mode/base
restoration and independent state edits. Sanitizer CoreText tests exercise actual
Arial regular/bold/italic, synthetic Impact italic and the installed variable Arimo
font at weight 511.3. The compiled effect smoke test consumes a BCAP3 carrier and
checks that B, native italic and synthetic italic change real frame pixels.

These checks are isolated native/source acceptance. Installed Premiere typography
editing and save/reopen still require the parent task's Mac verification; earlier
0.7.9 host evidence at the top of this file does not establish those new behaviors.
