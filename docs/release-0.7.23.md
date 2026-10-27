# Better Captions 0.7.23 — Mac ribbon and direct HSLA styling

The styling interface follows the selected Mac rich-text ribbon design: shared
Bold/Italic segments, foreground/background swatches, font search, supported
numeric weights, draggable size and line-height values, compact case selection,
and All-words alignment. Case menus use complete option names.

Swatches open direct HSLA sliders and draggable channel values. Alpha controls
opacity without a second operating-system color dialog. The background popover
also contains bubble enable, padding, corner radius and Color spaces between
words. Spacing, Outline, Shadow and Layout remain compact detail tabs.

Color spaces is independent for past/current/upcoming words. It extends the
bubble over the following same-line gap without changing wrapping, text origins
or Smart fitting. Enabled documents use BCAP v5; existing v1–4 documents remain
byte-identical until this option is enabled. Transcript extension supports v5
while preserving existing edits, manual splits, styles and native keys.

Native geometry reads now index properties once per checked context, replacing
repeated native property scans. The immediate request wake and interactive
response checks from 0.7.22 remain, with full serial validation and readback.

Requires the updated compiled native effect alongside the panel and service.
