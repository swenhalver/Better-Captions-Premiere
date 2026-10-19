# Better Captions 0.7.15 — native effect creation

New transcripts on the native-effect development branch create a single Premiere
Transparent Video clip with the Better Captions native effect. The panel edits
the embedded transcript, word timing and supported word styles live. Position,
Width, Height and native animated overrides remain in Premiere Effect Controls.
No After Effects application or Dynamic Link is used.

Existing movie captions reconnect through their existing workflow. **Create native
effect copy** creates a separate native clip and preserves the movie and its
media. It does not transfer existing Motion curves or delete/disable the movie;
keep the desired version enabled in the timeline. Unrepresentable formatting is
refused before creating a clip, rather than silently changing the original look.

Native creation uses a positively identified generated source, persistent project
metadata, exact source/sequence timing, an empty enabled top track or a new track,
and exact effect/document readback. Ambiguous writes pause automatic creation.
The original footage, effects and keyframes are preserved. A false adjustment
layer flag alone never authorizes adopting footage as a caption carrier.

The compiled Metal effect is a separate experimental installation. This panel
package does not install or replace that binary. Creation fails when it is absent;
it does not silently generate a movie instead. The current accepted Mac binary
remains unchanged from the 0.7.11 preview repair.

## Validation

Mac live checks and exact build/test results are recorded in
[Mac verification](mac-verification-0.7.15.md). Native Premiere graphics, whose
letters/shapes are ordinary editable Premiere objects, are being developed
separately on Windows; they are not part of this native-effect release.

Current native limitations include centered text, shared As typed or ASCII Title
Case, no whole-caption background or letter spacing, and no panel animation
presets other than Karaoke. Use native Effect Controls for geometry/animation.
Existing rendered-movie captions remain available for their broader panel options
and plugin-free playback. A compiled effect must be installed on each computer
that renders a native-effect project.
