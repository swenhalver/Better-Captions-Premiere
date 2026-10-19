# Better Captions 0.7.10 — Mac development verification

Status 2026-10-18: source, browser, compiled-renderer and installed Mac checks
passed for the font and transcript interface. UXP/CEP 0.7.10 was installed through
Adobe's installer and Premiere was restarted on the other display. Native-effect
Razor timing and Program Monitor handle dragging remain separate open items.

## Font catalog and browser checks

The actual Mac font catalog returned 864 families, including 93 real continuous
variable ranges. Arial reported weights 400/700 and an italic face. Bebas Neue
reported only 400 and no italic face. Aliases, localized names, names containing
commas and fractional weights are preserved. The largest actual family name on
this Mac is 42 characters and fits the native document's font-name bound.

The production picker was exercised in Chrome Beta through the existing local
debug bridge on an owned temporary review tab. The browser wrapper explicitly
labels its synthetic fixture data. Search narrowed to Impact, Enter selected it,
the weight menu exposed only 400, and Italic remained enabled. Selecting Arial
exposed 400/700; relative B retained base 400 and enabled the next heavier face.
At 360px and 1000px viewport widths with a 280px panel, the popup stayed within
the viewport, all six fixture families were reachable and no horizontal overflow
was found. The temporary tab was detached and closed after testing.

The transcript interface was exercised in the production browser wrapper at
280px and 360px panel widths. Direct sentence edits retain their appearance and
clicked caret position; commit, Escape and Undo preserve the intended text.
Inline caption timestamps, directly draggable unselected word edges, one-frame
numeric spinners, whole-word translation and collision shrinking all passed.
The minimum edited duration is three frames, neighbours stay fixed, and touching
edges can be separated. Fit content fills the available width; vertical wheel
input changes zoom around the pointer. No panel overflow was found.

Svelte/TypeScript reports 0 errors and 0 warnings. The complete JavaScript suite
passes 781 tests: 779 pass, 2 Windows-only skips, 0 failures. The production panel
and service build and 0.7.10 CCX/Windows-macOS packaging pass. The design scan
found no mechanical findings in the edited UI. Startup-heartbeat tests use a
manual clock so host-launch load cannot turn a 15ms test wait into a grace expiry.

## Compiled native checks

The official-SDK arm64 candidate is signed and verified, with all diagnostic and
custom-UI probe flags disabled. Its executable SHA-256 is:

`6312eaabae8795ca9f4efa20a116cac9bf11f09c299b18e0368518ed7f62f74d`

Core/CoreText sanitizer tests passed. Real CoreText checks include Arial 400/700
face selection, relative B, a variable Arimo weight of 511.3, and synthetic Impact
italic with changed glyph pixels. The dynamically loaded SDK adapter smoke also
renders BCAP3 typography. Existing arbitrary-data/style/source-time tests pass.
BCAP1/2 no-op roundtrips retain their original bytes; edited typography upgrades
to the bounded BCAP3 footer without renumbering native parameters.

The typography build used an isolated source copy with the other chat's timing
probe edits excluded. It does not claim to resolve that investigation's Razor
failure. Native handle dragging and installed Windows acceptance also remain open.

## Installed acceptance

Testing used Premiere 26.5.2 and the saved scratch project `Native Effect Scratch`,
with the existing native adjustment-layer caption selected. The panel reconnected
automatically after restarting. Its font catalog returned all 864 actual Mac
families without an error. The installed UXP/CEP payload matched all 23 shipped
files; the normal signed native executable matched the hash above.

In the actual Premiere panel, typing Impact narrowed the autocomplete list to
one result; Enter selected it. Its numeric weight was 400, B was unavailable
because no heavier face exists, and Italic remained enabled. Enabling Italic
changed 13,784 pixels in two consistently exported native frames. This proves
native synthetic slant rendering; those exports are not a timing acceptance test.
Selecting Arial and enabling B retained the 400 baseline and persisted relative
weight mode. Actual family metadata and compiled face checks establish its 700
heavier face; a manual 700 dropdown selection is not claimed here.

Moving Premiere's CTI to 3.25 seconds updated the panel to 3.25 without saving or
rendering captions. An unselected word's end edge was dragged directly from 6.0
to 5.766666666666667 seconds while its neighbour stayed at 6.0. A middle word was
dragged into its neighbour and saved at 3.9–4.0 seconds at 30fps: exactly three
frames. The same values were read back from the actual native BCDOC1 carrier.
Vertical wheel input over the installed word lane changed Fit content to 150%
and back. A first/last-word envelope guard discovered during this acceptance is
fixed in the follow-up 0.7.11 build. See [0.7.11 verification](mac-verification-0.7.11.md)
for installed acceptance of that fix.

All test edits were restored to the exact original native carrier. The complete
graphs of all 22 scratch sequences and 118 clips matched the pre-install capture,
including component parameters and keyframes. The closed production project's
SHA-256 remained `c4259feec4b32e0a52c1f2a72ef9f049626d74133fa91fee1d2788a62cd97d03`.
Premiere remained on the other display after each native test. Detailed receipts
are in `/tmp/better-captions-verification/mac-font-0710/`; those temporary files
are local evidence and are not packaged as user assets.
