# Better Captions 0.7.42

Scrolling preserves the authored font size and geometry. Visible lines limits scrolling history within the available caption height; it never shrinks text to force more rows into a small box.

Native Scrolling text > Boundaries offers independent Top, Bottom, Left and Right positions and fade enabled, width, amount and curve controls. Existing captions retain the legacy directional mode until the independent mode is selected.

Native Width and Height reset use 90% of the containing sequence dimensions through Adobe's Sequence Info suite. Registration uses an Auto sentinel because Premiere supplies no dimensions while registering the effect. Supervised Reset callbacks resolve that sentinel into the sequence-specific pixel value, preserving existing positive values and keyframes.

Grouped, purpose-specific native Effect Controls and the temporary layout guide remain included. Installed Premiere acceptance is recorded separately after testing the actual reset arrows at multiple resolutions.
