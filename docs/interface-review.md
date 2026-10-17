# Premiere-native interface review

The caption editor now uses Transcript, Style and Motion workspaces. Native transcription stays in the header; apply/update remains in the lower action area. Docked panels stack the cue list and selected editor; expanded panels place them alongside each other. Keyboard tabs support arrows, Home and End. Text editing also supports Ctrl/Cmd+Enter.

[Online interactive review](https://better-captions-premiere-review.swenhalver.chatgpt.site) is private to the owner's ChatGPT account. Its browser-only review toolbar switches between 280, 360, 480 pixels and expanded width. It uses synthetic captions and local browser storage. Transcription, timeline application and native Motion actions require the installed Premiere panel. The toolbar does not mount in UXP or CEP.

For future preview updates, reuse Site project `appgprj_6ad2dbaa92d881919fd7f5eca5e9e47f`. The ignored `work/remote-preview` checkout contains its separate static source repository; `dist/` contains the compiled editor. Preserve owner-private access. Site credentials belong in process memory only. This preview deployment never pushes to the caption repository's `main` branch.

## Verification

- `npm run check`: 0 errors, 0 warnings.
- `npm run build`: both the visible editor and invisible render-service bundles build. The existing non-module bootstrap warning remains informational.
- `npm test`: 190 tests, 181 passing, 9 Windows platform failures. Four media tests rely on the existing hardcoded Homebrew FFmpeg path. Three assertions require POSIX file modes. Two tests require unavailable Windows symlink privileges. Renderer, grouping, transcript edits, native-API mocks, transport, watchers, ownership and allowlist tests pass. Native/backend source and test files were not changed.
- Browser interactions: save text and undo; sentence regroup from 6 to 3 words producing 4 cues; search and empty results; invalid word timing rejection; valid word timing save; independent persisted base size, current-word scale and spoken opacity; arrow/Home navigation and visible focus; disabled native actions in the demo.
- Isolated local host fixture: no-sequence empty state, pending transcription with editing/refresh/apply lockout, actionable read error and dismiss control. The test harness does not ship and invokes no real Premiere APIs.
- Two bounded visual passes: 280/360/480px panels, 1280×900 expanded, 390×844 mobile and the observed 676×716 viewport. At 390px the document has no horizontal overflow. Final screenshots are retained locally under `.impeccable/review/`.
- Fresh independent Impeccable finish reviewer: **ship**, scoped to the browser UI; no material fixes requested. The built system is recorded in `DESIGN.md` and `.impeccable/design.json`.

## Native verification boundary

Premiere Pro 2026 launched on SwenHalver-PC-2020, but Adobe's device activation limit blocks the workspace. No other device was signed out. Actual Speech to Text, clip application, native move/resize handles, constant-font reflow and animated Position/Width/Height need runtime verification. The supported installer and media paths currently target Apple Silicon macOS; this redesign does not add a Windows installer or port native runtime dependencies.

## Merge-sensitive files

Coordinate with the separate Mac RollUp/fade work when merging `webview-ui/src/main-webview.svelte`, `components/AnimationPanel.svelte` and `components/ExportButton.svelte`. Changes there are UI state, layout and controls; the ExportButton apply algorithm remains intact. `StylePanel.svelte` and `WordStates.svelte` reorganize existing settings without changing the style schema. Transcript edit/grouping functions remain intact; the transcript component adds search and disclosure UI.

No changes were made to the renderer, parser/edit core, types/session schema, host transports, private bridge, UXP/CEP host implementations, native queues, ownership, heartbeat, watcher protections or CSP. There is one visible UXP panel and one invisible CEP renderer. The main Program Monitor remains the only caption preview destination.
