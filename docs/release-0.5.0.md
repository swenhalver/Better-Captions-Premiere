# Better Captions 0.5.0

This version implements the approved combined interface as the production Premiere plugin. The visible panel and invisible renderer are platform-neutral JavaScript, packaged together for Apple Silicon, Intel macOS and Windows.

## What changed

- **Transcript:** sentence selection opens a single word lane. Drag, keyboard and numeric timing edits snap to the sequence frame grid, retain at least one frame per word and prevent overlaps. Connected boundaries move together. Existing text correction, grouping, split/merge and transcript Undo remain available.
- **Styling:** Past words, Current word and Next words each have font family, absolute font size, weight, italic, case, letter spacing, color, opacity, stroke, shadow and optional word bubble. Missing new fields inherit the prior global appearance, preserving old sessions.
- **Position & size:** the selected caption exposes native X/Y, independent Width/Height, stopwatches, key navigation, add/remove, Linear/Bezier/Hold interpolation and Undo. Edits use one native UXP transaction and verify readback. Stale links, changed Motion and locked tracks are rejected. Existing native size watching performs fixed-font reflow.
- Clicking a word in the labeled type sample selects and seeks that word. Generated caption movies remain rendered media; Premiere’s Program Monitor does not expose individual word hit targets. Use the panel’s word lane to edit individual timing.

## Install on macOS

1. Install Premiere Pro **26.3+**, Creative Cloud Desktop, Node.js **24+**, FFmpeg/FFprobe and Fontconfig. Homebrew users can run `brew install node ffmpeg fontconfig`.
2. Download and extract `Better-Captions-Swen-0.5.0-Windows-macOS.zip` from the GitHub release.
3. In Terminal, change into the extracted folder and run `node scripts/install.cjs` (or `zsh scripts/install-cep.sh`). This installs both the UXP panel and invisible CEP service.
4. If Adobe’s command-line installer fails, open `dist/Better-Captions-Swen-0.5.0.ccx` in Creative Cloud and complete its installation, then run `node scripts/install.cjs --service-only` from the extracted folder.
5. Save your work, restart Premiere, then open **Window → UXP Plugins → Better Captions**. Open a saved sequence and click **Refresh sequence**.

The CCX alone is not the complete installation: rendering also requires the background service included in the ZIP. The installer checks dependencies, retains an existing owned service as a backup and never overwrites another extension. No notarized native executable is shipped. The CEP developer flag is required for this unsigned service.

## Verification

- The local Windows suite passed all **215 tests**. Automated tests cover the real native-action adapter with a Premiere SDK fixture, clip-identity changes during asynchronous preparation, refused/silent transactions, source-time keys, independent dimensions, Undo, per-state rendering, timing invariants, protocol isolation, native paths and package permissions.
- Svelte/TypeScript and both production bundles are checked during packaging.
- The [GitHub Actions test/build/package run](https://github.com/swenhalver/Better-Captions-Premiere/actions/runs/39009788040) passed on macOS and Windows. CI does not run Adobe Premiere.
- Browser review uses synthetic captions and sample keyframes. It does not control a remote Premiere installation.

Actual **0.5.0 installation and keyframe behavior inside Premiere on macOS have not been exercised** on this Windows development machine. The current Windows Adobe installation attempt for 0.4.0 was blocked by UPIA `-903`. Earlier host verification files describe earlier native builds, not a live 0.5.0 acceptance test. This release is marked prerelease pending that host acceptance.

## Boundaries

Native Motion property discovery currently expects English parameter names. Use an English Premiere UI for these panel keyframe controls. Existing unsupported retiming, complex animated Anchor Point and trimmed animated-media geometry restrictions still apply; actionable host errors preserve the clip. Up to 256 keys per edited property are supported, with the existing watcher’s combined-key limit unchanged. The panel’s one-edit Undo becomes unavailable after external changes or a media relink; Premiere’s Undo remains the recovery path for earlier edits. Native custom Bezier handles are preserved on untouched keys; the panel edits the interpolation mode rather than custom handles.
