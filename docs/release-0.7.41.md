# Better Captions 0.7.41

Native Effect Controls use collapsible Layout, Text style, Word styles, Caption grouping and Scrolling text sections. Existing disk parameter IDs and underlying stream types remain stable. Enum and toggle fields use named native controls.

Layout edits use a transient rendered cyan bounding box, independent of Effect Controls selection. A short lease and background-service cleanup remove the guide after editing stops. This temporary guide affects rendered frames while active; it is cleared before normal settled output.
