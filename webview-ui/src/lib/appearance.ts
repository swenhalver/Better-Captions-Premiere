import type { StyleConfig, WordAppearance } from './types';

export type WordStateKey = 'upcomingWord' | 'activeWord' | 'spokenWord';
export type ResolvedAppearance = Required<WordAppearance>;
/** Missing per-state effects inherit the old global values when loading earlier sessions. */
export function resolveAppearance(style: StyleConfig, key: WordStateKey): ResolvedAppearance {
  const base: ResolvedAppearance = {
    fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontWeightOffset: null, fontSize: style.fontSize,
    sizeScale: 1, color: style.textColor, opacity: 1, italic: false, letterSpacing: 0,
    textTransform: style.textTransform, bubble: false, bubbleColor: '#000000',
    bubbleOpacity: 1, padding: 8, radius: 10,
    strokeEnabled: style.strokeEnabled, strokeColor: style.strokeColor,
    strokeOpacity: style.strokeOpacity, strokeWidth: style.strokeWidth,
    shadowEnabled: style.shadowEnabled, shadowColor: style.shadowColor,
    shadowOpacity: style.shadowOpacity, shadowBlur: style.shadowBlur,
    shadowOffsetX: style.shadowOffsetX, shadowOffsetY: style.shadowOffsetY,
  };
  const saved = style[key];
  return { ...base, ...saved, fontFamily: saved?.fontFamily || style.fontFamily,
    fontWeight: saved?.fontWeightOffset === 0 || saved?.fontWeightOffset === 100
      ? Math.min(1000, Math.max(100, style.fontWeight + saved.fontWeightOffset))
      : saved?.fontWeight ?? style.fontWeight,
    fontSize: saved?.fontSize ?? style.fontSize * (saved?.sizeScale ?? 1) };
}

export function effectPadding(a: ResolvedAppearance): number {
  return (a.strokeEnabled ? a.strokeWidth : 0) +
    (a.shadowEnabled ? Math.max(Math.abs(a.shadowOffsetX), Math.abs(a.shadowOffsetY)) + 2 * a.shadowBlur : 0);
}
