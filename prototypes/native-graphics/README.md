# Native Premiere graphics prototype

This exporter creates one Premiere-native text graphic per phrase in a new sequence, using the public FCP7 `xmeml` Text-generator format. The imported graphics use Premiere's renderer and native editing controls. The XML contains no external movie references, compiled Better Captions effect, MOGRT, After Effects or Dynamic Link dependency.

This is a runnable interchange prototype. Panel integration, automatic updates/reconnection and full per-word styling remain unfinished.

## Run the example

From the repository root, with **Node.js 22.18+** and built-in TypeScript support; Node.js 24+ is recommended:

```sh
node scripts/native-graphics.mjs --session prototypes/native-graphics/fixtures/sample-session.json --output native-graphics-example
```

The output directory must be new and its parent must exist. The CLI accepts a saved `SessionState` or direct `NativeGraphicsPlanInput` JSON object, up to 8 MiB. It validates and plans before creating output, leaves the input unchanged, and rejects existing output files/directories. An I/O failure preserves incomplete output and reports its location; retry with a new directory.

The four output files are:

| File | Purpose |
| --- | --- |
| `graphics.xml` | A new sequence with native text graphics on V2 and empty V1. |
| `manifest.json` | Generation ID, phrase/source identities, exact source timing, frame ranges, requested appearance, warnings and original authoring data. |
| `source-plan.srt` | Plain phrase text/timing fallback. SRT has its own limited capability declaration. |
| `README.txt` | Import guidance, written last after the other files succeed. |

In Premiere, use **File > Import** to import `graphics.xml` into a scratch project, then open the new sequence. Inspect the main Program Monitor, Properties and Effect Controls. Each export uses fresh output identities; it does not find or replace existing timeline clips.

## What the writer transfers

The planner reuses character-based phrase grouping, keeps whole words and manual split/speaker/placement boundaries, and rejects overlapping source timing. Phrase ranges are rounded to sequence frames; zero-frame phrases fail explicitly. Integer and exact 1000/1001 NTSC rates are supported by the XML writer. The manifest retains original seconds and identifies rounding.

The XML requests phrase text, display-case conversion, frame timing, shared font family, size, regular/bold, left/center/right alignment and solid text color. Weights below 600 map to Regular; 600 and above map to Bold. Other exact weights remain in the manifest with a warning. Missing fonts can be substituted by Premiere.

Titles begin at the frame center. Font-size normalization was measured on Premiere 26.5.2 at 1080p: XML size 32 produced the requested native size 72. Other hosts, frame sizes and fonts need native checks.

The manifest preserves source captions, words/timings, styles, animation, supplied transcript, saved geometry and legacy links. It does **not** apply past/current/upcoming word states, relative Bold, italic, stroke, shadow, current-word enlargement, bubble shapes/padding/radius, independent text-box dimensions, wrapping, dynamic reflow, saved placement or geometry keyframes. Legacy movie/effect links are not treated as new graphic links. `nativeImportVerified` remains false until a separate native acceptance check; generating XML cannot establish that result.

## Windows native checks completed

Observed on **Premiere 26.5.2.5, Windows, 1920 × 1080, 30 fps**:

- The initial [Text fixture](fixtures/text-generator.xml) imported real **Graphics > Text** objects on V2 and rendered over empty V1.
- Direct text editing and adding a native Rectangle worked in Premiere's UI.
- Ordinary **Motion** Position X was keyed from 960 to 1060, and Scale from 100 to 85, at 0 and 2 seconds. At 1 second the readbacks were 1010 and 92.5. The saved project was closed and reopened, and the edits persisted.
- The [generated XML fixture](fixtures/generated-graphics.xml) imported two clips. Premiere confirmed the requested font size of 72.

The Rectangle and Motion keys were **manual UI additions**, not XML-writer features. These checks do not establish automatic shape creation, independent text-box resizing, complete word-state fidelity, or programmatic mutation/reconnection of existing graphics. This branch currently exports the saved session; it does not add the graphics workflow to the panel's Speech to Text or Apply controls.

See the [Windows acceptance record](verification-windows.md) for exact operations, unverified cases and Windows SDK provenance.

## Validation and references

The 31 new planner/XML/CLI tests pass. `npm run check` reports zero errors/warnings, and `npm run build` passes. The full Windows suite reports **815 tests: 812 passed, 3 inherited failures**: the native-effect C++ roundtrip cannot find `clang++`, and two font-catalog checks reject six installed Airbnb Cereal faces containing U+007F in their family names. No compiler installation or font changes were made for this prototype.

The format follows [Apple's archived Text-generator subtitling example](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Applications/Applications.html). Adobe's [Premiere reference, XML import section](https://helpx.adobe.com/pdf/cs6/premiere_pro_reference.pdf) documents translation of FCP Text generators into titles; the current Graphics behavior above was verified locally. Adobe also documents [text properties](https://helpx.adobe.com/premiere/desktop/add-text-images/stylize-text/create-text-styles.html), [native shape creation](https://helpx.adobe.com/premiere/desktop/add-text-images/draw-objects/create-a-shape.html) and [Effect Controls keyframes](https://helpx.adobe.com/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/add-keyframes.html). Those UI capabilities are separate from what this exporter automates.
