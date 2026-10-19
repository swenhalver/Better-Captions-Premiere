# Windows native graphics acceptance

Date: 2026-10-18 (some log timestamps fall on October 19 UTC). Host: Adobe Premiere Pro 26.5.2.5 on Windows. Sequence: 1920 × 1080, square pixels, 30 fps. All native checks used a separate scratch project containing synthetic text. Existing user projects were not edited. This branch extends the separate 0.7.11 snapshot; it is not a release of the newer native-effect branch. The draft pull request is unmerged and has conflicts with the advancing `swen/native-caption-effect` base. Standalone branch checks do not establish merge readiness.

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
| Import `fixtures/probes/origin-calibration.xml` | The center, right and up clips rendered in the intended directions. `origin=(.25,0)` moved text right and `(0,-.25)` moved it up. These are visual observations, not a general pixel-coordinate calibration; the writer still emits centered titles. |
| Import `fixtures/probes/text-parameter-keyframes.xml` | The keyed title remained white with native font size 81 at sequence 3:11 and 5:24. Source Text animation was off. The requested size 32→48 and white→red keys did not transfer. |
| Import `fixtures/probes/basic-motion-keyframes.xml` | At 0 and 2:05, ordinary Motion read Position (960, 540), Scale 100. At 2:05 Vector Motion also read (960, 540), 100, with animation off. The requested Basic Motion keys did not transfer in this fixture. |
| Import `fixtures/probes/fontstyle-calibration-0123-v1.xml` | Style 0 rendered upright and read Arial Regular, native size 72. Style 3 read Arial Bold Italic, size 72, in Effect Controls (its Program Monitor frame was not separately checked). The earlier style-1 origin fixture read Italic, and the generated style-2 fixture read Bold. The writer was corrected to request Regular using 0. This is measured Premiere behavior, different from Apple's example value list. |

The Better Captions panel was closed for these checks. Neither XML fixture references a movie, compiled effect, MOGRT or Dynamic Link item. The text objects and manually added shape are rendered and edited by Premiere. No After Effects application was used.

The native rectangle, text replacement and Motion keys above were **manual Premiere UI operations**. The exporter does not generate those edits. The existing installed panel/service was not uninstalled; the check establishes that these sequences render without opening or invoking them, rather than a clean-machine uninstall test.

## Boundaries

- The CLI and secondary Experimental panel action create independent new sequences. The ordinary live Apply flow is unchanged; native object reconnection is not implemented. Panel/backend automated checks are separate from the manual fixture observations above.
- The exporter does not request paragraph-box geometry. Native box creation, independent width/height changes and dynamic reflow have not passed acceptance for the generated output.
- Per-word font/color changes, three word states, active-word enlargement, bubbles, outlines, shadows and their animation are not transferred by this writer. The source manifest retains their supplied settings.
- The tested XML Text and Basic Motion keyframe fixtures failed to transfer animation. Manual native Motion keys passed the earlier persistence test. Those two results must not be conflated.
- Font sizing is measured only at 1080p in this Windows host. Other frame sizes, fonts, NTSC import and macOS native import require their own host checks.
- Program Monitor rendering and frame scrubbing were checked. Continuous playback, exported-frame comparisons and a standalone rendered-video export have not been verified.
- Generating a manifest always leaves `nativeImportVerified: false`. These manual observations apply to the listed fixtures and host; the writer cannot infer that a future import succeeded.

## Code validation

- Planner, XML and CLI tests pass as part of the final suite. Coverage includes source/frame timing, overlap rejection, character grouping, Unicode, escaping, the measured Regular/Bold mapping, preserved authoring intent and actual CLI no-clobber/error behavior.
- `npm run check`: **0 errors, 0 warnings**.
- `npm run build`: passed, with the existing build configuration warnings.
- Final full `npm test` after the Windows project-path and itemless-Graphics repairs, with the installed LLVM compiler configured: **852 passed, 0 failed, 0 skipped**. Coverage includes native generation retaining its busy state across sequence switches, extended local-drive host paths, Save As protections, strict caller-path validation and discovery alongside itemless native Graphics.
- `npm run package`: passed; produced the 0.7.11 CCX and Windows/macOS ZIP for this prototype snapshot.
- The first full run exposed a missing C++ compiler and six installed Airbnb Cereal faces containing U+007F in their family aliases. Visual Studio 2022 C++ Build Tools and the Windows SDK were then installed. The font catalog now excludes an invalid face while retaining valid faces; installed fonts were not changed. With `CXX` pointed to the installed LLVM compiler, all native-effect interop and real Windows catalog checks pass.
- The CLI was also run directly against `fixtures/sample-session.json`. It produced all four output files in a new directory and reported two phrases.

## SDK provenance

After the native XML tests, the user supplied the Adobe Developer Console SDK page and completed sign-in. The official Windows package was downloaded and extracted outside this repository:

- Package: `Premiere Pro 26.0 C++ SDK Windows.zip`, 2,353,431 bytes.
- Console selection: Premiere Plugin SDK, Windows, app version 2026, download v1 — February 2026.
- SHA-256: `a311cbc2613ded7842d79bd255b37a7d0a4d6e0331d0267e1f80e9edfb2dd2b4`.
- The archive contained 419 entries; extraction verified that all paths remained inside the SDK destination. `Examples/Headers/PrSDKAESupport.h` and Windows sample solution files are present.

