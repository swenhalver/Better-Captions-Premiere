# Mac verification — 0.7.15

Native-effect creation passed installed acceptance on Premiere Pro 26.5.2,
Apple Silicon, using the previously accepted Metal effect binary. Panel and
service version 0.7.15 are installed. All seven installed panel payload files and
the installed host script match the packaged sources byte for byte.

Completed host checks:

- Premiere creates one Transparent Video source from a bounded factory request.
- Source metadata persists through Premiere's project metadata API; synthetic
  media rejects source `setXMPMetadata`, which is not used by the implementation.
- The native effect renders on a sole Transparent Video clip over an otherwise
  empty timeline, with correct zero-origin spoken-word highlighting.
- Captions remain visible during active Half-resolution scrubbing.
- The production creation handler created one exact identified native clip on an
  empty top track and confirmed document, geometry, source and timeline timing.
- Existing timeline clips were checked before/after creation by the handler.
- The installed panel automatically created one native effect from a saved test
  transcript, without a movie render or manual Apply action.
- A live panel style edit changed the current-word bubble in the embedded native
  document. The effect retained source origin zero and its original word count.
- Restarting Premiere reconnected the panel to the generated carrier and its
  embedded document. Carrier ownership survives project save/reopen.
- Active Quarter-resolution scrubbing shows the captions over source footage.
- A native copy is now enabled on V4 of the user's production sequence. The old
  caption movie remains intact on V3, disabled as a reversible backup. The native
  clip is named `Better Captions | Native effect`.
- The before/after project graphs contain the same six sequences. All original
  clip/effect/keyframe values are unchanged except the old caption's disabled
  flag. One new native caption track was added. The original movie sidecar is
  preserved. The old movie's Motion controls were static before conversion.
- Portrait acceptance caught clipping in the initial two-line box. Initial height
  now estimates wrapped line capacity from the phrase length, font and width;
  the production box was corrected to show its complete three-line caption.

Validation: Svelte check reports zero errors/warnings; 825 automated tests report
823 passes, two Windows-only skips, zero failures. Package generation and Adobe
installation succeeded. The UI detector reports no findings. The native binary
remains SHA-256 `8c4ad9b0acc11fbec2ef8d3f5b13f01282fce2f6d6891875790e71c348e4dbf4`.

Physical Program Monitor drag handles and Windows native-effect rendering are
not newly qualified by this increment. Native-effect geometry/keyframes use
Premiere Effect Controls; native text/shapes are a separate Windows development
branch. The native renderer remains experimental, with the limits in
[native-effect acceptance](native-effect-acceptance.md).

Receipts and local screenshots: `artifacts/host-scratch/native-creation-2026-10-18/`.
The user's production project was saved, copied and snapshotted before testing;
test mutations take place in the separate Native Effect Scratch project.

The generated CEP adapter also uses stable sequence IDs because Premiere returns
fresh sequence wrapper objects on repeated reads. Live read-only acceptance of
that adapter passed on the production native carrier. Native reconnection prefers
the sole enabled native clip when all movie captions are disabled backups; an
explicit selection or another enabled caption version retains selection priority.
Windows font enumeration has a bounded 30-second cold-start allowance, replacing
a 15-second timeout observed on a loaded Windows CI worker. Mac timing is unchanged.
