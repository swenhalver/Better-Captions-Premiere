# Better Captions 0.7.10 — Mac development verification

Status 2026-10-18: source, browser and isolated compiled-renderer checks passed.
Installed Premiere acceptance is pending coordinated host access; the separate
native timing investigation is using Premiere. This record must not be interpreted
as proof that 0.7.10 has already been installed.

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

Svelte/TypeScript reports 0 errors and 0 warnings. The complete JavaScript suite
passes 730 tests: 728 pass, 2 platform skips, 0 failures. The production panel and
service build and 0.7.10 CCX/Windows-macOS packaging pass. The design scan found
no mechanical findings in the edited UI.

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

Pending host handover. Final installation must compare the shipped UXP/CEP files
with installed copies, verify the native executable hash, open the actual picker
in Premiere, select a real installed family and check supported weights/italic
rendering while preserving the saved production project and the other display.
