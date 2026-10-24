# Better Captions 0.7.44

- Caption groups never wrap or shrink during rendering. Regrouping remains the only source of line breaks; excess width clips at the existing boundaries.
- Speech gaps longer than the existing 0.6-second pause threshold reserve one blank timed row. Scrolling holds that space until speech resumes.
- Source words, timestamps, clip identities and authored styles remain unchanged.
