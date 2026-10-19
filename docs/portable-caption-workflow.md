# Portable caption workflow

Transparent ProRes 4444 movies are the normal Better Captions output. The panel
owns transcript, timing and appearance edits; Premiere reads the resulting movies
as ordinary linked media. This keeps finished captions visible when Better
Captions is unavailable, while preserving the session for later panel editing.

## Edit and render

1. Save the Premiere project and open the intended sequence in Better Captions.
2. Transcribe or use the existing transcript, edit words/timing, then choose the
   caption appearance and layout in the panel.
3. Apply the generated output above footage. New captions normally share one
   transparent text-area movie; explicit manual splits remain separate clips.
   Existing linked clips retain their identities through supported updates.
4. Let rendering and timeline verification finish before handing off the project.
   The Program Monitor shows the result; there is no separate plugin preview.

Output uses the active timeline frame rate, including supported fractional rates.
The encoder checks codec, alpha, dimensions, frame count and frame rate before
accepting a movie. Changes to text, word timing or internal styling require the
panel to regenerate media. Rendering is part of this workflow; a movie cannot
reflow its baked letters merely because its clip is scaled.

## What survives without Better Captions

With the caption movies online, Premiere can play and export them without the
Better Captions panel, render service or compiled caption effect. Normal clip
operations remain available: move, trim, Razor split, scale, opacity and native
Motion animation. Scaling stretches the rendered pixels; it does not change
font size or paragraph wrapping. Trimming or splitting also does not regenerate
the words or their highlight timing.

Text, font, word-state styling and internal caption layout are baked into the
movie. Premiere's Text tool cannot edit their letters. Reinstalling Better
Captions and retaining the session makes later panel editing possible; generated
movie playback itself does not require the original fonts or rendering tools.
Timeline-to-panel synchronization still depends on Better Captions and the
supported clip-link/timing workflow.

## Keep the project, movies and session together

For a saved project, assets are created in:

```text
<project folder>/
  Project.prproj
  Better Captions/
    <sequence identity>/
      captions.better-captions.json
      <caption job>/
        caption.mov
        render.json
```

The `.mov` files are the rendered media Premiere needs. The JSON session retains
transcript, timing, appearance and caption links for the panel; `render.json`
records the encoded output. Temporary PNG staging files are removed after a
verified encode.

Copy the complete adjacent **Better Captions** folder with the project. Collecting
only the project file leaves the movies behind. A media-collection operation may
include linked movies without collecting the panel's JSON session, so retain the
whole folder deliberately. If the folder moves, use Premiere's normal media
relinking when necessary; automatic panel reconnection after every relocation is
not implied by this guide. Keep a backup before further panel edits.

For the verified editable handoff, use **Portable Captions - Plugin-Free Playback**
in the original `artifacts/host-scratch/Native Effect Scratch.prproj`, together
with its adjacent assets/session. The exported `Portable Captions.prproj` was a
**playback-only acceptance fixture**. Premiere's `exportAsProject` rebased its
project-item identities, and panel reconnection refused the resulting mismatch.
It is not a supported editable handoff; copying media alone does not repair those
identities. The original project reopened and reconnected correctly. This is a
specific limitation in addition to the general relocation/relinking caveat above.

## Existing experimental native layers

An existing adjustment layer containing the experimental native caption effect
continues to be a native-effect source. This normal movie workflow does not
convert, remove, disable or replace it automatically. Removing the compiled
effect can make that source stop rendering captions even when its transcript is
still embedded in the project.

Making that particular source portable would require an explicit bake while its
renderer is available, with frame-by-frame appearance, layout, animation and
transparency verified. Mapping only its transcript into the movie renderer is not
proof of an identical conversion: native override keys, geometry and font
rendering can differ. No general native-to-movie bake feature is introduced here.
Retain existing source layers and prior decisions until an explicit conversion
is requested and verified.

## Installed verification receipt — 2026-10-18

The generated-movie path was exercised with panel 0.7.11, then all three Better
Captions components were made unavailable across a fresh Premiere restart: the
UXP panel, CEP service and compiled experimental effect.

- The playback-only fixture `Portable Captions.prproj` contains the sequence **Portable Captions - Plugin-Free
  Playback** at 30 fps, with one caption movie on V3 and no clips on V1/V2. Its linked
  original test asset is `Better Captions/d217ac73-a8e3-4e64-ba39-dd7626554ae9/caption-portable-a-kYNYan/caption.mov`.
- Without those components, playback advanced from 0 to 8.7666667 seconds. Fresh PNG
  frame exports succeeded at 2.5 and 5.5 seconds. The decoded 2.5-second RGBA pixels
  exactly match the before-removal frame: SHA-256
  `57c379cb0f591d4f6a0af948a8245601fecea5d4b3850a2ea868e7fd29b1d98b`.
  The PNG files themselves have different file hashes; the equality is decoded
  image pixels, not byte-identical PNG containers.
- All three components were restored afterward. All 29 restored file SHA-256
  values match their baseline. The preservation receipt also reports no changes
  to the 22 original scratch sequence graphs.
- After restoration, the original `Native Effect Scratch.prproj` reopened and the
  panel reconnected to **Portable Captions - Plugin-Free Playback**. Editing the
  first phrase to **These captions still work.** automatically regenerated media,
  preserving clip `000f433e` and project item `000f433d`. The new movie is
  `Better Captions/d217ac73-a8e3-4e64-ba39-dd7626554ae9/caption-portable-a-L49Yqc/caption.mov`:
  ProRes 4444, alpha (`yuva444p12le`), 30/1 fps, 263 frames.
- Final verification reports all 22 prior scratch sequence graphs unchanged and
  the production project SHA-256 unchanged at
  `c4259feec4b32e0a52c1f2a72ef9f049626d74133fa91fee1d2788a62cd97d03`.
  The original project and editable sequence are the handoff left open in Premiere.

Local receipts are under ignored
`artifacts/host-scratch/portable-captions-2026-10-18/`:
`without-plugin-verification.json`, `restored-state.json`, `preservation.json`,
`disabled-state.json`, `first-apply-result.json`,
`editing-roundtrip-verification.json`, `edited-final-state.json` and
`final-original-graph.json`. These record the original/updated media, session and
clip identities, restoration and preservation checks.

This establishes plugin-free playback and **PNG frame export** for the tested
movie, plus a successful word-edit/automatic-regeneration roundtrip in the
original project. A complete video-file export was not part of this check. A
style-change roundtrip, broader relocation/relinking and manual clip operations
are not additional host checks claimed here. The exported playback fixture must
not be described as an editable panel handoff.
