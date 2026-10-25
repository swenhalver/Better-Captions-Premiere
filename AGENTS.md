# Agent rules

## Reinstall after every change

**Small UI text/cosmetic changes:** Swen's explicit instruction on 2026-10-25 is
"don't test after small changes like this, just reload the plugin." For changes
such as removing a placeholder label, build the client, sync the installed
plugin assets and restart Premiere Pro. Swen clarified that "reload" means
restart Premiere Pro, not just its panel. Use the safe save/quit and relaunch
procedure below, preserving the project and layout. Skip test suites and live
acceptance runs. If Swen has already restarted Premiere, do not restart it
again. This exception takes precedence over the full release workflow below
for those small changes.

After each change to the plugin, reinstall it into Premiere without being asked. The user tests in Premiere right away, so the installed panel must match the latest code.

1. **Coordinate first.** Other agents may be editing this checkout and installing at the same time. Check for active agents with whatever your environment provides (for example ListAgents, or T3 `t3_thread_list` for running threads in this project). If another agent is active, message it before bumping the version, so two installs never claim the same number.
2. **Pick the next free version.** Use one patch above the highest of:
   - `version` in `package.json`
   - `dist/Better-Captions-Swen-*.ccx`
   - `~/Library/Application Support/Adobe/UXP/Plugins/External/ca.swen.bettercaptions_*`

   Re-read these right before editing, because another agent may have just bumped them.
3. **Bump every version field:**
   - `package.json`
   - `uxp/manifest.json`
   - `cep/CSXS/manifest.xml`, both `ExtensionBundleVersion` and the `Extension` `Version`

   Then add `docs/release-<version>.md`, a short note describing the change. `npm run package` requires it.
4. **Build and install:**
   - `npm test`
   - `npm run package`
   - `npm run install:premiere`

   Confirm Adobe prints "Installation Successful".

   The installer first removes every existing S-Captions registration through Adobe's UnifiedPluginInstallerAgent (`--remove S-Captions` until `--list all` shows none), then installs the new CCX. This matters: Premiere's UXP plugin manager loads the FIRST registration of a plugin id and ignores later ones, so leftover older registrations make Premiere show a stale (or deleted, hence blank) panel no matter what was just installed. After installing, `--list all` must show exactly one S-Captions line and `~/Library/Application Support/Adobe/UXP/Plugins/External/` exactly one `ca.swen.bettercaptions_*` folder. Premiere must be quit before the removal step.
5. **Relaunch Premiere yourself, quitting it through a Codex computer-use agent.** Scripted quits (the AppleScript quit event, `activate` plus a System Events Cmd+Q) are unreliable: Premiere often ignores them while busy. Always delegate the quit to a Codex agent (T3 `delegate_task`, provider `codex`) that brings Premiere forward, answers any save dialog with Save, and chooses Quit from the menu. Since `npm run install:premiere` needs Premiere closed, quit before installing.

   After Quit, nothing may target Premiere until its process is gone: no accessibility reads, clicks, `activate` or `open`. Anything that does makes LaunchServices send a reopen event to the dying process, which shows the Finder dialog "The application “Adobe Premiere Pro 2026.app” is not open anymore." The user does not want that dialog. Only poll the process, then launch once:

   ```
   while pgrep -f "MacOS/Adobe Premiere Pro 2026$" >/dev/null; do sleep 3; done   # background job
   npm run install:premiere
   bash scripts/open-premiere.sh
   ```

   The same barrier applies after an unexpected window close, process exit, or Computer Use error suggesting the window disappeared. Discard old Computer Use app handles. Check the process without targeting the app; if it exited, relaunch once through the launcher, wait for it to finish, verify the new PID/window, and bind a fresh app handle. Never probe an old handle to find out whether Premiere has exited: `getApp` can launch an app and stale-handle input can generate the Finder dialog.

   Always relaunch with `scripts/open-premiere.sh`, never a bare `open -b`. It waits for the old process to be gone, then opens Premiere with the most recent project (entry 0 of Premiere's recent-projects list), so the user lands back in their project instead of the Home screen. `--dry-run` prints which project it would open. It then waits for the Premiere Pro MCP bridge (the `MCPBridgeCEP` extension, which now starts itself invisibly with Premiere) to report via `/tmp/premiere-mcp-bridge/bridge-owner.json`, so agents can use the `premiere_pro` MCP tools right after a relaunch.

   Fallback when Codex cannot reach Premiere's window (Computer Use returns `cgWindowNotFound`; Premiere's Accessibility window list shows only an `AXApplication` element, which happened after a hidden launch plus an S-Space display loss): the menu bar still works through Accessibility. Press **File › Save**, confirm the save by the `.prproj` file's modification time (the Save item stays enabled), then press **Premiere › Quit Premiere** with `AXUIElementPerformAction(..., kAXPressAction)`, and only poll the process afterwards. A relaunch restores normal window access.

   When Swen says he is remote, relaunch with `bash scripts/open-premiere.sh --main-display`, which skips S-Space.

   Never force-quit or kill it. Then report the installed version.

   **If Premiere is on Swen's main display, never bring it to the front or send it keys.** He may be typing in another app, and his keystrokes would land in Premiere, where plain letters are editing shortcuts. On 2026-10-23, during a quit while Premiere was on his main display, his timeline got a real 37-frame ripple trim and its In/Out points were cleared. Quit it there only through the Accessibility menu path above (File › Save, then Premiere › Quit via `kAXPressAction`), which doesn't steal focus. Or ask him first.
