# Mac verification: 0.7.0

Verified on 2026-10-17 from `dbcaa005dd1a2386ac011963aec1556cd5c064c1`, plus the sequence-scoped preset UI fix in this change.

## Passed

- Local macOS suite: 382 passes, zero failures, two Windows-only skips (384 total).
- Svelte validation: zero errors and zero warnings.
- Production webview, invisible renderer, CCX and Windows/macOS ZIP builds.
- Actual mounted Svelte editor regression: a completed Apply message clears on a sequence switch; delayed success and delayed failure from the prior sequence cannot appear in the new sequence. The shared library remains available and the new sequence's style stays unchanged.
- Adobe UPIA confirmed the 0.6.0 to 0.7.0 installation. All 21 installed UXP/CEP runtime files match the packaged source bytes, including the new native preset store.
- The previous owned plugin and renderer were backed up. Installation used an upgrade without uninstalling the plugin, preserving UXP user data. The separate checkout's 16 in-progress files were unchanged.

## Native acceptance still pending

Premiere was running, but its MCP bridge was disconnected and the installed Computer Use service rejected this session with `Sender process is not authenticated` before returning an app state or screenshot. No native save, quit, project edit or preset action was attempted through that rejected session. The control client was closed. Premiere's existing window was moved to the other display at the user's request.

The new version is installed on disk; the running application must be restarted before checking it. Saving, reopening and applying a preset in the actual Mac UXP panel, plus native keyframe preservation after rendering, remain unverified in this session. Browser/runtime checks and installed-file equality do not establish that native acceptance.

The follow-up UI fix is in the branch source. Existing v0.7.0 release assets were not replaced.
