# Better Captions 0.7.9 development build

This branch keeps the existing movie-based captions and adds experimental native
adjustment-layer reconnection. It does not migrate or replace existing clips.

The panel automatically discovers the current project/sequence and follows a
selected Better Captions layer. Saved movie captions reconnect using exact native
clip, project-item and full media-path identities. Missing or ambiguous clips keep
their saved edits; reconnecting never inserts replacements. Project copies and
Save As contexts are isolated even when their sequence GUIDs are identical.

Native adjustment layers restore their embedded timed words and supported styles.
Edits use one guarded, revision-checked document write. Native geometry, keyframes
and Effect Controls overrides are preserved. Summary polling omits transcript
carriers; full documents are read for changed targets and periodic verification.
Unconfirmed writes pause further automatic changes for that context.

The compact styling interface includes numeric weight choices and relative B
(one 100-point step above All words), Title Case, word spacing and word bubbles.
Movie-based text and style edits update automatically. Position/Width/Height have
compact resettable controls. Setup and advanced settings stay collapsed.

The experimental native renderer exposes Current/Past/Next size, tint, opacity
and bubble overrides in Premiere Effect Controls. Unsupported native font weight,
italic, tracking, alignment and percentage spacing controls are disabled rather
than silently ignored. Supported transcript/style edits remain in the panel.
Native character grouping, placement and animation use Effect Controls. Full
Unicode title casing and native Razor/source-time acceptance remain separate
experimental limitations; see native-effect-acceptance.md.

The package installer updates only the owned UXP panel and CEP service. The
separately compiled native effect uses its own reversible per-user installer.
Installation and host acceptance are recorded in mac-verification-0.7.9.md.
