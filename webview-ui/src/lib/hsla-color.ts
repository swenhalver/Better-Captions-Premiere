/** HSL channels for the picker; the saved caption contract remains hex + alpha. */
export interface HslaColor { h: number; s: number; l: number; a: number; }
const bounded = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

export function hexToHsla(color: string, opacity = 1): HslaColor {
  const expanded = /^#[\da-f]{3}$/i.test(color) ? '#' + [...color.slice(1)].map(channel => channel + channel).join('') : color;
  if (!/^#[\da-f]{6}$/i.test(expanded)) return { h: 0, s: 0, l: 0, a: bounded(opacity, 0, 1) };
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, l = (max + min) / 2;
  let h = 0;
  if (delta) h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s: delta ? delta / (1 - Math.abs(2 * l - 1)) * 100 : 0, l: l * 100, a: bounded(opacity, 0, 1) };
}

export function hslaToHex(value: HslaColor): { color: string; opacity: number } {
  const h = ((bounded(value.h, 0, 360) % 360) + 360) % 360 / 60;
  const s = bounded(value.s, 0, 100) / 100, l = bounded(value.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
  const channels = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return { color: '#' + channels.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join(''), opacity: bounded(value.a, 0, 1) };
}
