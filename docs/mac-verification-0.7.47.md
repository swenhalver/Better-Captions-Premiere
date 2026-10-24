# macOS verification: 0.7.47

This update includes the grouped-line, timed-silence, padding and popup behavior
described in `nowrap-silence-padding-verification.md`.

Caption grouping is now an always-visible section with its help paragraphs and
Regroup button removed. The character control reuses the existing scrubbable
number behavior: drag, click to type, integer steps, 15..150 UI bounds, and valid
typed changes applied immediately. Empty and partial drafts remain editable.
Persisted older values outside that range are preserved until adjusted. Fresh
unlinked captions now split and rejoin automatically; linked native identities
remain unchanged.

The new default-open Text box boundaries section appears below Scrolling text.
Selecting All four sides exposes separate Top, Bottom, Left and Right controls
for crop inset, fade enable, fade width, fade amount and curve. Existing
Directional edge settings are retained until the user selects another mode.
The UI states that these boundaries currently affect scrolling text.

The host bridge discovers the native side groups and handles Premiere's blank
checkbox labels, boolean samples, and zero-based popup values. Actual Premiere
readback returned all 21 boundary streams. On a disposable sequence, the same
identity-checked production host methods successfully changed and read back:

- Boundary mode: All four sides.
- Top/Bottom/Left/Right crop insets: 5/6/7/8 percent.
- Top fade: off; top fade width: 25 percent.
- Right curve: Gentle start.

The temporary sequence was removed and the original sequence/playhead restored.
Receipts: `/tmp/bc-edge-controls-live.json`, `/tmp/bc-edge-edit-live.json`.

The full JavaScript suite passed 1,052 tests with two skipped and zero failed.
Svelte check reported zero errors and zero warnings. The final native source
passed all three ASan/UBSan CTest targets and the official Adobe SDK build.

Native binary SHA-256 remains
`aad396a74353f2b52db3743857084b8e61ba368ee1bc59c6ac563642d87c5bf0`.
Panel/service version is 0.7.47. No release commit or remote push was requested.
