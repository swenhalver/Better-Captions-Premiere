# Agent rules

## Reinstall after every change

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

   Always relaunch with `scripts/open-premiere.sh`, never a bare `open -b`. It waits for the old process to be gone, then opens Premiere with the most recent project (entry 0 of Premiere's recent-projects list), so the user lands back in their project instead of the Home screen. `--dry-run` prints which project it would open. It then waits for the Premiere Pro MCP bridge (the `MCPBridgeCEP` extension, which now starts itself invisibly with Premiere) to report via `/tmp/premiere-mcp-bridge/bridge-owner.json`, so agents can use the `premiere_pro` MCP tools right after a relaunch.

   Fallback when Codex cannot reach Premiere's window (Computer Use returns `cgWindowNotFound`; Premiere's Accessibility window list shows only an `AXApplication` element, which happened after a hidden launch plus an S-Space display loss): the menu bar still works through Accessibility. Press **File › Save**, confirm the save by the `.prproj` file's modification time (the Save item stays enabled), then press **Premiere › Quit Premiere** with `AXUIElementPerformAction(..., kAXPressAction)`, and only poll the process afterwards. A relaunch restores normal window access.

   When Swen says he is remote, relaunch with `bash scripts/open-premiere.sh --main-display`, which skips S-Space.

   Never force-quit or kill it. Then report the installed version.
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
- Premiere on S-Space is always maximized (Swen's preference; same as double-clicking its title bar). If it is running elsewhere, run `bash scripts/move-premiere-to-sspace.sh`, which moves the project window to S-Space and zooms it to fill the display. `swift scripts/maximize-premiere-sspace.swift` alone zooms it if it is already on S-Space, and leaves it alone if it already fills it. `open-premiere.sh` does this after every launch. Computer-use agents can instead double-click Premiere's title bar on S-Space.
- Testers must leave the S-Captions panel in Swen's proportions. The full-window reference is `docs/testing/panel-layout-good-full.png`, with a closer view in `docs/testing/panel-layout-good.png`. Exact pixels don't matter; the proportions do. With Premiere maximized on S-Space, the top row is about half the window height and split roughly 31% S-Captions, 46% Program Monitor and 22% right column (Lumetri Color through Info, MCP Bridge below). That makes S-Captions about two-thirds as wide as the Program Monitor beside it. The Styling toolbar fits on one row, and Position/Width and Height/Visible lines sit in two columns. `docs/testing/panel-layout-bad.png` is what it must never be left as: a narrow sidebar about a fifth of the window, with the toolbar wrapped and the controls in one column. The panel has been arriving already shrunk after relaunches, so match it to the reference, not to whatever you found at the start. Check at the start and again at the end. If it doesn't match, drag the dividers until it looks like the reference, and confirm with a screenshot compared against it. One screenshot right after the drag isn't enough. On 2026-10-23 a tester's final screenshot showed it wide, yet Swen found it narrow on S-Space once the run ended. Make sure each drag really ended, with the mouse-up delivered to Premiere. Then, as the very last step after `release-app`, wait about a minute and take one more full-window screenshot to confirm the layout held. Don't maximize panels during the test. If Swen resizes the panel himself during a run, his latest layout wins.
- Swen's layout is saved in a Premiere workspace named **S-Captions**, created 2026-10-23 at his request because Save Changes to This Workspace was disabled on Effects. It stays the active workspace, so **Window › Workspaces › Reset to Saved Layout** restores it exactly. `scripts/open-premiere.sh` runs `swift scripts/reset-premiere-layout.swift` after every launch, because each relaunch squeezes S-Captions. Testers use Reset to Saved Layout, not divider dragging, to restore the layout at the start and end of a run. If you did drag a divider during a test, reset afterwards and confirm against the reference. Never use Save Changes to This Workspace unless Swen asks, and never switch to another workspace.
- Mute Premiere's own audio for the whole test, and restore it at the end (Swen, 2026-10-23). Before any playback or scrubbing, record Premiere's playback volume and mute state, then mute Premiere itself, for example with the speaker control at the right end of the Program Monitor's transport bar. Afterwards, put both back exactly as found. Never change macOS system volume or output devices. Never use the timeline track M buttons or Audio Track Mixer faders: they change the sequence and get saved into the project.
- Computer-use agents follow S-Space's AGENTS.md: run `tools/s-space prepare-app --app com.adobe.PremierePro.26` before anything that opens new Premiere windows or dialogs, place new windows with `move --window`, and `release-app --pid <pid>` when finished. Never quit the user's app as cleanup.

## One forgiving user

This is a personal plugin with a single user, the author, who tests every build and is forgiving of missteps. Do not spend effort on backwards compatibility, migration paths, deprecation shims or defensive handling of hypothetical other users. Prefer the simplest change that makes the current build work; if an older document, setting or install needs to be thrown away, say so and move on.
