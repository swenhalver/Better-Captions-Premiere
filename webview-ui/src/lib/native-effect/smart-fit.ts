import { MAX_CAPTION_CHARS, type CaptionItem, type TextTransform } from '../types.ts';
import type { ResolvedAppearance } from '../appearance.ts';
import { installedFont } from '../font-catalog.ts';
import type { NativeLineFitState } from '../../cep-api.ts';

// The panel's Smart line fit button measures how many characters fit one line at the
// layer's Width and font, then writes that number into Characters per caption. The
// native renderer only ever groups by that character count.

/** Returns glyph advance in pixels, excluding bubble padding. The style's
 * fontSize is already effective (state scale and native global scale applied). */
export type SmartFitMeasure = (text: string, appearance: ResolvedAppearance) => number;
export interface SmartFitOptions {
  width: number;
  wordSpacing: number;
  appearances: readonly ResolvedAppearance[];
}

/** Matches the native ASCII title-case rule (words with an existing capital are kept); Unicode upper/lower mirrors the
 * macOS rasterizer's Unicode case transform, without modifying source words. */
export function smartFitDisplayText(text: string, mode: TextTransform): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'lowercase') return text.toLowerCase();
  if (mode !== 'titlecase') return text;
  return text.split(/([-. \t])/).map(word => {
    if (/[A-Z]/.test(word)) return word;
    const first = word.search(/[a-z\u0080-\u{10FFFF}]/u);
    return first < 0 || word.codePointAt(first)! >= 128 ? word : word.slice(0, first) + word[first].toUpperCase() + word.slice(first + 1);
  }).join('');
}

/** Match render_style.hpp: state Size% affects font size, Bubble overrides
 * document mode, and Padding% affects padding. Global size scales fonts only. */
export function applyNativeFitState(appearance: ResolvedAppearance, globalFontScale: number, control?: NativeLineFitState): ResolvedAppearance {
  const override = control === undefined ? { sizeScale: 1, bubbleMode: 1, paddingScale: 1 } : control;
  if (typeof override !== 'object' || override === null || Array.isArray(override) || Object.keys(override).some(key => !['sizeScale','bubbleMode','paddingScale'].includes(key)) ||
    !Number.isFinite(override.sizeScale) || override.sizeScale < .01 || override.sizeScale > 4 || !Number.isInteger(override.bubbleMode) || override.bubbleMode < 1 || override.bubbleMode > 3 ||
    !Number.isFinite(override.paddingScale) || override.paddingScale < 0 || override.paddingScale > 4 || !Number.isFinite(globalFontScale) || globalFontScale <= 0 || globalFontScale > 16) throw new Error('Invalid native line fit state overrides.');
  return { ...appearance, paddingTop:appearance.paddingTop*override.paddingScale,paddingRight:appearance.paddingRight*override.paddingScale,paddingBottom:appearance.paddingBottom*override.paddingScale,paddingLeft:appearance.paddingLeft*override.paddingScale, fontSize: appearance.fontSize * override.sizeScale * globalFontScale, padding: appearance.padding * override.paddingScale, bubblePaddingInline: (appearance.bubblePaddingInline??appearance.padding)*override.paddingScale, bubblePaddingBlock: (appearance.bubblePaddingBlock??appearance.padding)*override.paddingScale,
    bubble: override.bubbleMode === 1 ? appearance.bubble : override.bubbleMode === 2 };
}

/** Approximate one-line character capacity using the transcript's measured glyph mix,
 * the worst word-state advance and a 5% safety margin. */
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

/** Per-word advance (widest word state or line position style, inline bubble padding and margins) and the usable line width. */
function smartFitMetrics(options: SmartFitOptions, measure: SmartFitMeasure) {
  const { width, wordSpacing, appearances } = options;
  if (!Number.isFinite(width) || width <= 0 || width > 8192 || !Number.isFinite(wordSpacing) || wordSpacing < 0 || wordSpacing > 4096 || appearances.length < 3 || typeof measure !== 'function') throw new Error('Invalid native line fit configuration.');
  const usableWidth = width * .95;
  const cache = new Map<string, number>();
  const advance = (text: string) => {
    const cached = cache.get(text); if (cached !== undefined) return cached;
    const value = Math.max(...appearances.map(appearance => {
      if (!Number.isFinite(appearance.fontSize) || appearance.fontSize <= 0 || !Number.isFinite(appearance.padding) || appearance.padding < 0) throw new Error('Invalid line fit typography.');
      const measured = measure(smartFitDisplayText(text, appearance.textTransform), appearance);
      if (!Number.isFinite(measured) || measured < 0 || measured > 1e9) throw new Error('Native line fit measurement failed.');
      const inlinePad=(appearance.paddingLeft+appearance.paddingRight)/2;if(!Number.isFinite(inlinePad)||inlinePad<0)throw new Error('Invalid line fit padding.');
      return Math.max(0,measured + 2 * inlinePad+appearance.marginLeft+appearance.marginRight);
    }));
    cache.set(text, value); return value;
  };
  return {advance,usableWidth};
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
