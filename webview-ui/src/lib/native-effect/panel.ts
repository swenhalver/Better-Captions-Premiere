import { nativeCaptionPhrases } from './phrases.ts';
import { createCanvasWordMeasure, smartFitCharacterCapacity, applyNativeFitState, type SmartFitMeasure } from './smart-fit.ts';
import type { NativeLineFitStates } from '../../cep-api.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';
import { validTransparentCarrier } from './carrier.ts';
import { DEFAULT_ANIMATION, DEFAULT_STYLE, type CaptionItem, type SequenceInfo, type SessionState, type StyleConfig, type WordAppearance } from '../types.ts';
import { resolveAppearance } from '../appearance.ts';
import { normalizeNativeMatchName, validateNativeDocument, type NativeCaption, type NativeColor, type NativeDocument, type NativeStyle, type NativeWord, type NativeWordStyle } from './contract.ts';
import { buildCepNativeReadScript, type CepNativeLocator, type CepNativeSnapshot } from './cep-operations.ts';
import { encodeNativeTransportText, MAX_NATIVE_CARRIER_BYTES, NATIVE_TRANSPORT_PREFIX } from './encode.ts';

export interface NativePanelEntry {
  kind: 'native-effect'; maxChars?: number; lineFitWidth?: number; lineFitFontScale?: number; lineFitStates?: NativeLineFitStates; clipNodeId: string; projectItemId: string; trackIndex: number; clipIndex: number;
  startTicks: string; endTicks: string; inTicks: string; outTicks: string; selected: boolean;
  locator: CepNativeLocator; matchName: string; documentText: string; revision: string;
}
export interface NativePanelBinding {
  snapshot: CepNativeSnapshot; document: NativeDocument; baseline: SessionState;
  /** Add to document times for this layer's current ordinary-speed timeline placement. */
  timelineOffsetSeconds: number; clip: NativePanelEntry;
}
const clone = <T,>(value: T): T => structuredClone(value);
const pairs = [['upcomingWord', 'upcoming'], ['activeWord', 'current'], ['spokenWord', 'spoken']] as const;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unsupportedGlobal = ['backgroundEnabled', 'backgroundColor', 'backgroundOpacity', 'backgroundPadding', 'backgroundRadius', 'positionX', 'positionY', 'textAlign', 'maxWidth'] as const;
const unsupportedWord = ['letterSpacing'] as const;
export const NATIVE_PANEL_CAPABILITIES = {
  storage: 'embedded-native-document', geometry: 'premiere-effect-controls', animation: 'premiere-effect-controls',
  unsupportedGlobalStyleFields: unsupportedGlobal, unsupportedWordStyleFields: unsupportedWord,
  supportedGlobalStyleFields: ['wordSpacing', 'lineHeight'],
  supportedWordStyleFields: ['fontFamily', 'fontWeight', 'fontWeightOffset', 'italic', 'underline', 'fontSize', 'sizeScale', 'color', 'opacity', 'bubble', 'bubbleFillSpaces', 'bubblePaddingInline', 'bubblePaddingBlock', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'bubbleColor', 'bubbleOpacity', 'padding', 'radius', 'strokeEnabled', 'strokeColor', 'strokeWidth', 'strokeOpacity', 'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'],
  case: 'shared-as-typed-upper-lower-or-ascii-titlecase', wordSpacing: 'editable-native-pixels', effectToggles: 'outline-width-and-shadow-alpha',
} as const;

/** Only GUID braces/case are equivalent. Arbitrary identifiers remain exact. */
export function nativePanelSequenceId(value: string): string {
  const bare = /^\{[0-9a-f-]+\}$/i.test(value) ? value.slice(1, -1) : value;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bare) ? bare.toLowerCase() : value;
}
function tickSeconds(value: unknown): number {
  if (typeof value !== 'string' || !/^-?\d{1,21}$/.test(value)) throw new Error('Invalid native clip ticks.');
  const ticks = BigInt(value), bound = 864000n * 254016000000n;
  if (ticks < -bound || ticks > bound) throw new Error('Native clip ticks exceed the supported range.');
  return Number(ticks) / 254016000000;
}

