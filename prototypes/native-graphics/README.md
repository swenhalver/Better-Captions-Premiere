# Native Premiere graphics prototype

This exporter creates one Premiere-native text graphic per phrase in a new sequence, using the public FCP7 `xmeml` Text-generator format. The imported graphics use Premiere's renderer and native editing controls. The XML contains no external movie references, compiled Better Captions effect, MOGRT, After Effects or Dynamic Link dependency.

The branch includes a secondary **Native graphics · Experimental** panel workflow and a standalone CLI using the same XML writer. This tested prototype is built on the **0.7.11 snapshot**. It is separate from the latest stable Mac release; macOS native acceptance remains outstanding. Its draft pull request is unmerged and has conflicts with the advancing `swen/native-caption-effect` base; standalone branch validation does not establish merge readiness.

## Use the panel workflow

1. Save the Premiere project, select the source sequence, and transcribe or load captions in Better Captions.
2. In the panel's output area, open **Native graphics · Experimental**, review its limitations, then choose **Create native graphics**. This action is available for the regular caption session; the browser demo cannot run it.
3. The service captures the source captions and settings, saves a new generation, and attempts to import it as a separate sequence named `Better Captions graphics <generation-id>`.
4. Find the sequence in Premiere's Project panel. Inspect its native text, timing, fonts and styling in the Program Monitor and Effect Controls before using it.

The normal live-caption workflow remains available. Native graphics are an independent snapshot: later caption edits do not update them, and edits made to these graphics in Premiere do not flow back into the source captions. Every creation uses fresh identities and can produce another sequence; existing timeline clips are not located or replaced.

The result distinguishes these outcomes:

| Result | Meaning and next step |
| --- | --- |
| `imported` | Premiere confirmed a new sequence with the expected identity, name and frame settings. Inspect the actual graphics; this check does not establish their text, timing or visual fidelity. |
| `saved` | The generation files are saved, but no import was attempted. Read the warning and use **File > Import** with the displayed **Saved XML** path when appropriate. |
| `import-unconfirmed` | An import was attempted, but its result could not be confirmed. A sequence may already exist. Inspect the Project panel before doing anything that could import another copy. |
| Unknown outcome | The panel did not receive a valid result. A sequence may already exist, and saved-file availability is not confirmed by this message. Inspect the Project panel first. |

For an unconfirmed or unknown outcome, the warning is retained and **Create another sequence** is disabled until **I checked the Project panel** is selected. This is the editor's acknowledgement, not an automated inspection. The service does not retry automatically. A deliberate new creation can still duplicate the previous attempt. Pending work, the last result and its acknowledgement survive sequence changes for the current panel session.

The panel shows concise result warnings and exposes the saved XML path for manual import or recovery. If the import receipt cannot be saved, it warns the editor to retain the displayed path before closing the panel.

## Generation files

The panel saves each generation beside the `.prproj`, under `Better Captions/<sequence-id-slug>/native-graphics-<generation-id>/`. It revalidates the captured project/sequence and generated XML before importing. It does not accept arbitrary XML or file paths from the panel action.

| File | Entry point | Purpose |
| --- | --- | --- |
| `graphics.xml` | Panel and CLI | A new sequence with native text graphics on V2 and empty V1. |
| `manifest.json` | Panel and CLI | Generation ID, phrase/source identities, exact source timing, frame ranges, requested appearance, warnings and original authoring data. |
| `source-plan.srt` | Panel and CLI | Plain phrase text/timing fallback. SRT has its own limited capability declaration. |
| `import-result.json` | Panel | Saved outcome, source identity, artifact paths, import-attempt state, warnings and any confirmed sequence identity. A receipt-save failure is reported separately. |
| `README.txt` | CLI | Manual import guidance, written last after the other files succeed. |

The manifest keeps `nativeImportVerified: false`, including when the panel reports `imported`. The receipt's `new-sequence-identity-and-settings` verification records a narrower host check and does not turn the retained source styles into verified native output.

## Run the example

From the repository root, with **Node.js 22.18+** and built-in TypeScript support; Node.js 24+ is recommended:

```sh
node scripts/native-graphics.mjs --session prototypes/native-graphics/fixtures/sample-session.json --output native-graphics-example
```

The output directory must be new and its parent must exist. The CLI accepts a saved `SessionState` or direct `NativeGraphicsPlanInput` JSON object, up to 8 MiB. It validates and plans before creating output, leaves the input unchanged, and rejects existing output files/directories. An I/O failure preserves incomplete output and reports its location; retry with a new directory.

