# Mac verification — 0.7.16

Verified in installed Premiere Pro 26.5.2 on Apple Silicon. The production native
clip `000f42ec` reconnects as one physical clip with 78 timed words and 15 phrase
rows at 56 characters. Existing native clips need no retranscription.

The installed Caption grouping input was changed to 24. The panel displayed 24
phrases, with a maximum length of 24 characters, and the effect parameter read
back as 24 without a manual update action. Restoring 56 restored the original
phrase grouping. Agent-hook character-limit edits use the same grouping path.

The complete normalized production graph before/after the limit test is identical:
six sequences, clip IDs and media, source/timeline timing, native transcript bytes,
effect values and keyframes. The disabled movie backup remains intact. No clip
was created, removed, replaced or trimmed. Premiere was kept on the other display
and its bounds verified after the tests and restart.

Validation: 832 automated tests, 830 passes, two Windows-only skips, zero failures;
Svelte check reports zero errors and warnings. Package generation and Adobe
installation succeeded. All seven installed panel payload files and the installed
CEP host match the build. Native-grouping tests cover renderer-equivalent phrase
rules, no-op byte preservation, per-phrase text edits, static parameter readback,
conflicts, malformed input, animated-limit refusal and the full panel/UXP/service/
CEP transport route.

The native effect executable is unchanged, SHA-256
`8c4ad9b0acc11fbec2ef8d3f5b13f01282fce2f6d6891875790e71c348e4dbf4`.
Animated character limits remain in Effect Controls; the panel does not flatten
or rewrite their keys. Physical Program Monitor drag handles and Windows native
rendering are not qualified by this grouping increment.

Private project backups, state receipts and screenshot evidence remain local in
`artifacts/host-scratch/native-phrases-2026-10-18/`.
