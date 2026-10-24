import type { AnimationConfig, StyleConfig } from './types';
import { resolveAppearance } from './appearance.ts';
import { validateStylePatch } from './agent-bridge.ts';

export const PRESET_STORAGE_KEY = 'better-captions-style-presets-v1';
export const PRESET_LIMIT = 200;
export const PRESET_BYTES = 2 * 1024 * 1024;
export type PresetStyle = Omit<StyleConfig, 'positionX' | 'positionY' | 'maxChars'>;
export interface PresetLook { style: PresetStyle; animation: AnimationConfig; }
export interface StylePreset extends PresetLook { id: string; name: string; createdAt: number; updatedAt: number; }
export interface PresetLibrary { version: 1; revision: number; presets: StylePreset[]; }
export const emptyPresetLibrary = (): PresetLibrary => ({ version: 1, revision: 0, presets: [] });

const styleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'textColor', 'strokeEnabled', 'strokeColor', 'strokeOpacity', 'strokeWidth', 'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'backgroundEnabled', 'backgroundColor', 'backgroundOpacity', 'backgroundPadding', 'backgroundRadius', 'textAlign', 'maxWidth', 'lineHeight', 'textTransform', 'activeWord', 'spokenWord', 'upcomingWord'];
const wordKeys = ['fontFamily', 'fontWeight', 'fontSize', 'sizeScale', 'color', 'opacity', 'italic', 'letterSpacing', 'textTransform', 'bubble', 'bubbleColor', 'bubbleOpacity', 'padding', 'radius', 'strokeEnabled', 'strokeColor', 'strokeOpacity', 'strokeWidth', 'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function exact(value: unknown, keys: string[], label: string, optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label}. The saved preset has missing or unsupported fields.`);
}
export function presetName(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Enter a preset name of 1–80 characters.');
  return value.trim();
}
export function validatePresetLook(value: unknown): PresetLook {
  exact(value, ['style', 'animation'], 'preset');
  exact(value.style, styleKeys, 'preset style', ['wordSpacing']);
  for (const state of ['spokenWord', 'activeWord', 'upcomingWord']) exact(value.style[state], wordKeys, 'word style', ['fontWeightOffset', 'bubbleFillSpaces', 'bubblePaddingInline', 'bubblePaddingBlock', 'underline', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft']);
  validateStylePatch(value.style);
  exact(value.animation, ['preset', 'fadeInDuration', 'fadeOutDuration', 'highlightColor'], 'preset animation');
  const a = value.animation;
  if (!['fade', 'pop', 'typewriter', 'karaoke', 'bounce'].includes(String(a.preset)) ||
      typeof a.highlightColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.highlightColor) ||
      [a.fadeInDuration, a.fadeOutDuration].some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 5)) throw new Error('Invalid saved animation settings.');
  return clone(value) as unknown as PresetLook;
}
/** Resolve inheritance so a saved look fully replaces all three word appearances. */
export function capturePresetLook(style: StyleConfig, animation: AnimationConfig): PresetLook {
  const { positionX: _x, positionY: _y, maxChars: _count, ...look } = style;
  return validatePresetLook({ style: { ...look, spokenWord: resolveAppearance(style, 'spokenWord'), activeWord: resolveAppearance(style, 'activeWord'), upcomingWord: resolveAppearance(style, 'upcomingWord') }, animation });
}
export function validatePresetLibrary(value: unknown): PresetLibrary {
  exact(value, ['version', 'revision', 'presets'], 'preset library');
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.presets) || value.presets.length > PRESET_LIMIT || JSON.stringify(value).length > PRESET_BYTES) throw new Error('This preset library is unsupported or too large.');
  const ids = new Set<string>(), names = new Set<string>();
  for (const p of value.presets) {
    exact(p, ['id', 'name', 'createdAt', 'updatedAt', 'style', 'animation'], 'saved preset');
    if (typeof p.id !== 'string' || !/^preset-[a-zA-Z0-9_-]{1,100}$/.test(p.id) || ids.has(p.id)) throw new Error('Invalid or duplicate preset ID.');
    const name = presetName(p.name as string);
    if (name !== p.name || names.has(name.toLowerCase())) throw new Error('A preset with this name already exists. Choose another name or replace the saved preset.');
    if ([p.createdAt, p.updatedAt].some(t => !Number.isSafeInteger(t) || Number(t) < 0) || Number(p.updatedAt) < Number(p.createdAt)) throw new Error('Invalid preset save date.');
    validatePresetLook({ style: p.style, animation: p.animation });
    ids.add(p.id); names.add(name.toLowerCase());
  }
  return clone(value) as unknown as PresetLibrary;
}
export function addStylePreset(library: PresetLibrary, name: string, look: PresetLook, id: string, now = Date.now()): PresetLibrary {
  if (library.presets.length >= PRESET_LIMIT) throw new Error('Your library has 200 presets. Delete an unused preset before saving another.');
  return validatePresetLibrary({ ...library, presets: [...library.presets, { ...validatePresetLook(look), id, name: presetName(name), createdAt: now, updatedAt: now }] });
}
export function changeStylePreset(library: PresetLibrary, id: string, change: { name?: string; look?: PresetLook } | 'delete', now = Date.now()): PresetLibrary {
  if (!library.presets.some(p => p.id === id)) throw new Error('This preset is no longer available. Reload presets and choose another.');
  return validatePresetLibrary({ ...library, presets: change === 'delete' ? library.presets.filter(p => p.id !== id) : library.presets.map(p => p.id !== id ? p : { ...p, ...(change.look ? validatePresetLook(change.look) : {}), name: change.name === undefined ? p.name : presetName(change.name), updatedAt: Math.max(now, p.createdAt) }) });
}
export function applyPresetLook(style: StyleConfig, look: PresetLook): { style: StyleConfig; animation: AnimationConfig } {
  const validated = validatePresetLook(look);
  const { wordSpacing: _previousSpacing, ...current } = style;
  return { style: { ...current, ...validated.style }, animation: validated.animation };
}
