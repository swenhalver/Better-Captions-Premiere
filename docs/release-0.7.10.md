# Better Captions 0.7.10 development build

The font field is now an autocomplete combobox with a scrollable list, keyboard
selection, search, an empty state and a font-list refresh action. It uses a local
catalog of installed families and faces rather than a browser datalist or a short
fallback font list. Opening the list exposes all families; typing filters it
without applying partial font names to the video.

The numeric weight menu contains only weights observed for the selected font,
including real variable-font ranges. Selecting a different family chooses its
nearest supported weight. Relative B retains the All words baseline and uses the
next available heavier weight. Arial 400 therefore steps to its installed 700;
a regular-only family has no heavier B step. An existing B can always be turned
off. No Regular/Bold labels are added to the numeric menu.

Italic is available for every selected family. Movie captions use the browser's
italic font matching/synthesis. The experimental native renderer now selects
installed CoreText faces and variable weights and synthesizes a measured italic
slant when no matching italic face exists. Native typography is persisted in the
bounded BCAP3 extension; older documents keep their original representation
until a typography edit upgrades them. Existing native parameter IDs, geometry,
keyframes and timing origins are preserved.

On macOS the installed catalog comes from fontconfig; on Windows it comes from
physical WPF font faces and OpenType weight metadata. Catalog failures are visible
and retryable. The browser review alone uses labeled synthetic fixture data.

Native-effect Razor timing, direct Program Monitor dragging and installed Windows
Premiere acceptance remain separate open items. The native effect is still an
experimental development build. See [Mac verification](mac-verification-0.7.10.md)
for installed checks and their limits.
