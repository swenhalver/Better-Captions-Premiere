# Native command enumeration probe

This separate Windows development probe asks Premiere's documented control-surface command suite for its command list. It helps establish whether commands related to captions and native graphics are exposed by the installed host. It does not create or edit graphics, execute commands, inspect project contents, send network requests, or install itself.

The exported plugin entry point registers the plugin and minimal control-surface callbacks. Enumeration starts in `Connect`, which the host calls for a configured control surface. If that call cannot obtain a usable command handle, exactly one further attempt may run on the first documented `Update` callback. The retry is consumed before calling the host, including under reentrancy; later updates and focus callbacks do no work. There are no timers or background retries. Merely discovering the plugin or listing its name does not enumerate commands or write a log. Once added, subsequent connections can refresh the log; remove the surface from Preferences to stop that behavior. Transport, mixer, marker, command-display and Lumetri capabilities are absent. Their null output handles and success returns match the SDK's default `ControlSurfaceBase` callbacks.

## Build

Requirements: Windows x64, Visual Studio 2022 or newer C++ build tools with a Windows SDK, CMake 3.24+, and a separately obtained, licensed Premiere Pro 26.0 C++ SDK. No After Effects SDK, Boost, Adobe binary library, PiPL compiler, or Adobe sample source is needed. The only SDK input is its external `Examples/Headers` directory. This probe currently targets Windows; it is independent of the main cross-platform plugin.

Run from this directory in PowerShell (choose the generator matching the installed Visual Studio):

```powershell
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 "-DPREMIERE_SDK_ROOT=C:/Users/Swen/Documents/Adobe-SDKs/Premiere-Pro-26.0-Windows/Premiere Pro 26.0 C++ SDK"
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```

Output: `build/Release/BetterCaptionsCommandProbe.acsrf`. Windows libraries linked are `Advapi32`, `Shell32`, and `Ole32`, with the MSVC DLL runtime. Confirm its export table contains `EntryPoint` using `dumpbin /exports`. Build products stay ignored; no build step copies into Premiere or starts it.

## Host verification (separate, explicit step)

The SDK guide's Control Surfaces chapter documents `<Premiere application folder>/Plugins/ControlSurface/` as the plugin location. The inspected Premiere 2026 installation uses `C:/Program Files/Adobe/Adobe Premiere Pro 2026/PlugIns/`; its `ControlSurface` subdirectory was absent before deployment. The intended destination is therefore `C:/Program Files/Adobe/Adobe Premiere Pro 2026/PlugIns/ControlSurface/BetterCaptionsCommandProbe.acsrf` (create that subdirectory during authorized deployment). Windows treats the guide's `Plugins` and the installed `PlugIns` spelling alike; do not add a hyphen or use the video-effect `Common` directory.

After an authorized manual deployment and host restart, add **Better Captions Command Probe (read only)** in Preferences > Control Surface > Add. Open a disposable project if none is open. A successful library build does not establish that Premiere discovers or connects it; record actual host results separately.

Read the current user's log:

```powershell
Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'BetterCaptionsCommandProbe/commands.jsonl')
```

The log contains metadata, the raw command-handle result, command records when a usable handle is available, and a final summary. Each command preserves the host-provided `context_id`, `context_name`, `command_id`, and `command_name`. Inspect all names, since names can be localized. A matching name establishes command availability only; it does not establish enabled state, required selection/context, successful execution, a data-driven graphics API, or a text/shape parameter contract. There is no execution path in this probe.

For `get_command_ref`, `error` is the exact SDK return value and `present` records whether it returned a handle. An error or absent handle prevents enumeration. Success (`error: 0`) plus no handle is reported as `null_command_ref`, never converted into a fabricated host error. A first-update report contains the original connection result in `previous_attempt`, so the latest report retains both observations. `first_update_retry_pending: true` means only that a retry was armed; the host may not issue an update before disconnection. A final unsuccessful attempt establishes only that this connection did not expose a usable command handle. The SDK sample also requests the command handle during `Connect`; trying the first update is a bounded diagnostic comparison, not a claim that the SDK requires delayed initialization.

Limits: 16,384 command entries, 4,096 bytes per UTF-8 string buffer including its terminator, 8 MiB per report, and a three-second elapsed-time check between commands. Individual host calls are synchronous and cannot be interrupted. Oversized or unavailable strings are `null` with their SDK error code; incomplete reports are marked in the summary. Host-returned strings and acquired suites are released. Empty enumeration is reported as zero commands, not proof that Premiere has no relevant UI command. Reconnect the configured surface after opening a project to retry.

Only one `commands.jsonl` is retained and overwritten on each connection or its single deferred attempt. Its dedicated LocalAppData directory and file use a protected ACL for the current user and SYSTEM. The writer rejects a reparse-point leaf directory/file and hard-linked log files. A failed write goes to the Windows debugger output with an error code; the plugin does not interrupt Premiere with a dialog. The file is written synchronously, so a reader or interrupted process can encounter an incomplete report: require the final summary before using it. No project path, credentials, caption contents or pointer addresses are requested or logged. The connection's opaque host handle is retained only until `Disconnect`; command handles and acquired host suites are never retained between attempts.

