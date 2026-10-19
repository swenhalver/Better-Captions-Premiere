# Native effect geometry bridge

The caption panel edits the existing Better Captions native effect's **Position**, **Width**, and **Height** parameters. It does not encode geometry into the caption document or replace a timeline clip. Native defaults come from `native/adobe/BetterCaptionsEffect.cpp`: normalized Position `[0.5, 0.9]`, Width `1536` pixels, Height `150` pixels. Dimensions remain independent and accept the native slider range of 1–8192 pixels.

`readNativeCaptionControls(snapshot, sequenceId)` requires the exact owned native locator and embedded-document revision returned by caption discovery. The receipt includes the current timeline/source tick strings, clip timing, `insideClip`, and one descriptor per parameter. Descriptors expose its sampled value, native default, whether animation is enabled in Effect Controls, whether keys are supported, and bounded key values used for concurrency/readback checks. The panel need not display or manipulate those keys.

`editNativeCaptionControl(snapshot, request, sequenceId)` accepts:

```js
{
  revision: receipt.revision,
  parameter: 'width', // 'position' or 'height' also supported
  operation: 'set',   // or 'reset', without value
  value: 600,         // Position takes both normalized axes [x, y]
  atTicks: receipt.timelineTicks
}
```

For an unanimated parameter, set/reset edits the static value. For an animated parameter, it updates the key at the captured source time, or inserts a key there when absent. Reset changes the current static/keyed value to the native default; it never disables animation or removes other keys. Existing keys are edited in place without setting interpolation or easing. The bridge has no interpolation getter and therefore does not claim to read back custom Bezier handles; preservation follows from never recreating or assigning those existing keys.

Premiere ComponentParam animation uses the clip's **source clock**. This is the same clock used by the established native Motion adapter, with Mac evidence recorded in `docs/mac-verification-0.7.8.md`. For a forward clip at 1x speed, `source = timelinePlayhead - clipStart + sourceIn`. The new bridge requires exposed forward-speed checks, uses exact decimal-string tick arithmetic, rejects edits outside the clip, and refuses a changed playhead or document/clip/control revision. A nonzero start/in-point fixture and tick values above JavaScript's safe integer range verify the mapping in `tests/native-caption-controls.test.mjs`. Those fixtures do not substitute for a live-host acceptance test of this new native-effect geometry API.

Reads are expiring read operations throughout webview, UXP, service, and CEP. Edits are serialized mutations with no automatic retry. Before the first setter the bridge rechecks the snapshot, current controls/playhead, and track lock. Readback verifies the target value, all untargeted controls, existing target keys, animation state, and immutable caption document. If a setter has been attempted but cannot be confirmed, the response is `BC_OUTPUT_UNCONFIRMED`, nonrecoverable, `retry: 'never'`; the user should inspect Effect Controls before another write. Plain read or preflight refusals do not acquire that mutation-failure status.

`seekNativeCaptionKeyframe(snapshot, {parameter, direction, revision, atTicks}, sequenceId)` navigates strictly to the previous/next key on the chosen animated parameter. Only keys inside the current clip's source `[in, out)` and timeline `[start, end)` ranges qualify. It maps source ticks back to timeline ticks with exact decimal arithmetic and calls `setPlayerPosition` once with that string. The returned fresh controls receipt samples the values at the destination and confirms unchanged static values, animation state, keys and embedded document. It does not call any parameter setters. No eligible key, a stale playhead/control revision, or unsupported retiming stops before seeking; an uncertain attempted seek is never automatically repeated.

Every geometry read verifies that the active sequence/project and playhead still match after all parameter sampling, so a scrub during the read cannot produce a receipt whose numbers came from a different position.

`groups` refers to the appended **Groups per page** native scalar, integer1–100
(default1). It is optional on reads for compatibility with older compiled effects.
Explicit group edits/reset follow the same clock/revision/keyframe rules; older
binaries reject group writes before a setter. Fractional render samples between
native group-count keyframes are rounded/clamped by the CPU/GPU renderer.

Explicit edits select the owned caption clip if needed so Premiere can show its
non-rendered on-screen area controls. Background reads and polling never select
clips or alter the workspace/panel widths.
