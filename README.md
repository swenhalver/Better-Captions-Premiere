# Better Captions — Swen's Premiere fork

Editable word-highlight captions using **Premiere Pro's built-in Speech to Text**. Based on [Matthew Paquette's Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere), upstream commit `16c32128506a9c1a29a3577ea6d8e37339e9e6b9`.

This fork adds independent upcoming, currently spoken, and previously spoken word appearances; a rounded bubble behind the active word; word sizing; transcript and timing edits; frame placement; actual timeline insertion; and a local agent API.

## What you can edit

- Caption text and individual word start/end times, with overlap validation.
- Phrase grouping at sentences, pauses, word/character limits, and readable durations. Split, merge, regroup, and undo before timeline links would be lost.
- Base font, weight, size, color, alignment, case, outline, shadow, caption background, wrapping width, and line height.
- Active and past words independently: font, weight, relative size, color, opacity, bubble color/opacity, padding, and corner radius.
- Full-frame caption placement by dragging the preview or entering coordinates. Set a shared location or override individual phrases.
- Fade, Pop, Bounce, Typewriter, and word highlighting. Enlarged words reserve space so surrounding words do not jump as the highlight moves.

Each phrase is rendered as a transparent **ProRes 4444 clip** at the sequence's frame size and exact frame rate, then placed on a chosen video track. It is hardcoded into the final video when you export the sequence. Edit its text/style/timing in this panel and apply again; existing clip identity and manual Premiere Motion/Opacity settings are preserved. These are rendered clips, so Premiere's Text tool does not edit their letters directly.

## Requirements

The provided installer targets **Apple Silicon macOS and Premiere Pro 26.3 or newer**. Live checks used Premiere 26.5.2. Windows and Intel installers have not been implemented or tested.

- Node.js 24 LTS for building/development and the optional agent CLI.
- Local FFmpeg/FFprobe at `/opt/homebrew/bin/ffmpeg` and `/opt/homebrew/bin/ffprobe`.
- Fontconfig's `/opt/homebrew/bin/fc-list` for the installed-font picker.
- Premiere's Speech to Text language pack and transcription preferences set as desired.

With Homebrew, the media/font dependencies are `brew install ffmpeg fontconfig`.

## Install and use

From the source checkout:

```sh
npm --prefix webview-ui ci --ignore-scripts
npm run check
npm test
npm run package
npm run install:premiere
```

Alternatively, unpack the installer ZIP from this fork's releases and run `zsh scripts/install-cep.sh` in its folder. Keep the unpacked folder in a permanent location: the CEP installation points to it.

The installer installs the main UXP caption editor and an invisible CEP render service. The Transcribe button calls Premiere directly from the main plugin; no separate transcript window is used. Adobe's local CEP developer flag is needed for this reviewed, unsigned panel. Restart Premiere once after first installation to start its background rendering service; save your work first. The service has no window or menu entry.

1. Open **Window > UXP Plugins > Better Captions**. This is the only visible plugin panel.
2. Open a saved sequence, then **Refresh sequence** in the caption editor.
3. Click **Transcribe in Premiere**. The main plugin calls Adobe's native `Transcript.transcribeClipProjectItem` API for enabled audio clips missing a transcript, using Premiere's language preferences. Existing native transcripts are reused.
4. Review/correct the transcript, word timing, styles, and frame position in the panel.
5. Choose an unlocked video track with space for the captions and click **Apply captions to Premiere**.

For edited footage, source word timestamps are mapped through the timeline clips' in/out points and duration. Muted tracks and disabled audio clips are skipped. Repeated uses of the same source reuse its native transcript. Native transcription failures are reported rather than replaced with another speech engine.

Caption sessions and rendered media live next to the saved project under `Better Captions/<sequence-id>/`. Keep that folder with the project when moving or archiving it. The panel saves caption changes automatically; it does not save the Premiere project itself.

**Pull timeline changes** reads back caption clip timing and positions after manual timeline edits. Refreshing the sequence preserves the panel's saved transcript corrections. Applying again updates linked clips and rejects collisions with unrelated clips.

## Agent hooks

While the caption editor is open, an agent can read and edit the same saved state through a local file protocol. No network server or general script execution endpoint is exposed.

```sh
node scripts/agent.cjs status
node scripts/agent.cjs get_state
node scripts/agent.cjs patch_style '{"fontFamily":"Arial","fontSize":72,"activeWord":{"bubble":true,"bubbleColor":"#FFD84D","color":"#121212","sizeScale":1.3,"radius":18,"padding":10},"spokenWord":{"color":"#A0A0A0","opacity":0.65}}'
node scripts/agent.cjs set_position '{"x":0.5,"y":0.8}'
node scripts/agent.cjs patch_animation '{"preset":"bounce"}'
node scripts/agent.cjs apply
```

Use `--sequence <id>` or `--instance <id>` if several editors are open. Use `--file /absolute/path/edit.json` for larger edits. Actions are `get_state`, `patch_style`, `patch_animation`, `set_captions`, `set_position`, `refresh`, and `apply`. State and style changes are saved before a success response. Applying renders and updates Premiere clips; other styling actions update the preview/session until applied.

`set_captions` accepts `{"captions":[...]}` using the caption structure returned by `get_state`. Supply each word's text and timings; caption display text is derived from those words. Existing timeline links are preserved by caption ID. Requests cannot substitute media paths, run arbitrary commands, or remove linked captions. Phrase-specific placement accepts `{"captionId":"…","x":0.5,"y":0.8}`.

## Verification and boundaries

`npm test` covers renderer word states, bubbles and animations, phrase timing/grouping, edits, frame alignment, alpha-preserving encoding, literal process arguments, sequence-scoped persistence, timeline preflight/rollback, and local request validation. `npm run check` checks Svelte/TypeScript; `npm run build` creates the production panel.

[Live verification evidence](tests/verification-result.json) records insertion, exact timing, relinking with manual Motion/Opacity preservation, and collision protection on a disposable Premiere sequence. Native Speech to Text was also invoked through the native UXP API and returned all 12 spoken words with native timestamps from a synthetic spoken source.

The preview opened by `npm run dev` uses a fictional transcript for UI evaluation. Its Transcribe and Apply buttons require the installed Premiere panel.

Nested audio sequences, reversed speech, and variable time-remapping need a deliberate workflow; flatten/open the dialogue sequence before transcription. Simultaneously spoken overlapping audio is not a speaker-selection workflow. Transcript corrections in this panel affect generated captions; they are not written back into Premiere's native transcript. Linked captions cannot be deleted/regrouped silently; edit their timeline clips deliberately before replacing the set.

No After Effects, Whisper, audio-export transcription pipeline, paid speech API, or upstream native binary is used. The upstream shell addon is disabled, its shipped binaries are removed, and the production panel blocks remote content through CSP. See [the original audit](SECURITY-AUDIT.md) and [fork security notes](security/FORK-CHANGES.md).

## Upstream and licensing

Credit belongs to [Matthew Paquette / Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere). The original README is preserved in [UPSTREAM-README.md](UPSTREAM-README.md). Its README claims the MIT license, but the reviewed upstream commit has no LICENSE file. This fork preserves attribution and existing file notices and does not invent a license grant for upstream code. Clarify that omission with upstream before broader redistribution.

The original UXP scaffold remains for comparison/rebasing; the supported build and installer use `uxp/` for the single panel and `cep/` for invisible rendering/timeline operations.
