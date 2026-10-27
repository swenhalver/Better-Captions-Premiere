export interface InstalledFont {
  family: string;
  weights: number[];
  italic: boolean;
  variable?: { min: number; max: number };
}

let installed: InstalledFont[] = [];
let byFamily = new Map<string, InstalledFont>();
const key = (name: string) => name.trim().normalize('NFC').toLocaleLowerCase();
const weight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1000;

/** The catalogue belongs to this computer, never to a saved caption document. */
export function registerFontCatalog(value: unknown): InstalledFont[] {
  if (!Array.isArray(value) || !value.length || value.length > 30000) throw new Error('The installed font list is empty or invalid.');
  const next = new Map<string, InstalledFont>();
  for (const font of value) {
    if (!font || typeof font.family !== 'string' || !font.family.trim() || font.family.length > 4096 || /[\u0000-\u001f\u007f]/.test(font.family) || !Array.isArray(font.weights) || !font.weights.length || font.weights.length > 2000 || !font.weights.every(weight) || typeof font.italic !== 'boolean') throw new Error('The installed font list contains invalid font metadata.');
    if (font.variable && (!weight(font.variable.min) || !weight(font.variable.max) || font.variable.min > font.variable.max)) throw new Error('The installed variable-font range is invalid.');
    const normalized: InstalledFont = { family: font.family.trim(), weights: [...new Set<number>(font.weights)].sort((a, b) => a - b), italic: font.italic, ...(font.variable ? { variable: { ...font.variable } } : {}) };
    if (next.has(key(normalized.family))) throw new Error('The installed font list contains duplicate families.');
    next.set(key(normalized.family), normalized);
  }
  installed = [...next.values()].sort((a, b) => a.family.localeCompare(b.family));
  byFamily = new Map(installed.map(font => [key(font.family), font]));
  return installed;
}
export const installedFont = (family: string) => byFamily.get(key(family));

export function fontWeightOptions(family: string, catalog?: InstalledFont[]): number[] {
  const font = catalog ? catalog.find(font => key(font.family) === key(family)) : installedFont(family);
  if (!font) return [];
  const values = new Set(font.weights);
  if (font.variable) {
    values.add(font.variable.min); values.add(font.variable.max);
    for (let number = 100; number <= 1000; number += 100) if (number >= font.variable.min && number <= font.variable.max) values.add(number);
  }
  return [...values].sort((a, b) => a - b);
}

export function resolveFontWeight(family: string, requested: number): number {
  const font = installedFont(family);
  if (!font) return requested;
  const candidates = [...font.weights];
  if (font.variable) candidates.push(Math.min(font.variable.max, Math.max(font.variable.min, requested)));
  return candidates.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested) || a - b)[0];
}

export function nextFontWeight(family: string, baseline: number): number {
  const font = installedFont(family);
  if (!font) return Math.min(1000, baseline + 100);
  const candidates = fontWeightOptions(family).filter(value => value > baseline);
  if (font.variable && font.variable.max > baseline) candidates.push(Math.max(font.variable.min, Math.min(font.variable.max, baseline + 100)));
  return candidates.length ? Math.min(...candidates) : resolveFontWeight(family, baseline);
}

export function searchFonts(fonts: string[], query: string): string[] {
  const text = key(query);
  if (!text) return fonts;
  const tokens = text.split(/\s+/);
  return fonts.filter(name => tokens.every(token => key(name).includes(token))).sort((a, b) => Number(!key(a).startsWith(text)) - Number(!key(b).startsWith(text)) || a.localeCompare(b));
}
