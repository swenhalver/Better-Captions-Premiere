# Better Captions 0.7.20 — Smart line fitting and scrolling text

**Transcript → Caption grouping → Smart line fit** fits whole words to one line
using real font measurements at 95% of the selected Width. It reserves each word’s
largest upcoming/current/spoken appearance and bubble padding, so changing the
highlight does not reshuffle phrase boundaries. Sentence, pause and manual split
boundaries are retained. The fixed character limit is preserved and resumes when
Smart line fit is off. A single word wider than the area remains whole.

**Styling → Scrolling text** restores the roll-up/fade-boundary controls in the
native effect workflow:

- Scroll, Fade, Slide or Pop line transitions.
- Up, Down, Left or Right direction and a 0.1–10× speed multiplier.
- Wait for line to finish is enabled by default; turn it off to progress while the line is spoken.
- 1–8 visible lines and transition duration.
- Soft fade boundary with position, thickness, amount and four curves.
- Premiere keyframes, current-playhead values, previous/next key navigation and
  per-control reset. No duplicate keyframe timeline appears in the plugin.

Vertical scrolling moves line by line. Horizontal scrolling moves blocks containing
up to the selected visible-line count. Scroll mode preserves character/Smart group
breaks and replaces page switching while enabled; Groups per page is retained for
returning to ordinary captions. Words reveal at their source timestamps; rendering
at a scrub position is deterministic. Creative transitions draw shared history once
and keep the currently spoken word at its configured opacity for legibility. The soft exit changes pixel alpha without
blurring text.

All new native controls append after existing parameter IDs. Transcript carrier
bytes and codec versions are unchanged. Existing sources, text edits, timings,
styles, geometry, keys and manual splits are retained. Native control edits remain
identity/revision guarded and an unconfirmed write is not automatically repeated.

The separate older RollUp development checkout is preserved unchanged. These
features require the matching updated compiled native plugin alongside the panel.
