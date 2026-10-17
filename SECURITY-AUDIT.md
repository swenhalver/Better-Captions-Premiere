# Security Audit Report

**Target:** Paquette1111/Better-Captions-Premiere
**Commit:** 16c32128506a9c1a29a3577ea6d8e37339e9e6b9
**Date:** 2026-10-16
**Auditor:** Codex using skill-security-audit

## Executive Summary

**Verdict: CAUTION for upstream as-is.** Four HIGH findings, one MEDIUM, one LOW, and two INFO. No malicious intent was established. Remediate the flagged execution, permissions, binary provenance, and dependency issues before use.

## Repository Scorecard

OpenSSF endpoint returned HTTP 404: no scorecard available.

## Permission Summary

| File | Permissions | Risk |
|---|---|---|
| uxp.config.ts | Full local filesystem; remote webviews; local and remote host messaging; clipboard read/write; cross-plugin IPC; string code generation; native addon; unrelated launch schemes | HIGH |

## Findings

### FINDING-001 Shell command interpolation

- Severity: HIGH
- Confidence: HIGH
- Category: CE-02
- Phase: 3
- File: src/api/premierepro.ts:279-286
- Evidence: `addon.execSync(cmd + " 2>&1")`
- Risk: Project/output paths are interpolated into a shell command inside double quotes. Shell substitutions in a path can execute. The active image-sequence export currently bypasses this helper, which reduces current reachability but leaves the exported API exposed.
- Recommendation: Replace shell strings with argument-array process execution; do not expose a generic execution API.

### FINDING-002 Remote webview privileges exceed caption requirements

- Severity: HIGH
- Confidence: HIGH
- Category: PE-01
- Phase: 1,6
- File: uxp.config.ts:103-132
- Evidence: `domains: "all"; enableMessageBridge: "localAndRemote"; enableAddon: true`
- Risk: Remote content can be hosted by a webview configured to exchange privileged host messages. The application normally loads local content; a navigation or injection would widen its impact.
- Recommendation: Use local-only content and messaging. Disable unrelated network, clipboard, IPC, launch schemes, and addon access.

### FINDING-003 Bundled executable libraries lack a reproducible source binding

- Severity: HIGH
- Confidence: HIGH
- Category: SC-05
- Phase: 5
- File: public-hybrid/mac/arm64/bolt-uxp-hybrid.uxpaddon
- Evidence: `SHA256 0bbd621a0a2ab865f1449a7017d797d30fa5bca4534adfddae76e06f6bafffe5`
- Risk: Three native libraries ship in the repository. The arm64 binary has a 2024 signature and exports execSync. Static inspection cannot prove correspondence to the reviewed C++ source. This is a provenance limitation, not evidence of malware.
- Recommendation: Do not load shipped native libraries; build reviewed code or use a small source-visible host adapter.

### FINDING-004 Locked build dependencies have published advisories

- Severity: HIGH
- Confidence: HIGH
- Category: SC-05
- Phase: 5
- File: package-lock.json; webview-ui/package-lock.json
- Evidence: `npm advisory bulk endpoint returned matches for 17 package names`
- Risk: Affected development packages include Vite, Rollup, shell-quote, globbing packages, PostCSS, Svelte, and ws. The registry returned 69 advisory records across installed version families; that is not 69 proven exploitable vulnerabilities. No build or dependency install was run during the audit.
- Recommendation: Refresh the minimum needed build dependencies; retain integrity-pinned locks, ignore lifecycle scripts initially, and rerun dependency audit.

### FINDING-005 Git dependency is not pinned in the root manifest

- Severity: MEDIUM
- Confidence: HIGH
- Category: SC-05
- Phase: 5
- File: package.json:27
- Evidence: `https://github.com/justintaylor-dev/cc-ext-uxp-types.git`
- Risk: The type dependency is fetched from a third-party Git repository. The lock resolves a Git URL without registry integrity; root manifest intent can drift on a fresh resolution.
- Recommendation: Remove it from the shipped CEP build or pin an audited immutable commit.

### FINDING-006 No hooks or agent instruction files

- Severity: INFO
- Confidence: HIGH
- Category: PI/BD
- Phase: 2,4
- File: repository inventory
- Evidence: `0 hooks; 0 SKILL.md; 0 AGENTS.md/CLAUDE.md`
- Risk: No agent prompt injection, credential reads, exfiltration endpoints, hidden persistence, or ecosystem changes were found by source review. XML BOMs at byte zero are benign.
- Recommendation: Keep caption code and any future agent instructions separated.

### FINDING-007 No external repository scorecard

- Severity: INFO
- Confidence: HIGH
- Category: SC-05
- Phase: 0
- File: OpenSSF API
- Evidence: `HTTP 404`
- Risk: No OpenSSF Security Scorecard is available.
- Recommendation: Treat this audit as a bounded source snapshot, not a guarantee.

### FINDING-008 License file is missing