6. **Native effect changes** (anything under `native/`) also need the C++ plug-in rebuilt and reinstalled, with the SDKs that live in the gitignored `sdk/` folder:

   ```
   AE_SDK_EXAMPLES="$PWD/sdk/AdobeAfterEffectsSDK_26.5_MacOS/Examples" \
   PREMIERE_SDK_HEADERS="$PWD/sdk/Premiere Pro 26.0 C++ SDK/Examples/Headers" \
   bash native/adobe/build-macos.sh && bash native/adobe/install-user-macos.sh
   ```

## Commit every change

Commit every change without being asked (Swen, 2026-10-23: "you're supposed to be committing every change"). Once a build is installed, commit it on the current branch. Commit it even if its live test is still pending, because the next change shouldn't pile onto uncommitted work. The commit includes the code, tests and its `docs/release-<version>.md`, with a message naming the version and what changed. Never push unless Swen asks. When several agents share the checkout, the agent that owns the install makes the commit. Agents working in their own worktree commit on their own branch, and the install owner merges.

## Codex does the testing

All live testing in Premiere is done by Codex agents (T3 `delegate_task`, provider `codex`), never by Claude agents. This covers Computer Use runs, keyboard and mouse tests, test-hook measurements against the running Premiere, screenshots and checking results in the panel. Claude agents write the code, run `npm test`, `npm run check` and the native unit tests, package and install, then hand every live check to a Codex tester with exact steps and read back its report. Do not drive Premiere from a Claude agent with CGEvent scripts, accessibility clicks or test hooks to "just check quickly". Claude agents also do not write test scripts, test hooks or step-by-step click scripts for Codex: describe what must be verified (the behaviour and the expected outcome) and let Codex choose and build the testing method it thinks best.

## Test on the S-Space monitor

All Premiere testing happens on the user's S-Space virtual monitor (`/Users/swenhalverson/Cursor Projects/S-Space`, CLI `tools/s-space`), never on the main display.

Before any live UI test, check the screen is unlocked: `CGSessionCopyCurrentDictionary()["CGSSessionScreenIsLocked"]` must not be 1. While the Mac is locked, Computer Use fails with `cgWindowNotFound` and screenshots show only the lock-screen wallpaper. Never try to unlock it; ask Swen to unlock (for example via Screen Sharing).

Exception: when Swen says he is remote, test on the main display without asking ("You can always use the main display if I say I'm remote"). Do not wait for S-Space then.

If S-Space drops mid-session (`s-space status` shows `displayActive: false`) and `s-space start` fails with "macOS could not create the S-Space monitor", stop: do not loop retries or restart its helper. Ask Swen to restart S-Space, unless he has said he is remote.