/** Full bounded read; no host APIs and no code/file/network interpretation. */
export function decodeNativePanelDocument(text: unknown, sequenceId: string): NativeDocument {
  if (typeof text !== 'string' || !/^BCDOC1:[0-9a-f]+$/.test(text) || text.length % 2 !== 1 || (text.length + 1) * 2 > MAX_NATIVE_CARRIER_BYTES) throw new Error('Invalid bounded native document carrier.');
  const hex = text.slice(NATIVE_TRANSPORT_PREFIX.length), bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const data = new DataView(bytes.buffer); let offset = 0;
  const need = (count: number) => { if (offset + count > bytes.length) throw new Error('Truncated native caption document.'); };
  const u = () => { need(4); const value = data.getUint32(offset, true); offset += 4; return value; };
  const d = () => { need(8); const value = data.getFloat64(offset, true); offset += 8; if (!Number.isFinite(value)) throw new Error('Nonfinite native document value.'); return value; };
  const flag = () => { const value = u(); if (value > 1) throw new Error('Invalid native document flag.'); return value === 1; };
  const string = (limit: number) => { const size = u(); if (!size || size > limit) throw new Error('Invalid native document string.'); need(size); const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + size)); offset += size; return value; };
  if (u() !== 0x50414342) throw new Error('Invalid native document magic.');
  const version = u(); if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6 && version !== 7 && version !== 8 && version !== 9 && version !== 10) throw new Error('Unsupported native binary version.');
  const count = u(); if (count > 10000) throw new Error('Too many native caption containers.');
  const captions: NativeCaption[] = []; let totalWords = 0;
  for (let i = 0; i < count; i++) {
    const id = string(256), manualSplit = flag(), wordCount = u();
    if (!wordCount || (totalWords += wordCount) > 50000) throw new Error('This panel supports 1 to 50000 native words.');
    const words: NativeWord[] = [];
    for (let j = 0; j < wordCount; j++) {
      const word: NativeWord = { text: string(4096), start: d(), end: d(), endOfSentence: flag() };
      if (version >= 8) {
        const boundary = u();
        if (boundary > (version >= 10 ? 3 : 2)) throw new Error('Invalid native word line boundary.');
        if (boundary) word.lineBreakBefore = boundary === 1 ? 'break' : boundary === 2 ? 'join' : 'edge';
      } else if (i > 0 && j === 0) {
        // Older renderers always restarted at storage edges. Preserve those
        // visible splits once, then keep storage independent from grouping.
        word.lineBreakBefore = 'break';
      }
      if (version >= 9) {
        const removed = u();
        if (removed > 8) throw new Error('Invalid native word removed pause lines.');
        if (removed) word.pauseLinesRemoved = removed;
      }
      words.push(word);
    }
    captions.push({ id, manualSplit, start: Math.min(...words.map(word => word.start)), end: Math.max(...words.map(word => word.end)), words });
  }
  const color = (): NativeColor => ({ r: d(), g: d(), b: d(), a: d() });
  const wordStyle = (): NativeWordStyle => ({ fontFamily: string(256), fontSize: d(), sizeScale: d(), opacity: d(), color: color(), bubble: flag(), bubbleColor: color(), padding: d(), radius: d(), outlineWidth: d(), outlineColor: color(), shadowBlur: d(), shadowX: d(), shadowY: d(), shadowColor: color() });
  const style: NativeStyle = { upcoming: wordStyle(), current: wordStyle(), spoken: wordStyle(), wordSpacing: d(), lineHeight: d(), titleCase: flag() };
  const timeOriginSeconds = version >= 2 ? d() : 0;
  if(version>=3){const base=d();if(base!==0)style.baseFontWeight=base;for(const word of [style.upcoming,style.current,style.spoken]){const weight=d(),italic=u(),mode=u();if(italic>2||mode>2)throw new Error('Invalid native typography mode.');if(weight!==0)word.fontWeight=weight;if(italic)word.italic=italic===2;if(mode)word.fontWeightOffset=mode===2?100:0;}}
  if(version>=4){const mode=u();if(mode>2)throw new Error('Invalid native display letter case.');if(mode)style.letterCase=mode===1?'uppercase':'lowercase';}
  if(version>=5){for(const word of [style.upcoming,style.current,style.spoken]){const fill=flag();if(fill)word.bubbleFillSpaces=true;}}
  if(version>=6)for(const word of [style.upcoming,style.current,style.spoken])for(const axis of ['bubblePaddingInline','bubblePaddingBlock'] as const){const value=d();if(value!==-1)word[axis]=value;}
  if(version>=6)for(const word of [style.upcoming,style.current,style.spoken]){const mode=u();if(mode>2)throw new Error('Invalid native underline mode.');if(mode)word.underline=mode===2;}
  if(version>=7)for(const word of [style.upcoming,style.current,style.spoken])for(const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const){const value=d();if(!key.startsWith('margin')?value!==-1:value!==0)word[key]=value;}
  if (offset !== bytes.length) throw new Error('Trailing native document bytes.');
  if (version < 10) {
    // Before v10 a merge also wrote plain breaks at its edges. A break right
    // beside a joined word came from a merge, so a reflow may clear it.
    const all = captions.flatMap(caption => caption.words);
    all.forEach((word, index) => { if (word.lineBreakBefore === 'break' && (all[index - 1]?.lineBreakBefore === 'join' || all[index + 1]?.lineBreakBefore === 'join')) word.lineBreakBefore = 'edge'; });
  }
  return validateNativeDocument({ version: 1, animationAuthority: 'premiere-effect', sequenceId: nativePanelSequenceId(sequenceId), captions, style, timeOriginSeconds, binaryVersion: 10 });
}

