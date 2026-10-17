# Remote continuation: 0.7.3 work in progress

The user is turning off the Mac and explicitly asked the existing remote caption-interface chat to finish this work. Continue on the remote PC. The last released/installed Mac build is 0.7.2, source c6255f364c734f8dce5a18fa95586c8b2499874e. Its complete native Mac grouping/preset acceptance and CI passed. Do not overwrite v0.7.2 assets or tag. This WIP source is versioned 0.7.3 to avoid stale Adobe caches when installing it.

## Latest user requirements

1. Applying captions should automatically create a new video track above footage instead of asking the user to fix a V1 collision.
2. Regroup must work after changing character count, including captions already applied.
3. All captions should occupy ONE physical timeline clip unless the user manually splits it. Sentence groups inside that clip remain editable. Preserve native Motion/keyframes and manual cuts.
4. Finish remotely, test the actual installed plugin where possible, then upload the completed result to the user's GitHub. No further Mac work while the laptop is off.

## Implemented source

- ExportButton defaults to automatic track -1; explicit manual tracks remain available. One-clip planning runs inside the Apply try/finally so invalid data cannot leave the panel busy. Source fingerprint still watches the original UI props.
- uxp/caption-track.js uses Adobe's public SequenceEditor insert action at the next track index, a verified generated video-only seed, limitShift=true, audio index0, and exact non-ripple seed cleanup. It validates project/sequence/count, exact path and source times, requires exactly one new track, and retries cleanup at most once. Native API execution has not been exercised yet.
- UXP apply orchestration requests internal prepareCaptionTrack(captions,-1,previous), runs native creation only for mode=create, then uses the confirmed fixed destination for Apply. New helper is included in CCX packaging.
- CEP automatic preflight is read-only. Prepare independently FFprobes exactly one video/no audio, imports the owned seed idempotently and returns the exact destination/seed receipt. Linked clips retain their tracks.
- bundleCaptionContainers creates a single physical whole-transcript container for new/unlinked captions with captionBundle:true, groupingMaxChars and real renderSegments. Existing linked/manualSplit containers are kept intact. Differing explicit frame positions currently reject rather than lose placement.
- Regroup now changes real rendered phrases inside existing native containers without removing IDs/keys. Transcript shows individually editable sentence rows. Word/text/timing edits recompute segments; Undo cannot restore stale plural pre-Apply partitions after creating a bundle. Agent edits support bounded whole transcripts and recompute derived groups.
- Backend native Razor support explicitly requires captionBundle:true. It proves all references are same active sequence/track and source-contiguous, adjacent forward1x slices. It samples each fragment on its source clock, fingerprints all fragments, relinks once, preserves every cut/ID/in/out/native curve, resolves selected-slice descriptors, and returns canonical selection identity. Rollback tests cover later fragment failure.

## Must finish before release

- UXP text-area.js still needs a narrow verified-fragment exception to its trimmed-animation guard. Validate descriptor.bundleSourceContiguous===true and bundleFragments receipt, and include the full receipt in signature/identity/final asynchronous revalidation. Receipt fields: clipNodeId,track,startTicks,endTicks,inTicks,outTicks; max64, same track, adjacent timeline/source, first sourceIn0, matching source/timeline durations. Never enable generic trimmed-source animation or weaken exact identity checks.
- Add fresh global fragment discovery after relink. Current backend readback checks captured object timings and native writes, but additional global revalidation will catch a new external reference/cut during the async phase.
- Existing linked plural legacy MOV clips are NOT automatically consolidated yet. This remains necessary for the user's current two-clip sequence. Preserve actual native edits: first current legacy clip is static Position[364.8160457611084,1066.3050842285156], Width576, Height331.22640625; second is Position[360,1088], Width576, Height512. Both have zero Position/Width/Height keys, rotation0, center anchor, independent scaling. First range0–2.375, second2.375–4.33333333333333 at24fps. Do not reset these edited values. A one-clip conversion can lift compatible static changes into explicit hold keys, but must verify other native effects and keep old clips until successful verified replacement. Arbitrary animated/custom-eased legacy clips need exact preservation or an explicit safe limitation, not silent flattening/deletion.
- Run native acceptance: footage-only V1 -> Apply creates one caption clip above it, no footage/audio timing shifts; Regroup18/30/100 after Apply changes actual phrase rendering without new physical clips; one-clip position/size/key edits persist; Razor into2 parts -> style/group update preserves2 cuts/IDs/source times/native curves; selected later-slice controls edit correct native source frames.
- Razor's intentional bounds currently reject external/audio reuse, reordered/duplicated/gapped/trimmed/moved-track slices, >64fragments, >2000 project clips or >256 automatic Motion keys. Do not claim support for those cases.
- Verify build/package/install, Windows/macOS CI, artifact hashes and actual download readback. Update README/release notes/PR1 around final behavior. Publish a NEW0.7.3 release only when ready; do not present WIP as runtime verified.

## Validation before freeze

Frontend full suite passed444 total /442pass /2Windows-only skips; Svelte check0errors0warnings. Backend latest focused suite99/99 passed: node --test tests/premiere-host.test.mjs tests/service-backend.test.mjs tests/caption-track-api.test.mjs. Root native seed helper suite10/10 passed. Fresh complete frozen-tree results are recorded below by the handoff commit.

## Preservation and environment

Use the user's fork https://github.com/swenhalver/Better-Captions-Premiere. Preserve any remote uncommitted changes before checking out/merging this branch. Do not touch the separate Mac Better-Captions-Premiere checkout with16 foreign RollUp/fade edits. All local agents froze their files for handoff. No0.7.3 installation or native timeline mutation was performed on the Mac. Premiere remains open on the requested other display; the previous task's S-Space claim was released and CUA REPL reset. No documented separate capture-release API was exposed, so capture release could not be independently verified. Do not restart/drive the now-offline Mac.

Frozen-tree check results: {"tests": {"exitCode": 0, "tests": 452, "pass": 450, "fail": 0, "skipped": 2}, "check": {"exitCode": 0}, "build": {"exitCode": 0}}
