# Mac verification — 0.7.24

## Browser acceptance

Checked the actual Mac ribbon preview in an isolated background in-app browser
tab at 360px. With filled spaces and 20px corners, the first wrapped row had
corner pairs `[10,0], [0,0], [0,0], [0,10]` in the half-scale sample; the next row
had `[10,0], [0,10]`. Each physical line retained rounded outer ends and square
internal joins. The user-facing preview was refreshed with the correction.

Actual text baseline advances changed from 26px at line height 0.6, to 42px at
1.2, to 66px at 2. Alignment and line-height SVGs measured 19.5px square with a
2px stroke; inactive icons shared `rgb(237,237,237)`. Selected alignment retains
its white-on-blue active state.

The earlier corner bug came from conflicting shorthand/longhand inline radius
updates. The replacement uses one four-corner radius value. Layout measurements
use actual inline baselines and DOM-flush promises so background tabs do not
depend on animation-frame delivery.

## Installed acceptance

Verified in Premiere Pro 26.5.2 on Apple Silicon macOS. All 18 installed UXP
package entries matched the CCX byte for byte. CCX SHA-256:
`3d3fbcb99925f3ba9f3fb2e9001c0699e6ef7457393b0aa79373448f406becaa`.
Native binary SHA-256:
`f8818415770dd072dd9ab30fafb1d7340e8664da99aa07156a4b22ef8597d9c1`.
Native archived source: `251e7ea646e5d93bcdf65e636f48bac0e4d7e896` with recorded
explicit build overlays; panel/service source: `2a440e2`.

The installed B/I/U ribbon, size buttons, line height after alignment and
independent padding popup were checked in a disposable sequence. The real
Underline button changed its v3 carrier to v6 and enabled underline in all three
word states. Caption text and timings remained identical. Program Monitor
screenshots showed real underlines under both rendered groups.

Using the installed Current-word popup to set Inline padding 30, Block padding
4 and Color spaces changed exactly those three current-state fields. Legacy
uniform padding, all other styles and caption data remained intact. The native
bubble visibly grew horizontally and became thinner vertically. Line-height
values 0.6 and 2 produced visibly tight and separated lines; readback confirmed
the new value. The exact original v3 carrier was restored after testing.

A captured installed geometry edit completed in 252ms versus the earlier 555ms
sample; captured reads ranged 63–443ms. This is limited request-level sampling,
not proof of fluid dragging. Plugin geometry changes remain less smooth than
Effect Controls.

Selecting the actual native-effect header displayed the blue Program Monitor
bounds. They remained visible after returning to Better Captions on the
original production clip. Automatic effect-header activation is still
unavailable through the inspected public CEP/UXP or QE interfaces; clip selection
alone does not reliably activate the box.

The full JavaScript suite passed 1,002 tests with two expected skips. Svelte
reported zero errors and zero warnings. Native core/raster tests passed under
ASan/UBSan, including real independent-padding and underline pixels, legacy
pixel equality, line spacing and per-line rounded joins. Real Adobe SDK adapter,
custom-UI, source-clock and Metal checks passed. These compiled checks are
reported separately from installed acceptance above.

The disposable sequence was deleted and the original reopened. All six original
sequence graphs matched the fresh preservation baseline exactly, including
caption documents, timings, styles, parameter values and keys. The saved project
retains only those six sequences. Premiere stayed on the other display at
(-2520,1146), with its 2560×1409 window and wide left panel preserved.
