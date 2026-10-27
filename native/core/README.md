# Portable caption document and layout core

This C++17 library has no Adobe SDK dependency. It produces **draw commands**, not pixels. A native effect adapter must shape/measure fonts, draw text/bubbles/outlines/shadows, clip to the text area, and invalidate frames when its host parameters/document change. Actual Premiere rendering and native parameter behavior require separate host verification.

`Document` schema 3 stores stable caption-container IDs, manual-split markers, source words/timing, and independent upcoming/current/spoken styles. `regroup` derives phrases afresh from character count, sentence endings and pauses; it never replaces containers or modifies transcript text. Empty containers are valid. Words must be sorted by start time in each container. Word times remain in the authored caption time domain. `timeOriginSeconds` stores the explicit source/sequence origin captured by the panel at application; it defaults to zero and must be finite within ±864,000 seconds. The native adapter subtracts this origin from its ordinary media sample seconds exactly once before calling layout. This supports adjustment layers with large default source in-points without guessing a one-hour offset or rewriting word times. Trims and splits retain the persisted origin.

`layoutFrame` selects half-open `[start,end)` phrases and word activity ranges. Pauses inside a phrase retain the phrase and show earlier words as spoken. Text area coordinates are top-left pixels. Punctuation tokens attach to the preceding word without an extra space, including at regroup boundaries. Width wraps words without scaling the font; height reports overflow without altering layout. A word wider than the box also reports overflow. The caller must clip drawing, and can surface overflow in its panel. Independent overlapping containers can produce multiple draw-command sets; the host is responsible for compositing them.

The native adapter's default for **new effects** is a box center at 50% horizontal / 90% vertical, width 1,536 px and height 150 px. The adapter converts that center to the top-left coordinates expected here. At 720-, 1080- and 2160-pixel frame heights, real CoreText raster tests verify default 64 px caption ink is within the lower 79–94% of the image. These are initial parameter defaults only; existing point/height values and authored keyframes retain their original interpretation. Core layout never changes an explicit box to a default.

The callback receives the effective per-state font style and display text. Return real shaped advance width, ascent and descent at `fontSize * sizeScale`. `DrawWord.x` and `width` describe its outer bubble bounds when a bubble is enabled; text origin is `x + inlinePadding()` and baseline is the returned `baseline`. Bubble top is `baseline - ascent - padding`. Bubble bounds do not include outline/shadow extents. Titles transform ASCII letters only and preserve UTF-8 bytes; complete Unicode locale-aware title casing requires a host text library. Source words remain unchanged.

Schema 2 appended the origin as binary64 after the schema-1 title-case field. Schema 3 keeps those bytes unchanged and appends a 56-byte typography footer: optional shared base weight (binary64, zero means unset), then upcoming/current/spoken records of optional absolute weight (binary64, zero means unset), italic (uint32: 0 legacy/unset, 1 false, 2 true), and relative-weight mode (uint32: 0 absolute/unset, 1 shared base, 2 next available heavier). Explicit weights and shared base range from 1 to 1000, including fractional variable coordinates. Relative mode 2 corresponds to the panel's persisted `fontWeightOffset:100` flag; it does not invent a missing static weight. The decoder accepts schemas 1–6 (the later extensions are described below). Untouched v1/v2 documents re-encode byte-for-byte in their original version; an origin edit upgrades v1 to v2, and a typography edit upgrades to v3. New C++ documents default to v3. Unknown versions are rejected. The binary codec uses fixed little-endian uint32 and IEEE-754 binary64 values; strings are byte-length-prefixed. It rejects unknown schema versions, non-finite values, malformed booleans, duplicate container IDs, invalid timings/styles, malformed UTF-8, unsupported controls (U+0000–001F, U+007F–009F, U+2028/U+2029), trailing bytes, excessive counts and sizes, and incomplete buffers. The maximum document is 16 MiB, with 100,000 total words, 10,000 containers, 4,096-byte word strings and 256-byte IDs/font names. It is a local data format, not an executable command transport. The panel must explicitly migrate legacy caption data rather than automatically replacing legacy timeline clips.

Run `native/tests/run-core-tests.sh` for strict-warning AddressSanitizer/UndefinedBehaviorSanitizer checks. The CMake test executable also accepts `--roundtrip input.bcap output.bcap` for panel/native binary interchange verification.

The macOS rasterizer selects actual installed family faces using OpenType `usWeightClass` and CoreText traits, or a real variable `wght` coordinate. It prefers a native italic face at the selected weight and applies a 12-degree synthetic slant when no matching italic face is available. Synthetic ink overhang is included in measured width and bubbles. Legacy unset typography retains the original named face exactly. Font selections are reused within one frame only, so new font registrations are visible on the next render. A native family name remains explicitly bounded to 256 UTF-8 bytes; longer names are rejected, not shortened.


