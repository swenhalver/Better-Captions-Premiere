# 0.7.101: Scrolling glides through blank lines, and the line list stays put while typing

**Blank lines no longer make scrolling stop on each one.** With plain Scroll, Up or Down, and Wait for line on, a run of blank lines (typed empty lines or the pause lines made from silence) is now one smooth move. The line being spoken stays in place until it ends. The captions then glide through every blank line without stopping and stop when the next spoken line reaches the current line's slot. Blank lines keep their spacing, and word times, highlighting and line positions are unchanged.

The glide takes one step per blank line at that line's own length, adjusted by Speed, and never takes less than one ordinary scroll. The next line is never late: if the gap is shorter than that, or Speed is slow, the glide speeds up to arrive when the line starts. Short lines spoken just before the blank lines that are still scrolling into place also finish by then, so the next line no longer arrives after its first words.

Fade, Slide and Pop, sideways scrolling, Wait for line off and pages work as before.

**The line list no longer jumps while you type.** Each time Premiere confirmed an edit, the panel re-read the pause controls, and until that read returned it briefly forgot them. The pause rows vanished, the list got shorter and the browser moved the scroll position far above the line being typed. The panel now keeps the last pause settings it knew for the same connected caption layer until the fresh ones arrive. A different sequence or layer, or a disconnected one, never reuses them.

**Test launcher.** The S-Space test launcher no longer asks S-Space to claim Premiere's windows, since S-Space no longer routes them. It still keeps Premiere hidden until each window has been placed and matched exactly, and still refuses to open on the main display.

**Tests.** Several native and panel tests still assumed rules changed in recent releases: Current line counting from the top (0.7.94) and fades always running from 0% to 100% (0.7.93). They were updated to test the same behaviour under those rules. Panel test harnesses gained the small fakes that the diagnostic viewport sample from 0.7.100 needs. The native core, line position, rasterizer and scroll-spacing suites, sanitizer builds, `npm test` and `npm run check` pass. The glide and the steadier line list still need to be checked inside Premiere.
