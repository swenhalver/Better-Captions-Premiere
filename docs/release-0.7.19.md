# Better Captions 0.7.19 — Extend existing captions

Choose **Sequence actions (…) → Extend captions** after adding footage beyond the
current native caption clip. Pending caption edits are saved first. Premiere’s
built-in source transcription supplies only the new timeline tail; previously
edited caption text, word timings, display styles, character limit, manual splits,
position/size and native keyframes are retained. The same physical caption clip
extends to the end of enabled footage/audio. Existing manual clip splits stay intact.

The operation bypasses stale static sequence transcripts, reuses existing native
source transcripts, and transcribes missing source items through Premiere. It
never replaces the existing caption document with a fresh whole-sequence transcript.
If footage, caption text, effects, timing or keys change while transcription runs,
extension refuses the stale operation. An occupied destination on the same track
is reported before any write. An unconfirmed write is never replayed automatically.
Silent tails do not create empty captions or lengthen the layer unnecessarily.

Includes the [0.7.18 numeric controls](release-0.7.18.md) and
[0.7.17 outline/case repairs](release-0.7.17.md).
See [native transcript extension](native-transcript-extension.md) for the API contract.

## Caption area and pages

The updated native build adds a draw-only Program Monitor bounding box for the
caption area when Premiere displays the selected effect’s on-screen controls.
The rectangle follows Position, Width and Height and is not part of rendered or
exported pixels. Experimental overlay pointer handlers remain disabled.

**Groups per page** selects 1–100 consecutive caption groups to show together.
Each group retains its character limit and begins on a separate line. The active
word still receives the current-word style across the page; manual container
boundaries remain separate. Extra groups need enough caption area height.
