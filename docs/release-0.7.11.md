# Better Captions 0.7.11 development build

Word timing edits keep a three-frame minimum, including collision shrinking.
The edge handles leave a centre area available for moving short words. The
installed-font picker, direct sentence/timestamp editing, integrated Split/Merge,
Fit content and wheel zoom from [0.7.10](release-0.7.10.md) are included.

First and last words can now move or trim inward on an existing native caption
without a false validation rejection. Timing tools retain the captured editing
range; the saved native document follows the actual edited word times. Only
captured existing boundaries may remain wider than the words. New caption IDs,
fabricated boundary-only changes and words outside their range still reject.
The physical caption clip, scalar controls and keyframes remain untouched.

This increment gives Adobe's installer a fresh version identity; reinstalling
0.7.10 over 0.7.10 reported success while leaving its previous payload in place.
Installation acceptance compares actual file bytes with the package.

Native-effect Razor timing, direct Program Monitor dragging and installed Windows
Premiere acceptance remain open. See [Mac verification](mac-verification-0.7.11.md)
for the installed checks and their limits.
