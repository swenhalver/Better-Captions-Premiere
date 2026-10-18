# Better Captions 0.5.1

This update keeps the approved Transcript / Styling interface from 0.5.0 and addresses issues found while reviewing it for the existing Mac installation.

## Caption editing

The Transcript tab provides editable sentences and a word timeline with frame-aligned, non-overlapping boundaries. Styling provides independent Past, Current and Next word typography, color, opacity, stroke, shadow and bubbles. Captions appear in Premiere's Program Monitor; there is no separate plugin video preview or helper window.

Position & size controls use native Premiere Motion for position and independent width/height. Supported width changes reflow text at the same font size. New checks refuse unsupported animation before changing a clip, and revalidate the exact caption link after asynchronous edit preparation. Existing custom animated Uniform Scale must be unlocked in Effect Controls before using independent dimensions.

## Install on macOS

1. Install Premiere Pro 26.3+, Creative Cloud Desktop, Node.js 24+, FFmpeg/FFprobe and Fontconfig. Both Apple Silicon and Intel tool paths are supported.
2. Extract `Better-Captions-Swen-0.5.1-Windows-macOS.zip` from the GitHub release.
3. Run `node scripts/install.cjs` in the extracted folder. The ZIP includes both the UXP panel and invisible CEP service; the CCX alone is incomplete.
4. Save work and restart Premiere, then open **Window → UXP Plugins → Better Captions** and refresh a saved sequence.

If Adobe's command-line installer fails, install the included CCX through Creative Cloud and then run `node scripts/install.cjs --service-only`. The installer verifies the registered panel version before installing the service. Recognized earlier Better Captions services are retained outside extension discovery for recovery; unrelated or ambiguous installations are preserved and refused.

## Verification and limits

Validation results for this update are recorded with the release. Automated SDK fixtures and browser tests do not establish successful operation inside Adobe Premiere. Native Mac acceptance remains pending until it is explicitly recorded.

The native keyframe controls currently require English Motion parameter names. Animated Motion on a caption with a nonzero source in point cannot be preserved through text reflow; remove that unsupported animation or restore the source in point to zero first. Existing complex retiming and animated Anchor Point migration restrictions remain. Native custom Bezier handles on untouched keys are preserved. Edits or panel Undo that would have to recreate a complex key use an actionable refusal; use Premiere's Undo or Effect Controls for those changes. The panel can change an existing interpolation mode, but does not edit custom easing handles.

The separate in-progress RollUp/fade work is not part of this release. Its local source files are preserved.
