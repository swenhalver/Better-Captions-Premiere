# 0.7.3 remote Windows continuation

Status: unreleased; fresh installed-plugin acceptance is blocked. The Mac 0.7.2 tag, assets and installation have not been changed. This work continues the frozen `914582f846f5427692aec64b55c28ef6d3a52d9d` handoff on the remote Windows PC.

## Completed implementation

- New Apply uses one physical caption clip, with editable sentence groups and automatic placement above footage. Regroup changes real render segments after Apply.
- Later native Razor fragments can use text-area controls only with a complete, freshly validated contiguous-fragment receipt. The receipt participates in signatures, history and final revalidation; arbitrary trimmed animation remains protected.
- Global media references are rediscovered after relink to catch copies or new cuts made during the operation.
- Compatible legacy static clips stage a single replacement with native Position/Width/Height hold keys. The original clips survive render and hold readback; final removal uses one non-ripple transaction. Failed or uncertain partial conversions retain recovery material. Unsupported legacy animation/effects/bounds/trims fail before removing originals.
- Public panel, UXP, private service and CEP endpoints are connected and covered by integration regressions. Internal staging/removal endpoints remain inaccessible from the webview RPC allowlist.
- The character-cap field remains readable at 280px when the grouping summary wraps.
- Full Apply can recreate a deleted caption clip or track from the saved transcript and style. Exact absence receipts are checked against active video/audio references before rendering, track preparation and Apply. Surviving native fragments/media copies and Undo during rendering prevent recreation. Original session links remain until successful Apply; automatic partial reflow does not resurrect deleted clips.

## Local evidence

- 459 tests pass on this Windows account, including real FFmpeg rendering and 18 deleted-caption recovery regressions. The 32 installer-upgrade tests are excluded from this local invocation because the account lacks the Windows symbolic-link privilege they exercise; source tests have not been skipped or weakened. Full Windows/macOS CI runs all tests.
- Svelte/TypeScript check: zero errors and zero warnings. Both production bundles and the CCX/universal ZIP build successfully.
- Browser keyboard interaction at character caps 18, 30 and 100 changed the synthetic sentence groups; 30 produced three rows and 100 produced two. This proves browser grouping only, not native rendered output after Apply. No browser console errors were observed.
- Responsive review uses 1280×900 expanded and 390×844 with a 280px panel. The grouping field was corrected after the first narrow capture. Browser fixtures remain labeled synthetic and native actions remain disabled.
- The final interface review returned `disposition: ship` for the corrected grouping labels and narrow layout. That verdict covers the interface correction only; it does not establish native acceptance or release readiness.
- Full Windows/macOS checks and downloadable development packages are tracked on [PR #1](https://github.com/swenhalver/Better-Captions-Premiere/pull/1). Native acceptance below remains required even when CI passes.

## Installation blocker

With a freshly built package, `node scripts/install.cjs` resolves FFmpeg/FFprobe, but Adobe UPIA returns `-903`. Opening the CCX normally in Creative Cloud also reports “Couldn't install plugin” with code `-1`. Adobe's UPI logs show `launchElevateServer failed` and product-database refresh failure `-151`. A normal Creative Cloud quit/relaunch and installer retry still return `-903`.

Further system-level Adobe UPI logs show the elevated helper cannot resolve the logged-in Windows account among the enumerated profiles and returns `-903`. The account is valid, but its name differs from the profile-folder name; an Adobe profile-enumeration bug is the likely explanation, not yet a confirmed repair diagnosis. Adobe's official signed standalone Repair utility has been prepared. The latest launch was canceled before repair began; launching it requires Windows administrator approval.

No successful 0.7.3 installation or native timeline acceptance is claimed. No manual Adobe plugin-store copy or registration bypass was used. Creative Cloud/UPIA needs repair through Adobe's normal installation flow before the native checks can continue.

## Required native acceptance before publication

1. With footage only on V1, Apply creates one caption clip above footage; every existing video/audio clip retains its start/end and source in/out.
2. Regroup at 18, 30 and 100 after Apply visibly changes the Program Monitor phrases while retaining one physical clip and native geometry/keyframes.
3. Razor the bundle into two parts. Update style/grouping and verify both IDs, source bounds, cut and native curves; edit a selected later-slice key on the correct source frame.
4. Convert the current two legacy static clips into one. Verify the actual Mac-recorded geometry at 720×1280 / 24fps: first 0–2.375s, Position `[364.8160457611084,1066.3050842285156]`, Width 576, Height 331.22640625; second 2.375–4.33333333333333s, Position `[360,1088]`, Width 576, Height 512. Confirm native default effect fingerprints and hold interpolation, one final clip, and unchanged unrelated video/audio timings.
5. Check rejection and recovery on stale geometry, unsupported effects/animation, track locks and refused native transactions.
6. Delete the generated caption clip, then its entire video track, and run full **Update Program Monitor** each time. Verify fresh links, preserved transcript/grouping/style, automatic placement and no duplicate clips. Repeat with one deleted manual split and a surviving clip, and confirm Undo during rendering or a surviving native Razor fragment prevents duplicate recreation.
7. After these checks, build and download the new release artifacts, verify hashes, and publish a new 0.7.3 tag/release. Preserve all 0.7.2 assets.
