/** Experimental transport only. These pure functions never call or mutate Premiere. */
import { validateNativeLineStyles, type NativeLineStyles } from './line-styles.ts';
export const NATIVE_SCHEMA_VERSION = 1 as const;
export const NATIVE_EFFECT_MATCH_NAME = 'com.swen.bettercaptions.native.experimental';
/** Premiere's CEP component name adds exactly one AE. prefix for this effect. */
export function normalizeNativeMatchName(value: unknown): typeof NATIVE_EFFECT_MATCH_NAME | null {
  return value === NATIVE_EFFECT_MATCH_NAME || value === 'AE.' + NATIVE_EFFECT_MATCH_NAME ? NATIVE_EFFECT_MATCH_NAME : null;
}
export const NATIVE_PARAMETERS = ['positionX', 'positionY', 'width', 'height'] as const;
export type NativeParameter = typeof NATIVE_PARAMETERS[number];
export interface NativeWord { text: string; start: number; end: number; endOfSentence: boolean; lineBreakBefore?: 'break' | 'join' | 'edge'; pauseLinesRemoved?: number; }
export interface NativeCaption { id: string; start: number; end: number; manualSplit: boolean; words: NativeWord[]; }
export interface NativeDocument { version: 1; animationAuthority: 'premiere-effect'; sequenceId: string; captions: NativeCaption[]; style: NativeStyle; timeOriginSeconds: number; binaryVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12; }
export interface NativeHostEvidence {
  host: 'premiere'; matchName: string; loaded: boolean; renderVerified: boolean;
  parameterReadWriteVerified: boolean; serializationVerified: boolean;
}
export interface NativeTarget { sequenceId: string; clipId: string; effectId: string; revision: string; }

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected a plain JSON object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!keys.includes(key) || !('value' in descriptor)) throw new Error('Unknown or unsafe native property: ' + key);
  }
  if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol properties are unsupported.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w:.-]{1,160}$/.test(value)) throw new Error('Invalid native identity or revision.');
  return value;
}
function numeric(value: unknown, min = 0, max = 864000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Native value is outside its finite range.');
  return value;
}
function interval(value: Record<string, unknown>): [number, number] {
  const start = numeric(value.start), end = numeric(value.end);
  if (end <= start) throw new Error('Native interval must have positive duration.');
  return [start, end];
}
export function validateNativeDocument(input: unknown): NativeDocument {
  const doc = record(input, ['version', 'animationAuthority', 'sequenceId', 'captions', 'style', 'timeOriginSeconds', 'binaryVersion']);
  if (doc.version !== NATIVE_SCHEMA_VERSION || doc.animationAuthority !== 'premiere-effect') throw new Error('Unsupported native schema or animation authority.');
  if (!Array.isArray(doc.captions) || doc.captions.length > 10000) throw new Error('Expected at most 10000 captions.');
  const seen = new Set<string>(); let words = 0, characters = 0;
  const captions = doc.captions.map(item => {
    const caption = record(item, ['id', 'start', 'end', 'manualSplit', 'words']);
    const captionId = id(caption.id), [start, end] = interval(caption);
    if (seen.has(captionId)) throw new Error('Duplicate native caption identity.'); seen.add(captionId);
    if (typeof caption.manualSplit !== 'boolean') throw new Error('manualSplit must be explicit.');
    if (!Array.isArray(caption.words) || !caption.words.length || (words += caption.words.length) > 50000) throw new Error('Expected 1 to 50000 total words.');
    let previous = start;
    const result = caption.words.map(item => {
      const word = record(item, ['text', 'start', 'end', 'endOfSentence', 'lineBreakBefore', 'pauseLinesRemoved']); const [a, b] = interval(word);
      if (typeof word.text !== 'string' || word.text.length > 500 || word.text !== '' && !word.text.trim() || new TextDecoder().decode(new TextEncoder().encode(word.text)) !== word.text || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(word.text) || (characters += word.text.length) > 2000000) throw new Error('Invalid or oversized native transcript text.');
      if (a < start || b > end || a < previous) throw new Error('Native words must be ordered inside their caption.');
      previous = a;
      if (typeof word.endOfSentence !== 'boolean') throw new Error('endOfSentence must be explicit.');
      if (word.lineBreakBefore !== undefined && word.lineBreakBefore !== 'break' && word.lineBreakBefore !== 'join' && word.lineBreakBefore !== 'edge') throw new Error('Invalid native word line boundary.');
      if (word.pauseLinesRemoved !== undefined && (typeof word.pauseLinesRemoved !== 'number' || !Number.isInteger(word.pauseLinesRemoved) || word.pauseLinesRemoved < 0 || word.pauseLinesRemoved > 8)) throw new Error('Invalid native word removed pause lines.');
      return { text: word.text, start: a, end: b, endOfSentence: word.endOfSentence, ...(word.pauseLinesRemoved === undefined || word.pauseLinesRemoved === 0 ? {} : { pauseLinesRemoved: word.pauseLinesRemoved as number }), ...(word.lineBreakBefore === undefined ? {} : { lineBreakBefore: word.lineBreakBefore as 'break' | 'join' | 'edge' }) };
    });
    return { id: captionId, start, end, manualSplit: caption.manualSplit, words: result };
  });
  if (doc.binaryVersion !== undefined && ![1,2,3,4,5,6,7,8,9,10,11,12].includes(doc.binaryVersion as number)) throw new Error('Unsupported native binary version.');
  return { version: 1, animationAuthority: 'premiere-effect', sequenceId: id(doc.sequenceId), captions, style: validateNativeStyle(doc.style), timeOriginSeconds: doc.timeOriginSeconds === undefined ? 0 : numeric(doc.timeOriginSeconds, -864000, 864000), ...(doc.binaryVersion === undefined ? {} : { binaryVersion: doc.binaryVersion as 1|2|3|4|5|6|7|8|9|10|11|12 }) };
}
export function requireNativeHost(evidence: NativeHostEvidence): void {
  if (evidence.host !== 'premiere' || !normalizeNativeMatchName(evidence.matchName) || evidence.loaded !== true || evidence.renderVerified !== true || evidence.parameterReadWriteVerified !== true || evidence.serializationVerified !== true) throw new Error('Native effect is unavailable or unverified. No automatic movie fallback.');
}
function target(input: unknown): NativeTarget {
  const value = record(input, ['sequenceId', 'clipId', 'effectId', 'revision']);
  return { sequenceId: id(value.sequenceId), clipId: id(value.clipId), effectId: id(value.effectId), revision: id(value.revision) };
}
/** Disk IDs are serialization identities from native/adobe/BetterCaptionsEffect.cpp,
 * NOT UXP ComponentParam indexes. Resolve and verify the actual host parameter first. */
