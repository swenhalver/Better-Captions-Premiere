# Mac verification — 0.7.20

Verification is in progress. Automated checks and real installed-host outcomes are
recorded below after completion; this file does not assert acceptance from source
compilation alone.

Automated checks before installation:

- Svelte check: zero errors and warnings.
- Full suite, concurrency limited to four workers: 928 tests, 926 passed,
  two platform-specific skips, zero failures.
- Native CMake ASan/UBSan core and real CoreText rasterizer: 2/2 passed.
- Impeccable detector on the changed transcript/scrolling components: no findings.
- A previous unconstrained run hit the existing 50 ms font-catalog fixture timer
  under concurrent native compilation; bounded-concurrency rerun passed.

Installed-host verification pending below.
