# Windows native graphics acceptance

Date: 2026-10-18. Host: Adobe Premiere Pro 26.5.2.5 on Windows. Sequence: 1920 × 1080, square pixels, 30 fps. All native checks used a separate scratch project containing synthetic text. Existing user projects were not edited.

## Verified in Premiere

| Input / action | Observed result |
| --- | --- |
| Import `fixtures/text-generator.xml` | A six-second sequence containing two native Graphics clips on V2, with empty V1. The Program Monitor rendered the title over the empty lower track. |
| Inspect the first imported graphic | Effect Controls exposed Graphics, Vector Motion, Text and ordinary Motion. Text exposed native font and appearance controls. |
| Edit the text in the Program Monitor | The title changed to `Native edit survived`. This was an editable native text object. |
| Graphics and Titles → New Layer → Rectangle | A native `Shape (Shape 01)` layer was added inside the graphic. |
| Add ordinary Motion keys at 0 and 2 seconds | Position changed from (960, 540) to (1060, 540); uniform Scale changed from 100 to 85. At 1 second the controls displayed Position (1010, 540), Scale 92.5, with corresponding movement and scaling in the Program Monitor. |
| Save, close and reopen the scratch project | The edited text, native rectangle and Motion keys persisted. The intermediate values remained visible at 1 second. |
| Import `fixtures/generated-graphics.xml`, produced by the exporter | A new sequence contained two native graphics covering frames [0, 90) and [90, 180). The first title read `Native titles stay editable`, in Arial Bold with blue fill. |
| Inspect the generated title's font size | XML size 32 imported as native size 72, confirming the writer's 1080p calibration. The initial fixture's raw XML size 72 had imported as native size 162. |

The Better Captions panel was closed for these checks. Neither XML fixture references a movie, compiled effect, MOGRT or Dynamic Link item. The text objects and manually added shape are rendered and edited by Premiere. No After Effects application was used.

The native rectangle, text replacement and Motion keys above were **manual Premiere UI operations**. The exporter does not generate those edits. The existing installed panel/service was not uninstalled; the check establishes that these sequences render without opening or invoking them, rather than a clean-machine uninstall test.

## Boundaries

- This is a CLI interchange prototype, not a released plugin workflow. There is no panel Apply integration or native object reconnection.
- The exporter does not request paragraph-box geometry. Native box creation, independent width/height changes and dynamic reflow have not passed acceptance for the generated output.
- Per-word font/color changes, three word states, active-word enlargement, bubbles, outlines, shadows and their animation are not transferred by this writer. The source manifest retains their supplied settings.
- Native Source Text animation and word-range editing were explored in the scratch project but are not counted as completed acceptance tests here. In particular, the visible Source Text stopwatch does not establish that XML font-size or color keyframes import correctly.
- Font sizing is measured only at 1080p in this Windows host. Other frame sizes, fonts, NTSC import and macOS native import require their own host checks.
- Program Monitor rendering and frame scrubbing were checked. Continuous playback, exported-frame comparisons and a standalone rendered-video export have not been verified.
- Generating a manifest always leaves `nativeImportVerified: false`. These manual observations apply to the listed fixtures and host; the writer cannot infer that a future import succeeded.

## Code validation

- `node --test tests/native-graphics-plan.test.mjs tests/native-graphics-xml.test.mjs tests/native-graphics-cli.test.mjs`: **31 passed**. Coverage includes source/frame timing, overlap rejection, character grouping, Unicode, escaping, preserved authoring intent and actual CLI no-clobber/error behavior.
- `npm run check`: **0 errors, 0 warnings**.
- `npm run build`: passed, with the existing build configuration warnings.
- Full `npm test`: **815 tests, 812 passed, 3 failed**. One native-effect interop test could not start `clang++`; no usable C++ toolchain was found. Two real Windows font-catalog checks rejected six installed Airbnb Cereal faces whose family aliases contain U+007F. These failures predate the prototype changes. Compiler and font installations were not changed.
- The CLI was also run directly against `fixtures/sample-session.json`. It produced all four output files in a new directory and reported two phrases.

## SDK provenance

After the native XML tests, the user supplied the Adobe Developer Console SDK page and completed sign-in. The official Windows package was downloaded and extracted outside this repository:

- Package: `Premiere Pro 26.0 C++ SDK Windows.zip`, 2,353,431 bytes.
- Console selection: Premiere Plugin SDK, Windows, app version 2026, download v1 — February 2026.
- SHA-256: `a311cbc2613ded7842d79bd255b37a7d0a4d6e0331d0267e1f80e9edfb2dd2b4`.
- The archive contained 419 entries; extraction verified that all paths remained inside the SDK destination. `Examples/Headers/PrSDKAESupport.h` and Windows sample solution files are present.

No licensed SDK headers, sample implementations or archive are included in this branch. This prototype uses the public XML interchange format and does not compile against the SDK.

Review of the bundled SDK guide did not establish a documented API to create or style standard native Premiere Text/Shape/paragraph layers. Its plugin compatibility table places AEGPs in After Effects only (PDF pages 32–33); custom titling importers provide importer-owned media and rendered imagery (pages 121, 135). These do not supply the requested native layer editor. The control-surface host command suite does expose command enumeration and execution, but no applicable graphics command ID or text/style/layer setters were established. A compiled command probe would need separate runtime verification; it is not part of this exporter.
