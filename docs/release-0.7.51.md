# Better Captions 0.7.51

Native caption controls now stay synchronized with Effect Controls after an unconfirmed edit. Read-only polling continues, adopts the actual Premiere values and restores editing automatically after a successful read of the same caption clip. This includes Groups per page and Scrolling text Visible lines. No refresh button or manual reconnection is required.

The failed setter and queued edits are discarded and never replayed. Failed, stale or wrong-clip reads cannot resume writes. Verification failures now preserve a bounded failure reason instead of the previous generic message.

This panel/service update does not change the native rendering binary, caption text, geometry defaults or saved styles.
