# Premiere layout verification

The saved **S-Captions** workspace is the reference. Its name alone does not
prove that Premiere is displaying its saved proportions.

Premiere must remain a **normal maximized window with visible window controls
and menu-bar area**, never full screen. The previous `AXZoomButton` action
targeted a control whose actual subrole was `AXFullScreenButton`. That action
has been removed. `maximize-premiere-sspace.swift` now only checks the normal
frame below the menu bar and refuses full-monitor/full-screen frames. When
sizing is necessary, the Codex tester double-clicks the visible title bar,
reruns the verifier and resets the saved layout. Correct dock proportions
alone cannot pass a run if its window controls are hidden.

On 2026-10-24, reducing the outer window from 2560 to 2054 points and growing
it back to 2558 reduced the left dock from 31% to 15.8%. The Program Monitor
grew to 61.6%; the workspace name stayed S-Captions. Reset to Saved Layout
returned the left/program/right split to 31.0% / 46.4% / 22.6%.

This reproduces a mechanism for the recurring collapse. It does not establish
which earlier resize caused a particular user's report. Saved workspace data
was intact, and the S-Space release code does not resize windows.

## Run procedure

1. Confirm the desktop is unlocked, Premiere's current PID/window, and that the
   window is on S-Space. Complete all window sizing before resetting the saved
   layout. `open-premiere.sh` resets after startup and sizing;
   `move-premiere-to-sspace.sh` resets after placement and sizing verification.
   Both stop if the normal maximized frame cannot be verified. Neither a
   helper exit nor an accepted menu press is proof of rendered proportions.
2. Capture the actual full window through Computer Use. Read its current width
   and height from S-Space's window inventory. Run the read-only checker:

   ```sh
   swift scripts/check-premiere-layout.swift CAPTURE \
     --window-width WIDTH --window-height HEIGHT > CHECK.json
   ```

   Require exit 0 and `pass: true`. Inspect the screenshot as well: S-Captions
   around 31%, Program around 46%, right column around 22%, top row around half
   height, Styling toolbar on one row and controls in two columns. These bounds
   follow the checked-in full-window reference. A user-requested new layout
   takes precedence; do not overwrite their change to make this checker pass.
3. Perform the actual feature tests, preserving the project and audio. After
   a real sibling-panel/focus round trip, return to S-Captions and check a new
   capture. Reapply the saved layout after any later outer-window size change.
4. Restore the original project/state and reset the saved layout after the
   final sizing. Check a fresh capture. Release the task's S-Space claims and
   preparation, record the release time, and wait at least 60 seconds.
5. Make a fresh full-window capture as the **last Premiere UI operation**.
   Check it offline with the actual bounds, and record the capture time, paths,
   PID/window and measurements. Do not report restoration complete on failure.
   Restore and repeat the final sequence if it fails.

The checker reads an image only. It cannot establish capture freshness, active
panel identity, actual control reflow, project preservation or release timing.
Those require the live observations and report above. Missing separators or
unexpected image geometry fail rather than being treated as a restored layout.

## Coordinate and process safety

The same investigation found a separate automation error: a 5120×2818 raw
Computer Use image contained a 2560×1409 app at its top left, but input also
divided supplied coordinates by two. A click derived from the 1× content landed
on the window-close control. Logs show a normal Premiere exit immediately
afterward; a stale-handle input then produced Finder's “not open anymore” alert.

Use named AX menu items when possible. Image-to-window validation does not
calibrate input: the checker always reports `inputCoordinatesVerified: false`.
Independently verify input on a harmless control away from the title bar before
coordinate actions. Never infer input scaling from a cropped view or padded
image dimensions alone. Treat that calibration as invalid after window sizing
or a new app binding; prefer named menu actions for subsequent restoration.

After an unexpected close or missing-window error, stop targeting that app
handle. Check only the process until exit is resolved. If exited, relaunch once
through `open-premiere.sh`, wait for completion, verify the new PID/window and
bind a fresh Computer Use handle. Do not use `getApp` or a stale handle as a
process-existence probe.
