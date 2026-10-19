# Mac verification — 0.7.19

## Extension

A real production-sequence clone was created for the guarded-host acceptance test,
then deleted and the original sequence reactivated. Project returned to six sequences.
Original production caption text was not extended or replaced during this test.

- Existing caption: 76 words, physical end 33.583333 seconds.
- Enabled footage/audio target: 43.041667 seconds.
- Appended one synthetic verification word only on the temporary copy.
- Native host extension returned readbackVerified:true, same clip/project item,
  start and in-point, extended out/end. All 76 original word objects and all
  style fields compared exactly after decoding. Host confirmed protected effect
  parameters/keyframes and other timeline clips remained unchanged.
- Production read-only extension preflight also succeeded.
- This verifies the real clip-duration/document transaction. Installed-panel
  source-tail transcription/menu acceptance is recorded separately below when run.

Premiere window remained 2560×1409 at (-2560,1137), on the other display, with the
wider Effect Controls / Better Captions panel preserved throughout this pass.

## Installed panel and native preview

- Installed panel menu action **Extend captions** ran Premiere's built-in tail
  transcript path on a second temporary sequence copy. It appended 17 real words
  (76→93) and extended to43.041667 seconds. Every old word object/timing and style
  compared exactly; clip/source/start/in identities stayed unchanged. The panel
  displayed “Added 17 words. Existing edits preserved.”
- Groups per page typed to3 in the installed plugin reached the native scalar.
  With enough height and visible upcoming-word styling on the test copy, the
  Program Monitor displayed 3 consecutive phrase groups, each retaining the
  character-count break and width wrapping, with current-word highlighting.
- Selecting the effect title in Effect Controls displayed the blue area rectangle
  and 8 markers. The outline stayed visible after returning to Better Captions,
  followed native Position/Width/Height, and is drawn through UI events only.
  Premiere requires effect selection to route this overlay; selecting the clip
  alone did not initially activate it. There is no component-selection scripting
  method in the inspected host. No menu loops or preference toggles were added.
- On the test copy, Width keys 674 at 0s / 774 at 2s sampled 724 at 1s in both host and
  plugin. The animation indicator and previous/next buttons appeared. A real-host
  source-zero navigation failure exposed a Premiere evaluation issue in the
  combined directional condition; explicit branches fixed it and confirmed 0s / 674.
  Background-read navigation clicks also now queue once instead of disappearing.
- Both temporary test sequences were removed; original six sequences restored.
  After restart, all preexisting production graph fields matched exactly, with
  only the expected new Groups per page scalar (default 1) appended.

Installed native executable SHA-256:
84ea23bd4c859fe2ecd3513c34f1612017ad9871dd5c97927790549c931dc0aa.
Shader SHA-256 remains
 dd6d2a53a07ec92e8a43dcd9bab97c53f7370c7ea6e53e53a6dfe88827eff5bd.
CMake native core/Mac rasterizer 2/2 passed; compiled adapter, arbitrary-data,
appearance, draw-only UI, source-clock and Metal composite checks passed.
