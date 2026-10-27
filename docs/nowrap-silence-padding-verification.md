# Grouped lines, silence, padding and popup tracking

Verified on 2026-10-20 in the Better Captions checkout and the installed macOS
Premiere plugin.

## Behavior

- Regrouping determines phrase boundaries. Rendering does not wrap a phrase or
  split a long word when the text area narrows, and does not reduce the font.
- A gap longer than the existing 0.6-second pause threshold reserves one timed
  blank row. Scrolling enters the blank at speech end and holds it until speech
  resumes; future rows cannot bypass that gap through a taller viewport.
- Authored vertical padding participates in row geometry whether the word
  background is on or off. Padding edits change line height; toggling the
  background at the same padding does not move the glyph baseline.
- Asymmetric padding reserves the space needed above and below the text so
  background paint fits in the row. Explicit text-box boundaries still clip
  overflow when the authored content exceeds the available box.
- Style and font popups track their parent controls through nested scrolling,
  resizing and position-only toolbar reflows. They close when the parent is
  fully clipped and clean up tracking when dismissed.

## Runtime evidence

The installed no-wrap fixture used a 300-pixel-wide box and a complete long
phrase. Actual Premiere output has exactly one glyph band, y=401..448. The
remainder is clipped horizontally instead of appearing on additional rows.

Actual Premiere exports for a two-second speech gap show speech before the
pause, an entirely empty frame during the pause, and resumed speech afterward.
A three-slot static page has two glyph bands separated by one complete blank
row.

The corrected padding fixture uses 80 pixels above and 40 below the text in an
accommodating 648-by-1000 box. Background off and on produce identical glyph
bands, y=231..278 and y=729..776. Enabling the blue background adds complete
192-pixel paint bands, y=140..331 and y=638..829, without changing text placement.
The background-disabled frame has no blue paint.

The existing in-app browser preview was used after checking Chrome Beta and
Chrome stable for a matching tab. In the spare existing preview tab, a nested
scroll moved both the parent button and its portaled popup by exactly -214.5
pixels. The gap stayed exactly 4 pixels. The popup was closed and the preview
scroll restored after testing.

All disposable verification sequences were removed. The six original sequence
graphs exactly matched the latest pre-install snapshot after the padding test.
The user's concurrent edits were retained between earlier snapshots.

Evidence images are in `artifacts/verification-nowrap-silence/`. Raw host
snapshots include `/tmp/bc-padding-preinstall.json` and
`/tmp/bc-padding-cleaned.json`. Source and installed native binary SHA-256:
`aad396a74353f2b52db3743857084b8e61ba368ee1bc59c6ac563642d87c5bf0`.

## Automated verification

- Full JavaScript suite: 1,042 passed, two skipped, zero failed.
- Svelte: zero errors and warnings.
- All three AddressSanitizer/UndefinedBehaviorSanitizer CTest targets pass.
- Native pixel tests cover static and all four scroll directions, background
  toggles at identical padding, padding-driven row changes, complete background
  paint, blank-row spacing, transitions and both wait policies.
- The full official Adobe SDK build and adapter/helper checks pass.
- Installed client assets match their CCX package byte for byte.

Logs: `/tmp/bc-padding-js-tests.log`, `/tmp/bc-padding-check.log`,
`/tmp/bc-padding-native-build.log`, `/tmp/bc-padding-install.log`.
