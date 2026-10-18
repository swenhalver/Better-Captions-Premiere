import { normalizeNativeMatchName } from './contract.ts';
/** Structural subset of Adobe's documented UXP Component/ComponentParam API.
 * No setters, actions, QE calls, undocumented native handles, or effect insertion. */
interface UxpParam {
  displayName: string;
  areKeyframesSupported(): Promise<boolean>;
  isTimeVarying(): boolean;
  getStartValue(): Promise<{ value: unknown }>;
}
interface UxpComponent {
  getMatchName(): Promise<string>;
  getParamCount(): number;
  getParam(index: number): UxpParam;
}
export interface ParameterProbe {
  index: number; displayName: string; keyframesSupported?: boolean; timeVarying?: boolean;
  valueType?: string; stringLength?: number; finiteNumber?: number; error?: string;
}
/** Read-only inventory of an already resolved component. Results are observations,
 * never evidence of rendering, write support, serialization, or arbitrary SCAN support. */
export async function probeNativeComponent(component: UxpComponent) {
  const matchName = await component.getMatchName();
  if (!normalizeNativeMatchName(matchName)) throw new Error('Select the experimental Better Captions native component.');
  const count = component.getParamCount();
  if (!Number.isInteger(count) || count < 0 || count > 128) throw new Error('Native parameter count exceeds probe bounds.');
  const parameters: ParameterProbe[] = [];
  for (let index = 0; index < count; index++) {
    const result: ParameterProbe = { index, displayName: '' };
    try {
      const param = component.getParam(index);
      result.displayName = String(param.displayName).slice(0, 256);
      result.keyframesSupported = await param.areKeyframesSupported();
      result.timeVarying = param.isTimeVarying();
      const frame = await param.getStartValue(), value = frame.value;
      result.valueType = value === null ? 'null' : typeof value;
      if (typeof value === 'string') result.stringLength = value.length;
      if (typeof value === 'number' && Number.isFinite(value)) result.finiteNumber = value;
    } catch {
      // Do not emit host exception text: it may include transcript content or paths.
      result.error = 'Host parameter read failed.';
    }
    parameters.push(result);
  }
  return { matchName, canonicalMatchName: normalizeNativeMatchName(matchName), parameters, readOnly: true as const, writeSupportVerified: false as const, arbitraryTextTransportVerified: false as const };
}
