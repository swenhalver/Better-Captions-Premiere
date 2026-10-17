# Better Captions — Swen's Premiere fork

Editable word-highlight captions using **Premiere Pro's built-in Speech to Text**. Based on [Matthew Paquette's Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere), upstream commit `16c32128506a9c1a29a3577ea6d8e37339e9e6b9`.

This fork adds independent upcoming, currently spoken, and previously spoken word appearances; a rounded bubble behind the active word; word sizing; transcript and timing edits; a movable, independently resizable text area in Premiere's Program Monitor; native position and size keyframes; actual timeline insertion; and a local agent API.

## What you can edit

- Caption text and individual word start/end times, with overlap validation.
- Phrase grouping at sentences, pauses, word/character limits, and readable durations. Split, merge, regroup, and undo before timeline links would be lost.
- Base font, weight, size, color, alignment, case, outline, shadow, caption background, wrapping width, and line height.
- Active and past words independently: font, weight, relative size, color, opacity, bubble color/opacity, padding, and corner radius.
- Caption placement and independent box width/height directly in Premiere's Program Monitor. Width changes reflow the words without changing their font size. Edit native Position, Width and Height keyframes in the plugin's lanes, including exact frame/value controls and supported Undo/Redo.
- Shared or phrase-specific starting placement from numeric frame coordinates in the panel.
- Fade, Pop, Bounce, Typewriter, and word highlighting. Enlarged words reserve space so surrounding words do not jump as the highlight moves.

Each phrase is rendered as a transparent **ProRes 4444 text-area clip** at the sequence's exact frame rate, then placed on a chosen video track. It is hardcoded into the final video when you export the sequence. The Program Monitor is the caption preview; the plugin has no separate caption canvas. Edit text/style/timing in the panel and update the Program Monitor. These are rendered clips, so Premiere's Text tool does not edit their letters directly.

## Requirements

