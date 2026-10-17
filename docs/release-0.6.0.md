# Better Captions 0.6.0

Position and sizing keyframes can now be edited in Better Captions. The panel and Premiere's Program Monitor use the same native Motion animation, so moving a box in the video does not create a second animation to synchronize.

## Keyframe editor

Open **Styling → Position & size** for an applied caption. Position, Width and Height each have a compact keyframe lane. Select a diamond to edit that key's frame and values, move it one frame at a time, change supported interpolation, or delete it. The selected key stays selected when the playhead moves. The separate at-playhead controls continue to add keys and edit the current frame.

Width and Height are independent. Changing width reflows the caption at its existing font size, including between size keys. Position changes display without rendering. Keep Better Captions visible while resizing so automatic reflow can replace the caption movie after the drag settles.

**Undo** and **Redo** support up to 32 confirmed area edits per caption during the current plugin session. A verified automatic reflow can replace the media file without losing that history. A native edit made outside the plugin invalidates incompatible history. The actual keyframes are saved in the Premiere project; save that project to keep them across application restarts.

Use **Select in Program Monitor**, then enable Premiere's **Transform** control below the Program Monitor to show the box handles. The plugin never toggles native tools during background refreshes. Same-frame native Position changes now refresh the panel's controls without triggering a render.

## Native easing

Existing Position and Bezier size-key values are changed in place, preserving native key times and easing. Readable Linear and Hold size keys also support moving, deletion and interpolation changes with panel Undo/Redo.

Premiere does not expose all custom temporal/spatial handles through the supported APIs. Destructive operations that would rebuild an unreadable custom curve are refused before changing it. Use Premiere's native controls for those particular structural edits. The panel never labels unreadable interpolation as Linear or claims a recovery operation can be undone when it cannot reconstruct the original curve.

## Agent controls and validation

The private local agent API adds `read_area` and `edit_area`. Both target an already applied caption ID; edits require the current native signature and exact source tick string when selecting a key. They share the panel's identity checks, native serialization lane and bounded operations. They accept no arbitrary file paths or code.

Automated validation covers exact-key targeting away from the playhead, stale request rejection, native value patches and rollback, media relinking with Undo/Redo, frame moves and deletion, read-only control refreshes, and narrow panel layouts. Native installation and acceptance results are recorded with the published release assets.

Native numeric verification allows Premiere's Float32 rounding bound. For example, a requested 480 px width in a 576 px box is stored as approximately 480.0000146 px; that valid result no longer causes a false failure or discards area history. Incorrect values outside the rounding allowance still fail verification.

## Native verification

Tested with the installed panel and invisible renderer in Premiere Pro 26.5.2 on macOS:

- All 20 installed panel/renderer files matched the production build byte for byte.
- A selected Width key was edited while the playhead remained on a different frame. The 480 px Float32 case was accepted correctly.
- Independent Width and Height keys were created; Width moved from frame 24 to 30 and was deleted. Multi-step Undo/Redo restored the key, its frame, its value and the independent Height curve.
- Linear/Hold interpolation changed through the plugin. Existing-key value Undo/Redo survived automatic media relinking and constant-font reflow.
- An existing Position key's value was changed in place and undone. All six Motion curves matched their original readback afterward, including the manually adjusted key at frame 1. The right-hand stacked panel group remained intact and the render service stayed invisible.

Actual component DOM checks passed at 280, 360 and 480 px. The complete local suite passed 372 tests with two Windows-only checks skipped, and Svelte reported zero errors or warnings. The release's verification asset records the matching Windows/macOS CI result.

## Installation

Extract the matching Windows/macOS ZIP and run `node scripts/install.cjs`. It contains both the UXP editor and invisible CEP renderer; the CCX alone is incomplete. Save work and restart Premiere after installation, then open **Window → UXP Plugins → Better Captions**.

Premiere Pro 26.3+, Creative Cloud Desktop, Node.js 24+, FFmpeg/FFprobe and macOS Fontconfig are required. No After Effects or separate visible transcript window is used. The separate in-progress RollUp/fade work is not included.
