# S-Captions 0.7.53

The plugin panel and native effect are now named **S-Captions**. Existing plugin IDs, native effect match name, parameter IDs, stored caption documents, asset folders and installation paths are retained. Native effect creation supports both the new display name and an older installed native effect.

Scrolling pauses now add empty rows progressively at the pause cadence (0.6 seconds by default), capped at **Visible lines**. With two visible lines, a long enough pause adds two empty rows and clears the prior speech. Shorter pauses add fewer rows. Non-scrolling caption pages retain their existing single separator. No transcript words or timings are changed.

The main layout field remains **Visible lines**, synchronized automatically with the same native Effect Controls parameter (1–8). Polling recovers automatically after an unconfirmed update without replaying a failed write.

For development restarts, use the [S-Space test launcher](premiere-test-launch.md). It opens the saved project hidden, verifies that its windows are on S-Space, and reveals it without activation. Normal Premiere startup preferences are unchanged.