- Severity: LOW
- Confidence: HIGH
- Category: licensing
- Phase: 5
- File: README.md: License
- Evidence: `README links to LICENSE; no LICENSE file exists at this commit`
- Risk: The README claims MIT, while the license file and some embedded Adobe licensing terms are absent. This is a distribution concern rather than malicious behavior.
- Recommendation: Keep upstream attribution and keep this local fork private until license terms are clarified.

## Phase Coverage

1. Inspected UXP permissions and expected caption functions.
2. Read all three Markdown files; scanned all text for override, concealment, authority, role, encoded/hidden text, host-config changes, and anti-audit patterns. No actionable prompt-injection finding.
3. Reviewed source paths for filesystem writes, native process execution, network requests, and build commands. No credential/exfiltration combination.
4. No hooks, CI workflows, or agent event hooks exist in this snapshot.
5. Inspected both lockfiles, Git dependency, Xcode build phases, and native binary metadata; queried the npm advisory endpoint for 408 public package names and OpenSSF for the repository.
6. Simulated normal startup, local webview messaging, export, and malicious project-path/remote-content scenarios. Normal behavior is caption preview/import. The remote privileges plus execution helper unnecessarily broaden the impact of a future injection.

## File Inventory

97 tracked files, 1,533,962 bytes. 40 source files, 6 JSON configuration/lock files, 3 Markdown files, 48 assets/build metadata files.