No licensed SDK headers, sample implementations or archive are included in this branch. The XML writer does not compile against the SDK. A separate original development probe under `native/graphics-command-probe` compiles against externally installed SDK declarations.

Review of the bundled SDK guide did not establish a documented API to create or style standard native Premiere Text/Shape/paragraph layers. Its plugin compatibility table places AEGPs in After Effects only (PDF pages 32–33); custom titling importers provide importer-owned media and rendered imagery (pages 121, 135). These do not supply the requested native layer editor. The control-surface host command suite exposes command enumeration and execution, but no applicable graphics command ID or text/style/layer setters were established. The separate probe only enumerates; it has no command-execution path and is not part of the distributed panel package.

## Windows UI repair and compiler

Premiere's timeline, Effect Controls and dialogs initially painted white. Normal restart and workspace switching did not resolve it. With Premiere closed, its preferences and debug database were backed up. Changing only `Suppress D2D in Drover V7` from `false` to `true` in the debug database, followed by restart, restored the native panels. The setting persisted after a clean quit. Adobe staff document this [legacy GDI workaround](https://community.adobe.com/bug-reports-733/drawing-error-905919/index3.html). This confirms the successful workaround on this machine, not a diagnosis of a particular GPU driver.

The C++ toolchain installed successfully without a reboot requirement: Visual Studio Build Tools 17.14.42, MSVC 19.44.35229.0 and Windows SDK 10.0.26100.0. The original command probe built as an x64 DLL exporting `EntryPoint`. Both native CTests passed, including bounded enumeration, callback lifecycle, null handles, reentrancy and disconnect behavior. Premiere discovered the probe and allowed it to be configured as a control surface. Its runtime result is documented in the probe README; discovering the library alone does not establish a usable host command handle.

## Panel installation

The elevated UPIA command reported a successful 0.7.11 installation, but placed its files in the system plugin directory while its registration used `$localPlugins`. Premiere's UXP log resolved that token to the user plugin directory and failed to find the manifest. An older user-level 0.7.3 copy and its single-plugin registration were preserved in the Better Captions installation backup folder during diagnosis.

Opening the built CCX from normal Windows File Explorer and completing Creative Cloud's replacement prompt installed 0.7.11 in the user plugin directory and regenerated its matching registration. Creative Cloud then displayed 0.7.11 as installed; after restart, Premiere listed and opened Better Captions. No manual catalog-token edit was needed. The companion CEP service was also version 0.7.11.

The first panel check exposed a separate project-path issue: this host returned the saved local project as `\\?\C:\...`, which the strict ordinary-path validators rejected. The temporary diagnostic used to observe that value was removed from the installed panel after capture. Panel workflow acceptance below is separate from the successful installation result.

## Panel workflow acceptance

After normalizing the extended local-drive prefix only at host project reads, the installed panel correctly read the saved scratch project, its active sequence, 1920 × 1080 dimensions and 30 fps. General caller-path validators remain strict. The rebuilt CCX was installed through the same Creative Cloud desktop flow; installed UXP source hashes matched the build.

Two synthetic caption items totaling two seconds were loaded through the existing local agent interface, with Arial Regular, size 72, solid `#50B4FF`, and character cap 56. The actual **Create native graphics** panel button produced generation `38885911bdf0baeeaabc11c5936dbd48`. The saved `import-result.json` reported `imported`, the expected source identity, a new sequence identity and matching frame settings, with automatic retries disabled. XML, manifest and SRT were retained beside the project.

The phrase planner combined the two adjacent items into one 41-character phrase. Opening the generated sequence showed one native Graphics clip on V2, empty V1, and a two-second duration. The Program Monitor rendered `Created in the panel Editable in Premiere` in blue. Effect Controls exposed native Text / Source Text, Arial Regular and size 72. Direct Program Monitor editing changed it to `Panel edit survived`; the change remained visible after saving, cleanly quitting and reopening Premiere and the scratch project. This is a manual native edit after generation, not a round trip into the source captions.

The panel initially reported `Premiere did not expose a caption clip identity` while scanning these native Graphics. A bounded temporary host diagnostic established that the generated clip had a valid string TrackItem node ID but `projectItem: null`. Its four components were `AE.ADBE Opacity`, `AE.ADBE Motion`, `AE.ADBE Graphic Group` and `AE.ADBE Text`. The failure was the discovery code's unconditional ProjectItem ID requirement, rather than a missing TrackItem identity. The temporary diagnostic was removed after capture.

Discovery now skips legacy-media matching for unrelated clips with no ProjectItem, while retaining valid/unique TrackItem IDs, selection, scan bounds and native-component inspection. An exact saved caption node whose media item disappeared still fails; native-caption document write guards remain strict. After installing the final service and restarting Premiere, the same generated sequence initialized with an empty connection error, zero reconnect failures and idle output. Its saved native text still rendered. The text-only scratch sequence's separate no-audio transcription notice was expected and dismissed. Installed service source matched the final repository hash, and neither temporary diagnostic marker remained installed. This repair does not reconnect generated Graphics to their source caption session.
