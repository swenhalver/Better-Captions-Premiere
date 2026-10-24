import { LINE_STYLE_FIELDS, type LineAppearance, type LinePositionKey, type LineStyleField, type LineStyles, type StyleConfig, type WordAppearance } from './types.ts';
import type { ResolvedAppearance } from './appearance.ts';
import { nextFontWeight, resolveFontWeight } from './font-catalog.ts';

// Line position styles: overrides for a slot of the visible caption window
// (Line 1 is the top line). Precedence is All words, then Past/Current/Next,
// then the line: a field set here wins; unset fields inherit.
export const LINE_POSITIONS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const satisfies readonly LinePositionKey[];
export type LineScope = `line-${LinePositionKey}`;
export const lineScope = (position: LinePositionKey): LineScope => `line-${position}`;
export function lineScopePosition(scope: string): LinePositionKey | null {
  const match = /^line-([1-8])$/.exec(scope);
  return match ? match[1] as LinePositionKey : null;
}

/** Labeled groups, each reset to inherit as one unit from the overrides list. */
export const LINE_STYLE_GROUPS: readonly { label: string; fields: readonly LineStyleField[] }[] = [
  { label: 'Font', fields: ['fontFamily'] }, { label: 'Weight', fields: ['fontWeight', 'fontWeightOffset'] },
  { label: 'Italic', fields: ['italic'] }, { label: 'Underline', fields: ['underline'] }, { label: 'Size', fields: ['fontSize'] },
  { label: 'Color', fields: ['color'] }, { label: 'Opacity', fields: ['opacity'] },
  { label: 'Background', fields: ['bubble', 'bubbleFillSpaces', 'bubbleColor', 'bubbleOpacity'] },
  { label: 'Padding', fields: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] },
  { label: 'Corners', fields: ['radiusTL', 'radiusTR', 'radiusBR', 'radiusBL'] },
  { label: 'Margin', fields: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] },
  { label: 'Outline', fields: ['strokeEnabled', 'strokeWidth', 'strokeColor', 'strokeOpacity'] },
  { label: 'Shadow', fields: ['shadowEnabled', 'shadowOpacity', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'] },
];
/** Fields that only mean something together are set and reset together. */
const pairs: readonly (readonly LineStyleField[])[] = [['fontWeight', 'fontWeightOffset'], ['strokeEnabled', 'strokeWidth'], ['shadowEnabled', 'shadowOpacity']];
const withCompanions = (fields: readonly string[]) => new Set<string>(fields.flatMap((field): readonly string[] => pairs.find(pair => pair.includes(field as LineStyleField)) ?? [field]));

export const lineOverrides = (style: StyleConfig, position: LinePositionKey): LineStyleField[] =>
  LINE_STYLE_FIELDS.filter(field => style.lineStyles?.[position]?.[field] !== undefined);
export const lineOverrideGroups = (style: StyleConfig, position: LinePositionKey) =>
  LINE_STYLE_GROUPS.filter(group => group.fields.some(field => style.lineStyles?.[position]?.[field] !== undefined));
/** Any field of the given controls set on the line; otherwise the control shows an inherited value. */
export const lineSets = (style: StyleConfig, position: LinePositionKey, fields: readonly string[]) =>
  [...withCompanions(fields)].some(field => style.lineStyles?.[position]?.[field as LineStyleField] !== undefined);

function withLine(style: StyleConfig, position: LinePositionKey, line: LineAppearance): Partial<StyleConfig> {
  const lines: LineStyles = { ...style.lineStyles };
  if (Object.keys(line).length) lines[position] = line; else delete lines[position];
  return { lineStyles: Object.keys(lines).length ? lines : undefined };
}

/** Set the patched fields on one line. Fields a line cannot hold (case, letter
 * spacing, uniform padding) are ignored; axis padding sets both of its sides. */
export function lineStylePatch(style: StyleConfig, position: LinePositionKey, patch: Partial<WordAppearance>): Partial<StyleConfig> {
  const line: Record<string, unknown> = { ...style.lineStyles?.[position] };
  const source: Partial<WordAppearance> = { ...patch };
  if (patch.bubblePaddingInline !== undefined) { source.paddingLeft ??= patch.bubblePaddingInline; source.paddingRight ??= patch.bubblePaddingInline; }
  if (patch.bubblePaddingBlock !== undefined) { source.paddingTop ??= patch.bubblePaddingBlock; source.paddingBottom ??= patch.bubblePaddingBlock; }
  for (const field of LINE_STYLE_FIELDS) if (source[field] !== undefined) line[field] = source[field];
  // An absolute weight replaces a relative step, and a relative step an absolute weight.
  if (patch.fontWeight !== undefined && !(patch.fontWeightOffset === 0 || patch.fontWeightOffset === 100)) delete line.fontWeightOffset;
  if ((patch.fontWeightOffset === 0 || patch.fontWeightOffset === 100) && patch.fontWeight === undefined) delete line.fontWeight;
  return withLine(style, position, line as LineAppearance);
}

/** Back to inherit: the fields (and their companions) leave the line. */
export function lineStyleReset(style: StyleConfig, position: LinePositionKey, fields: readonly string[]): Partial<StyleConfig> {
  const remove = withCompanions(fields), line = { ...style.lineStyles?.[position] } as Record<string, unknown>;
  for (const field of remove) delete line[field];
  return withLine(style, position, line as LineAppearance);
}

/** What a line shows: its own fields over the inherited All words appearance. */
export function resolveLineAppearance(style: StyleConfig, position: LinePositionKey, inherited: ResolvedAppearance): ResolvedAppearance {
  const line = style.lineStyles?.[position];
  if (!line) return inherited;
  const result = { ...inherited } as Record<string, unknown>;
  for (const field of LINE_STYLE_FIELDS) if (line[field] !== undefined) result[field] = line[field];
  const family = result.fontFamily as string;
  result.fontWeight = line.fontWeightOffset === 100 ? nextFontWeight(family, style.fontWeight)
    : line.fontWeightOffset === 0 ? resolveFontWeight(family, style.fontWeight)
    : line.fontWeight !== undefined ? resolveFontWeight(family, line.fontWeight) : inherited.fontWeight;
  return result as ResolvedAppearance;
}

/** Smart line fit: a word state's fit appearance as it looks on this line. The
 * line's font size is a document size, so the global font scale applies; the
 * state's Effect Controls percentages do not touch values the line sets. */
export function lineFitAppearance(style: StyleConfig, line: LineAppearance, state: ResolvedAppearance, globalFontScale: number): ResolvedAppearance {
  const result = { ...state } as Record<string, unknown>;
  for (const field of ['fontFamily', 'italic', 'bubble', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const)
    if (line[field] !== undefined) result[field] = line[field];
  if (line.fontSize !== undefined) result.fontSize = line.fontSize * globalFontScale;
  const family = result.fontFamily as string;
  if (line.fontWeightOffset === 100) result.fontWeight = nextFontWeight(family, style.fontWeight);
  else if (line.fontWeightOffset === 0) result.fontWeight = resolveFontWeight(family, style.fontWeight);
  else if (line.fontWeight !== undefined) result.fontWeight = resolveFontWeight(family, line.fontWeight);
  return result as ResolvedAppearance;
}
