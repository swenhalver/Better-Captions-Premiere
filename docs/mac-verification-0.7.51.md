# macOS verification — 0.7.51

On 2026-10-20, installed the packaged UXP panel and CEP service and restarted Premiere Pro 26.5.2 after saving the open project. Every installed UXP file matched the final CCX, and the installed host JSX matched source.

The confirmation banner could not be reproduced on the current static Groups per page write. Live native writes to Groups per page = 2 and Visible lines = 3 returned verified receipts; independent reads confirmed each, with unrelated controls unchanged. The source defect was confirmed: a BC_OUTPUT_UNCONFIRMED response permanently prevented the controller's polling reads and later edits.

The controller now keeps polling after an uncertain write. A successful read of the same clip adopts actual native values and clears the write block automatically. The failed setter and pending edits are discarded, never replayed. Failed, stale and wrong-clip reads cannot resume writes. No manual refresh UI is required.

After restart, the installed panel visibly showed Groups per page = 2 and Visible lines = 3 with no error. An external native Visible lines change from 3 to 4 automatically appeared as 4 in the panel without a refresh or panel interaction. Restoring the native value to 3 automatically appeared as 3. The final native controls receipt exactly matched the pre-test receipt; the project was saved and left open at the same playhead.

Evidence is local under artifacts/verification-0.7.51: panel-synced.png, external-lines-four.png, and final-control-receipt.json. No native renderer binary was changed. Automated validation: 1,070 passed, two skipped, zero failed; Svelte check reported zero errors and warnings; build, package, installation, and git diff whitespace checks passed.
