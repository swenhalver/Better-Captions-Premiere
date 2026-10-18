# Better Captions 0.7.1

Caption grouping now uses **characters**, with no word-count cap. Open **Transcript → Sentence grouping → Characters per caption**, choose a limit and click **Regroup** before applying captions to Premiere.

- Default 56 characters, configurable from 1 to 500. Spaces and punctuation count. Unicode graphemes count as visible characters when supported by the embedded browser; the fallback counts normalized Unicode code points.
- Words stay whole. A single word longer than the limit appears in its own caption and can exceed that limit.
- Increasing the limit can join short captions across previous automatic boundaries. Decreasing it splits them. Sentence markers, pauses, speaker/placement boundaries, word timings and the existing readable-duration limit are respected.
- Existing linked clips remain protected; regrouping cannot remove their native Motion keys or media identities. Undo restores the previous unlinked captions.
- Saved legacy word limits migrate to the 56-character default. Existing captions are retained until Regroup or new transcription. The agent style setting is now `maxChars`; style presets leave that destination setting intact.
- Includes the sequence-scoped preset message fix pulled from `c4e3f87`.

## Verification

Character-limit regressions cover twelve short words in one caption, exact boundaries, spaces/punctuation, Unicode, long-word handling, joining and splitting old captions, linked-clip protection and old-session migration. The local Windows suite outside the existing symlink-dependent installer tests passed, and Svelte reported zero errors and warnings. Full Windows/macOS CI and exact source/artifact hashes are recorded with the GitHub release.

Browser checks exercise the actual character control, split/rejoin behavior, Undo and reopening. These checks do not establish native Premiere acceptance for 0.7.1. See [0.7.0 Mac installation checks](mac-verification-0.7.0.md) and [0.6.0 native keyframe acceptance](release-0.6.0.md) for the inherited platform evidence and limits.

## Installation

Download the full `Better-Captions-Swen-0.7.1-Windows-macOS.zip`, extract it to a permanent folder, and run `node scripts/install.cjs`. Restart Premiere after upgrading. The same plugin identity preserves its user-data preset library. Premiere Pro 26.3+, Creative Cloud Desktop, Node.js 24+, FFmpeg/FFprobe and macOS Fontconfig are required.
