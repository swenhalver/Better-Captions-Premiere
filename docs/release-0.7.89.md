# S-Captions 0.7.89

Fix Extend captions rejecting valid geometry in Premiere's ExtendScript runtime. The v7 geometry-footer validator now uses explicit branches and boolean assignments in place of the compound conditional expression that failed during live acceptance. Range validation and the exact append-only style comparison stay intact.

Retains all 0.7.88 position styles and BCAP v12 ordering (wrap mode before position styles). The native plug-in is unchanged.