function hexColor(color: NativeColor): string {
  return '#' + [color.r, color.g, color.b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
}
function editColor(previous: NativeColor, value: string): NativeColor {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Native caption colors require six-digit hex values.');
  return { r: Number.parseInt(value.slice(1, 3), 16) / 255, g: Number.parseInt(value.slice(3, 5), 16) / 255, b: Number.parseInt(value.slice(5, 7), 16) / 255, a: previous.a };
}
function panelWord(native: NativeWordStyle, textCase: WordAppearance['textTransform']): WordAppearance {
  return { fontFamily: native.fontFamily, fontWeight: native.fontWeight??400, fontWeightOffset: native.fontWeightOffset??null, fontSize: native.fontSize * native.sizeScale, sizeScale: native.sizeScale,
    italic: native.italic??false, ...(native.underline===undefined?{}:{underline:native.underline}), letterSpacing: 0, textTransform: textCase, color: hexColor(native.color), opacity: native.opacity,
    bubble: native.bubble, bubbleFillSpaces: native.bubbleFillSpaces ?? false, bubbleColor: hexColor(native.bubbleColor), bubbleOpacity: native.bubbleColor.a, padding: native.padding, ...(native.paddingTop===undefined?{}:{paddingTop:native.paddingTop}), ...(native.paddingRight===undefined?{}:{paddingRight:native.paddingRight}), ...(native.paddingBottom===undefined?{}:{paddingBottom:native.paddingBottom}), ...(native.paddingLeft===undefined?{}:{paddingLeft:native.paddingLeft}), ...(native.radiusTL===undefined?{}:{radiusTL:native.radiusTL}), ...(native.radiusTR===undefined?{}:{radiusTR:native.radiusTR}), ...(native.radiusBR===undefined?{}:{radiusBR:native.radiusBR}), ...(native.radiusBL===undefined?{}:{radiusBL:native.radiusBL}), ...(native.marginTop===undefined?{}:{marginTop:native.marginTop}), ...(native.marginRight===undefined?{}:{marginRight:native.marginRight}), ...(native.marginBottom===undefined?{}:{marginBottom:native.marginBottom}), ...(native.marginLeft===undefined?{}:{marginLeft:native.marginLeft}),  ...(native.bubblePaddingInline===undefined?{}:{bubblePaddingInline:native.bubblePaddingInline}), ...(native.bubblePaddingBlock===undefined?{}:{bubblePaddingBlock:native.bubblePaddingBlock}), radius: native.radius,
    strokeEnabled: native.outlineWidth > 0, strokeWidth: native.outlineWidth, strokeColor: hexColor(native.outlineColor), strokeOpacity: native.outlineColor.a,
    shadowEnabled: native.shadowColor.a > 0 && (native.shadowBlur > 0 || native.shadowX !== 0 || native.shadowY !== 0), shadowColor: hexColor(native.shadowColor), shadowOpacity: native.shadowColor.a,
    shadowBlur: native.shadowBlur, shadowOffsetX: native.shadowX, shadowOffsetY: native.shadowY };
}
function bindingSnapshot(entry: NativePanelEntry): CepNativeSnapshot {
  // Reuse the existing bounded locator validation; script generation executes nothing.
  buildCepNativeReadScript(entry.locator);
  if (!normalizeNativeMatchName(entry.matchName) || entry.kind !== 'native-effect' || typeof entry.revision !== 'string' || entry.revision.length > MAX_NATIVE_CARRIER_BYTES) throw new Error('Invalid native caption connection.');
  let revision;
  try { revision = JSON.parse(entry.revision); } catch { throw new Error('Invalid native caption revision.'); }
  if (!revision || revision.projectPath !== entry.locator.projectPath || revision.sequenceId !== entry.locator.sequenceId || revision.clipNodeId !== entry.clipNodeId || entry.locator.clipNodeId !== entry.clipNodeId || !(revision.adjustmentLayer === true || validTransparentCarrier(revision, entry.projectItemId)) || revision.documentIndex !== entry.locator.documentParamIndex || revision.documentText !== entry.documentText || !Array.isArray(revision.components) || revision.components.filter((name: unknown) => normalizeNativeMatchName(name)).length !== 1 || !normalizeNativeMatchName(revision.components[entry.locator.componentIndex])) throw new Error('Native caption revision identity differs.');
  for (const [field, revisionField] of [['startTicks', 'start'], ['endTicks', 'end'], ['inTicks', 'inPoint'], ['outTicks', 'outPoint']] as const) {
    if (entry[field] !== revision[revisionField]) throw new Error('Native caption timing changed.');
    tickSeconds(entry[field]);
  }
  if (entry.trackIndex !== entry.locator.trackIndex || entry.clipIndex !== entry.locator.clipIndex || tickSeconds(entry.endTicks) <= tickSeconds(entry.startTicks)) throw new Error('Native caption container changed.');
  return { locator: clone(entry.locator), revision: entry.revision };
}

/** Derive editor-only phrase rows. The native renderer groups using explicit boundaries and Characters per line. */
export function deriveNativePanelPhrases(_binding: NativePanelBinding, session: SessionState): CaptionItem[] {
  return nativeCaptionPhrases(session.captions, session.style.maxChars);
}

function nativeFitOptions(binding:NativePanelBinding,session:SessionState){
  const clip=binding.clip;
  const width = clip.lineFitWidth, scale = clip.lineFitFontScale;
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 8192 || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 16) throw new Error('Native line fit geometry is unavailable. Refresh S-Captions.');
  const overrides = clip.lineFitStates;
  if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides) || Object.keys(overrides).length !== 3 || !['upcoming','current','spoken'].every(key => Object.hasOwn(overrides,key) && overrides[key as keyof NativeLineFitStates] !== undefined))) throw new Error('Invalid native line fit state overrides.');
  const appearances = pairs.map(([key,nativeKey]) => applyNativeFitState(resolveAppearance(session.style,key),scale,overrides?.[nativeKey]));
  return {width,wordSpacing:session.style.wordSpacing??binding.document.style.wordSpacing,appearances};
}

