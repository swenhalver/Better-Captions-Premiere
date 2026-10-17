# Fork security changes

The upstream audit in `SECURITY-AUDIT.md` describes the pinned original source, not a claim of malicious behavior. The relevant fixes in this fork are:

- No precompiled upstream `.uxpaddon` is loaded or packaged. Those binaries were removed from the fork, and the legacy native shell entrypoint was disabled in source.
- FFmpeg/FFprobe and macOS Fontconfig resolve to absolute local executables from documented installation locations, absolute PATH directories or explicit local environment settings. Windows font enumeration uses a fixed system PowerShell/.NET script. All process calls use argument arrays with `shell:false`; project paths and caption text are not interpolated into commands. Native requests cannot select tools or scripts.
- The production CEP page denies remote scripts, requests, frames, forms, and objects with CSP. The main UXP panel permits its packaged local webview and filesystem access, with no remote domains, process-launch, addon, or dynamic-code permission.
- The main UXP plugin directly calls Premiere's native Transcript API. Its local webview bridge exposes a fixed method list. The invisible CEP backend accepts only bounded rendering/timeline actions with captured project and sequence identity; it has no general eval or shell-command endpoint.
- Agent access is local, under private directories, with bounded JSON, request IDs, expiry, sequence/instance checks, style/action allowlists, and no arbitrary file-path or shell operation.
- The Windows installer and service create protected directory ACLs for the current user, SYSTEM and Administrators. Files inherit those rules. macOS retains 0700 directories and 0600 files. Both reject symbolic-link/junction queue roots; local project paths reject traversal, UNC/device paths and drive-relative Windows paths.
- Rendering writes only to managed job folders. Export validates frame dimensions/order/count, transparency and frame rate, preflights timeline collisions, and preserves linked clips and Motion values.
- The frontend dependency lock was refreshed; `npm audit` returned zero advisories at validation time. Dependencies were installed with lifecycle scripts disabled.

Threat boundary: another process already running as the same OS user (or a system administrator) can access that user's Premiere project and local agent state. These local hooks do not give an unauthenticated remote caller access to Premiere. The installed CEP panel necessarily has local filesystem/process capability for rendering, so keep its source and install folder under the user's control.

Live mutation failures and recovery limits are explicitly reported. Tests simulate rollback failures; normal insertion/relink and collision protection were also tested in Premiere. No audit can guarantee the absence of every defect.

## 0.5.0 native text-area controls

The visible UXP panel adds only allowlisted `readCaptionArea` and `editCaptionArea` methods. The background service exposes a read-only `readCaptionAreaDescriptor` operation to resolve an existing caption link, with sequence, project, clip, media, track-lock and speed checks. Native writes use the existing bounded UXP serialization lane, captured clip timing/media identity, a complete Motion-state signature, a second identity/value check after asynchronous preparation, one Premiere transaction and readback verification. The request contains bounded pixel values and an enumerated edit operation; it does not accept code, file paths, executable names or arbitrary native methods.

Word-style additions use the existing strict style validator. Optional state fields preserve old sessions. No network endpoints, remote fonts or new executable dependencies were added.

## 0.5.2 native compatibility

The unnamed Uniform Scale fallback requires a fresh proof from CEP's named control on the exact linked clip. UXP verifies the component, identical parameter count and Width/Uniform Scale/Rotation indices, neighbouring parameter identities, nonanimated Boolean value and agreement with that proof. The binding structure participates in identity checks; the Boolean state is refreshed after a transaction. Missing or ambiguous proof fails before mutation.

Native action and PointKeyframe construction now follow Adobe's synchronous lock requirements. Position values and key times are read back after writing. The panel refuses reconstruction of Position keys whose native easing cannot be read. No menu command, operating-system input automation or tool-toggle loop is used by the plugin.

Service startup polling reads only the private heartbeat, has a five-second maximum and reserves the serialization deadline. It writes no request before readiness. Legacy geometry migration performs at most one guarded full-profile read per selected identity, with a 64-entry cache and stale-result checks. Unknown rendered baselines require an explicit update. Agent runtime diagnostics are bounded read-only response data and are not persisted. No new permissions, service actions, network endpoints or dependencies were added.

## 0.6.0 keyframe editing

The private CEP service adds `patchCaptionKeyValues` for at most 32 existing Position, Width or Height key values. It accepts an enumerated property, exact existing source ticks, expected value and replacement value. It cannot add or remove a key, change animation modes, select a method or execute code. Before writing, it confirms the project, sequence, clip, media, track, timing, source bounds, geometry binding and all six Motion curves against a fresh descriptor. It reads every result back, checks untouched Motion values, and attempts inverse-value rollback on failure. Recovery failures are reported explicitly.

The local agent allowlist adds `read_area` and `edit_area`, targeting an applied caption ID through the existing panel handler. Requests have strict property, operation, track, tick-string, number and size bounds. Edits require a fresh native signature; the panel confirms the current sequence and caption identity again after asynchronous preparation. The internal CEP patch action is not a public WebView method.

Area history is bounded to 32 steps per caption, 32 caption contexts and 4 MiB. It survives a verified media-path-only reflow while each new request still requires the current media identity. External Motion changes invalidate incompatible history. Unknown native easing is preserved by in-place value edits; destructive reconstruction is refused unless the user explicitly removes an unsupported animation as a recovery operation, without a false Undo claim.

The existing bounded geometry watch gains a control revision containing Position keys and at most 24 interpolation probes. It adds no timer, operating-system input, menu action or rendering on Position-only changes. No new permissions, network endpoints, executable dependencies or remote content were added.
