# Mac validation for 0.5.1

The reviewed 0.5.0 source was pinned to 291532d06dc2e3ed045864bfb0d82b87a596e155. The 0.5.1 changes correct stale playhead edits, busy ownership, hidden reflow failures, unsupported trimmed/complex Motion edits, exact-link revalidation and legacy installer migration. The approved Transcript / Styling interface is preserved.

- macOS tests: 280 passed, 0 failed, 2 Windows-only tests skipped.
- Svelte/TypeScript: 0 errors and 0 warnings.
- Production editor and service builds passed.
- Both archives passed CRC, manifest/version, nested-CCX and executable Mac-wrapper checks.
- Adobe's actual command-line installer confirmed 0.5.1 installation. A separate installer query reported Better Captions 0.5.1 enabled in Premiere 26.5.2.
- The existing 0.3.1 CEP symlink was recognized and preserved in the private install-backups folder; the installed service is now an owned copy with version metadata. Its permanent old source remains intact.
- All 16 files belonging to the separate local RollUp work retained their recorded hashes.

Premiere remained closed during installation. These results do not yet establish 0.5.1 operation inside Premiere: transcription, rendering, Program Monitor handles and native keyframe acceptance still require a live run. The release remains a prerelease.