export const NATIVE_PARAMETER_DISK_MAPPING = {
  positionX: { diskId: 1, nativeName: 'Position', kind: 'point', coordinate: 'x' },
  positionY: { diskId: 1, nativeName: 'Position', kind: 'point', coordinate: 'y' },
  width: { diskId: 2, nativeName: 'Width', kind: 'number' },
  height: { diskId: 3, nativeName: 'Height', kind: 'number' },
} as const;
/** Position edits require read/modify/write of one native PointF, preserving the other
 * coordinate at exact ticks. This plan does not prove host coordinate units or writes. */
export function planNativeParameterEdit(input: unknown, current: NativeTarget, evidence: NativeHostEvidence) {
  requireNativeHost(evidence);
  const request = record(input, ['target', 'parameter', 'value', 'timeTicks', 'operation']);
  const requested = target(request.target), actual = target(current);
  if (JSON.stringify(requested) !== JSON.stringify(actual)) throw new Error('Native target changed. Refresh before editing.');
  if (!NATIVE_PARAMETERS.includes(request.parameter as NativeParameter)) throw new Error('Unknown native parameter.');
  if (request.operation !== 'set-value' && request.operation !== 'reset-at-time') throw new Error('Unsupported native edit operation.');
  if (typeof request.timeTicks !== 'string' || !/^\d{1,21}$/.test(request.timeTicks)) throw new Error('Use exact Premiere ticks.');
  const dimension = request.parameter === 'width' || request.parameter === 'height';
  if (request.operation === 'reset-at-time' && request.value !== undefined) throw new Error('Reset defaults must come from the native parameter.');
  const value = request.operation === 'set-value' ? numeric(request.value, dimension ? 1 : -100000, dimension ? 8192 : 100000) : undefined;
  return { target: requested, parameter: request.parameter as NativeParameter, operation: request.operation, timeTicks: request.timeTicks, ...(value === undefined ? {} : { value }), animationAuthority: 'premiere-effect' as const, preserveOtherKeysAndInterpolation: true as const, retry: 'never' as const };
}
export interface MigrationSnapshot { target: NativeTarget; snapshotId: string; sourceFingerprint: string; protectedAnimation: boolean; adjustmentLayer: boolean; }
/** Plan creation is explicit and reversible; execution belongs to a separate verified host adapter. */
export function planNativeMigration(input: unknown, evidence: NativeHostEvidence) {
  requireNativeHost(evidence);
  const request = record(input, ['explicitConsent', 'document', 'snapshot']);
  if (request.explicitConsent !== true) throw new Error('Explicit native migration consent is required.');
  const snapshot = record(request.snapshot, ['target', 'snapshotId', 'sourceFingerprint', 'protectedAnimation', 'adjustmentLayer']);
  const nativeTarget = target(snapshot.target);
  if (snapshot.adjustmentLayer !== true) throw new Error('Native captions require an adjustment layer.');
  if (snapshot.protectedAnimation !== false) throw new Error('Protected animated captions require separate manual migration.');
  if (typeof snapshot.sourceFingerprint !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(snapshot.sourceFingerprint)) throw new Error('A SHA-256 preservation fingerprint is required.');
  const document = validateNativeDocument(request.document);
  if (document.sequenceId !== nativeTarget.sequenceId) throw new Error('Migration sequence changed.');
  return { version: 1 as const, document, source: { target: nativeTarget, snapshotId: id(snapshot.snapshotId), sourceFingerprint: id(snapshot.sourceFingerprint) }, strategy: 'create-separate-native-container' as const, targetKind: 'adjustment-layer' as const, preserveLegacy: true as const, rollback: 'remove-new-container-only' as const, retry: 'never' as const };
}

