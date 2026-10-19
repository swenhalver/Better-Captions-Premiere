# Mac verification — 0.7.23

Verified in Premiere Pro 26.5.2 on Apple Silicon macOS. The installed CCX's 18
entries matched the package byte for byte; the native binary SHA-256 was
`39cb579ce16880d58981fed8c596323b42658fdcca6be36ae19ee4015ddeb0ee`.

The installed Mac ribbon, direct HSLA background popup and geometry controls
were checked in a disposable sequence. Enabling Color spaces changed only the
current-state flag and BCAP version 3 to 5; all caption text, timings and other
styles remained identical. Program Monitor screenshots confirmed the native
bubble extended across the following space. The original carrier was restored.

The blue Program Monitor bounds appeared after selecting the native effect's
header in Effect Controls, and remained visible after returning to Better
Captions and changing position. Clip selection alone did not activate them.
No public CEP, UXP or inspected QE component API exposed effect-header activation.
Automatic activation from the panel remains unresolved.

Installed service request measurements were 186–203 ms for reads and 555 ms for
one successful geometry edit. The one-pass property lookup did not materially
resolve the perceived drag latency. These are actual host measurements, not a
claim of smooth real-time updates.

The full JavaScript suite passed 965 tests with two expected skips; Svelte
reported zero errors and zero warnings. Native core/raster checks passed with
ASan/UBSan. All six production sequence graphs matched the preservation baseline.
Premiere remained on the other display with the wide left panel preserved.
