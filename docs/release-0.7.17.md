# Better Captions 0.7.17 — clean outline layering and display case

The native renderer draws the outline beneath a separate clean fill at the same
font, position and baseline. The stroke no longer paints into the glyph interior
or makes the selected font look thinner. Shadowed text composites the outline and
fill together before casting one shadow. Outline opacity zero preserves the exact
clean text pixels; zero word opacity hides both passes.

Uppercase and Lowercase are enabled in the plugin’s shared All words case
selector. Together with As typed and Title Case, they change the display without
rewriting source words, word timings or manual splits. Mac upper/lower conversion
supports Unicode, including length-expanding cases such as Straße → STRASSE.
Per-state case differences remain unsupported; the case setting is shared.

The native document reader remains compatible with versions 1–3. Upper/lower
styles use an additive version-4 display-mode field; untouched older documents
remain byte-identical. Install the updated native effect with the panel before
using the new modes. Older native binaries cannot read version-4 documents.

This update requires both the 0.7.17 panel/service and the separately built Mac
Metal native effect. The panel installer does not replace the native binary.
[Mac verification](mac-verification-0.7.17.md) records the installed acceptance.
