# Native transport boundary

The BCAP encoder interoperates with the C++ core. It does not yet transfer data into a running Premiere effect. Parameter edit and migration functions create plans; they do not mutate Premiere.

Current primary documentation inspected on 2026-10-18:

- [Adobe UXP Component](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/component): `getMatchName`, `getParamCount`, and zero-based `getParam` support a read-only inventory of an existing component. Index order is component-defined, and must not be confused with PF disk IDs.
- [Adobe UXP ComponentParam](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/componentparam): `createKeyframe` accepts number, string, boolean, PointF or Color **depending on the parameter type**; incompatible types throw. `createSetValueAction` concerns non-time-varying values. This is insufficient evidence that a string can set a PF arbitrary-data parameter.
- [Adobe UXP Keyframe](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/keyframe): documents its value and temporal interpolation access. It does not establish arbitrary binary transport.
- Adobe After Effects SDK 26.5 `Examples/Headers/AE_Effect.h` defines `PF_Arbitrary_PRINT_SIZE_FUNC`, `PF_Arbitrary_PRINT_FUNC`, and `PF_Arbitrary_SCAN_FUNC`. PRINT returns a text description; SCAN reconstructs an arbitrary handle from text. Their existence does not prove Premiere calls SCAN for CEP `setValue(string)` or UXP `createKeyframe(string)`.

`probeNativeComponent` uses only the documented read APIs against a caller-resolved native component, returns bounded observations, and intentionally reports write/arbitrary transport support as unverified. It does not add effects or change any parameter. Tests use structural mocks; no live host proof is implied.

Next host experiment: in a disposable project, inspect the installed experimental effect's parameters and obtain an actual arb representation through the supported host API, if exposed. Only after a deliberate string mutation and callback logging demonstrate PF SCAN, followed by saved-project reopening and decoded byte comparison, may an adapter claim arbitrary transport. A failed or uncertain mutation must not be retried automatically. If the host does not expose this bridge, investigate a documented native custom UI/import mechanism and make the limitation explicit; never quietly substitute a sidecar movie.

Any resulting adapter must preserve effect instance and clip identity, exact ticks, all unrelated keys/interpolation, original native Motion, source transcript, manual splits and legacy containers. A per-time reset must use the native parameter default and retain other keys. These are requirements, not verified host behavior.

## Compiled adapter parameter identities

The current `native/adobe/BetterCaptionsEffect.cpp` defines stable disk IDs: **1 Position (point), 2 Width, 3 Height, 4 Characters per caption, 5 Font size, 6 Text color, 7 Caption document (experimental, arbitrary)**. Disk IDs describe native serialization identities. They are **not** documented UXP component indexes; the host inventory must determine the actual exposed ordering.

Panel logical `positionX` and `positionY` both refer to coordinates of the **same Position point parameter**, representing the text-area center in the compiled renderer. An adapter must read the existing point at the requested ticks, update one coordinate, and preserve the other coordinate and native keyframe interpolation. It must verify Premiere’s coordinate units before exposing pixel labels; the compiled renderer interprets the supplied PF point values as pixels before render-resolution scaling. Width/Height each permit 1–8192 in the native parameter definition. Their independent values control reflow, without a scale/aspect-ratio operation.

`NATIVE_PARAMETER_DISK_MAPPING` records these native source identities without assuming host parameter indexes or claiming a completed writable bridge.