export interface NativeColor { r: number; g: number; b: number; a: number; }
export interface NativeWordStyle {
  fontWeight?: number; italic?: boolean; underline?: boolean; fontWeightOffset?: 0 | 100 | null;
  fontFamily: string; fontSize: number; sizeScale: number; opacity: number; color: NativeColor;
  paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number; radiusTL?: number; radiusTR?: number; radiusBR?: number; radiusBL?: number; marginTop?: number; marginRight?: number; marginBottom?: number; marginLeft?: number; bubble: boolean; bubbleFillSpaces?: boolean; bubblePaddingInline?: number; bubblePaddingBlock?: number; bubbleColor: NativeColor; padding: number; radius: number; outlineWidth: number;
  outlineColor: NativeColor; shadowBlur: number; shadowX: number; shadowY: number; shadowColor: NativeColor;
}
/** lineWrap (BCAP v11) is absent for Fill, the default and every older document. */
export interface NativeStyle { upcoming: NativeWordStyle; current: NativeWordStyle; spoken: NativeWordStyle; wordSpacing: number; lineHeight: number; titleCase: boolean; letterCase?: 'uppercase' | 'lowercase'; baseFontWeight?: number; lineWrap?: 'balance' | 'pretty'; lineStyles?: NativeLineStyles; }
function nativeColor(input: unknown): NativeColor {
  const c = record(input, ['r', 'g', 'b', 'a']);
  return { r: numeric(c.r, 0, 1), g: numeric(c.g, 0, 1), b: numeric(c.b, 0, 1), a: numeric(c.a, 0, 1) };
}
function wordStyle(input: unknown): NativeWordStyle {
  const keys = ['fontFamily', 'fontSize', 'sizeScale', 'opacity', 'color', 'bubble', 'bubbleColor', 'padding', 'radius', 'outlineWidth', 'outlineColor', 'shadowBlur', 'shadowX', 'shadowY', 'shadowColor', 'fontWeight', 'italic', 'fontWeightOffset', 'bubbleFillSpaces', 'bubblePaddingInline', 'bubblePaddingBlock', 'underline', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
  const s = record(input, keys);
  if (typeof s.fontFamily !== 'string' || !s.fontFamily.trim() || new TextDecoder().decode(new TextEncoder().encode(s.fontFamily)) !== s.fontFamily || new TextEncoder().encode(s.fontFamily).length > 256 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s.fontFamily)) throw new Error('Invalid native font family.');
  if (typeof s.bubble !== 'boolean') throw new Error('Invalid native bubble flag.');
  if (s.bubbleFillSpaces !== undefined && typeof s.bubbleFillSpaces !== 'boolean') throw new Error('Invalid native bubble spaces flag.');
  if (s.underline !== undefined && typeof s.underline !== 'boolean') throw new Error('Invalid native underline flag.');
  if (s.italic !== undefined && typeof s.italic !== 'boolean') throw new Error('Invalid native italic flag.');
  if (s.fontWeightOffset !== undefined && s.fontWeightOffset !== null && s.fontWeightOffset !== 0 && s.fontWeightOffset !== 100) throw new Error('Invalid native relative weight mode.');
  return { fontFamily: s.fontFamily, fontSize: numeric(s.fontSize, 0.01, 4096), sizeScale: numeric(s.sizeScale, .01, 16), opacity: numeric(s.opacity, 0, 1), color: nativeColor(s.color), bubble: s.bubble, bubbleColor: nativeColor(s.bubbleColor), padding: numeric(s.padding, 0, 4096), radius: numeric(s.radius, 0, 4096), outlineWidth: numeric(s.outlineWidth, 0, 4096), outlineColor: nativeColor(s.outlineColor), shadowBlur: numeric(s.shadowBlur, 0, 4096), shadowX: numeric(s.shadowX, -4096, 4096), shadowY: numeric(s.shadowY, -4096, 4096), shadowColor: nativeColor(s.shadowColor), ...(s.paddingTop===undefined?{}:{paddingTop:numeric(s.paddingTop,0,4096)}), ...(s.paddingRight===undefined?{}:{paddingRight:numeric(s.paddingRight,0,4096)}), ...(s.paddingBottom===undefined?{}:{paddingBottom:numeric(s.paddingBottom,0,4096)}), ...(s.paddingLeft===undefined?{}:{paddingLeft:numeric(s.paddingLeft,0,4096)}), ...(s.radiusTL===undefined?{}:{radiusTL:numeric(s.radiusTL,0,4096)}), ...(s.radiusTR===undefined?{}:{radiusTR:numeric(s.radiusTR,0,4096)}), ...(s.radiusBR===undefined?{}:{radiusBR:numeric(s.radiusBR,0,4096)}), ...(s.radiusBL===undefined?{}:{radiusBL:numeric(s.radiusBL,0,4096)}), ...(s.marginTop===undefined?{}:{marginTop:numeric(s.marginTop,-4096,4096)}), ...(s.marginRight===undefined?{}:{marginRight:numeric(s.marginRight,-4096,4096)}), ...(s.marginBottom===undefined?{}:{marginBottom:numeric(s.marginBottom,-4096,4096)}), ...(s.marginLeft===undefined?{}:{marginLeft:numeric(s.marginLeft,-4096,4096)}), ...(s.underline === undefined ? {} : {underline:s.underline as boolean}), ...(s.bubblePaddingInline === undefined ? {} : {bubblePaddingInline:numeric(s.bubblePaddingInline,0,4096)}), ...(s.bubblePaddingBlock === undefined ? {} : {bubblePaddingBlock:numeric(s.bubblePaddingBlock,0,4096)}), ...(s.bubbleFillSpaces === undefined ? {} : {bubbleFillSpaces:s.bubbleFillSpaces as boolean}), ...(s.fontWeight === undefined ? {} : {fontWeight:numeric(s.fontWeight,1,1000)}), ...(s.italic === undefined ? {} : {italic:s.italic as boolean}), ...(s.fontWeightOffset === undefined ? {} : {fontWeightOffset:s.fontWeightOffset as 0|100|null}) };
}
export function validateNativeStyle(input: unknown): NativeStyle {
  const s = record(input, ['upcoming', 'current', 'spoken', 'wordSpacing', 'lineHeight', 'titleCase', 'baseFontWeight', 'letterCase', 'lineWrap', 'lineStyles']);
  const lineStyles = validateNativeLineStyles(s.lineStyles);
  if (s.lineWrap !== undefined && s.lineWrap !== 'balance' && s.lineWrap !== 'pretty') throw new Error('Invalid native line wrap.');
  if (s.letterCase !== undefined && (!['uppercase','lowercase'].includes(s.letterCase as string) || s.titleCase)) throw new Error('Invalid native display letter case.');
  if (typeof s.titleCase !== 'boolean') throw new Error('Invalid display-only Title Case flag.');
  return { upcoming: wordStyle(s.upcoming), current: wordStyle(s.current), spoken: wordStyle(s.spoken), wordSpacing: numeric(s.wordSpacing, 0, 4096), lineHeight: numeric(s.lineHeight, .6, 10), titleCase: s.titleCase, ...(s.letterCase === undefined ? {} : {letterCase:s.letterCase as 'uppercase'|'lowercase'}), ...(s.baseFontWeight === undefined ? {} : {baseFontWeight:numeric(s.baseFontWeight,1,1000)}), ...(s.lineWrap === undefined ? {} : {lineWrap:s.lineWrap as 'balance'|'pretty'}), ...(lineStyles === undefined ? {} : {lineStyles}) };
}
export function defaultNativeStyle(): NativeStyle {
  const word: NativeWordStyle = { fontFamily: 'Arial', fontSize: 64, sizeScale: 1, opacity: 1, color: {r:1,g:1,b:1,a:1}, bubble: false, bubbleColor: {r:0,g:0,b:0,a:1}, padding:8, radius:10, outlineWidth:0, outlineColor:{r:0,g:0,b:0,a:1}, shadowBlur:0, shadowX:0, shadowY:0, shadowColor:{r:0,g:0,b:0,a:.5} };
  return { upcoming: structuredClone(word), current: structuredClone(word), spoken: structuredClone(word), wordSpacing:12, lineHeight:1.3, titleCase:false };
}

