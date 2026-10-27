# macOS verification — 0.7.52

The primary panel field previously edited Groups per page, while the effect's Visible lines was a separate scrolling parameter. Verified the reported mismatch live: groups = 1 and rollUpLines = 3. The primary field now reads/writes rollUpLines and is labelled Visible lines; its duplicate in Scrolling text is removed. Native Groups per page and existing saved values are unchanged.

Installed 0.7.52 and verified all installed UXP files against the CCX. Premiere's first restart removed stale prior plugin registrations during startup and could not resolve its old editor path. A second restart loaded the sole installed 0.7.52 registration successfully. The native renderer binary is unchanged.

Live acceptance used actual UI input: the primary plugin Visible lines value changed from 3 to 1; independent native readback and Effect Controls both showed 1. Changing Visible lines directly in Effect Controls from 1 to 2 updated the plugin automatically. Setting it back to 1 through the plugin returned native Visible lines = 1. All unrelated control descriptors matched the pre-test read, and the project was saved at its original playhead.

Evidence: artifacts/verification-0.7.52/plugin-visible-lines-one.png, effect-visible-lines-one.png, native-two-synced-to-plugin.png, final-receipt.json. Automated validation: 1,072 passed, two skipped, zero failed; Svelte/TypeScript check zero errors/warnings; build/package/install and diff whitespace checks passed.
