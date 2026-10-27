# Better Captions 0.7.52

The main native layout section now uses Visible lines and reads/writes Premiere's actual Visible lines stream (rollUpLines), with its native range of 1–8. Previously this main field was Groups per page, a separate parameter ignored by scrolling. The duplicate Visible lines field in Scrolling text is removed. Native defaults, keyframes, reset and automatic polling remain on the same Visible lines stream. Existing Groups per page values and the native parameter/API remain unchanged.
