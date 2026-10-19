import { MAX_CAPTION_CHARS, type CaptionItem, type CaptionSegment, type TextTransform } from '../types.ts';
import type { ResolvedAppearance } from '../appearance.ts';
import { installedFont } from '../font-catalog.ts';
import type { NativeLineFitState } from '../../cep-api.ts';

/** Returns glyph advance in pixels, excluding bubble padding. The style's
 * fontSize is already effective (state scale and native global scale applied). */
export type SmartFitMeasure = (text: string, appearance: ResolvedAppearance) => number;
export interface SmartFitOptions {
  width: number;
  wordSpacing: number;
  appearances: readonly ResolvedAppearance[];
  pause?: number;
}

/** Matches the native ASCII title-case rule; Unicode upper/lower mirrors the
 * macOS rasterizer's Unicode case transform, without modifying source words. */
export function smartFitDisplayText(text: string, mode: TextTransform): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'lowercase') return text.toLowerCase();
  if (mode !== 'titlecase') return text;
  let initial = true, result = '';
  for (const character of text) {
    if (character.codePointAt(0)! >= 128) { initial = false; result += character; continue; }
    if (/[a-zA-Z]/.test(character)) { result += initial ? character.toUpperCase() : character.toLowerCase(); initial = false; }
    else { result += character; if (character === '-' || character === ' ' || character === '\t') initial = true; }
  }
  return result;
}

/** Match render_style.hpp: state Size% affects font size, Bubble overrides
 * document mode, and Padding% affects padding. Global size scales fonts only. */
export function applyNativeFitState(appearance: ResolvedAppearance, globalFontScale: number, control?: NativeLineFitState): ResolvedAppearance {
  const override = control === undefined ? { sizeScale: 1, bubbleMode: 1, paddingScale: 1 } : control;
  if (typeof override !== 'object' || override === null || Array.isArray(override) || Object.keys(override).some(key => !['sizeScale','bubbleMode','paddingScale'].includes(key)) ||
    !Number.isFinite(override.sizeScale) || override.sizeScale < .01 || override.sizeScale > 4 || !Number.isInteger(override.bubbleMode) || override.bubbleMode < 1 || override.bubbleMode > 3 ||
    !Number.isFinite(override.paddingScale) || override.paddingScale < 0 || override.paddingScale > 4 || !Number.isFinite(globalFontScale) || globalFontScale <= 0 || globalFontScale > 16) throw new Error('Invalid native smart line fit state overrides.');
  return { ...appearance, fontSize: appearance.fontSize * override.sizeScale * globalFontScale, padding: appearance.padding * override.paddingScale,
    bubble: override.bubbleMode === 1 ? appearance.bubble : override.bubbleMode === 2 };
}

/** Approximate character capacity using the transcript's measured glyph mix.
 * Actual Smart groups still use whole-word pixel fitting, not this estimate. */
export function smartFitCharacterCapacity(captions: CaptionItem[], options: SmartFitOptions, measure: SmartFitMeasure): number | null {
  const {advance, usableWidth}=smartFitMetrics(options,measure);
  let pixels=0,characters=0;
  for(const caption of captions)caption.words.forEach((word,index)=>{
    const spaced=index>0&&!/^[.,!?;:%)\]}]/.test(word.text);
    pixels+=advance(word.text)+(spaced?options.wordSpacing:0);
    characters+=Math.max(...options.appearances.map(appearance=>Array.from(smartFitDisplayText(word.text,appearance.textTransform)).length))+(spaced?1:0);
  });
  if(pixels<=0||characters<=0)return null;
  return Math.max(1,Math.min(MAX_CAPTION_CHARS,Math.floor(usableWidth*characters/pixels)));
}

/** Greedy whole-word groups, fixed for all active-word states and independent
 * of the playhead. Smart mode deliberately ignores the stored character cap.
 * Native rendering remains authoritative for actual font-engine measurement. */
