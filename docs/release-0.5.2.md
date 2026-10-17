# Better Captions 0.5.2

This update fixes native position, sizing and keyframe failures found in Premiere Pro 26.5.2. The Transcript / Styling interface, three word states, word bubbles, editable timing and private agent hooks remain available.

## Program Monitor selection

Use **Select in Program Monitor** to select the exact linked caption and seek into its spoken text. The action is also available in Position & size. Double-click the caption in Premiere's Program Monitor to show its Transform handles, then drag the box or its side handles. The plugin does not toggle Premiere's native tools during refresh, selection following, or automatic reflow.

## Native area controls

Premiere 26.5 exposes its Uniform Scale checkbox without a display name. The panel now identifies that unnamed control using a fresh descriptor from the exact caption clip, its named Scale Width and Rotation neighbours, and its static Boolean value. It refuses ambiguous or mismatched controls instead of guessing a parameter index.

Native actions are created inside Premiere's synchronous project transaction. Position keyframes follow the [Adobe engineer's PointKeyframe example](https://forums.creativeclouddeveloper.com/t/having-troubles-writing-position-in-premiere/12194/2): construct the point and key in the lock, set its time, then add it without a scalar interpolation action. Every edit still verifies the resulting native values and key times.

Width and height are independent. Changing width reflows the text at its existing font size; height changes the available area. Existing clips keep their native Position and size animation during the reflow.

Position & size confirms Premiere's current playhead when opening or refreshing its controls. It keeps its last confirmed controls visible during a refresh or reflow, with editing disabled until fresh values arrive. This prevents the panel from collapsing and moving the scroll position while a caption updates.

The service gets a bounded startup grace period. Older linked captions missing a saved geometry watch signature get one guarded Motion-profile comparison. Proven size differences enter the existing stability check before reflow; an unknown rendered baseline requires one explicit Update. Agent state includes bounded, read-only runtime diagnostics that are never saved into the caption session.

## Native verification

Verified on macOS with the installed panel and invisible renderer in Premiere Pro 26.5.2, using isolated verification sequences:

- Installed panel and renderer files matched the built source by byte comparison.
- Static Position X changed from 400 to 360; Premiere Properties confirmed 360.
- Position keys at frames 0 and 36 retained X values 360 and 400. At frame 18, Premiere confirmed X = 380.
- Independent Width and Height keys were created and edited. Native Motion samples changed from scale X/Y = 1/1 to approximately 0.833333/1.125. At frame 18 the panel read Height = 543.086 px, and Premiere showed separate interpolated scales.
- Automatic reflow updated the selected caption media, preserved its timeline identity and animation, kept the base font at 64 px, and reported no layout overflow.
- The native Transcribe button returned 15 timed words from a newly generated speech clip and grouped them into four captions. A separate native-transcript import returned 12 timed words.
- The right-hand stacked panel group remained intact; the renderer did not open a companion window.

Transform handles were shown in the Program Monitor. The computer-use driver did not reliably execute a mouse drag, so the drag gesture itself remains a manual acceptance item. Position, size, keyframe interpolation and rendered output were verified through the native controls and readback.

## Current limits

Native parameter discovery currently requires English Motion labels. The PointKeyframe API does not expose its temporal interpolation mode. The panel can add Position keys, but refuses edits or panel Undo that would recreate an existing Position key with unknown easing. Use Premiere Properties, Effect Controls or native Undo for those edits. Existing custom easing on untouched keys is preserved.

Animated Motion on a caption with a nonzero source in point remains unsupported for reflow. Restore its source in point to zero or remove the unsupported animation before adding or changing keys. The panel refuses these cases before mutation.

## Installation

Extract the matching Windows/macOS ZIP and run `node scripts/install.cjs`. The ZIP includes the UXP panel and invisible CEP renderer; the CCX alone is incomplete. Save work and restart Premiere after installation, then open **Window → UXP Plugins → Better Captions**.

Premiere Pro 26.3+, Creative Cloud Desktop, Node.js 24+, FFmpeg/FFprobe and Fontconfig are required. Recognized older services are backed up by the installer. The separate in-progress RollUp/fade work is not included.