The CLI writes the three generation files plus `README.txt`; it does not launch Premiere or produce an import receipt. Use **File > Import** to import `graphics.xml` into a scratch project, then open the new sequence and inspect the main Program Monitor, Properties and Effect Controls. Manual imports need the same visual checks as panel imports.

## What the writer transfers

The planner reuses character-based phrase grouping, keeps whole words and manual split/speaker/placement boundaries, and rejects overlapping source timing. Phrase ranges are rounded to sequence frames; zero-frame phrases fail explicitly. Integer and exact 1000/1001 NTSC rates are supported by the XML writer. The manifest retains original seconds and identifies rounding.

The XML requests phrase text, display-case conversion, frame timing, shared font family, size, regular/bold, left/center/right alignment and solid text color. Weights below 600 map to Regular; 600 and above map to Bold. Other exact weights remain in the manifest with a warning. The writer uses XML font style 0 for Regular and 2 for Bold, based on the measured Premiere importer behavior; this differs from Apple's example and is not a portable FCP guarantee. Missing fonts can be substituted by Premiere.

Titles begin at the frame center. Font-size normalization was measured on Premiere 26.5.2 at 1080p: XML size 32 produced the requested native size 72. Other hosts, frame sizes and fonts need native checks.

The manifest preserves source captions, words/timings, styles, animation, supplied transcript, saved geometry and legacy links. The following remain outside this writer's capabilities:

- Per-word font/color overrides and past/current/upcoming states, relative Bold, italic, stroke, shadow, current-word enlargement, letter spacing, opacity and caption backgrounds.
- Native bubble or other shape creation, including bubble padding and corner radius.
- Saved placement, independent text-box width/height, wrapping, dynamic reflow and geometry keyframes. Titles start centered; placement and any native keys must be set in Premiere.
- Text-property animation, word-state animation and automatic transfer of the saved animation configuration.
- Reconnection, automatic text/style updates, replacement of existing graphics or round-tripping native edits into the source manifest. Legacy movie/effect links are not treated as new graphic links.

Public XML mapping probes are separate experiments. A native control, a successful static import, or a manually added keyframe does not establish that the writer can generate that behavior. Other frame sizes/fonts, NTSC native import and macOS require their own host acceptance. The [Windows acceptance record](verification-windows.md) identifies the exact verified and outstanding cases.

## Windows native checks completed

Observed on **Premiere 26.5.2.5, Windows, 1920 × 1080, 30 fps**:

- The initial [Text fixture](fixtures/text-generator.xml) imported real **Graphics > Text** objects on V2 and rendered over empty V1.
- Direct text editing and adding a native Rectangle worked in Premiere's UI.
- Ordinary **Motion** Position X was keyed from 960 to 1060, and Scale from 100 to 85, at 0 and 2 seconds. At 1 second the readbacks were 1010 and 92.5. The saved project was closed and reopened, and the edits persisted.
- The [generated XML fixture](fixtures/generated-graphics.xml) imported two clips. Premiere confirmed the requested font size of 72.
- The installed panel's **Create native graphics** action saved generation files and an import receipt, then imported an independent two-second sequence. Its native Text controls showed Arial Regular, size 72 and the requested blue fill. Direct Program Monitor editing changed this panel-generated graphic to `Panel edit survived`; it persisted after saving, quitting and reopening the project.

The Rectangle and Motion keys were **manual UI additions**, not XML-writer features. These checks do not establish automatic shape creation, independent text-box resizing, complete word-state fidelity, or programmatic mutation/reconnection of existing graphics. The secondary panel action exports the current authoring snapshot; it does not convert the normal live-caption workflow into automatic native-graphics updates.

See the [Windows acceptance record](verification-windows.md) for exact operations, unverified cases and Windows SDK provenance.

## Validation and references

Current validation commands, exact test counts, build results and native acceptance observations are recorded in [verification-windows.md](verification-windows.md). That record also separates controller/transport tests from actions actually verified in Premiere.

The format follows [Apple's archived Text-generator subtitling example](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Applications/Applications.html). Adobe's [Premiere reference, XML import section](https://helpx.adobe.com/pdf/cs6/premiere_pro_reference.pdf) documents translation of FCP Text generators into titles; the current Graphics behavior above was verified locally. Adobe also documents [text properties](https://helpx.adobe.com/premiere/desktop/add-text-images/stylize-text/create-text-styles.html), [native shape creation](https://helpx.adobe.com/premiere/desktop/add-text-images/draw-objects/create-a-shape.html) and [Effect Controls keyframes](https://helpx.adobe.com/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/add-keyframes.html). Those UI capabilities are separate from what this exporter automates.