export interface NativePointCalibration {
  target: NativeTarget;
  /** Must be proved against rendering in the specific host/sequence, not guessed
   * from a getter roundtrip or transferred from native Motion. */
  renderingVerified: boolean;
  space: 'normalized-sequence' | 'sequence-pixels';
  frameWidth: number;
  frameHeight: number;
}
/** Pure mapping for a single Position coordinate; no host write or keys created.
 * Pixel intent stays separate from calibrated host point representation. */
export function planNativePointCoordinate(
  plan: ReturnType<typeof planNativeParameterEdit>,
  currentHostPoint: { x: number; y: number },
  calibration: NativePointCalibration,
) {
  if (plan.parameter !== 'positionX' && plan.parameter !== 'positionY') throw new Error('Expected a Position coordinate plan.');
  if (plan.operation !== 'set-value' || plan.value === undefined) throw new Error('Native reset requires verified host defaults.');
  const calibrationTarget = target(calibration.target);
  if (JSON.stringify(calibrationTarget) !== JSON.stringify(plan.target) || calibration.renderingVerified !== true) throw new Error('Position host coordinates require current rendering verification.');
  if (calibration.space !== 'normalized-sequence' && calibration.space !== 'sequence-pixels') throw new Error('Unknown host Position coordinate space.');
  const width = numeric(calibration.frameWidth, 1, 32768), height = numeric(calibration.frameHeight, 1, 32768);
  const point = { x: numeric(currentHostPoint.x, -100000, 100000), y: numeric(currentHostPoint.y, -100000, 100000) };
  const coordinate = plan.parameter === 'positionX' ? 'x' : 'y';
  const scale = calibration.space === 'normalized-sequence' ? (coordinate === 'x' ? width : height) : 1;
  point[coordinate] = plan.value / scale;
  return { target: { ...plan.target }, point, timeTicks: plan.timeTicks, coordinateSpace: calibration.space, preserveOtherKeysAndInterpolation: true as const, retry: 'never' as const };
}
