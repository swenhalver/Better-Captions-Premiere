import type { LineAppearance, LinePositionKey, LineStyles } from '../types.ts';

/** BCAP version that appends line position styles. Documents without any keep
 * writing the base version, so this is the only number to renumber on merge. */
export const POSITION_STYLES_VERSION = 11;
export const LINE_POSITION_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const satisfies readonly LinePositionKey[];

export interface NativeRgb { r: number; g: number; b: number; }
/** Overrides for one slot of the visible caption window (Line 1 is the top line).
 * Mirrors native PositionStyle: colors carry RGB only, alpha travels in its
 * own opacity field, fontSize is the effective size and italic/underline are
 * explicit. fontWeightOffset 0/100 needs fontWeight (0 when only relative). */
export interface NativeLineStyle {
  fontFamily?: string; fontWeight?: number; fontWeightOffset?: 0 | 100; italic?: boolean; underline?: boolean; fontSize?: number;
  color?: NativeRgb; opacity?: number; bubble?: boolean; bubbleFillSpaces?: boolean; bubbleColor?: NativeRgb; bubbleOpacity?: number;
  paddingTop?: number; paddingRight?: number; paddingBottom?: number; paddingLeft?: number;
  radiusTL?: number; radiusTR?: number; radiusBR?: number; radiusBL?: number;
  marginTop?: number; marginRight?: number; marginBottom?: number; marginLeft?: number;
  outlineWidth?: number; outlineColor?: NativeRgb; outlineOpacity?: number;
  shadowBlur?: number; shadowX?: number; shadowY?: number; shadowColor?: NativeRgb; shadowOpacity?: number;
}
export type NativeLineStyles = Partial<Record<LinePositionKey, NativeLineStyle>>;

type Kind = 'text' | 'weight' | 'mode' | 'flag' | 'number' | 'rgb';
/** Bit order is the wire order; the same table lives in native caption_core.cpp. */
const FIELDS: readonly (readonly [keyof NativeLineStyle, Kind, number?, number?])[] = [
  ['fontFamily', 'text'], ['fontWeight', 'weight'], ['italic', 'mode'], ['underline', 'mode'], ['fontSize', 'number', 0.01, 4096],
  ['color', 'rgb'], ['opacity', 'number', 0, 1], ['bubble', 'flag'], ['bubbleFillSpaces', 'flag'], ['bubbleColor', 'rgb'], ['bubbleOpacity', 'number', 0, 1],
  ['paddingTop', 'number', 0, 4096], ['paddingRight', 'number', 0, 4096], ['paddingBottom', 'number', 0, 4096], ['paddingLeft', 'number', 0, 4096],
  ['radiusTL', 'number', 0, 4096], ['radiusTR', 'number', 0, 4096], ['radiusBR', 'number', 0, 4096], ['radiusBL', 'number', 0, 4096],
  ['marginTop', 'number', -4096, 4096], ['marginRight', 'number', -4096, 4096], ['marginBottom', 'number', -4096, 4096], ['marginLeft', 'number', -4096, 4096],
  ['outlineWidth', 'number', 0, 4096], ['outlineColor', 'rgb'], ['outlineOpacity', 'number', 0, 1],
  ['shadowBlur', 'number', 0, 4096], ['shadowX', 'number', -4096, 4096], ['shadowY', 'number', -4096, 4096], ['shadowColor', 'rgb'], ['shadowOpacity', 'number', 0, 1],
];
const KEYS = new Set<string>([...FIELDS.map(([key]) => key), 'fontWeightOffset']);

function plain(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Line position style value is outside its finite range.');
  return value;
}
function rgb(value: unknown): NativeRgb {
  const c = plain(value, 'line position color');
  if (Object.keys(c).some(key => !['r', 'g', 'b'].includes(key))) throw new Error('Invalid line position color.');
  return { r: finite(c.r, 0, 1), g: finite(c.g, 0, 1), b: finite(c.b, 0, 1) };
}
function family(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > 256 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) throw new Error('Invalid line position font family.');
  return value;
}