The installer supports **Windows and macOS (Apple Silicon or Intel), with Premiere Pro 26.3 or newer**. The same JavaScript plugin and platform-neutral package are used on both systems. Download the complete [0.6.0 Windows/macOS package](https://github.com/swenhalver/Better-Captions-Premiere/releases/tag/v0.6.0). See the [release verification notes](docs/release-0.6.0.md) for tested behavior and remaining native-runtime limits.

- Node.js 24 LTS for building/development and the optional agent CLI.
- Local FFmpeg and FFprobe. The plugin finds WinGet's user links on Windows, Apple Silicon/Intel Homebrew locations on macOS, and absolute directories in `PATH`.
- macOS: Fontconfig (`fc-list`) for the font picker. Windows uses its installed font families through the system Windows PowerShell/.NET APIs, with no Fontconfig dependency.
- Premiere's Speech to Text language pack and transcription preferences set as desired.

With Homebrew, run `brew install ffmpeg fontconfig`. On Windows, install a local FFmpeg distribution containing both `ffmpeg.exe` and `ffprobe.exe`, for example `winget install --id Gyan.FFmpeg --exact`. Restart Premiere after installing dependencies. Custom locations can be set through `BETTER_CAPTIONS_FFMPEG`, `BETTER_CAPTIONS_FFPROBE` and (macOS) `BETTER_CAPTIONS_FC_LIST`, each containing an absolute executable path. These are local configuration; caption requests cannot choose executables.

## Install and use

From the source checkout:

```sh
npm --prefix webview-ui ci --ignore-scripts
npm run check
npm test
npm run package
npm run install:premiere
```

Alternatively, unpack the `Windows-macOS.zip` installer and run `node scripts/install.cjs` in its folder. The macOS `zsh scripts/install-cep.sh` command remains available. The installer copies the invisible service into the user's Adobe CEP extensions folder and preserves an earlier owned service outside Adobe's extension discovery directory. An existing legacy macOS source link is reused when it points to this checkout.

The installer installs the main UXP caption editor and an invisible CEP render service. The Transcribe button calls Premiere directly from the main plugin; no separate transcript window is used. Adobe's local CEP developer flag is needed for this reviewed, unsigned panel. Restart Premiere once after first installation to start its background rendering service; save your work first. The service has no window or menu entry.

If Adobe UPIA reports an installation error, open the `.ccx` in Creative Cloud Desktop and complete Adobe's normal installation prompt, then run `node scripts/install.cjs --service-only`. That mode verifies the matching UXP plugin ID/version before installing the invisible service; it does not bypass UXP registration.

Private queue and agent files live under `%APPDATA%\Better Captions` on Windows and `~/Library/Application Support/Better Captions` on macOS. Windows folders have a protected ACL for the current user, SYSTEM and Administrators; macOS folders/files retain 0700/0600 permissions. Caption assets still live beside the project. Local drive paths, spaces and Unicode are supported; UNC/device paths and traversal segments are rejected.

1. Open **Window > UXP Plugins > Better Captions**. This is the only visible plugin panel.
2. Open a saved sequence, then **Refresh sequence** in the caption editor.
3. Click **Transcribe in Premiere**. The main plugin calls Adobe's native `Transcript.transcribeClipProjectItem` API for enabled audio clips missing a transcript, using Premiere's language preferences. Existing native transcripts are reused.
4. In **Transcript**, select a sentence to open its single word lane. Select a word and drag an edge, use the arrow keys, or edit the seconds. Boundaries snap to frames and stop before they overlap another word; connected edges move together. In **Styling**, choose **Past words**, **Current word**, or **Next words** to edit each state’s typography, color, opacity, case, tracking, stroke, shadow and bubble.
5. Choose an unlocked video track above the footage, with its output enabled, and click **Apply to Program Monitor**.
6. Choose a caption and click **Select in Program Monitor**. Enable Premiere's **Transform** control below the Program Monitor to show its native handles, or select **Motion** in Effect Controls. Drag the area to move it or drag its handles to resize it. Generated caption clips use independent width and height.
7. In **Styling → Position & size**, enable a stopwatch for **Position**, **Width**, or **Height**, move the caption-frame playhead, then edit X/Y or the size in pixels. Select a diamond in a keyframe lane to edit that exact key's frame and value, independently of the playhead. Use the frame field or ±1-frame buttons to move it, or Delete key to remove it. Existing Position and Bezier size values are changed in place to preserve their native easing. Linear/Hold size keys support structural edits; Premiere's unreadable custom curves require native controls for moving, deletion or easing changes. Panel **Undo** and **Redo** keep up to 32 confirmed edits per caption for the current session, including across automatic reflow. Native changes invalidate incompatible panel history. Save the Premiere project to retain its actual keyframes.

Keep Better Captions open while editing the box dimensions. After a resize settles for about 750 ms, the plugin rerenders only the selected caption, using Premiere's evaluated width and height at every output frame. Inverse scaling keeps the font size constant, including between size keyframes. The existing movie can briefly stretch during the drag while the replacement renders. Position changes display immediately without rerendering. An overflow notice means the text needs a taller or wider area; the plugin does not silently shrink its font. After other text, timing or style edits, click **Update Program Monitor**.

Background geometry checks use a bounded change fingerprint rather than evaluating every output frame or reading media metadata on each poll. They stop while the panel is hidden and pause after an error until you Refresh or Update. Native requests run in one serialized lane; a timeout does not pretend to cancel Premiere or start another overlapping call. Only one background service instance owns the queue. The plugin does not open or navigate native menus for transcription or timeline updates.

Automatic size watching supports up to 256 combined Motion control keys; more complex curves can still use a manual Update. Existing animated Anchor Point changes or animated Motion on a nonzero trimmed source-in can require a fresh caption clip before changing its media geometry. Supported Position, independent Width and Height keys remain on their existing clip.

For edited footage, source word timestamps are mapped through the timeline clips' in/out points and duration. Muted tracks and disabled audio clips are skipped. Repeated uses of the same source reuse its native transcript. Native transcription failures are reported rather than replaced with another speech engine.

Caption sessions and rendered media live next to the saved project under `Better Captions/<sequence-id>/`. Keep that folder with the project when moving or archiving it. The panel saves caption changes automatically; it does not save the Premiere project itself.

**Sync timing from Premiere** reads back caption clip timing after manual timeline edits. Refreshing the sequence preserves the panel's saved transcript corrections. Updating again keeps linked clip identity, native Motion/Opacity and their supported keyframes, and rejects collisions with unrelated clips.

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

Use `--sequence <id>` or `--instance <id>` if several editors are open. Use `--file /absolute/path/edit.json` for larger edits. Actions are `get_state`, `patch_style`, `patch_animation`, `set_captions`, `set_position`, `read_area`, `edit_area`, `refresh`, and `apply`. State and style changes are saved before a success response. Applying renders and updates Premiere clips; other styling actions update the saved caption session until applied.

`read_area` accepts `{"captionId":"…","frame":0}` and returns native area state in `result`. `edit_area` accepts `{"captionId":"…","edit":{...}}` with the latest `result.signature`, a caption-relative integer `frame`, an operation and track. Exact-key operations `set-key`, `move-key` and `remove-key` require the key's source `ticks` as `keyTicks`; moving also requires `targetFrame`. Position values are `[x,y]` pixels; Width and Height values are `[pixels]`. The native backend rejects stale links or signatures and unsupported destructive easing changes before mutation. `undo` and `redo` use the same fresh-signature check.

`set_captions` accepts `{"captions":[...]}` using the caption structure returned by `get_state`. Supply each word's text and timings; caption display text is derived from those words. Existing timeline links are preserved by caption ID. Requests cannot substitute media paths, run arbitrary commands, or remove linked captions. Phrase-specific placement accepts `{"captionId":"…","x":0.5,"y":0.8}`.

## Verification and boundaries

`npm test` covers renderer word states, bubbles and animations, independent text-area dimensions, constant-font reflow, sampled size curves, native selection following, phrase timing/grouping, edits, frame alignment, alpha-preserving encoding, literal process arguments, sequence-scoped persistence, timeline preflight/rollback, and local request validation. `npm run check` checks Svelte/TypeScript; `npm run build` creates the production panel.

[Live verification evidence](tests/verification-result.json) records insertion, exact timing, relinking with manual Motion/Opacity preservation, and collision protection on a disposable Premiere sequence. Native Speech to Text was also invoked through the native UXP API and returned all 12 spoken words with native timestamps from a synthetic spoken source.

The preview opened by `npm run dev` uses a fictional transcript for UI evaluation. Its Transcribe and Apply buttons require the installed Premiere panel.

The [online interface review](https://better-captions-premiere-review.swenhalver.chatgpt.site) provides the original 0.5.0 interface review with browser-only panel-width controls (owner sign-in required). Run the local preview for the current editor. See [interface review and verification](docs/interface-review.md) for the two-tab workflow and [0.6.0 release notes](docs/release-0.6.0.md) for current verification. The older three concept studies remain available at `/concepts/`.

Nested audio sequences, reversed speech, and variable time-remapping need a deliberate workflow; flatten/open the dialogue sequence before transcription. Simultaneously spoken overlapping audio is not a speaker-selection workflow. Transcript corrections in this panel affect generated captions; they are not written back into Premiere's native transcript. Linked captions cannot be deleted/regrouped silently; edit their timeline clips deliberately before replacing the set.

No After Effects, Whisper, audio-export transcription pipeline, paid speech API, or upstream native binary is used. The upstream shell addon is disabled, its shipped binaries are removed, and the production panel blocks remote content through CSP. See [the original audit](SECURITY-AUDIT.md) and [fork security notes](security/FORK-CHANGES.md).

## Upstream and licensing

Credit belongs to [Matthew Paquette / Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere). The original README is preserved in [UPSTREAM-README.md](UPSTREAM-README.md). Its README claims the MIT license, but the reviewed upstream commit has no LICENSE file. This fork preserves attribution and existing file notices and does not invent a license grant for upstream code. Clarify that omission with upstream before broader redistribution.

The original UXP scaffold remains for comparison/rebasing; the supported build and installer use `uxp/` for the single panel and `cep/` for invisible rendering/timeline operations.