- Launch Premiere only through `bash scripts/open-premiere.sh`, which runs `scripts/launch-premiere-test.swift`: it registers Premiere with S-Space, launches it hidden, places every window on S-Space, then reveals it. It refuses to open on the main display.
- Premiere on S-Space must stay in a **normal maximized window, never full screen** (Swen, 2026-10-24). Its red/yellow/green window controls and the menu-bar area must remain visible. Never press the green button or `AXZoomButton`: Premiere exposes that control as `AXFullScreenButton`; the helper previously entered full screen through it. Maximize only by double-clicking the visible title bar through Computer Use. `scripts/maximize-premiere-sspace.swift` now only verifies the normal frame below the menu bar and refuses full-monitor/full-screen frames; it performs no zoom or resize action. Launch/move helpers call this verifier and stop on failure. The Codex tester must correct normal window sizing and rerun the check, then reset the saved layout. A screenshot with correct dock ratios but hidden window controls is a failed run.
- Testers must leave the S-Captions panel in Swen's proportions. The full-window reference is `docs/testing/panel-layout-good-full.png`, with a closer view in `docs/testing/panel-layout-good.png`. Exact pixels don't matter; the proportions do. With Premiere maximized on S-Space, the top row is about half the window height and split roughly 31% S-Captions, 46% Program Monitor and 22% right column (Lumetri Color through Info, MCP Bridge below). That makes S-Captions about two-thirds as wide as the Program Monitor beside it. The Styling toolbar fits on one row, and Position/Width and Height/Visible lines sit in two columns. `docs/testing/panel-layout-bad.png` is what it must never be left as. Match the reference at the start and end, never the potentially collapsed layout found at arrival. Don't maximize panels during the test. If Swen resizes the panel himself during a run, his latest layout wins.
- Swen's layout is saved in a Premiere workspace named **S-Captions**, created 2026-10-23 at his request because Save Changes to This Workspace was disabled on Effects. It stays the active workspace, so **Window › Workspaces › Reset to Saved Layout** restores it. On 2026-10-24 a controlled outer-window shrink/grow reduced S-Captions from 31% to 16% while leaving the workspace name unchanged. Reset **after the last window move, resize, maximize, project reopen, or extension startup**, not before. Both launch and move helpers request that reset after sizing; their success only proves the menu action was accepted. Testers use Reset to Saved Layout instead of divider dragging. Never use Save Changes to This Workspace unless Swen asks, and never switch to another workspace.
- **Every live test run has a measured layout completion gate.** Save fresh full-window Computer Use screenshots and run `swift scripts/check-premiere-layout.swift IMAGE --window-width WIDTH --window-height HEIGHT`, using the actual current window dimensions from S-Space. Require exit 0 and `pass: true` at the start, after a real sibling-panel/focus round trip back to S-Captions, and at the end. As the last Premiere UI operation, after `release-app` and at least 60 seconds, capture another full-window screenshot and require the guard to pass again. Record paths, PID/window bounds and release/capture times in the run report. Inspect the controls visually too. A workspace label, successful reset, AX geometry or one immediate screenshot is insufficient. If any check fails, restore, repeat the end checks, and restart the release/wait/final-capture sequence. Never report the run restored or complete while this gate fails. See `docs/testing/premiere-layout-verification.md`.
- **Validate screenshot and input coordinate mappings separately.** Computer Use can return a padded 2× image canvas with 1× app content, while input is independently scaled. On 2026-10-24 a click from a cropped view landed on Premiere's window-close control and a later stale-handle call produced the Finder dialog. Prefer fresh named AX menu items. Before coordinate input, compare raw image, detected content and actual window bounds, then independently calibrate the input on a harmless control away from the title bar. The layout guard's `coordinateMapping.verified` validates image geometry only; `inputCoordinatesVerified` remains false. Never send cropped-image coordinates directly or infer input scaling from the image size alone.
- Mute Premiere's own audio for the whole test, and restore it at the end (Swen, 2026-10-23). Before any playback or scrubbing, record Premiere's playback volume and mute state, then mute Premiere itself, for example with the speaker control at the right end of the Program Monitor's transport bar. Afterwards, put both back exactly as found. Never change macOS system volume or output devices. Never use the timeline track M buttons or Audio Track Mixer faders: they change the sequence and get saved into the project.
- Computer-use agents follow S-Space's AGENTS.md: run `tools/s-space prepare-app --app com.adobe.PremierePro.26` before anything that opens new Premiere windows or dialogs, place new windows with `move --window`, and `release-app --pid <pid>` when finished. Never quit the user's app as cleanup.

## One forgiving user

This is a personal plugin with a single user, the author, who tests every build and is forgiving of missteps. Do not spend effort on backwards compatibility, migration paths, deprecation shims or defensive handling of hypothetical other users. Prefer the simplest change that makes the current build work; if an older document, setting or install needs to be thrown away, say so and move on.
