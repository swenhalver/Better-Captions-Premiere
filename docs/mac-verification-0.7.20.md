# Mac verification — 0.7.20

Native runtime source: `f71c08ff5b9f05bf2698726a13ac3c7e6f9ab8e8`.
Panel source: `910789b96b86fabc487204152fe41c56f7ae69d9` (no subsequent panel changes).

## Automated checks

- Full suite, concurrency limited to four workers: 928 tests, 926 passed,
  two platform-specific skips, zero failures. Svelte check: zero errors/warnings.
- Native CMake ASan/UBSan core and real CoreText rasterizer: 2/2 passed,
  repeated after the final transition-legibility change.
- Actual C++ document/encoder contract: 21/21 passed after that change.
- Final SDK build passed compiled PF adapter, arbitrary-data, render-style,
  source-clock, draw-only custom-UI and actual Metal compositor checks.
- Impeccable detector on the changed transcript/scrolling components: no findings.
- An earlier unconstrained suite hit an existing 50 ms font-catalog fixture timer
  under concurrent native compilation. The bounded-concurrency full rerun passed.

## Installed Premiere checks

Installed the compiled native bundle, UXP panel and invisible CEP service, then
reopened the saved project. Compared all 17 CCX payload files with installed UXP
files; every file matched, and the installed host bridge matched source exactly.

- Final executable SHA-256:
  `d32bb806350b7dda74c0ee247b83ddfc691246317029f45c9f0be7eb71cc0125`.
- Metal shader SHA-256:
  `dd6d2a53a07ec92e8a43dcd9bab97c53f7370c7ea6e53e53a6dfe88827eff5bd`.
- Read back all 13 appended native controls with neutral defaults. In particular,
  **Wait for line to finish = 1**, while Smart and scrolling are initially off.
- Used a temporary sequence clone for every style/geometry/keyframe/transition
  mutation. The original caption carrier remained byte-for-byte unchanged.
- Clicked Smart line fit in the installed panel: native scalar became 1, the
  transcript list changed from 16 to 32 measured phrases, and Program Monitor
  showed a one-line phrase. Source words/timings/styles/splits were unchanged.
- Opened Styling → Scrolling text; enabled it, then chose Fade, Slide and Pop
  through the actual panel. Native values read back as 2, 3 and 4 respectively.
- Confirmed right direction, 2× speed and wait-off native readback. Captured
  rightward scrolling with the default wait-on behavior over the original video.
- First Fade check revealed shared-history duplication and an incoming highlight
  camouflaged by the outgoing line. Fixed this before finishing. Rebuilt and
  reinstalled the final renderer. Real Program Monitor frames now show each
  retained word once and the green current word at its configured opacity in
  Fade and Pop, plus a readable current word during Slide. Core and pixel
  regressions cover this case.
- Native Width keys on the copy: 674 at 0 s and 774 at 2 s. At 1 s the plugin
  displayed 724 and its animation indicator. Clicking its Previous button moved
  Premiere to 0 s / 674; Next moved to 2 s / 774. These were real installed UI
  actions, not synthetic browser events.

## Preservation and cleanup

Removed the temporary validation sequence, reopened the original All Clips
sequence and saved. All six original sequence graphs match their pre-install
snapshot exactly after excluding the 13 newly appended default parameters. This
includes every existing clip identity, source, timing, caption carrier, parameter
value and keyframe. The original Word-count/Width/Height changes were retained.

Premiere remained on the other display at `(-2560, 1137)`, size `2560 × 1409`,
after tests and both restarts. Effect Controls/Better Captions retained their
approximately 774 px panel width. The temporary MCP bridge startup source change
was restored to its original SHA-256 `e29f1ec96b8197c953140a69de7134fe22652215d4efdd1fac168ae4bc4a7a93`.

Readbacks and screenshots are local ignored artifacts under
`artifacts/host-scratch/smart-scroll-0.7.20/` and `/tmp/bc-0720-*`.
The QE export-frame helper produced a different timestamp than requested and
was not used as evidence; Program Monitor screenshots and native source-clock
readbacks were used instead.

Native caption bounds remain draw-only and require selecting the native effect
heading once in Effect Controls to activate Premiere's custom overlay. Installed
Windows acceptance is not claimed by these Mac checks.
