/** Numeric interaction shared by caption styling and native effect controls. */
export interface NumberBounds { min?: number; max?: number; }

export function boundedNumber(value: number, bounds: NumberBounds = {}): number {
  const min = bounds.min ?? -Infinity;
  const max = bounds.max ?? Infinity;
  if (!Number.isFinite(value)) throw new TypeError('A finite number is required');
  return Math.max(min, Math.min(max, Number(value.toFixed(10))));
}

export function scrubMultiplier(modifiers: { shiftKey?: boolean; altKey?: boolean }): number {
  return modifiers.altKey ? .1 : modifiers.shiftKey ? 10 : 1;
}

/** One CSS pixel changes one step, with Shift coarse and Alt fine adjustment. */
export function scrubbedNumber(start: number, deltaPixels: number, step: number, modifiers: { shiftKey?: boolean; altKey?: boolean } = {}, bounds: NumberBounds = {}): number {
  const unit = (step > 0 && Number.isFinite(step) ? step : 1) * scrubMultiplier(modifiers);
  return boundedNumber(start + Math.round(deltaPixels) * unit, bounds);
}

export function parsedNumber(text: string, bounds: NumberBounds = {}): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) ? boundedNumber(value, bounds) : null;
}