BCAP schema 5 appends three uint32 boolean flags after the v4 letter-case footer, in upcoming/current/spoken order. Each enables filling the following space for that state's word bubble. Missing flags in v1–4 mean false; false/default settings keep legacy documents byte-identical in their existing version. A true flag upgrades to v5. Disabling the last flag retains a v5 carrier with zero flags, so roundtripping does not silently downgrade it. Unknown versions and non-boolean flag values are rejected.

Space filling is paint-only: the bubble extends rightward to the next word's outer left edge on the same laid-out line, even if that next word uses another state or has no bubble. It never extends after the final word, across a line/group break, or before punctuation that has no inserted space. Its color, text opacity, bubble alpha, padding, and radius follow the owning word. The extension does not move glyphs, alter phrase grouping or change width measurements. Rolling transitions transform and fade this extension with its owning word.

Connected visible word bubbles square only their internal touching edges when filling spaces. The first and last ends of each physical line retain their corner radius; wrapping and explicit group boundaries always start a fresh run. Different word-state colors and opacity are preserved on their own spans. Invisible or not-yet-displayed rolling/typewriter neighbors do not flatten a visible outer endpoint. These corner joins are derived draw geometry, not persisted fields or a BCAP schema change.

The line-height multiplier accepts finite values from 0.6 through 10. The panel exposes the compact 0.6–3 range, while existing native documents up to 10 remain readable. It multiplies the measured line extent when advancing baselines; values below 1 intentionally permit tight/overlapping lines. It does not change text sizing, horizontal wrapping, or derived bubble joins. No schema change is involved.


BCAP schema 6 appends a 60-byte footer after v5: six binary64 axis padding values in upcoming-inline/upcoming-block/current-inline/current-block/spoken-inline/spoken-block order, followed by three uint32 underline modes in upcoming/current/spoken order. Axis value -1 means inherit that state's old uniform `padding`; explicit values are finite 0–4096. Underline modes are 0 unset, 1 explicit off, 2 on. New optional JSON fields are `bubblePaddingInline`, `bubblePaddingBlock`, and `underline`. An explicit axis or underline choice requires v6; absent values retain v1–5 bytes exactly. Disabling an already-v6 option preserves its version and other footer values. Unknown modes, malformed numbers, truncation, and trailing bytes are rejected.

Inline padding affects bubble width and text's horizontal inset; block padding affects bubble height and measured line extent. Native Padding% modulates both axes; output downsampling uses the appropriate axis for explicit values, preserving legacy uniform-padding behavior when overrides are absent. Independent color-space joins still reset at physical line breaks. Native underline is rendered by CoreText on the unchanged font, glyph origins, and advances; an explicit off produces the old unset pixels exactly. No new Effect Controls parameter or animation authority is introduced.

BCAP v7 appends 288 bytes after the v6 footer: twelve binary64 values per
state in upcoming/current/spoken order. Fields are paddingTop, paddingRight,
paddingBottom, paddingLeft, radiusTL, radiusTR, radiusBR, radiusBL, marginTop,
marginRight, marginBottom, marginLeft. Padding/radius use -1 to inherit legacy
axis/uniform values; explicit values are finite 0–4096. Margins default to zero
and accept finite -4096–4096. Values participate in layout and native render
scaling. Unedited v1–6 documents retain their byte representation.


Scrolling `visibleLines` is a maximum history count, constrained by the physical
caption height. Increasing the count never scales font size, bubble padding,
margins, outlines or shadows. If the area fits fewer lines, only that many are
shown; increase the area's height to show more history at the authored size.
Independent boundary insets and fades remain masks over that unchanged layout.

Within a scrolling container, a gap longer than `pauseSeconds` derives timed
empty rows without changing the transcript or word timings. The count is
`min(visibleLines, max(1, floor(gapSeconds / pauseSeconds)))`: the first row
enters at the preceding speech end, subsequent rows enter every `pauseSeconds`,
and the final empty row lasts until speech resumes. A zero pause threshold uses
the default 0.6-second cadence while still recognizing every positive gap.
Long pauses can therefore clear all visible history, with at most eight derived
empty rows per gap. Future words remain hidden until the gap ends. Static pages
retain their existing single empty row per qualifying gap; separate containers
never acquire connecting silence rows. The layout is derived independently for
each requested frame, including backward seeks.

## Current BCAP v12 format, line wrapping and position styles

This section supersedes the historical version-selection descriptions above.
Writers emit BCAP **v11** without position styles and **v12** with them; readers
accept v1–12. Clearing all positions returns to v11 and preserves line wrap. JSON
panel protocol `version` remains 1. V8 made word boundaries explicit and made
storage-container edges and `manualSplit` metadata independent of rendered line
boundaries. V9 added each word's `pauseLinesRemoved` uint32 (0–8), immediately
after its boundary uint32; it suppresses derived pause rows without changing
speech timing.

