# Premiere-native interface review

The caption editor now uses Transcript, Style and Motion workspaces. Native transcription stays in the header; apply/update remains in the lower action area. Docked panels stack the cue list and selected editor; expanded panels place them alongside each other. Keyboard tabs support arrows, Home and End. Text editing also supports Ctrl/Cmd+Enter.

[Online interactive review](https://better-captions-premiere-review.swenhalver.chatgpt.site) is private to the owner's ChatGPT account. Its browser-only review toolbar switches between 280, 360, 480 pixels and expanded width. It uses synthetic captions and local browser storage. Transcription, timeline application and native Motion actions require the installed Premiere panel. The toolbar does not mount in UXP or CEP.

For future preview updates, reuse Site project `appgprj_6ad2dbaa92d881919fd7f5eca5e9e47f`. The ignored `work/remote-preview` checkout contains its separate static source repository; `dist/` contains the compiled editor. Preserve owner-private access. Site credentials belong in process memory only. This preview deployment never pushes to the caption repository's `main` branch.

## Verification

- `npm run check`: 0 errors, 0 warnings.
- `npm run build`: both the visible editor and invisible render-service bundles build. The existing non-module bootstrap warning remains informational.
- `npm test`: **204/204 passing on Windows**, with no skips. The original nine platform failures are resolved: media tests use the discovered FFmpeg binary, Windows private ACLs have their own inheritance assertions, POSIX mode checks remain on macOS, and Windows junctions exercise the link rejection tests without symlink privileges. Added coverage checks Mac/Windows paths and private-root agreement, Windows font enumeration, dependency resolution, service identity, Unicode process output, upgrade-version agreement and portable ZIP contents.
- Browser interactions: save text and undo; sentence regroup from 6 to 3 words producing 4 cues; search and empty results; invalid word timing rejection; valid word timing save; independent persisted base size, current-word scale and spoken opacity; arrow/Home navigation and visible focus; disabled native actions in the demo.
- Isolated local host fixture: no-sequence empty state, pending transcription with editing/refresh/apply lockout, actionable read error and dismiss control. The test harness does not ship and invokes no real Premiere APIs.
- Two bounded visual passes: 280/360/480px panels, 1280×900 expanded, 390×844 mobile and the observed 676×716 viewport. At 390px the document has no horizontal overflow. Final screenshots are retained locally under `.impeccable/review/`.
- Fresh independent Impeccable finish reviewer: **ship**, scoped to the browser UI; no material fixes requested. The built system is recorded in `DESIGN.md` and `.impeccable/design.json`.

## Native verification boundary

On October 16, 2026, the user resolved activation and Premiere Pro 26.5.2 opened normally on SwenHalver-PC-2020. The agent did not sign out another device. Window → UXP Plugins lists only Browse Plugins and Manage Plugins; Better Captions is not installed. The inspected user UXP directory contains Photoshop plugins, and the user CEP extensions directory is empty. No native workspace was rearranged.

The user then explicitly requested a cross-platform native port. Version 0.4.0 adds local Windows drive paths and matching AppData roots across UXP, CEP and the agent CLI; absolute dependency discovery for WinGet/PATH and both Homebrew architectures; installed Windows font enumeration; protected Windows ACLs; Node-based ZIP/CCX packaging and a common Node installer. The old macOS install command forwards to that installer. Session schema, renderer, protocol actions and queue lifetime/ownership rules remain intact.

All 204 tests pass on Windows, including real alpha-preserving ProRes encoding and installed font enumeration. Both production bundles and the CCX/universal ZIP build on Windows; Python's independent ZIP reader validates every member CRC. Adobe UPIA currently returns `-903` when installing the CCX, including after a clean Creative Cloud Desktop restart. The native panel is not yet registered; confirmation to complete Adobe's GUI installation is pending. Actual Speech to Text, clip application, native move/resize handles, constant-font reflow and animated Position/Width/Height remain unverified on this PC. Existing Mac runtime evidence remains in `tests/verification-result.json`; a fresh Mac run is still needed after the port.

## Merge-sensitive files

Coordinate with the separate Mac RollUp/fade work when merging `webview-ui/src/main-webview.svelte`, `components/AnimationPanel.svelte` and `components/ExportButton.svelte`. Changes there are UI state, layout and controls; the ExportButton apply algorithm remains intact. `StylePanel.svelte` and `WordStates.svelte` reorganize existing settings without changing the style schema. Transcript edit/grouping functions remain intact; the transcript component adds search and disclosure UI.

The cross-platform follow-up changes installer/tool discovery and local path/private-directory setup in the native adapters and bridge. Renderer, parser/edit core, types/session schema, transport actions, serialized native queues, ownership, heartbeat, watcher protections and CSP remain intact. There is one visible UXP panel and one invisible CEP renderer. The main Program Monitor remains the only caption preview destination.
