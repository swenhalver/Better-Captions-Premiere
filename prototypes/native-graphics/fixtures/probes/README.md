# Public XML mapping probes

These importer experiments were checked in a separate scratch project on **Premiere Pro 26.5.2.5 for Windows**, as recorded in the [Windows acceptance report](../../verification-windows.md). All use 1920 × 1080, 30 fps, synthetic text on V2, empty V1, Arial and no media references. They are separate from the production writer. Static XML font size 32 imported as native size 72; the keyed Text fixture had a different static result, recorded below.

| Fixture | Duration | Requested values and observed Windows result |
| --- | --- | --- |
| [origin-calibration.xml](origin-calibration.xml) | 6s | Three 2s clips request CENTER `(0,0)`, RIGHT `(.25,0)` and UP `(0,-.25)`. They rendered in those directions. This confirms axis direction visually, not a general pixel-coordinate calibration. The writer still emits centered titles. |
| [text-parameter-keyframes.xml](text-parameter-keyframes.xml) | 6s | The 3–6s clip requests size 32 and white at local frame 0, then size 48 and RGB(255,64,64) at frame 60. At sequence timecodes 3:11 and 5:24, the native title remained size 81 and white, with Source Text animation off. The requested size and color keys did not transfer. |
| [basic-motion-keyframes.xml](basic-motion-keyframes.xml) | 3s | Requests scale 100 and center (0,0) at frame 0, then scale 85 and center (.10,-.05) at frame 60. At 0 and 2:05, ordinary Motion remained Position (960,540), Scale 100. At 2:05, Vector Motion also read (960,540), Scale 100 with animation off. The requested XML keys did not transfer. |
| [fontstyle-calibration-0123-v1.xml](fontstyle-calibration-0123-v1.xml) | 8s | Four 2s clips request styles 0, 1, 2, 3, with size 32 and centered white text. Style 0 rendered upright and read Arial Regular, size 72. Style 3 read Arial Bold Italic, size 72, in Effect Controls; its Program Monitor frame was not checked. The earlier origin and generated fixtures established style 1 Italic and style 2 Bold. See the calibration notes below. |

The tested XML Text and Basic Motion keyframe encodings did not transfer animation on this host. Manual native Motion keys passed the separate persistence check in the acceptance report; that result does not validate XML keyframe import. Persistence of these probe imports is not established by the recorded checks. Other hosts, fonts, frame sizes and encodings require separate acceptance.

## Public format basis

- Apple's [Text/subtitling and Basic Motion examples](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Applications/Applications.html) supply the actual IDs: `Text`, `str`, `fontname`, `fontsize`, `fontstyle`, `fontalign`, `fontcolor`, `origin`, and Basic Motion `basic`/`scale`/`center`.
- Apple's [element catalog](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html) permits `filter` on `generatoritem`, numeric/color/point values and `parameter > keyframe > when,value`. A keyed parameter has no direct static `value`. Its [interpolation reference](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Interpolation/Interpolation.html) describes `FCPCurve`; these probes use zero in/out acceleration and no custom handles. They do not invent a `linear` interpolation identifier.
- Adobe's [XML import reference](https://helpx.adobe.com/pdf/cs6/premiere_pro_reference.pdf), printed page 114, documents FCP Text-to-title translation and Basic Motion/keyframe retention. That historical contract motivates these current-host probes; it does not prove animated Text properties translate.

There are no private effect payloads, scripts, external entities or guessed shape IDs. XML syntax, durations, IDs, keyframe locations and allowed parameter names were checked locally. The host observations above establish the tested mappings and the failed animation imports; syntactically valid XML alone does not establish host support.

## Font-style calibration

Apple's linked Text example explicitly lists `1=Plain`, `2=Bold`, `3=Italic`, `4=Bold/Italic`, with range 1–4. Zero is a deliberate Premiere importer probe outside that example's range. The fixture omits `valuemin`, `valuemax` and `valuelist`, matching the current writer, so it tests the same import path.

Live Premiere 26.5.2 on Windows confirmed `0 -> Arial Regular` in this fixture: Effect Controls read Regular and font size 72, and the Program Monitor showed upright text. Selecting the fourth clip confirmed `3 -> Arial Bold Italic`, size 72, in Effect Controls; the playhead remained on the first clip, so the rendered appearance of style 3 was not checked. Earlier observations were `1 -> Arial Italic` in the origin fixture and `2 -> Bold` in the generated fixture. The writer now uses 0 for regular weights and retains 2 for bold weights; it still does not transfer italic authoring intent. This mapping differs from Apple's declared example and is recorded as a Premiere importer calibration rather than a portable FCP contract.

## Possible three-state word output

The origin probe established visual axis direction, but the tested Text property keys were ignored. These results do not establish animated color/font/size states on a native Text generator. Stepwise state changes would need a separately verified encoding and timing behavior.

**Unimplemented alternative:** each word could use up to three non-overlapping static native Text clips: upcoming from phrase start to word start, current during the word, and spoken from word end to phrase end. Empty intervals would be omitted. This would be bounded at three clips per word, with up to one simultaneous layer per phrase word. A word edit would need to update its copies. Layout metrics, adjacent-word shaping/RTL, enlargement, line reflow, nesting and safe native reconnection still require separate design and acceptance. These fixtures do not implement or verify that approach.

**Shapes:** the reviewed Apple/Adobe sources do not establish an FCP7 Rectangle or rounded-rectangle generator ID that imports as an editable Premiere shape. Adobe documents [manual native shape creation](https://helpx.adobe.com/premiere/desktop/add-text-images/draw-objects/create-a-shape.html), which does not supply an interchange mapping. No shape generator is emitted here, and text glyphs are not claimed as native bubble shapes.
