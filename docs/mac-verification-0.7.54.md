# S-Captions 0.7.54 verification

The reported state was reproduced in the live panel: a saved movie-caption session showed missing clips, layout overflow and an unconfirmed-output block while read-only Premiere discovery identified selected native carrier 000f42ec, track 2, with a readable embedded document.

After installation and an isolated S-Space restart, the panel automatically connected to that same native clip without selecting it. Runtime connection status is Connected to native caption layer; live output is idle, not queued and not blocked; no caption carries the stale overflow flag. The visible panel screenshot confirms the warnings are gone.

Before/after comparison confirms identical native document bytes, clip count and identity, track/index, in/out/start/end timing, all native control descriptors, document revision and original 00:00:17:09 playhead. The saved legacy sidecar is byte-for-byte unchanged. No replacement or duplicate caption was created.

JavaScript: 1,081 passed, two skipped, zero failed. Svelte: zero errors/warnings. Focused regression coverage runs the actual component controller for startup over a stale sidecar, pending uncertain movie output, read-only recovery without replay, and pending native-edit protection. Installed UXP files match the CCX byte-for-byte.

Launch receipt: PID 83713, window 22488 fully on S-Space; zero visible main-display windows observed; Adobe did not take startup focus and foreground PID 72552 was unchanged. App claims were released and the Computer Use kernel reset after inspection. Available Computer Use documentation/tools expose no capture-release operation, so its separate capture release could not be verified. The user's apps and shared monitor remain running. No BetterTouchTool clicking was used.

Evidence: artifacts/verification-0.7.54 (before/after panel, connections, controls, unchanged sidecar backup and result receipt).