/** Canonical copy: known keys only, empty positions dropped, undefined when none. */
export function validateNativeLineStyles(input: unknown): NativeLineStyles | undefined {
  if (input === undefined) return undefined;
  const lines = plain(input, 'line position styles'), result: NativeLineStyles = {};
  for (const [position, value] of Object.entries(lines)) {
    if (!(LINE_POSITION_KEYS as readonly string[]).includes(position)) throw new Error('Line positions are 1 to 8.');
    const source = plain(value, 'line position style'), style: NativeLineStyle = {};
    for (const key of Object.keys(source)) if (!KEYS.has(key)) throw new Error('Unknown line position style: ' + key);
    for (const [key, kind, min = 0, max = 0] of FIELDS) {
      const field = source[key];
      if (field === undefined) continue;
      const target = style as Record<string, unknown>;
      if (kind === 'text') target[key] = family(field);
      else if (kind === 'weight') {
        if (field !== 0) finite(field, 1, 1000); else finite(field, 0, 0);
        target[key] = field;
      } else if (kind === 'mode' || kind === 'flag') { if (typeof field !== 'boolean') throw new Error('Invalid line position flag.'); target[key] = field; }
      else if (kind === 'rgb') target[key] = rgb(field);
      else target[key] = finite(field, min, max);
    }
    if (source.fontWeightOffset !== undefined) {
      if ((source.fontWeightOffset !== 0 && source.fontWeightOffset !== 100) || style.fontWeight === undefined) throw new Error('Invalid line position relative weight.');
      style.fontWeightOffset = source.fontWeightOffset;
    }
    if (style.fontWeight === 0 && style.fontWeightOffset === undefined) throw new Error('A line position weight needs a value.');
    if (Object.keys(style).length) result[position as LinePositionKey] = style;
  }
  return Object.keys(result).length ? result : undefined;
}

export const hasNativeLineStyles = (styles: NativeLineStyles | undefined) => !!styles && Object.keys(styles).length > 0;

interface Writer { u(n: number): void; d(n: number): void; s(text: string): void; }
/** Appended after the v7 style footer of a POSITION_STYLES_VERSION document. */
export function writeNativeLineStyles(w: Writer, styles: NativeLineStyles | undefined): void {
  const present = LINE_POSITION_KEYS.filter(key => styles?.[key] && Object.keys(styles[key]!).length);
  w.u(present.length);
  for (const key of present) {
    const style = styles![key]!;
    let mask = 0;
    FIELDS.forEach(([field], bit) => { if (style[field] !== undefined) mask |= 1 << bit; });
    w.u(Number(key)); w.u(mask >>> 0);
    for (const [field, kind] of FIELDS) {
      const value = style[field];
      if (value === undefined) continue;
      if (kind === 'text') w.s(value as string);
      else if (kind === 'weight') { w.d(value as number); w.u(style.fontWeightOffset === 100 ? 2 : style.fontWeightOffset === 0 ? 1 : 0); }
      else if (kind === 'mode' || kind === 'flag') w.u(Number(value));
      else if (kind === 'rgb') { const c = value as NativeRgb; w.d(c.r); w.d(c.g); w.d(c.b); }
      else w.d(value as number);
    }
  }
}

interface Reader { u(): number; d(): number; flag(): boolean; string(limit: number): string; }
export function readNativeLineStyles(r: Reader): NativeLineStyles | undefined {
  const count = r.u(); if (count > 8) throw new Error('Too many line position styles.');
  const result: Record<string, Record<string, unknown>> = {};
  let previous = 0;
  for (let entry = 0; entry < count; entry++) {
    const position = r.u(); if (position <= previous || position > 8) throw new Error('Invalid line position.'); previous = position;
    const mask = r.u(); if (!mask || mask >= 2 ** FIELDS.length) throw new Error('Invalid line position fields.');
    const style: Record<string, unknown> = {};
    FIELDS.forEach(([field, kind], bit) => {
      if (!((mask >>> bit) & 1)) return;
      if (kind === 'text') style[field] = r.string(256);
      else if (kind === 'weight') { style[field] = r.d(); const mode = r.u(); if (mode > 2) throw new Error('Invalid line position weight mode.'); if (mode) style.fontWeightOffset = mode === 2 ? 100 : 0; }
      else if (kind === 'mode') { const mode = r.u(); if (mode > 1) throw new Error('Invalid line position mode.'); style[field] = mode === 1; }
      else if (kind === 'flag') style[field] = r.flag();
      else if (kind === 'rgb') style[field] = { r: r.d(), g: r.d(), b: r.d() };
      else style[field] = r.d();
    });
    result[String(position)] = style;
  }
  return validateNativeLineStyles(count ? result : undefined);
}

