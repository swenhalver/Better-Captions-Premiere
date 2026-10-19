# Better Captions — Swen's Premiere fork

Editable word-highlight captions using **Premiere Pro's built-in Speech to Text**. Based on [Matthew Paquette's Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere), upstream commit `16c32128506a9c1a29a3577ea6d8e37339e9e6b9`.

This fork adds independent upcoming, currently spoken, and previously spoken word appearances; a rounded bubble behind the active word; word sizing; transcript and timing edits; a movable, independently resizable text area in Premiere's Program Monitor; native position and size keyframes; actual timeline insertion; and a local agent API.

**Pre-release status:** [0.7.8](https://github.com/swenhalver/Better-Captions-Premiere/releases/tag/v0.7.8) adds one-clip output, automatic tracks and installed Mac fixes. Native Mac checks confirmed a new track above occupied footage, character regrouping, plugin size-keyframe edits, retiming and preserved Razor cuts. Physical mouse dragging remains unverified by the automated native tests, compatible static legacy conversion still needs native acceptance, and Adobe installation is blocking Windows acceptance. See the [Mac verification record](docs/mac-verification-0.7.8.md) and [Windows verification record](docs/windows-verification-0.7.3.md) for the exact boundaries.

**Development branch:** `swen/native-caption-effect` now defaults new transcripts to a **native caption effect** in **0.7.27**. One Premiere Transparent Video clip holds the transcript and the compiled effect; text, timing and supported three-state styles update live from Better Captions. Phrase rows follow the native character limit or **Smart line fit**, adjustable in Caption grouping. Smart mode updates the estimated character-count number. Styling uses compact responsive tabs with working native word-spacing, outline/shadow toggles and Layout controls; left/center/right alignment icons appear only under All words. Smart fitting uses real font measurements and a 5% safety margin to fit a line to the selected width. **Scrolling text** restores line-by-line roll-up with four directions, speed, wait-for-line timing and a soft fade boundary; all its settings can use native Effect Controls keyframes. Outlines render beneath a clean glyph fill to preserve font weight; the shared case selector supports As typed, Uppercase, Lowercase and Title Case. Position, Width and Height also appear in the plugin as blue drag-adjustable values with reset buttons and Effect Controls keyframing indicators. **Groups per page** shows 1–100 consecutive caption groups together, with each group retaining the character limit. The native Program Monitor outline previews the selected caption area without being exported. Native keyframes remain in Effect Controls, with previous/next navigation in the plugin. **Sequence actions (…) → Extend captions** appends dialogue from newly added footage without replacing existing text edits or timings. Numeric styling values use the same drag/click-to-type behavior. Existing movie captions reconnect unchanged, with an explicit **Create native effect copy** action. Native effects require the separate experimental compiled plugin; the panel never silently falls back to a movie. See [0.7.27 notes](docs/release-0.7.27.md), [Mac verification](docs/mac-verification-0.7.24.md), and [native-effect acceptance](docs/native-effect-acceptance.md). Native Premiere graphics are being developed separately. The published 0.7.8 instructions below retain their rendered-movie workflow.

## Portable captions: the normal output

The normal workflow renders transparent **ProRes 4444 movie clips** into Premiere.
Use Better Captions to edit the transcript, word timing, layout and appearance;
the panel regenerates the caption media for Premiere. After rendering finishes,
Premiere reads those captions as ordinary media without Better Captions installed.
Premiere can still move, trim, split and scale the movie clips. Their letters and
internal styles are baked pixels; changing those requires the panel and a render.

Keep the project and its adjacent **Better Captions** folder together. That folder
contains the linked caption movies and `captions.better-captions.json` editing
session. A receiver needs the media for playback; retain the session too if later
panel editing is needed. See [the portable caption workflow](docs/portable-caption-workflow.md)
for handoff details and verification boundaries.

Installed verification with panel 0.7.11 made all three Better Captions
components temporarily unavailable across a fresh Premiere restart: the portable
fixture still played and exported fresh PNG frames, with identical decoded
2.5-second pixels. All 29 component files were restored with matching hashes.
The original project then reopened/reconnected; changing the phrase to **These
captions still work.** automatically regenerated the ProRes 4444 movie while
preserving its clip and project-item identities. Full video-file export was not
part of this check. See [verification details](docs/portable-caption-workflow.md#installed-verification-receipt--2026-10-18).

The verified editable handoff is **Portable Captions - Plugin-Free Playback** in
`artifacts/host-scratch/Native Effect Scratch.prproj`. The exported `Portable
Captions.prproj` is a playback-only fixture: `exportAsProject` rebased item IDs,
and panel reconnection correctly refused the mismatch. It is not an editable
handoff; retain the original project with its media and session.

Existing experimental native-effect adjustment layers are preserved. They are
**not automatically converted** into movies and still require the compiled effect
to render. An explicit, separately verified bake would be needed to make those
particular captions portable; this workflow does not add that conversion feature.

## What you can edit

- Caption text and individual word start/end times, with overlap validation.
- Phrase grouping at sentences, pauses, a configurable character limit, and readable durations. Spaces and punctuation count; whole words stay intact. Regroup before or after Apply; linked sentences change within their existing native clip.
- Base font, weight, size, color, alignment, case, outline, shadow, caption background, wrapping width, and line height.
- Active and past words independently: font, weight, relative size, color, opacity, bubble color/opacity, padding, and corner radius.
- Caption placement and independent box width/height directly in Premiere's Program Monitor. Width changes reflow the words without changing their font size. Edit native Position, Width and Height keyframes in the plugin's lanes, including exact frame/value controls and supported Undo/Redo.
- Shared or phrase-specific starting placement from numeric frame coordinates in the panel.
- Fade, Pop, Bounce, Typewriter, and word highlighting. Enlarged words reserve space so surrounding words do not jump as the highlight moves.
- Named style presets: save all three word appearances, shared layout/background, animation and fades for reuse across projects on the same computer. Apply, rename, replace and delete them from the top of Styling.

New captions render as one transparent **ProRes 4444 text-area clip** at the sequence's exact frame rate, containing individually editable sentence groups. Automatic placement uses an empty track above footage or creates a new track. Explicit transcript splits and supported native Razor cuts retain separate physical clips. Captions are hardcoded into the final video when you export the sequence. The Program Monitor is the caption preview; the plugin has no separate caption canvas. Edit text/style/timing in the panel and update the Program Monitor. These are rendered clips, so Premiere's Text tool does not edit their letters directly.

## Requirements

The installer targets **Windows and macOS (Apple Silicon or Intel), with Premiere Pro 26.3 or newer**. The same JavaScript plugin and platform-neutral package are used on both systems. Download the complete [0.7.8 Windows/macOS pre-release package](https://github.com/swenhalver/Better-Captions-Premiere/releases/tag/v0.7.8). Installed acceptance used Premiere Pro 26.5.2 on Apple Silicon; Windows native acceptance is pending. See the [release notes](docs/release-0.7.8.md) and [native Mac verification](docs/mac-verification-0.7.8.md) for tested behavior and remaining runtime limits.

- Node.js 24 LTS for building/development and the optional agent CLI.
- Local FFmpeg and FFprobe. The plugin finds WinGet's user links on Windows, Apple Silicon/Intel Homebrew locations on macOS, and absolute directories in `PATH`.
- macOS: Fontconfig (`fc-list`) for the font picker. Windows uses its installed font families through the system Windows PowerShell/.NET APIs, with no Fontconfig dependency.
- Premiere's Speech to Text language pack and transcription preferences set as desired.

These creation/editing requirements do not apply to ordinary playback of already
rendered caption movies. The receiver needs Premiere and the linked media, not
Better Captions, FFmpeg, Fontconfig or the fonts used to create the baked text.

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
5. Leave **Caption track** on **Automatic · above footage**, then click **Apply to Program Monitor**. A manual unlocked track remains available. Keep its output enabled in Premiere.
6. Choose a caption and click **Select in Program Monitor**. Enable Premiere's **Transform** control below the Program Monitor to show its native handles, or select **Motion** in Effect Controls. Drag the area to move it or drag its handles to resize it. Generated caption clips use independent width and height.
7. In **Styling → Position & size**, enable a stopwatch for **Position**, **Width**, or **Height**, move the caption-frame playhead, then edit X/Y or the size in pixels. Select a diamond in a keyframe lane to edit that exact key's frame and value, independently of the playhead. Use the frame field or ±1-frame buttons to move it, or Delete key to remove it. Existing Position and Bezier size values are changed in place to preserve their native easing. Linear/Hold size keys support structural edits; Premiere's unreadable custom curves require native controls for moving, deletion or easing changes. Panel **Undo** and **Redo** keep up to 32 confirmed edits per caption for the current session, including across automatic reflow. Native changes invalidate incompatible panel history. Save the Premiere project to retain its actual keyframes.

Keep Better Captions open while editing the box dimensions. After a resize settles for about 750 ms, the plugin rerenders only the selected caption, using Premiere's evaluated width and height at every output frame. Inverse scaling keeps the font size constant, including between size keyframes. The existing movie can briefly stretch during the drag while the replacement renders. Position changes display immediately without rerendering. An overflow notice means the text needs a taller or wider area; the plugin does not silently shrink its font. After other text, timing or style edits, click **Update Program Monitor**.

Background geometry checks use a bounded change fingerprint rather than evaluating every output frame or reading media metadata on each poll. They stop while the panel is hidden and pause after an error until you Refresh or Update. Native requests run in one serialized lane; a timeout does not pretend to cancel Premiere or start another overlapping call. Only one background service instance owns the queue. The plugin does not open or navigate native menus for transcription or timeline updates.

Automatic size watching supports up to 256 combined Motion control keys; more complex curves can still use a manual Update. Existing animated Anchor Point changes or animated Motion on a nonzero trimmed source-in can require a fresh caption clip before changing its media geometry. A verified native Razor bundle permits later-slice text-area edits on the correct source frames. Its slices must remain adjacent, forward 1x, in source order, on one track, with no external reuse. Discovery is bounded to 64 fragments and 2,000 project clips. Supported Position, independent Width and Height keys remain on their existing clip.

Updating a compatible legacy set of separate, untrimmed caption clips converts it into one clip. Existing static positions and sizes become native hold keys. The replacement is verified before the originals are removed together without ripple. Animated or custom effects, different source text-box bounds, custom anchor/rotation, timing gaps, trims and reused media stop conversion with the original clips preserved. Native Mac acceptance confirmed automatic creation of a track above footage and refusal of animated legacy conversion while retaining the originals' Motion keys exactly. Successful conversion of a compatible static legacy set still requires installed acceptance.

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

`set_captions` accepts `{"captions":[...]}` using the caption structure returned by `get_state`. Supply each word's text and timings; caption display text is derived from those words. Preserve an optional Boolean `endOfSentence` on words to retain sentence boundaries for later regrouping. Existing timeline links are preserved by caption ID. Requests cannot substitute media paths, run arbitrary commands, or remove linked captions. Phrase-specific placement accepts `{"captionId":"…","x":0.5,"y":0.8}`.

## Verification and boundaries

`npm test` covers renderer word states, bubbles and animations, independent text-area dimensions, constant-font reflow, sampled size curves, native selection following, phrase timing/grouping, edits, frame alignment, alpha-preserving encoding, literal process arguments, sequence-scoped persistence, timeline preflight/rollback, and local request validation. `npm run check` checks Svelte/TypeScript; `npm run build` creates the production panel.

[Live verification evidence](tests/verification-result.json) records insertion, exact timing, relinking with manual Motion/Opacity preservation, and collision protection on a disposable Premiere sequence. Native Speech to Text was also invoked through the native UXP API and returned all 12 spoken words with native timestamps from a synthetic spoken source.

The preview opened by `npm run dev` uses a fictional transcript for UI evaluation. Its Transcribe and Apply buttons require the installed Premiere panel.

The [online interface review](https://better-captions-premiere-review.swenhalver.chatgpt.site) provides the 0.7.1 editor with browser-only panel-width controls (owner sign-in required). Preview presets are saved in that browser; they do not synchronize with the installed plugin or other computers. See [interface review and verification](docs/interface-review.md) for the two-tab workflow and [0.7.1 release notes](docs/release-0.7.1.md) for current verification. The older three concept studies remain available at `/concepts/`.

## Character limits

In **Transcript → Caption grouping** (**Sentence grouping** in 0.7.2), set **Characters per caption** (1–500, default 56), then choose **Regroup**. For captions already applied, click **Update Program Monitor** to render the new caption groups. The count includes spaces and punctuation, with Unicode grapheme counting where available. There is no word-count cap. A single word longer than the chosen limit stays whole in its own caption.

Regroup splits or rejoins sentences while preserving word timings, sentence markers, pauses, speaker/placement boundaries and readable durations. Undo restores the previous grouping. Linked Premiere clips keep their physical boundaries and native keyframes while their rendered sentence groups change. Older sessions adopt the 56-character default instead of interpreting their old word count as characters; existing captions remain unchanged until regrouping. Style presets preserve the destination character limit.

If you delete a generated caption clip or its whole video track in Premiere, click **Update Program Monitor** to recreate it from the saved transcript and style. The replacement uses an automatic track above footage. Deliberate transcript splits remain separate, and surviving linked clips retain their native identities and Motion. Recreated clips start with the saved panel placement; native keyframes deleted with the old clips are no longer available. A remaining Razor fragment or media copy in the active sequence is protected, and automatic single-caption reflow does not recreate deleted clips.

## Reusable style presets

In **Styling**, choose **Save preset…**, enter a name, and save. To reuse the look in another sequence or project, select it under **Style preset** and choose **Apply**, then update the Program Monitor to render the captions. **Manage…** lets you rename a preset, replace it with the current look, or delete it after confirmation. Deleting a preset leaves captions already using that look unchanged.

Presets include past/current/next typography, stroke, shadow, word bubbles, shared caption layout/background, and animation/fades. They preserve the destination's word timing, grouping, starting placement, and existing native Position/Width/Height animation. The installed panel writes an atomic, revision-checked `style-presets.json` in its UXP user-data folder, independent of the Premiere project. Keep the same plugin identity when upgrading to retain that library; clearing plugin data removes it. Fonts remain installed locally.

Nested audio sequences, reversed speech, and variable time-remapping need a deliberate workflow; flatten/open the dialogue sequence before transcription. Simultaneously spoken overlapping audio is not a speaker-selection workflow. Transcript corrections in this panel affect generated captions; they are not written back into Premiere's native transcript. The panel does not silently delete linked clips. Use Premiere's Razor tool for deliberate physical splits after Apply.

No After Effects, Whisper, audio-export transcription pipeline, paid speech API, or upstream native binary is used. The upstream shell addon is disabled, its shipped binaries are removed, and the production panel blocks remote content through CSP. See [the original audit](SECURITY-AUDIT.md) and [fork security notes](security/FORK-CHANGES.md).

## Upstream and licensing

Credit belongs to [Matthew Paquette / Better Captions](https://github.com/Paquette1111/Better-Captions-Premiere). The original README is preserved in [UPSTREAM-README.md](UPSTREAM-README.md). Its README claims the MIT license, but the reviewed upstream commit has no LICENSE file. This fork preserves attribution and existing file notices and does not invent a license grant for upstream code. Clarify that omission with upstream before broader redistribution.

The original UXP scaffold remains for comparison/rebasing; the supported build and installer use `uxp/` for the single panel and `cep/` for invisible rendering/timeline operations.
