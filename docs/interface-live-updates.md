# Compact editor and automatic updates

These changes are on `swen/native-caption-effect`, in the dedicated Better Captions project. They are unreleased panel changes alongside the native C++ effect prototype. The existing panel still renders transparent movies; compiling the native prototype does not connect it to this editor yet.

## Workflow

After transcription, the large setup header becomes a compact sequence name, caption count and actions menu. Refresh and transcription actions remain in that menu. There is no caption canvas inside the plugin.

Text, style, animation and grouping edits automatically queue a Program Monitor update after about 400 ms without another edit. Rendering takes additional time. Edits remain possible while a movie is being prepared or rendered. A newer edit discards the obsolete render before timeline placement; only the brief placement stage locks editing. Opening a fully linked saved session does not rewrite its media merely because the panel opened. New unlinked transcripts do queue their initial output.

New output retains the one-clip default and automatic track placement above footage. Automatic styling preserves existing legacy clip containers and their Motion; legacy consolidation remains an explicit agent operation. Character-limit changes immediately regroup the displayed sentences while retaining native identities, manual clip boundaries and timing. The Regroup action remains available.

## Styling

The compact toolbar has All words, Past, Current and Next scopes, followed by font, size, bold, italic, color, weight, case and opacity. A property change in All words updates that property across the three word appearances without flattening unrelated differences. Base-size changes retain existing relative word sizes.

The weight list uses numeric values only. **B** means one 100-point weight step above the All words baseline, not a fixed 700. For example, base 500 with Current B enabled renders that word at 600; changing the base to 700 makes it 800. Turning B off returns that scope to the base. All words B changes all three offsets without changing the base setting. Explicit numeric per-state weight edits leave relative mode. The supported maximum is 1000. Relative settings survive session and preset saves and are available to agent hooks as per-word-state `fontWeightOffset` (100 for B, 0 for base, null for absolute weight).

Spacing, Outline, Shadow, Bubble and Layout open only when needed. Bubble controls include background color/opacity, padding and corner radius. Current-word font size remains independent of past and upcoming words.

Title Case affects rendered text only; it does not rewrite transcription. Measurement and painting use the same Unicode-aware transform, including wrapped word fragments.

Word spacing ranges from 0–300%, with 100% as normal spacing for new sessions. The revised layout removes duplicate per-word bubble clearance while keeping sufficient effect clearance and stable word positions. Older sessions and presets retain their original spacing until adjusted; **Use normal spacing** opts them into 100%.

## Position and size

Position & size opens with three compact rows in the style of Premiere's Effect Controls: a stopwatch, blue numeric values and an individual reset arrow. Position exposes X/Y in pixels. Width and Height are independent pixel dimensions, with no aspect-ratio lock.

Reset uses the original `renderBounds` center or dimensions. Without bounds, Position uses the saved caption placement or the actual default anchor, 50% across and 85% down. Unknown original native dimensions disable the corresponding reset rather than guessing.

Each reset uses the existing confirmed-playhead set operation. Other keys and easing remain unchanged; an animated property gets a key at the current frame when needed. Detailed lanes, selected-key values, timing and easing stay under the closed **Keyframes** disclosure. Typing and arrow-key numeric edits are supported; pointer scrubbing of numeric labels is not implemented.

## Recovery and write safety

Native work stays serialized. A timeout does not cancel Premiere's operation or free the lane. Local availability events announce when the exact outstanding replies have arrived. Proven read-only or unstarted failures resume automatically, with bounded backoff. An obsolete recovery timer cannot invalidate a newer read.

An uncertain timeline write blocks further automatic writes for that sequence, even after new edits or availability changes. A successful placement followed by a slow verification read cannot cause the entire placement to be repeated. Known clip links are saved before later verification. The pause message remains visible; other sequences can continue independently.

Automatic movie refresh preserves the confirmed native playhead rather than jumping to the selected sentence. Missing playhead information or invalid frame timing fails before seeking. The current cache-refresh workaround still uses two asynchronous seeks; simultaneous human scrubbing can race those seeks. A native renderer should remove this movie-refresh dependency, but that integration is separate work.

## Verification

- Local macOS source suite at this checkpoint: 630 tests, 628 passed, two Windows-only skips, zero failures.
- Svelte/TypeScript: zero errors and zero warnings. Both production webview/service builds succeeded.
- Browser checks at 280 px and 360 px panel widths: compact controls, independent width editing/reset, Title Case selection, current-word bubble controls and keyboard dismissal of the sequence menu. Relative B was exercised through the real controls: base 500 → Current B 600 → B off 500; changing the base to 700 with B on produced 800.
- Controller integration executes actual SessionManager, parser, live-output and Apply/supersede code. Native I/O and frame rendering are mocked in those tests.
- Renderer tests cover corrected spacing, legacy layout compatibility, Title Case measurement/painting, and saved preset/agent validation.
- The new interface, automatic updates and reset controls have not yet received installed Premiere acceptance. Showing transform handles is not proof of successful physical dragging or resize reflow. Existing production projects were not used as test material for these changes.

The local browser preview uses synthetic captions and cannot transcribe or place native clips. Run `npm run dev` for the review shell, or `npm --prefix webview-ui run dev -- --port 5190 --strictPort` for the preview used during this check.