const hex = (c: NativeRgb) => '#' + [c.r, c.g, c.b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
function fromHex(value: string): NativeRgb {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Line position colors require six-digit hex values.');
  return { r: parseInt(value.slice(1, 3), 16) / 255, g: parseInt(value.slice(3, 5), 16) / 255, b: parseInt(value.slice(5, 7), 16) / 255 };
}
const geometry = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;

/** Panel line appearance to its native overrides. Outline and shadow toggles
 * become outline width and shadow opacity, as they do for word states. */
export function nativeLineStyle(line: LineAppearance): NativeLineStyle {
  const n: NativeLineStyle = {};
  if (line.fontFamily !== undefined) n.fontFamily = line.fontFamily;
  const relative = line.fontWeightOffset === 0 || line.fontWeightOffset === 100;
  if (line.fontWeight !== undefined || relative) { n.fontWeight = line.fontWeight ?? 0; if (relative) n.fontWeightOffset = line.fontWeightOffset as 0 | 100; }
  if (line.italic !== undefined) n.italic = line.italic;
  if (line.underline !== undefined) n.underline = line.underline;
  if (line.fontSize !== undefined) n.fontSize = line.fontSize;
  if (line.color !== undefined) n.color = fromHex(line.color);
  if (line.opacity !== undefined) n.opacity = line.opacity;
  if (line.bubble !== undefined) n.bubble = line.bubble;
  if (line.bubbleFillSpaces !== undefined) n.bubbleFillSpaces = line.bubbleFillSpaces;
  if (line.bubbleColor !== undefined) n.bubbleColor = fromHex(line.bubbleColor);
  if (line.bubbleOpacity !== undefined) n.bubbleOpacity = line.bubbleOpacity;
  for (const key of geometry) if (line[key] !== undefined) n[key] = line[key];
  if (line.strokeEnabled !== undefined || line.strokeWidth !== undefined)
    n.outlineWidth = line.strokeEnabled === false ? 0 : line.strokeWidth !== undefined && line.strokeWidth > 0 ? line.strokeWidth : line.strokeEnabled ? 2 : 0;
  if (line.strokeColor !== undefined) n.outlineColor = fromHex(line.strokeColor);
  if (line.strokeOpacity !== undefined) n.outlineOpacity = line.strokeOpacity;
  if (line.shadowEnabled !== undefined || line.shadowOpacity !== undefined)
    n.shadowOpacity = line.shadowEnabled === false ? 0 : line.shadowOpacity !== undefined && line.shadowOpacity > 0 ? line.shadowOpacity : line.shadowEnabled ? .5 : 0;
  if (line.shadowBlur !== undefined) n.shadowBlur = line.shadowBlur;
  if (line.shadowOffsetX !== undefined) n.shadowX = line.shadowOffsetX;
  if (line.shadowOffsetY !== undefined) n.shadowY = line.shadowOffsetY;
  if (line.shadowColor !== undefined) n.shadowColor = fromHex(line.shadowColor);
  return n;
}
export function nativeLineStyles(lines: LineStyles | undefined): NativeLineStyles | undefined {
  const result: NativeLineStyles = {};
  for (const key of LINE_POSITION_KEYS) {
    const line = lines?.[key];
    if (!line) continue;
    const native = nativeLineStyle(line);
    if (Object.keys(native).length) result[key] = native;
  }
  return validateNativeLineStyles(Object.keys(result).length ? result : undefined);
}

/** Native overrides back to the panel's canonical line appearance. */
export function panelLineStyle(n: NativeLineStyle): LineAppearance {
  const line: LineAppearance = {};
  if (n.fontFamily !== undefined) line.fontFamily = n.fontFamily;
  if (n.fontWeight !== undefined) { if (n.fontWeight > 0) line.fontWeight = n.fontWeight; if (n.fontWeightOffset !== undefined) line.fontWeightOffset = n.fontWeightOffset; }
  if (n.italic !== undefined) line.italic = n.italic;
  if (n.underline !== undefined) line.underline = n.underline;
  if (n.fontSize !== undefined) line.fontSize = n.fontSize;
  if (n.color !== undefined) line.color = hex(n.color);
  if (n.opacity !== undefined) line.opacity = n.opacity;
  if (n.bubble !== undefined) line.bubble = n.bubble;
  if (n.bubbleFillSpaces !== undefined) line.bubbleFillSpaces = n.bubbleFillSpaces;
  if (n.bubbleColor !== undefined) line.bubbleColor = hex(n.bubbleColor);
  if (n.bubbleOpacity !== undefined) line.bubbleOpacity = n.bubbleOpacity;
  for (const key of geometry) if (n[key] !== undefined) line[key] = n[key];
  if (n.outlineWidth !== undefined) { line.strokeEnabled = n.outlineWidth > 0; if (n.outlineWidth > 0) line.strokeWidth = n.outlineWidth; }
  if (n.outlineColor !== undefined) line.strokeColor = hex(n.outlineColor);
  if (n.outlineOpacity !== undefined) line.strokeOpacity = n.outlineOpacity;
  if (n.shadowOpacity !== undefined) { line.shadowEnabled = n.shadowOpacity > 0; if (n.shadowOpacity > 0) line.shadowOpacity = n.shadowOpacity; }
  if (n.shadowBlur !== undefined) line.shadowBlur = n.shadowBlur;
  if (n.shadowX !== undefined) line.shadowOffsetX = n.shadowX;
  if (n.shadowY !== undefined) line.shadowOffsetY = n.shadowY;
  if (n.shadowColor !== undefined) line.shadowColor = hex(n.shadowColor);
  return line;
}
export function panelLineStyles(styles: NativeLineStyles | undefined): LineStyles | undefined {
  if (!styles) return undefined;
  const result: LineStyles = {};
  for (const key of LINE_POSITION_KEYS) if (styles[key]) result[key] = panelLineStyle(styles[key]!);
  return Object.keys(result).length ? result : undefined;
}
