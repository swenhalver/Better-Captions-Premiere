# Upcoming words during scrolling

The scrolling compositor used to discard words whose start time was later than
the current frame, even when their row was inside the scrolling viewport. It now
composes those words with the authored Next style, including opacity, typography,
margins and bubble joins. Existing viewport eligibility and scroll timing remain
in effect.

Validation on 2026-10-20:

- All three native CTest targets pass with AddressSanitizer and
  UndefinedBehaviorSanitizer, including actual CoreText pixel checks across four
  directions, four transitions and both wait policies.
- Explicit Next opacity zero removes the Next pixels without changing geometry.
- The shared scrolling/static geometry and pixel parity checks still pass.
- The full Adobe SDK build and adapter/helper checks pass. The installed native
  binary SHA-256 is
  `23790ac7207f6b2336a7684942b36d5d148540db7f176f25517ba59251d1463b`.
- Actual Premiere output at frame 15 of the 720-by-1280, 30-fps sequence changes
  from “All Right,” to “All Right, This Thing’s”. The same frame and authored
  styles were used before and after installation.
- Screenshot comparison: `artifacts/verification-upcoming/upcoming-before-after.png`.
- The disposable verification sequence was removed. The six original sequence
  graphs retain their clip identities, timing, components and parameters except
  for the user's concurrent character-limit/Smart-fit edits, which were retained
  (253 characters; Smart fit disabled).

Evidence files: `/tmp/bc-upcoming-before.json`,
`/tmp/bc-upcoming-cleaned.json`, `/tmp/bc-upcoming-old-on.png`,
`/tmp/bc-upcoming-new-on.png`.
