# Numeric text editing, 0.7.43

Characters per caption and inline caption timing now use text inputs with numeric
input modes and accessible spinbutton metadata. Native text editing handles
Backspace, forward Delete, selection shortcuts and horizontal caret movement.
The numeric action retains parsing, validation, Up/Down stepping and commit/cancel.
Enter followed by blur publishes only once.

Validation on 2026-10-20:

- 42 focused numeric, transcript and scrubbable-number tests pass.
- Full JavaScript suite: 1,033 passed, two skipped, zero failed.
- Svelte check: zero errors and zero warnings.
- Package 0.7.43 installed successfully. The installed client JavaScript,
  bootstrap and HTML match the CCX byte for byte.
- The new text field is visible in actual Premiere, without the old native
  number widget's spinner.
- Live forward-Delete testing was interrupted by concurrent Premiere input, so
  it is not counted as a completed keyboard verification. The test value was
  restored to the immediately preceding value, 252. Other project values and
  the user's latest playhead position were retained.
- Final graph readback retains all six original sequences and their clip,
  timing and effect state. The only changes from the initial task snapshot are
  the concurrent user character-limit and Smart-fit edits.

Adobe's same-version installer reported success while retaining the old 0.7.42
files. Bumping to 0.7.43 fixed that installation issue; matching package bytes
were checked before treating the installation as complete.

Evidence: `/tmp/bc-numeric-install43.log`,
`/tmp/bc-numeric-full-tests-final.log`, `/tmp/bc-numeric-check.log`,
`/tmp/bc-upcoming-final.json`.