| File | Bytes | Notes |
|---|---:|---|
| .gitignore | 421 | Reviewed; no separate finding |
| CHANGELOG.md | 2511 | Reviewed; no separate finding |
| README.md | 2689 | Reviewed; no separate finding |
| index.html | 381 | Reviewed; no separate finding |
| package-lock.json | 221004 | See findings |
| package.json | 1736 | See findings |
| public-hybrid/mac/arm64/bolt-uxp-hybrid.uxpaddon | 124352 | Native binary; provenance limitation |
| public-hybrid/mac/x64/bolt-uxp-hybrid.uxpaddon | 125648 | Native binary; provenance limitation |
| public-hybrid/win/x64/bolt-uxp-hybrid.uxpaddon | 48456 | Native binary; provenance limitation |
| public-zip/readme.txt | 51 | Reviewed; no separate finding |
| readme_dev.md | 1941 | Reviewed; no separate finding |
| src/api/api.ts | 434 | Reviewed; no separate finding |
| src/api/premierepro.ts | 12719 | See findings |
| src/api/utils/photoshop-utils.ts | 1071 | Reviewed; no separate finding |
| src/api/utils/premierepro-utils.ts | 682 | Reviewed; no separate finding |
| src/api/uxp.ts | 3726 | Reviewed; no separate finding |
| src/app.css | 1352 | Reviewed; no separate finding |
| src/assets/bolt-uxp-quickstart.gif | 88354 | Reviewed; no separate finding |
| src/assets/bolt-uxp.png | 15527 | Reviewed; no separate finding |
| src/assets/bolt-uxp.svg | 3688 | Reviewed; no separate finding |
| src/assets/built-with-bolt-uxp/Built_With_BOLT_UXP_Logo_Black_V01.png | 7612 | Reviewed; no separate finding |
| src/assets/built-with-bolt-uxp/Built_With_BOLT_UXP_Logo_Black_V01.svg | 5077 | Reviewed; no separate finding |
| src/assets/built-with-bolt-uxp/Built_With_BOLT_UXP_Logo_White_V01.png | 7338 | Reviewed; no separate finding |
| src/assets/built-with-bolt-uxp/Built_With_BOLT_UXP_Logo_White_V01.svg | 5254 | Reviewed; no separate finding |
| src/assets/react.png | 62718 | Reviewed; no separate finding |
| src/assets/react.svg | 3340 | Reviewed; no separate finding |
| src/assets/sass.png | 53474 | Reviewed; no separate finding |
| src/assets/sass.svg | 3633 | Reviewed; no separate finding |
| src/assets/svelte.png | 70449 | Reviewed; no separate finding |
| src/assets/svelte.svg | 1950 | Reviewed; no separate finding |
| src/assets/typescript.png | 40699 | Reviewed; no separate finding |
| src/assets/typescript.svg | 1312 | Reviewed; no separate finding |
| src/assets/vite.png | 86305 | Reviewed; no separate finding |
| src/assets/vite.svg | 1497 | Reviewed; no separate finding |
| src/assets/vue.png | 48155 | Reviewed; no separate finding |
| src/assets/vue.svg | 469 | Reviewed; no separate finding |
| src/globals.ts | 746 | Reviewed; no separate finding |
| src/hybrid/mac/.npmignore | 94 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/project.pbxproj | 21022 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/project.xcworkspace/contents.xcworkspacedata | 142 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/project.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist | 246 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/project.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings | 234 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/xcshareddata/xcschemes/arm64.xcscheme | 3045 | Reviewed; no separate finding |
| src/hybrid/mac/bolt-uxp-hybrid.xcodeproj/xcuserdata/justin.xcuserdatad/xcschemes/xcschememanagement.plist | 626 | Reviewed; no separate finding |
| src/hybrid/src/api/.gitattributes | 62 | Reviewed; no separate finding |
| src/hybrid/src/api/UxpAddonShared.h | 15483 | Reviewed; no separate finding |
| src/hybrid/src/api/UxpAddonTypes.h | 3192 | Reviewed; no separate finding |
| src/hybrid/src/module.cpp | 11990 | Reviewed; no separate finding |
| src/hybrid/src/utilities/.gitattributes | 62 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpAddon.cpp | 1201 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpAddon.h | 4015 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpTask.cpp | 2918 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpTask.h | 1882 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpValue.cpp | 8368 | Reviewed; no separate finding |
| src/hybrid/src/utilities/UxpValue.h | 2276 | Reviewed; no separate finding |
| src/hybrid/win/.npmignore | 7265 | Reviewed; no separate finding |
| src/hybrid/win/bolt-uxp-hybrid.vcxproj | 9644 | Reviewed; no separate finding |
| src/hybrid/win/bolt-uxp-hybrid.vcxproj.filters | 1919 | Reviewed; no separate finding |
| src/hybrid/win/bolt-uxp-hybrid.vcxproj.user | 168 | Reviewed; no separate finding |
| src/index-svelte.ts | 513 | Reviewed; no separate finding |
| src/index.scss | 2340 | Reviewed; no separate finding |
| src/main.svelte | 1528 | Reviewed; no separate finding |
| src/types/ppro.d.ts | 69502 | Reviewed; no separate finding |
| src/variables.scss | 2281 | Reviewed; no separate finding |
| src/vite-env.d.ts | 293 | Reviewed; no separate finding |
| src/webview-setup-host.ts | 4288 | Reviewed; no separate finding |
| tsconfig.json | 463 | Reviewed; no separate finding |
| uxp.config.ts | 3786 | See findings |
| vite.config.ts | 1290 | Reviewed; no separate finding |
| webview-ui/.npmignore | 298 | Reviewed; no separate finding |
| webview-ui/index.html | 391 | Reviewed; no separate finding |
| webview-ui/package-lock.json | 88207 | See findings |
| webview-ui/package.json | 544 | Reviewed; no separate finding |
| webview-ui/src/app.css | 1416 | Reviewed; no separate finding |
| webview-ui/src/components/AnimationPanel.svelte | 4743 | Reviewed; no separate finding |
| webview-ui/src/components/CanvasPreview.svelte | 6993 | Reviewed; no separate finding |
| webview-ui/src/components/ExportButton.svelte | 4825 | Reviewed; no separate finding |
| webview-ui/src/components/SequenceStatus.svelte | 1878 | Reviewed; no separate finding |
| webview-ui/src/components/StylePanel.svelte | 17298 | Reviewed; no separate finding |
| webview-ui/src/components/TranscriptPreview.svelte | 2745 | Reviewed; no separate finding |
| webview-ui/src/index-webview-svelte.ts | 161 | Reviewed; no separate finding |
| webview-ui/src/index.scss | 2790 | Reviewed; no separate finding |
| webview-ui/src/lib/canvas/engine.ts | 9030 | Reviewed; no separate finding |
| webview-ui/src/lib/export/exporter.ts | 3270 | Reviewed; no separate finding |
| webview-ui/src/lib/session/manager.svelte.ts | 4865 | Reviewed; no separate finding |
| webview-ui/src/lib/transcript/parser.ts | 2356 | Reviewed; no separate finding |
| webview-ui/src/lib/types.ts | 3114 | Reviewed; no separate finding |
| webview-ui/src/main-webview.svelte | 4143 | Reviewed; no separate finding |
| webview-ui/src/variables.scss | 218 | Reviewed; no separate finding |
| webview-ui/src/vite-env.d.ts | 73 | Reviewed; no separate finding |
| webview-ui/src/webview-api.ts | 1327 | Reviewed; no separate finding |
| webview-ui/src/webview-setup.ts | 1671 | Reviewed; no separate finding |
| webview-ui/src/webview.ts | 91 | Reviewed; no separate finding |
| webview-ui/tsconfig.json | 422 | Reviewed; no separate finding |
| webview-ui/vite.config.ts | 384 | Reviewed; no separate finding |
| webview-ui/yarn.lock | 24708 | Reviewed; no separate finding |
| yarn.lock | 107092 | Reviewed; no separate finding |

## Verdict Explanation

CAUTION is driven by plausible local command injection and a broad privileged webview surface, opaque executable artifacts, and dependency advisories. No CRITICAL finding was assigned: the critical-severity shell-quote advisory is in development tooling and its exploit preconditions were not demonstrated in this application. Source review does not prove a binary safe or establish exploitability of every package advisory. The reviewed target was not executed. The fork may proceed by removing these runtime paths and rechecking the actual shipped build.
