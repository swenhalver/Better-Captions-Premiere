# 0.7.105: Lines arrive just before they are spoken

**A pause now keeps the finished line in place instead of bringing the next one in early.** With vertical Scroll and Wait for line on, each move is timed back from the line it stops on: it settles 0.1 s before that line's first word. In the reported cue (four visible lines, current line 2, 0.18 s at 0.7x, Pause line length 0.5), "All right, that's $160" ends at 15.227 s, followed by two authored blank rows, then "and we'll get this" at 16.875 s. That three-row run takes 0.6 s. It used to leave at 15.227 s and settle at 15.827 s, more than a second early. Now "…$160" holds in the current slot until 16.175 s, the run glides through both blanks without stopping, and "and we'll get this" settles at 16.775 s.

**Same rate as 0.7.104.** Only the departure moves. Every run still eases in, cruises at 1.5 rows per Transition duration ÷ Speed, and eases out, with each blank row adding two thirds of an ordinary scroll. Blank rows never stop a run.

**No-gap fallback.** A run never leaves before the line it leaves has ended, nor before the previous run has settled. When either comes later than the timed departure, the run leaves then at the same rate, and the line arrives after its first word, whose highlighting keeps its own time. Back-to-back lines therefore scroll exactly as before.

**Brief lines.** A run that reaches a line which has already ended carries on past it, unless that would bring the next line in early. Then it stops on the brief line, which holds through the pause until the next run is due.

**Opening and trailing blanks.** The opening run through the leading slots also waits, so the first line settles 0.1 s before it is spoken. Trailing blanks still go as soon as the last line ends.

A Transition duration of 0 steps through every blank at once at the same due time. Fade, Slide and Pop, Wait for line off and horizontal pages are unchanged, and seeking lands on the same frame as playing.

**Tests.** Core unit tests cover the reported cue from its saved document (two authored blanks) and a separate synthetic one-pause version, both in both directions, plus the 0 to 3 blank cases with the new departure, a brief line before a long pause, capped gaps, Transition duration 0, leading and trailing blanks, line position styles and the blank-state check. The compiled adapter smoke test now checks Pause Line Length at 5.2 s, while both runs are still moving toward "After." at 5.39 s. `npm test` and `npm run check` pass, and the native effect is rebuilt. The motion still needs to be checked inside Premiere.
