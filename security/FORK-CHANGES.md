# Fork security changes

The upstream audit in `SECURITY-AUDIT.md` describes the pinned original source, not a claim of malicious behavior. The relevant fixes in this fork are:

- No precompiled upstream `.uxpaddon` is loaded or packaged. Those binaries were removed from the fork, and the legacy native shell entrypoint was disabled in source.
- FFmpeg and font enumeration use fixed executable paths and argument arrays with `shell:false`. Project paths and caption text are not interpolated into shell commands.
- The production CEP page denies remote scripts, requests, frames, forms, and objects with CSP. The main UXP panel permits its packaged local webview and filesystem access, with no remote domains, process-launch, addon, or dynamic-code permission.
- The main UXP plugin directly calls Premiere's native Transcript API. Its local webview bridge exposes a fixed method list. The invisible CEP backend accepts only bounded rendering/timeline actions with captured project and sequence identity; it has no general eval or shell-command endpoint.
- Agent access is local, under private directories, with bounded JSON, request IDs, expiry, sequence/instance checks, style/action allowlists, and no arbitrary file-path or shell operation.
- Rendering writes only to managed job folders. Export validates frame dimensions/order/count, transparency and frame rate, preflights timeline collisions, and preserves linked clips and Motion values.
- The frontend dependency lock was refreshed; `npm audit` returned zero advisories at validation time. Dependencies were installed with lifecycle scripts disabled.

Threat boundary: another process already running as the same macOS user can access that user's Premiere project and local agent state. These local hooks do not give an unauthenticated remote caller access to Premiere. The installed CEP panel necessarily has local filesystem/process capability for rendering, so keep its source and install folder under the user's control.

Live mutation failures and recovery limits are explicitly reported. Tests simulate rollback failures; normal insertion/relink and collision protection were also tested in Premiere. No audit can guarantee the absence of every defect.
