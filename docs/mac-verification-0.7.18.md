# Mac verification — 0.7.18 numeric controls

Tested in the installed Premiere Pro 2026 panel on the production sequence
UGC Video - 01 - All Clips. Premiere stayed at (-2560,1137), 2560×1409, on the
other display. The existing wide Effect Controls / Better Captions panel was kept.

- Styling showed Position 360.0/1152.0, Width 719.0, Height 249.0 matching native
  effect readback. Separate reset arrows and inactive animation indicators appeared.
- A horizontal width-value drag changed the native Width to 729. Position and
  Height remained unchanged. Subsequent human geometry changes were preserved.
- Current-playhead sampling, interpolated values, exact tick navigation and reset
  semantics have automated backend/controller coverage. Live animated-key navigation
  has not yet been accepted in this verification pass.
- Automated checks at the installed 0.7.18 checkpoint: 855 tests,853 passing,
  two Windows-only skips; Svelte check zero errors/warnings. Impeccable detector
  returned no findings for the changed numeric interface.

The native renderer remained the outline/case Metal build with executable SHA-256
7885264063f6b1cdda5606cbc27ea33138b2cade67a0ae1f12ebf8bbf9cfb1a8.
