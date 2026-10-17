import type { CaptionItem } from '../types';
export type WordEdge = 'startTime' | 'endTime';
const near = (a: number, b: number) => Math.abs(a - b) < .0001;
export function wordEdgeLimits(c: CaptionItem, index: number, edge: WordEdge, fps: number) {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(index) || !c.words[index]) throw new Error('Invalid word or sequence frame rate.');
  const w = c.words[index], p = c.words[index - 1], n = c.words[index + 1];
  const linked = edge === 'startTime' ? !!p && near(p.endTime, w.startTime) : !!n && near(n.startTime, w.endTime);
  const minimum = edge === 'startTime' ? (p ? linked ? p.startTime + 1 / fps : p.endTime : c.startTime) : w.startTime + 1 / fps;
  const maximum = edge === 'startTime' ? w.endTime - 1 / fps : (n ? linked ? n.endTime - 1 / fps : n.startTime : c.endTime);
  return { min: Math.ceil(minimum * fps - 1e-7), max: Math.floor(maximum * fps + 1e-7), linked };
}
export function moveWordEdge(c: CaptionItem, index: number, edge: WordEdge, seconds: number, fps: number): CaptionItem {
  if (!['startTime', 'endTime'].includes(edge) || !Number.isFinite(seconds)) throw new Error('Enter a valid word time.');
  const limits = wordEdgeLimits(c, index, edge, fps);
  if (limits.min > limits.max) throw new Error('This word has no spare frame. Adjust the caption timing first.');
  const value = Math.max(limits.min, Math.min(limits.max, Math.round(seconds * fps))) / fps;
  const words = c.words.map(w => ({ ...w }));
  words[index][edge] = value;
  if (limits.linked) words[index + (edge === 'startTime' ? -1 : 1)][edge === 'startTime' ? 'endTime' : 'startTime'] = value;
  return { ...c, words, timingEstimated: false };
}
