# Better Captions 0.7.22 — Smart character-count feedback

Smart line fit now updates the character-count field to an estimated capacity for
the current caption Width and typography. The estimate measures the transcript's
actual mix of letters with the largest current/upcoming/spoken appearance,
including native size and bubble-padding overrides and the existing 5% margin.
It follows Width/font changes and native animated values at the playhead.

The field is read-only while Smart fit is enabled; exact phrase grouping still
uses whole-word pixel measurements. Turning Smart fit off restores the saved
manual character limit. Missing font measurements show no invented number.

Styling sections are now actual keyboard-accessible tabs. Native Spacing exposes
pixel word spacing and line height; Outline and Shadow have working toggles.
Layout contains native Position, Width, Height and Groups per page controls.
Their contents use compact columns as the panel gets wider.

Left, center and right alignment icons appear in the normal All words controls,
with Lucide icons. They are hidden for Past, Current and Next. Native alignment
uses a newly appended Text alignment effect parameter, preserving all existing
parameter identities and default centered rendering. It supports keyframing.

This update requires both the panel/service and the updated compiled native
renderer. Caption documents, manual limits and existing keyframes are preserved.

Native Position/Width/Height updates now wake the service as soon as a request
arrives, with a 16 ms response check during interactive geometry requests.
Fresh gesture clocks, serialized/coalesced values and final-write flushing avoid
stale position writes while preserving native keyframes and validation.

Effect Controls now has Premiere-supported visual separators between typography,
phrase/page and roll-up sections. Existing word groups remain collapsible; no
parameter indexes, disk IDs or saved keys were changed.

Three browser-only interactive typography designs are available at `/?designs`,
including two independent Impeccable subagent alternatives based on the supplied
Mac rich-text toolbar references. They do not change the installed editor layout.
