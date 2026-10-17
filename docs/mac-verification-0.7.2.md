# Mac verification: 0.7.2

Verified on 2026-10-17 using the character-grouping update in `a21cd5708c9ff71cd324f10a4cf77c79d054c188` and the sentence-marker fix in `f9553f81779002136965e8d98313c2fd7567f55f`.

Native environment: Premiere Pro 26.5.2 on macOS 26.6.2, Apple Silicon.

## Automated and installed checks

- Local macOS suite: 393 passes, zero failures, two Windows-only skips (395 total). New tests cover marker-only sentence edges through agent caption and per-caption position edits, retained false/absent markers and rejected non-Boolean values.
- Svelte validation: zero errors and zero warnings. Production panel, invisible renderer, CCX and full Windows/macOS package built successfully.
- Adobe UPIA confirmed installation of 0.7.2 while Premiere was closed. All 21 installed UXP/CEP runtime files matched the package/source bytes. The existing native preset library survived unchanged at revision 4, with an empty preset list.
- No new dependencies, permissions or network endpoints were added. The separate checkout's 16 in-progress files were preserved.

## Native Premiere acceptance

- A fresh Computer Use subagent reopened the exact saved project on the requested other display. The project opened without missing-media dialogs and the baseline yellow-bubble captions rendered in the Program Monitor.
- The legacy session adopted `maxChars: 56` and dropped `maxWords`, without regrouping. Caption text, IDs, timing, placement and clip/project-item links stayed unchanged; every other style and animation field matched the baseline.
- Both captions' six underlying native Motion properties, key ticks, values and easing readback matched exactly, including the user's Position key at frame 1. Evaluated Position/Width/Height at frame 1 also matched exactly. The native panel showed Characters per caption 56 and disabled Regroup for linked captions.
- In the separate, unlinked Fresh Speech verification sequence, the native 18-character control and Regroup produced five expected phrases. Undo restored all four original groups and their original word/caption timestamps. Changing to 100 characters and regrouping produced the two expected complete sentences. Every word and its original timestamps remained intact; no clips were inserted or rendered in this test sequence.
- The actual installed agent validator retained four true sentence-boundary markers and an explicit false marker through two caption-edit roundtrips. Restored the original four caption IDs, words, timings and absent markers, and reset the character limit to 56. Two derived `timingEstimated: false` flags were normalized by the editor; transcript content and timing were unchanged.

- Saved a disposable 0.7.2 preset through the native panel, changed the destination character limit to 14 and temporarily changed the current-word color. Native Apply restored all three complete resolved appearances, shared layout and animation while retaining the destination limit of 14. Restored the original limit of 56 afterward. The saved preset contains no grouping limit.

- Native **Update Program Monitor** successfully updated both existing caption clips. The full post-render comparison again matched every native property, key, easing value and frame-1 dimension exactly. Deleted only the disposable preset (library revision 6, empty list), restored the original look and limit, and saved the project with a clean title. All production media paths remained unchanged, all 92 absolute media references existed, and no temporary media links remained. The separate checkout's 16 in-progress files still matched their original hashes.

The complete native preset save/apply/rename/replace/duplicate/cancel/delete/restart suite passed on 0.7.0 immediately before this upgrade; see [that record](mac-verification-0.7.0.md). These checks cover one Mac project with separate linked and unlinked verification sequences. They do not establish native Windows acceptance or cross-project Mac acceptance. Program Monitor drag/resize was not retested during this update; native curves and frame-1 geometry were read and compared exactly.