function smartFitMetrics(options: SmartFitOptions, measure: SmartFitMeasure) {
  const { width, wordSpacing, appearances } = options, pause = options.pause ?? .6;
  if (!Number.isFinite(width) || width <= 0 || width > 8192 || !Number.isFinite(wordSpacing) || wordSpacing < 0 || wordSpacing > 4096 || !Number.isFinite(pause) || pause < 0 || appearances.length !== 3 || typeof measure !== 'function') throw new Error('Invalid native smart line fit configuration.');
  const usableWidth = width * .95;
  const cache = new Map<string, number>();
  const advance = (text: string) => {
    const cached = cache.get(text); if (cached !== undefined) return cached;
    const value = Math.max(...appearances.map(appearance => {
      if (!Number.isFinite(appearance.fontSize) || appearance.fontSize <= 0 || !Number.isFinite(appearance.padding) || appearance.padding < 0) throw new Error('Invalid smart line fit typography.');
      const measured = measure(smartFitDisplayText(text, appearance.textTransform), appearance);
      if (!Number.isFinite(measured) || measured < 0 || measured > 1e9) throw new Error('Native smart line fit measurement failed.');
      return measured + (appearance.bubble ? 2 * appearance.padding : 0);
    }));
    cache.set(text, value); return value;
  };
  return {advance,usableWidth};
}

export function smartFitCaptionPhrases(captions: CaptionItem[], options: SmartFitOptions, measure: SmartFitMeasure): CaptionItem[] {
  const {advance,usableWidth}=smartFitMetrics(options,measure);
  const {wordSpacing}=options,pause=options.pause??.6;
  return captions.map(caption => {
    const renderSegments: CaptionSegment[] = [];
    let first = 0, count = 0, occupied = 0;
    const flush = () => {
      if (!count) return;
      const words = caption.words.slice(first, first + count).map(word => ({ ...word }));
      renderSegments.push({ id: `native-fit-${caption.id}-${first}`, words, text: words.map(word => word.text).join(' '), startTime: words[0].startTime, endTime: Math.max(...words.map(word => word.endTime)) });
      count = 0; occupied = 0;
    };
    caption.words.forEach((word, index) => {
      const punctuation = /^[.,!?;:%)\]}]/.test(word.text), pixels = advance(word.text);
      if (count && !punctuation && (occupied + wordSpacing + pixels > usableWidth || word.startTime - caption.words[index - 1].endTime > pause)) flush();
      if (!count) first = index;
      occupied += pixels + (count && !punctuation ? wordSpacing : 0); count++;
      if (word.endOfSentence || /[.!?]$/.test(word.text)) flush();
    });
    flush();
    // group metadata is derived editor state only, never a native document field.
    const { groupingMaxChars: _characterLimit, ...preserved } = caption;
    return { ...preserved, renderSegments };
  });
}

type CanvasMetrics = Pick<TextMetrics, 'width'> & Partial<Pick<TextMetrics, 'actualBoundingBoxLeft' | 'actualBoundingBoxRight'>>;
export interface SmartFitCanvasContext { font: string; measureText(text: string): CanvasMetrics; }

/** System fonts are selected through CSS in an unmounted canvas. Browser and
 * CoreText shaping can differ: this is a panel projection, not pixel equality.
 * No canvas means no guessed font metrics; the caller uses character grouping. */
export function createCanvasWordMeasure(context?: SmartFitCanvasContext | null): SmartFitMeasure | null {
  let canvas = context;
  if (canvas === undefined) {
    try {
      if (typeof document !== 'undefined') canvas = document.createElement('canvas').getContext('2d');
      else if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(1, 1).getContext('2d');
    } catch { return null; }
  }
  if (!canvas || typeof canvas.measureText !== 'function') return null;
  const drawing = canvas;
  return (text, appearance) => {
    drawing.font = `${appearance.italic ? 'italic' : 'normal'} ${appearance.fontWeight} ${appearance.fontSize}px ${JSON.stringify(appearance.fontFamily)}`;
    const metrics = drawing.measureText(text);
    // CoreText expands advance for synthetic-italic ink overhang. Real italic
    // faces retain their typographic advance in the native renderer.
    const syntheticItalic = appearance.italic && installedFont(appearance.fontFamily)?.italic !== true;
    return syntheticItalic && Number.isFinite(metrics.actualBoundingBoxLeft) && Number.isFinite(metrics.actualBoundingBoxRight)
      ? Math.max(metrics.width, metrics.actualBoundingBoxRight!) + Math.max(0, metrics.actualBoundingBoxLeft!) : metrics.width;
  };
}