Remove the configured surface before removing the binary. Close Premiere before manually deleting the deployed `.acsrf`; the build has no uninstall task. The log can be removed independently when no longer needed.

## API and dependency provenance

The original adapter uses these declarations from the externally licensed SDK:

- `adobesdk/controlsurface/plugin/ControlSurfacePluginSuite.h`: entry point, plugin lifecycle and suite registration contract.
- `adobesdk/controlsurface/plugin/ControlSurfaceSuite.h`: minimal surface callbacks.
- `adobesdk/controlsurface/host/ControlSurfaceHostSuite.h`: `GetCommandRef`.
- `adobesdk/controlsurface/host/ControlSurfaceHostCommandSuite.h`: `GetCommandCount` and `GetCommand` only.
- `adobesdk/AdobesdkStringSuite.h`: UTF-8 conversion and SDK string disposal.
- `SPBasic.h` / `SPSuites.h`: acquiring and registering documented suites.

The official SDK guide, chapter 14 (PDF pages 371–372), documents control-surface loading and use of the host suites. Adobe's SDK sample was consulted for ABI and lifecycle conventions; no sample implementation or SDK headers are copied into this repository. SDK-owned opaque strings are handled only through the String Suite. No undocumented structures, project blobs, or private graphics formats are used. The SDK README cautions that other shared headers contain undocumented APIs; those are outside this probe.

This directory's implementation is original project code and does not grant rights to Adobe's SDK. Obtain the SDK independently under Adobe's terms; do not commit or redistribute its archive, headers, samples, or documentation with this source. Any distribution of a built integration remains subject to the applicable SDK license and project licensing policy.

Tests cover log record injection/escaping and hard byte limits, including reserved room for an incomplete summary. A second executable compiles the original adapter against synthetic SDK callbacks and an in-memory log sink: it checks registration, bounded connection/first-update enumeration, reentrancy, cancellation on disconnect, raw error versus null-handle reporting, optional callback outputs, no command execution, and suite/string cleanup. It does not load the `.acsrf`, launch Premiere, write private logs, or imply any real host command is available. Actual command availability still requires Windows host verification.

## Local build verification

On October 18, 2026, the Release x64 build completed with MSVC 19.44.35229.0 and Windows SDK 10.0.26100.0, with no compiler warnings. Both CTest executables passed. `dumpbin` identified a PE32+ x64 DLL exporting exactly `EntryPoint`. Dependencies were Windows libraries, the Universal CRT, `MSVCP140.dll`, `VCRUNTIME140.dll`, and `VCRUNTIME140_1.dll`; the three MSVC runtime DLLs were present in `System32`. This is build and synthetic-test evidence only: the probe had not been installed or loaded into Premiere at that point.

Local, ignored artifacts: `build/Release/BetterCaptionsCommandProbe.acsrf`, `build/Testing/Temporary/LastTest.log`, and `build/verification/pe-inspection.txt`.

## Initial host observation and diagnostic revision

The initial 0.1.0 binary was subsequently discovered and configured in Premiere on this Windows machine. Its report at `2026-10-19T02:44:45Z` reached `get_command_ref` and ended with `complete: false`, `error: 1348563565` (`0x5061726D`, `Parm`). That version replaced a successful null result with the same code, so the report cannot distinguish the host returning `Parm` from a successful call with no handle. It enumerated no commands and establishes no graphics command availability. The dedicated log's protected DACL was verified for the current user and SYSTEM.

Revision 0.1.1 preserves that distinction and adds the single first-update comparison described above. The Release x64 rebuild completed without warnings and both CTest executables passed. The separate live-host result follows.

## Final live-host result and cleanup

Revision 0.1.1 loaded in Premiere 26.5.2 on Windows. The final report, timestamped `2026-10-19T02:59:03Z`, records the first-update attempt and retains the preceding connection result:

| Attempt | Raw `GetCommandRef` result | Handle returned |
| --- | --- | --- |
| `control_surface_connect` | `1348563565` (`0x5061726D`, `Parm`) | No |
| `control_surface_first_update` | `1348563565` (`0x5061726D`, `Parm`) | No |

The summary is `complete: false`, `stage: get_command_ref`, `reason: host_error`, `first_update_retry_pending: false`. These are actual host errors, not the old probe's synthesized null-handle error. The one deferred attempt was consumed. No command enumeration started and no commands were executed. This result does not establish whether any caption or graphics command is available; it establishes only that these two documented calls did not obtain a command handle from this host connection.

The configured surface was then removed in Preferences and the change saved with OK. Premiere was cleanly quit. Before removal, the installed probe was verified against SHA256 `4031953F1C49B9138C461ED215D945CC1FEF5B354495AD09FA5C5B27AA4CBD0F`, matching the locally built 0.1.1 binary. Only the owned `PlugIns/ControlSurface/BetterCaptionsCommandProbe.acsrf` was deleted, and its absence was verified. The diagnostic surface and installed binary are no longer configured to load on the next Premiere launch. The ignored local build and the private diagnostic log remain available as evidence.
