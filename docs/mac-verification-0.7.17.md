# Mac verification — 0.7.17 outline/case

Installed the compiled Metal native renderer with Premiere fully closed. Native
uppercase rendering was observed in the Program Monitor. A direct bounded native
write/read confirmed lowercase version-4 document mode 2; the original document
was restored exactly afterwards. Original source words and timings were retained.

A pre-fix rasterizer test demonstrated glyph fill loss under thick outlines. The
fixed native core and Mac rasterizer passed their CTest cases, including clean
fill preservation, Unicode case, opacity and shadow combinations. TypeScript ↔ C++
version-4 byte round trips passed with legacy formats preserved.

Executable SHA-256:
7885264063f6b1cdda5606cbc27ea33138b2cade67a0ae1f12ebf8bbf9cfb1a8.
Metal shader SHA-256:
dd6d2a53a07ec92e8a43dcd9bab97c53f7370c7ea6e53e53a6dfe88827eff5bd.
