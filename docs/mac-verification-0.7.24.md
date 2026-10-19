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

Final package and native host checks are pending completion of independent
inline/block padding support.
