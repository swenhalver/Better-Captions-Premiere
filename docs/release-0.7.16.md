# Better Captions 0.7.16 — native phrase grouping

The native-effect panel now displays the transcript as character-limited phrase
rows instead of one long paragraph. The source remains in one physical Premiere
clip until manually split. Existing native clips gain phrase rows when reconnected;
no retranscription or caption replacement is required.

Caption grouping includes Characters per caption and Regroup in the plugin.
Changing the limit updates the editor and the native effect live. Effect Controls
and the plugin read the same static parameter. Animated character limits remain
in Effect Controls so their keyframes are preserved.

Grouping matches the native renderer’s punctuation, sentence boundaries,
0.6-second pause rule and Unicode scalar count. An oversized single word stays
whole. Regrouping alone never rewrites the embedded transcript, word times,
geometry, keyframes or clip identity. Conflicting or unconfirmed parameter writes
stop instead of retrying automatically.

The native Metal binary is unchanged. Native graphics development on Windows is
separate. See [Mac verification](mac-verification-0.7.16.md) for installed checks.
