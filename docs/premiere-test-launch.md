# Premiere test launches on S-Space

Use this project command for agent test launches instead of an ordinary app launch:

```sh
npm run launch:premiere-test -- --project "/absolute/path/to/project.prproj"
```

The launcher checks the existing S-Space monitor and existing Accessibility access, reserves the Premiere launch with S-Space, and starts the requested project hidden with activation disabled. If Adobe overrides that request during startup, it hides Premiere again and immediately returns focus to the previously foreground application. It reads and places only windows belonging to that new Premiere process, preserves their size, verifies that they fit entirely on S-Space and are registered with S-Space, then reveals them without activation. It refuses an already-running Premiere session. Failed placement, registration, reveal, or focus verification leaves the launched process hidden and reports the error.

For a test restart, save the project through Computer Use and quit Premiere while its window is still on S-Space. Do not return the window to the main display between test restarts. Launch it with this command, then bind the running app through Computer Use. The launcher never saves or quits an existing user session. It does not change the shared S-Space helper, monitor settings, or ordinary Premiere startup preferences.

`npm run launch:premiere-test -- --check` checks prerequisites without launching an app. Add `--receipt /absolute/path/result.json` to save the launch verification. Receipts contain the foreground PID before/after, whether Adobe requested startup focus, observed main-display window count, and verified visible window bounds. They are local test evidence, not a guarantee that a future Adobe/macOS version will honor hidden launch.