/** Measures how many characters fit one line at the layer's Width and font, for the line fit button. */
export function nativeLineFitCharacterCapacity(binding:NativePanelBinding,session:SessionState,measure:SmartFitMeasure|null=createCanvasWordMeasure()):number|null{
  if(binding.clip.lineFitWidth===undefined||binding.clip.lineFitFontScale===undefined)return null;
  const options=nativeFitOptions(binding,session);
  return measure?smartFitCharacterCapacity(session.captions,options,measure):null;
}

export function rehydrateNativePanel(entry: NativePanelEntry, sequence: SequenceInfo) {
  const snapshot = bindingSnapshot(entry);
  if (nativePanelSequenceId(snapshot.locator.sequenceId) !== nativePanelSequenceId(sequence.id)) throw new Error('The native caption belongs to another sequence.');
  if (![sequence.frameWidth, sequence.frameHeight, sequence.frameRate, sequence.duration].every(Number.isFinite) || sequence.frameWidth < 1 || sequence.frameHeight < 1 || sequence.frameRate <= 0 || sequence.duration < 0) throw new Error('Invalid active sequence metadata.');
  const document = decodeNativePanelDocument(entry.documentText, snapshot.locator.sequenceId);
  const timelineOffsetSeconds = document.timeOriginSeconds - (tickSeconds(entry.inTicks) - tickSeconds(entry.startTicks));
  const style: StyleConfig = { ...clone(DEFAULT_STYLE), maxChars: validateCharacterLimit(entry.maxChars ?? DEFAULT_STYLE.maxChars), fontFamily: document.style.upcoming.fontFamily, fontSize: document.style.upcoming.fontSize,
    fontWeight: document.style.baseFontWeight??document.style.upcoming.fontWeight??400, textColor: hexColor(document.style.upcoming.color), strokeEnabled: document.style.upcoming.outlineWidth > 0,
    strokeColor: hexColor(document.style.upcoming.outlineColor), strokeOpacity: document.style.upcoming.outlineColor.a, strokeWidth: document.style.upcoming.outlineWidth,
    shadowEnabled: document.style.upcoming.shadowColor.a > 0 && (document.style.upcoming.shadowBlur > 0 || document.style.upcoming.shadowX !== 0 || document.style.upcoming.shadowY !== 0),
    shadowColor: hexColor(document.style.upcoming.shadowColor), shadowOpacity: document.style.upcoming.shadowColor.a, shadowBlur: document.style.upcoming.shadowBlur,
    shadowOffsetX: document.style.upcoming.shadowX, shadowOffsetY: document.style.upcoming.shadowY, backgroundEnabled: false, textAlign: 'center',
    lineHeight: document.style.lineHeight, wordSpacing: document.style.wordSpacing, textTransform: document.style.letterCase ?? (document.style.titleCase ? 'titlecase' : 'none'),
    upcomingWord: panelWord(document.style.upcoming, document.style.letterCase ?? (document.style.titleCase ? 'titlecase' : 'none')), activeWord: panelWord(document.style.current, document.style.letterCase ?? (document.style.titleCase ? 'titlecase' : 'none')), spokenWord: panelWord(document.style.spoken, document.style.letterCase ?? (document.style.titleCase ? 'titlecase' : 'none')) };
  const captions: CaptionItem[] = nativeCaptionPhrases(document.captions.map(caption => ({ id: caption.id, text: caption.words.map(word => word.text).join(' '),
    startTime: caption.start + timelineOffsetSeconds, endTime: caption.end + timelineOffsetSeconds, manualSplit: caption.manualSplit, timelineFloor: timelineOffsetSeconds,
    words: caption.words.map(word => ({ text: word.text, startTime: word.start + timelineOffsetSeconds, endTime: word.end + timelineOffsetSeconds, endOfSentence: word.endOfSentence, ...(word.lineBreakBefore === undefined ? {} : { lineBreakBefore: word.lineBreakBefore }), ...(word.pauseLinesRemoved === undefined ? {} : { pauseLinesRemoved: word.pauseLinesRemoved }), isActive: false })) })), style.maxChars);
  const session: SessionState = { sequenceId: sequence.id, sequenceName: sequence.name, transcriptJson: null, captions, style, animation: { ...clone(DEFAULT_ANIMATION), preset: 'karaoke' },
    hasTranscript: captions.length > 0, isLoading: false, currentTime: sequence.playhead ?? 0, duration: sequence.duration, frameRate: sequence.frameRate, frameWidth: sequence.frameWidth, frameHeight: sequence.frameHeight };
  const binding: NativePanelBinding = { snapshot, document: clone(document), baseline: clone(session), timelineOffsetSeconds, clip: clone(entry) };
  const warnings = [
    'Native Position, Width, Height and animated overrides remain in Premiere Effect Controls. Panel edits do not rewrite their keyframes.',
    'Native typography supports available font weights, relative B and real or synthetic italic. Letter spacing, alignment and whole-caption backgrounds remain unsupported.',
    `Native word spacing is edited in pixels. Outline and shadow toggles map to native outline width and shadow opacity; remembered disabled values stay in this editing session.`,
  ];
  warnings.push('Native text case supports shared As typed, Uppercase, Lowercase or ASCII Title Case; the source transcript is preserved.');
  if (captions.some(caption => caption.startTime < 0)) warnings.push('Some preserved source caption times precede sequence zero after this layer move; no source words were clipped or removed.');
  return { session, binding, warnings, capabilities: NATIVE_PANEL_CAPABILITIES };
}