V10 defines the word boundary enum as 0 automatic, 1 manual `break`, 2 `join`,
and 3 merge `edge`. Both `break` and `edge` render as hard line boundaries.
Reflow clears joins and merge edges while preserving manual breaks and removed
pause rows. Pre-v10 documents upgrade breaks adjacent to joined runs to merge
edges once on decode; v10+ manual breaks remain manual even beside joins.

V11 retains the v10 word layout and appends one little-endian uint32 **after the
v7 style footer**: 0 Fill, 1 Balance, 2 Pretty. Older documents decode as Fill;
unknown values, truncation and trailing bytes are rejected. Native C++ stores
`Style::lineWrap`; sparse panel JSON omits `style.lineWrap` for Fill and stores
`"balance"` or `"pretty"` otherwise.

All modes count Unicode scalars, include spaces between ordinary words and glue
leading punctuation without a space. Explicit joins make an indivisible unit,
even across sentence ends, pauses or the character/duration limit. Other hard
boundaries are sentence ends, manual breaks, merge edges and gaps **greater
than 0.6 seconds**. Within these boundaries, lines respect the character limit
and a **5.5-second** duration cap; one overlong word or joined unit stands alone.

- **Fill** places as many units as fit on each line.
- **Balance** minimizes line count first, then the sum of squared line widths;
  equal costs prefer a longer earlier line. It retains Fill's line count.
- **Pretty** uses Fill unless the final line is a single unit or shorter than
  one third of the character limit. It resplits only the last two lines,
  preferring a final line with multiple units, then the smallest sum of squared
  widths, then a longer first line. All fit constraints still apply.

At 20 characters, “The quick brown fox jumps over the lazy dog.” becomes:
Fill `The quick brown fox / jumps over the lazy / dog.`, Balance
`The quick brown / fox jumps over / the lazy dog.`, and Pretty
`The quick brown fox / jumps over / the lazy dog.`

`caption_core_tests --lines input.bcap MAXCHARS` prints the first global word
index of each derived line. `tests/line-wrap.test.mjs` compiles a temporary
standalone core executable and checks the TypeScript mirror against this output
for all three modes; it does not require an SDK, installed plug-in or Premiere.

BCAP v12 adds line position styles: style overrides for the slots of the
visible caption window, numbered in screen order (Line 1 is the top line, up to
eight). It is written only when a document has at least one; every other
document writes v11 with its wrap footer. `kPositionStylesVersion` is the single constant
to identify this extension. The exact order is the v10 base (through the v7
geometry footer), the v11 wrap uint32, then the v12 position block: a uint32
count (0–8), then per position
a uint32 position (1–8, strictly increasing), a nonzero uint32 field mask and
the flagged fields in bit order: font family (string), weight (binary64 weight
plus uint32 mode 0 absolute/1 shared base/2 next heavier), italic and
underline (uint32 0/1), effective font size, text RGB, opacity, bubble and
fill-spaces flags, bubble RGB, bubble opacity, padding top/right/bottom/left,
radius TL/TR/BR/BL, margin top/right/bottom/left, outline width, outline RGB,
outline opacity, shadow blur/X/Y, shadow RGB and shadow opacity. RGB fields
are three binary64 values; alpha always travels in its own opacity field.

Precedence is All words, then Past/Current/Next, then the line position: a
position's flagged fields replace the word's state values; the rest inherit.
In scrolling text a line takes the style of the slot it occupies, and each slot
reserves its own height from the worst metrics of every word under that slot's
merged styles, so position margins space slots apart (Lines 1 and 4 can sit
farther out while Lines 2 and 3 keep their normal gap). While a line scrolls
between slots its style blends between both slots: numbers and colors
interpolate, a background present on one side fades its alpha, and font
choices switch halfway. Rows stack on the current-line slot by their restyled
advances, so their positions follow the uneven spacing smoothly. Sideways
scrolling and pages use the row within the page; fade, slide and pop
transitions paint two settled windows, each with its own slot styles, and a
line present in both glides from its old slot to its new one, blending both
slot styles (without position styles such a line still moves at once, as before). Pause
lines take slots like text lines. Slots beyond Visible lines (or beyond the
rows a page or the box can hold) are kept but unused. With no position styles
in the visible slots the original layout code runs unchanged. The native
adapter scales position overrides by Global font size, Global text tint and
output downsampling; the per-state Word styles percentages modulate state
styles only.

Case, line height, word spacing and alignment remain global; position overrides
do not capture them. Sideways motion uses rows within the sliding page, and
paged rendering uses rows within each page. CEP Extend normalizes pre-v11
trailers with Fill and pre-v12 trailers with an empty positions block, then
requires exact normalized trailer equality. Canonical upgrades target v11 or
v12; the pre-v10 boundary migration stays independent of these footer versions.
