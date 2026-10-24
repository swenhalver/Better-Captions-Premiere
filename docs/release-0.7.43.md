# Better Captions 0.7.43

- Characters per caption and inline caption timing use standard text editing so forward Delete and Backspace work at the caret; numeric validation and stepping remain.
- Scrolling captions retain upcoming words with their authored Next style.
- Shared scrolling/static row composition preserves text spacing when toggling scrolling.

Validation: 1,033 JavaScript tests passed (two skipped), Svelte has zero errors/warnings, and all three native ASan/UBSan CTest targets pass. Native rendering was verified in actual Premiere output.