function unsupported(field: string): never { throw new Error(`Native captions cannot apply ${field}. Edit supported document styles or use Premiere Effect Controls; the native document was preserved.`); }
function updateWord(previous: NativeWordStyle, before: ReturnType<typeof resolveAppearance>, after: ReturnType<typeof resolveAppearance>, beforeRaw: Partial<WordAppearance>|undefined, afterRaw: Partial<WordAppearance>|undefined): NativeWordStyle {
  const result = clone(previous);
  if (before.fontFamily !== after.fontFamily) result.fontFamily = after.fontFamily;
  if(before.fontWeight!==after.fontWeight||beforeRaw?.fontWeight!==afterRaw?.fontWeight||beforeRaw?.fontWeightOffset!==afterRaw?.fontWeightOffset){result.fontWeight=after.fontWeight;result.fontWeightOffset=afterRaw?.fontWeightOffset??null;}
  if(before.italic!==after.italic||beforeRaw?.italic!==afterRaw?.italic)result.italic=after.italic;
  if(beforeRaw?.underline!==afterRaw?.underline){if(afterRaw?.underline===undefined)delete result.underline;else result.underline=afterRaw.underline;}
  if (before.fontSize !== after.fontSize) result.fontSize = after.fontSize / result.sizeScale;
  if (before.color !== after.color) result.color = editColor(result.color, after.color);
  if (before.opacity !== after.opacity) result.opacity = after.opacity;
  if (before.bubbleFillSpaces !== after.bubbleFillSpaces) { if(after.bubbleFillSpaces) result.bubbleFillSpaces=true; else delete result.bubbleFillSpaces; }
  if (before.bubble !== after.bubble) result.bubble = after.bubble;
  if (before.bubbleColor !== after.bubbleColor) result.bubbleColor = editColor(result.bubbleColor, after.bubbleColor);
  if (before.bubbleOpacity !== after.bubbleOpacity) result.bubbleColor.a = after.bubbleOpacity;
  if (before.padding !== after.padding) result.padding = after.padding;
  for(const axis of ['bubblePaddingInline','bubblePaddingBlock','paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const)if(beforeRaw?.[axis]!==afterRaw?.[axis]){if(afterRaw?.[axis]===undefined)delete result[axis];else result[axis]=afterRaw[axis];}
  if (before.radius !== after.radius) result.radius = after.radius;
  if (before.strokeEnabled !== after.strokeEnabled || before.strokeWidth !== after.strokeWidth) result.outlineWidth = after.strokeEnabled ? (after.strokeWidth > 0 ? after.strokeWidth : 2) : 0;
  if (before.strokeColor !== after.strokeColor) result.outlineColor = editColor(result.outlineColor, after.strokeColor);
  if (before.strokeOpacity !== after.strokeOpacity) result.outlineColor.a = after.strokeOpacity;
  if (before.shadowColor !== after.shadowColor) result.shadowColor = editColor(result.shadowColor, after.shadowColor);
  if (before.shadowOpacity !== after.shadowOpacity) result.shadowColor.a = after.shadowOpacity;
  if (before.shadowBlur !== after.shadowBlur) result.shadowBlur = after.shadowBlur;
  if (before.shadowOffsetX !== after.shadowOffsetX) result.shadowX = after.shadowOffsetX;
  if (before.shadowOffsetY !== after.shadowOffsetY) result.shadowY = after.shadowOffsetY;
  const shadowChanged = before.shadowEnabled !== after.shadowEnabled || ['shadowOpacity','shadowBlur','shadowOffsetX','shadowOffsetY'].some(key => before[key as keyof typeof before] !== after[key as keyof typeof after]);
  if (shadowChanged && !after.shadowEnabled) result.shadowColor.a = 0;
  if (before.shadowEnabled !== after.shadowEnabled && after.shadowEnabled) {
    result.shadowColor.a = after.shadowOpacity > 0 ? after.shadowOpacity : .5;
    if (result.shadowBlur === 0 && result.shadowX === 0 && result.shadowY === 0) result.shadowBlur = 4;
  }
  return result;
}

/** Pure preparation. Caller sends one exact-revision write; it never retries one. */
export function prepareNativePanelUpdate(binding: NativePanelBinding, edited: SessionState): NativeDocument {
  const before = binding.baseline;
  if (nativePanelSequenceId(edited.sequenceId) !== nativePanelSequenceId(before.sequenceId) || edited.frameWidth !== before.frameWidth || edited.frameHeight !== before.frameHeight || edited.frameRate !== before.frameRate) throw new Error('The native panel sequence context changed. Reconnect before editing.');
  validateCharacterLimit(edited.style.maxChars);
  if (edited.style.maxChars !== before.style.maxChars && binding.clip.maxChars === undefined) unsupported('an animated or unavailable character limit');
  for (const key of unsupportedGlobal) if (!same(edited.style[key], before.style[key])) unsupported(`the ${key} setting`);
  if (!same(edited.animation, before.animation)) unsupported('panel animation presets');
  if (!Array.isArray(edited.captions) || edited.captions.length > 10000 || edited.captions.reduce((total, caption) => total + caption.words.length, 0) > 50000) throw new Error('Native panel caption limits exceeded.');
  for (const [key] of pairs) {
    for (const field of unsupportedWord) if (!same(edited.style[key]?.[field], before.style[key]?.[field])) unsupported(`${key}.${field}`);
  }
  const styles = pairs.map(([key]) => resolveAppearance(edited.style, key));
  if (!styles.every(style => style.textTransform === styles[0].textTransform) || !['none', 'titlecase', 'uppercase', 'lowercase'].includes(styles[0].textTransform)) unsupported('different word-state case');
  const document = clone(binding.document);
  document.binaryVersion = 10;
  if(edited.style.fontWeight!==before.style.fontWeight||pairs.some(([key])=>edited.style[key]?.fontWeightOffset!==before.style[key]?.fontWeightOffset&&(edited.style[key]?.fontWeightOffset===0||edited.style[key]?.fontWeightOffset===100)))document.style.baseFontWeight=edited.style.fontWeight;
  for (const [key, nativeKey] of pairs) document.style[nativeKey] = updateWord(document.style[nativeKey], resolveAppearance(before.style, key), resolveAppearance(edited.style, key),before.style[key],edited.style[key]);
  if (edited.style.lineHeight !== before.style.lineHeight) document.style.lineHeight = edited.style.lineHeight;
  if (edited.style.wordSpacing !== before.style.wordSpacing) {
    const spacing = edited.style.wordSpacing;
    if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing < 0 || spacing > 4096) throw new Error('Native word spacing must be between 0 and 4096 pixels.');
    document.style.wordSpacing = spacing;
  }
  document.style.titleCase = styles[0].textTransform === 'titlecase';
  if (styles[0].textTransform === 'uppercase' || styles[0].textTransform === 'lowercase') document.style.letterCase = styles[0].textTransform; else delete document.style.letterCase;
  const upcoming = document.style.upcoming;
  const projectedBase = { fontFamily: upcoming.fontFamily, fontSize: upcoming.fontSize, textColor: hexColor(upcoming.color),
    strokeEnabled: upcoming.outlineWidth > 0, strokeColor: hexColor(upcoming.outlineColor), strokeOpacity: upcoming.outlineColor.a, strokeWidth: upcoming.outlineWidth,
    shadowEnabled: upcoming.shadowColor.a > 0 && (upcoming.shadowBlur > 0 || upcoming.shadowX !== 0 || upcoming.shadowY !== 0),
    shadowColor: hexColor(upcoming.shadowColor), shadowOpacity: upcoming.shadowColor.a, shadowBlur: upcoming.shadowBlur, shadowOffsetX: upcoming.shadowX, shadowOffsetY: upcoming.shadowY,
    textTransform: document.style.letterCase ?? (document.style.titleCase ? 'titlecase' : 'none') };
  for (const key of Object.keys(projectedBase) as (keyof typeof projectedBase)[]) {
    if (same(edited.style[key], before.style[key])) continue;
    // Disabled sliders retain useful values in the session, while the codec
    // represents their off state with zero outline width / shadow alpha.
    if (key === 'strokeWidth' && !edited.style.strokeEnabled && !projectedBase.strokeEnabled || key === 'shadowOpacity' && !edited.style.shadowEnabled && !projectedBase.shadowEnabled) continue;
    const wanted = edited.style[key], rendered = projectedBase[key];
    if (typeof wanted === 'number' && typeof rendered === 'number' ? Math.abs(wanted - rendered) > 1e-7 : wanted !== rendered) unsupported(`a base ${key} override hidden by the word-state styles`);
  }
  document.captions = edited.captions.map(caption => {
    const original = before.captions.find(item => item.id === caption.id);
    for (const field of ['speaker', 'position', 'clipNodeId', 'projectItemId', 'mediaPath', 'renderBounds', 'motionProfile'] as const) if (!same(caption[field], original?.[field])) unsupported(`caption ${field}`);
    const originalNative = binding.document.captions.find(item => item.id === caption.id);
    const orderedEnvelope = Number.isFinite(caption.startTime) && Number.isFinite(caption.endTime) && caption.endTime > caption.startTime;
    const capturedEnvelope = original && originalNative && Number.isFinite(original.startTime) && Number.isFinite(original.endTime) && original.endTime > original.startTime;
    const containedWords = caption.words.length > 0 && caption.words.every(word => Number.isFinite(word.startTime) && Number.isFinite(word.endTime) && word.endTime > word.startTime && word.startTime >= caption.startTime - 1e-7 && word.endTime <= caption.endTime + 1e-7);
    const wordStart = Math.min(...caption.words.map(word => word.startTime)), wordEnd = Math.max(...caption.words.map(word => word.endTime));
    // Timing tools keep the existing editable container while its first/last
    // word moves inward. Only a captured boundary may remain wider than words;
    // the native document itself always follows the actual source word times.
    const validStart = Math.abs(caption.startTime - wordStart) <= 1e-7 || capturedEnvelope && caption.startTime === original.startTime;
    const validEnd = Math.abs(caption.endTime - wordEnd) <= 1e-7 || capturedEnvelope && caption.endTime === original.endTime;
    if (!orderedEnvelope || !containedWords || caption.text !== caption.words.map(word => word.text).join(' ') || !validStart || !validEnd) throw new Error('Native caption timing follows its word boundaries. Edit the timed words; the native document was preserved.');
    const words = caption.words.map((word, index) => {
      const old = original?.words[index], stored = originalNative?.words[index];
      // Avoid adding/subtracting a floating placement offset to untouched source
      // timestamps. A style edit must not rewrite transcript bytes by rounding.
      if (old && stored && word.text === old.text && word.startTime === old.startTime && word.endTime === old.endTime && word.endOfSentence === old.endOfSentence && word.lineBreakBefore === old.lineBreakBefore && (word.pauseLinesRemoved ?? 0) === (old.pauseLinesRemoved ?? 0)) return clone(stored);
      return { text: word.text, start: old && stored && word.startTime === old.startTime ? stored.start : word.startTime - binding.timelineOffsetSeconds, end: old && stored && word.endTime === old.endTime ? stored.end : word.endTime - binding.timelineOffsetSeconds, endOfSentence: word.endOfSentence === true, ...(word.lineBreakBefore === undefined ? {} : { lineBreakBefore: word.lineBreakBefore }), ...(word.pauseLinesRemoved === undefined ? {} : { pauseLinesRemoved: word.pauseLinesRemoved }) };
    });
    return { id: caption.id, start: Math.min(...words.map(word => word.start)), end: Math.max(...words.map(word => word.end)), manualSplit: caption.manualSplit === true, words };
  });
  // Origin and envelope sequence are owned by the original exact native binding.
  return validateNativeDocument(document);
}

/** The exact-revision snapshot for one document write. A changed limit rides
 * along as grouping, so the host commits the scalar and the document's edit
 * token in one Premiere transaction: one Undo restores both. */
export function nativeDocumentWriteSnapshot(binding: NativePanelBinding, edited: SessionState): CepNativeSnapshot & { grouping?: { before: number; value: number } } {
  if (edited.style.maxChars === binding.baseline.style.maxChars) return clone(binding.snapshot);
  if (binding.clip.maxChars === undefined) unsupported('an animated or unavailable character limit');
  return { ...clone(binding.snapshot), grouping: { before: binding.clip.maxChars, value: edited.style.maxChars } };
}

export function confirmNativePanelUpdate(binding: NativePanelBinding, prepared: NativeDocument, edited: SessionState, response: { revision: string; documentText: string; maxChars?: number }): NativePanelBinding {
  const expected = encodeNativeTransportText(prepared);
  if (encodeNativeTransportText(prepareNativePanelUpdate(binding, edited)) !== expected) throw new Error('Native readback does not match the prepared panel edit.');
  if (response.documentText !== expected) throw new Error('Native document readback differs. Inspect the current layer before another action.');
  if (edited.style.maxChars !== binding.baseline.style.maxChars && response.maxChars !== edited.style.maxChars) throw new Error('Premiere did not confirm the character limit.');
  const entry = { ...clone(binding.clip), ...(response.maxChars === undefined ? {} : { maxChars: response.maxChars }), revision: response.revision, documentText: response.documentText };
  const snapshot = bindingSnapshot(entry);
  return { ...clone(binding), snapshot, document: clone(prepared), baseline: clone(edited), clip: entry };
}
