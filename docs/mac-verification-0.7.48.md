# macOS verification: 0.7.48

Installed UXP client files match the 0.7.48 CCX byte-for-byte. The installed CEP host bridge matches the source. Native binary SHA-256: `c8d4bce6e186c178dcd476229b999c46f052d3795f2f72afacaaa459b59d8dc1`. Premiere was saved, restarted once, and reopened on the existing main display.

## Background spacing

Background visibility no longer changes authored horizontal padding clearance in native composition, CoreText glyph origins, canvas measurements, or Smart-fit grouping/capacity. Margins remain unchanged. Editing padding still adjusts layout. Canvas space-filling paint uses asymmetric right/left padding consistently.

Actual installed Premiere exports on a disposable 720 by1280 sequence used a three-word row, 13/29px left/right padding, 7/11px left/right margins, red glyphs and blue backgrounds. All 2,867 nonzero red glyph pixels were identical between background Off and On. Only background pixels changed. Files: `artifacts/verification-nowrap-silence/horizontal-background-{off,on}-installed.png`.

## Double-click reset

Single-click typing remains immediate. Wrapper pointer tracking recognizes a second press despite the button-to-input swap; trailing click/dblclick cannot reset twice or commit a stale draft. Dragging and disabled controls retain their existing behavior.

Past/Current/Next style controls reset to the current All words value. All words uses known factory defaults. Native dimension reset callbacks retain sequence-derived 90% width/height defaults; Position axis resets preserve the other axis. Characters per caption resets to56.

Browser preview verification: All words20, Current90, double-click Current yielded20. Installed Premiere UI verification repeated this using a disposable native document. Native carrier readback confirmed Current20 and All20 after the actual double-click. Evidence: `current-reset-before-installed.png`, `current-reset-after-installed.png`, and `/tmp/bc-48-after-reset-carrier.txt`.

## Validation and preservation

- Full JavaScript suite: 1,065 passed, two skipped, zero failed.
- Svelte: zero errors, zero warnings.
- All three ASan/UBSan native CTests passed.
- Official Adobe SDK native build and adapter/helper checks passed.
- All six original sequence graphs compare exactly before/after restart and testing.
- Disposable test sequence removed; original sequence/playhead restored and project saved.

Logs: `/tmp/bc-48-js-tests.log`, `/tmp/bc-48-check.log`, `/tmp/bc-horizontal-build.log`, `/tmp/bc-48-native-build.log`, `/tmp/bc-48-install.log`. No commit or push requested.
