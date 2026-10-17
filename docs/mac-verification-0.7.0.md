# Mac verification: 0.7.0

Verified on 2026-10-17 from `dbcaa005dd1a2386ac011963aec1556cd5c064c1`, plus the sequence-scoped preset UI fix in `c4e3f87`.

Native environment: Premiere Pro 26.5.2 on macOS 26.6.2, Apple Silicon.

## Passed

- Local macOS suite: 382 passes, zero failures, two Windows-only skips (384 total).
- Svelte validation: zero errors and zero warnings.
- Production webview, invisible renderer, CCX and Windows/macOS ZIP builds.
- Actual mounted Svelte editor regression: a completed Apply message clears on a sequence switch; delayed success and delayed failure from the prior sequence cannot appear in the new sequence. The shared library remains available and the new sequence's style stays unchanged.
- Adobe UPIA confirmed the 0.6.0 to 0.7.0 installation. All 21 installed UXP/CEP runtime files match the packaged source bytes, including the new native preset store.
- The previous owned plugin and renderer were backed up. Installation used an upgrade without uninstalling the plugin, preserving UXP user data. The separate checkout's 16 in-progress files were unchanged.

## Native Premiere acceptance

- A fresh subagent obtained the supported Computer Use connection and completed the native checks in the existing verification sequence. The earlier standalone client authentication failure was a control-connection issue; it required no plugin or macOS permission changes.
- Saved a disposable preset through the installed panel. Its actual UXP `PluginData/style-presets.json` contained the complete baseline look, including all three word appearances and animation, and passed the frontend validator.
- Changed to a visibly different Georgia/purple/green/blue look and pop animation through the existing agent hooks, then rendered both caption clips in Premiere. Used the native panel's **Apply** and **Update Program Monitor** controls to restore the saved Arial/yellow-bubble/karaoke look. Visual inspection and complete resolved-style comparison confirmed restoration. The temporary large-font overflow warning cleared after restoring the baseline.
- Caption text, word times, grouping, placement, clip nodes and project-item links were preserved. All six underlying native Motion properties and their key ticks, values and easing readback were exactly unchanged on both captions, including the user-created Position key at frame 1. Pixel geometry at frame 1 also matched exactly.
- Rename succeeded; duplicate-name saving was rejected; cancelling replacement left the library unchanged; confirmed replacement retained the preset ID. Native saves advanced the library revision from 1 to 3.
- Saved and restarted Premiere, then reopened the same project. The renamed preset and complete library survived unchanged. The caption style/animation and all native curves and keyframes also survived unchanged.
- Cancelling deletion retained the preset. Confirmed deletion removed only the disposable preset, advanced the library to revision 4 with an empty list, and left the rendered captions unchanged. The project was saved with its original appearance restored and no dirty indicator.
- Restored only the old verification media that had been stored in `/tmp`, then relinked it into a permanent verification folder. The saved project had zero missing media and no remaining temporary verification links, and reopened without a missing-media prompt. All production media paths and the separate checkout's 16 in-progress files were preserved. Premiere remained on the user's requested other display.

These native checks cover one project and its verification sequence. Cross-project storage scope also has automated coverage; a second Mac project was not exercised. The 0.6.0 Program Monitor drag/resize behavior was not retested as part of this preset update.

The follow-up UI fix is in the branch source. Existing v0.7.0 release assets were not replaced.
