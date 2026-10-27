# 0.7.104: Lines scroll in at one speed

**Blank rows no longer change how fast a line comes in.** With vertical Scroll and Wait for line on, every move now follows one profile. A one-row move is the same ordinary scroll as before. A move through several rows eases in like the first half of an ordinary scroll, cruises at that scroll's top speed (1.5 rows per Transition duration ÷ Speed), and eases out like its second half. Each extra row adds two thirds of an ordinary scroll. So a line after three Pause rows arrives at the same speed as a line after none; it just travels further.

Gone from 0.7.101: blank runs paced by their shortest blank, glides squeezed to meet the next line's first word, earlier moves sped up to finish together, and stops on each blank. Blank rows (Pauses, empty lines, the opening's leading slots) never stop a move; it glides through them and stops on the next text line.

**Trade-off.** A text line that is still being spoken holds the move until its time ends. A short line that has already ended by the time the move would pass it joins the move instead of stopping it. Because nothing speeds up to catch up, a short line can start highlighting while it is still moving into place. Word timing is never changed: highlights keep their own times.

A Transition duration of 0 steps at the exact trigger. Other transitions, Wait for line off and horizontal pages are unchanged, and seeking lands on the same frame as playing.

**Tests.** Core unit tests cover 0 to 3 blanks, unequal, short and long durations, Speed 0.5, 1 and 2, one-row parity with ordinary scrolls, the shared cruise and ending profile, holds, the opening, seeking and the document staying unchanged. The 0.7.101 timing expectations were updated to the new profile, and the compiled adapter smoke test now checks Pause Line Length at 3.1 s, while both runs are still moving, instead of at 4.5 s, where both have now correctly settled on the same frame. `npm test` and `npm run check` pass, and the native effect is rebuilt. The motion still needs to be checked inside Premiere.
