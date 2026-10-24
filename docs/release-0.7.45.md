# Better Captions 0.7.45

- Caption groups never wrap or shrink during rendering. Regrouping remains the source of line boundaries. Excess width clips at the existing boundary.
- Speech gaps longer than the existing 0.6-second pause threshold reserve one timed blank row until speech resumes.
- Word backgrounds and vertical padding paint around fixed text without changing glyph baselines, line height, silence spacing or scrolling line capacity.
- Style popups and font pickers follow their parent controls during nested scrolling, toolbar reflow and viewport resizing.

Validation: 1,042 JavaScript tests passed (two skipped), zero Svelte errors/warnings, three native ASan/UBSan CTest targets passed. Actual Premiere renders verified one-line narrow overflow and speech/blank/resumed-speech frames.
