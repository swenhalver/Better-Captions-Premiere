import type { StyleConfig, WordAppearance } from './types';
import { resolveFontWeight, nextFontWeight } from './font-catalog.ts';

export type WordStateKey = 'upcomingWord' | 'activeWord' | 'spokenWord';
export type ResolvedAppearance = Required<WordAppearance>;
/** Missing per-state effects inherit the old global values when loading earlier sessions. */
export function resolveAppearance(style: StyleConfig, key: WordStateKey): ResolvedAppearance {
  const base: ResolvedAppearance = {
    fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontWeightOffset: null, fontSize: style.fontSize,
    sizeScale: 1, color: style.textColor, opacity: 1, italic: false, underline: false, letterSpacing: 0,
    textTransform: style.textTransform, bubble: false, bubbleColor: '#000000',
    bubbleOpacity: 1, bubbleFillSpaces: false, padding: 8, bubblePaddingInline: 8, bubblePaddingBlock: 8, radius: 10, paddingTop: 8, paddingRight: 8, paddingBottom: 8, paddingLeft: 8, radiusTL: 10, radiusTR: 10, radiusBR: 10, radiusBL: 10, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    strokeEnabled: style.strokeEnabled, strokeColor: style.strokeColor,
    strokeOpacity: style.strokeOpacity, strokeWidth: style.strokeWidth,
    shadowEnabled: style.shadowEnabled, shadowColor: style.shadowColor,
    shadowOpacity: style.shadowOpacity, shadowBlur: style.shadowBlur,
    shadowOffsetX: style.shadowOffsetX, shadowOffsetY: style.shadowOffsetY,
  };
  const saved = style[key];
  const family = saved?.fontFamily || style.fontFamily;
  return { ...base, ...saved, fontFamily: family,
    bubblePaddingInline: saved?.bubblePaddingInline ?? saved?.padding ?? base.padding,
    bubblePaddingBlock: saved?.bubblePaddingBlock ?? saved?.padding ?? base.padding,
    paddingTop: saved?.paddingTop ?? saved?.bubblePaddingBlock ?? saved?.padding ?? base.padding,
    paddingRight: saved?.paddingRight ?? saved?.bubblePaddingInline ?? saved?.padding ?? base.padding,
    paddingBottom: saved?.paddingBottom ?? saved?.bubblePaddingBlock ?? saved?.padding ?? base.padding,
    paddingLeft: saved?.paddingLeft ?? saved?.bubblePaddingInline ?? saved?.padding ?? base.padding,
    radiusTL: saved?.radiusTL ?? saved?.radius ?? base.radius,
    radiusTR: saved?.radiusTR ?? saved?.radius ?? base.radius,
    radiusBR: saved?.radiusBR ?? saved?.radius ?? base.radius,
    radiusBL: saved?.radiusBL ?? saved?.radius ?? base.radius,
    marginTop: saved?.marginTop ?? 0,
    marginRight: saved?.marginRight ?? 0,
    marginBottom: saved?.marginBottom ?? 0,
    marginLeft: saved?.marginLeft ?? 0,
    fontWeight: saved?.fontWeightOffset === 100 ? nextFontWeight(family, style.fontWeight)
      : resolveFontWeight(family, saved?.fontWeightOffset === 0 ? style.fontWeight : saved?.fontWeight ?? style.fontWeight),
    fontSize: saved?.fontSize ?? style.fontSize * (saved?.sizeScale ?? 1) };
}

export function effectPadding(a: ResolvedAppearance): number {
  return (a.strokeEnabled ? a.strokeWidth : 0) +
    (a.shadowEnabled ? Math.max(Math.abs(a.shadowOffsetX), Math.abs(a.shadowOffsetY)) + 2 * a.shadowBlur : 0);
}
