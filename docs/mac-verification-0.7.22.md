# Mac verification — 0.7.22

Automated: 949 tests, 947 passed, two skips. Svelte check zero errors/warnings.
Real SDK and Metal checks passed. Installed CCX all 18 entries matched exactly.
Native binary SHA256: d7c320ca6493076ea839643002df76886ea8b100dab6ca5ed56d1a96af55906b.

Installed acceptance on disposable sequence ae1cdd12-64a4-4454-b4db-ff992ee6c0af:
- Actual spacing/outline/shadow/layout tabs and All-only alignment loaded.
- Wide Layout exposes two columns with draggable values.
- Plugin Position X edit reached native readback and moved text.
- Native blue bounds became visible after selecting the Better Captions effect
  header, remained visible after returning to the plugin, and followed edits.
- Native UI diagnostics confirmed real COMP DRAW calls and successful drawing.
- No overlay/workspace preference changes were needed.
- Remaining latency measured 582ms for one edit and 221–296ms for reads. A
  subsequent native property-indexing fix belongs to 0.7.23; no smoothness claim.
- Premiere stayed on the other display at (-2520,1146), 2560x1409, wide left pane.

Production sequence preservation is checked with the subsequent final build.
