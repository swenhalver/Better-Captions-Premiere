import type { CaptionItem } from '../types';
import { validateCaptions } from './edit.ts';
export type WordEdge = 'startTime' | 'endTime';
export const MIN_WORD_FRAMES = 3;
export function wordEdgeLimits(c: CaptionItem, index: number, edge: WordEdge, fps: number) {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(index) || !c.words[index]) throw new Error('Invalid word or sequence frame rate.');
  const w = c.words[index], p = c.words[index - 1], n = c.words[index + 1];
  const minimum = edge === 'startTime' ? Math.max(c.startTime, p ? p.endTime : c.startTime) : w.startTime + MIN_WORD_FRAMES / fps;
  const maximum = edge === 'startTime' ? w.endTime - MIN_WORD_FRAMES / fps : Math.min(c.endTime, n ? n.startTime : c.endTime);
  return { min: Math.ceil(minimum * fps - 1e-7), max: Math.floor(maximum * fps + 1e-7) };
}
export function moveWordEdge(c: CaptionItem, index: number, edge: WordEdge, seconds: number, fps: number): CaptionItem {
  if (!['startTime', 'endTime'].includes(edge) || !Number.isFinite(seconds)) throw new Error('Enter a valid word time.');
  const limits = wordEdgeLimits(c, index, edge, fps);
  validateCaptions([c]);
  if (limits.min > limits.max) throw new Error('No room for 3 frames.');
  const requested = Math.round(seconds * fps), word = c.words[index];
  const requestedDuration = (edge === 'startTime' ? word.endTime - seconds : seconds - word.startTime) * fps;
  if ((word.endTime - word.startTime) * fps < MIN_WORD_FRAMES - 1e-7 &&
      requestedDuration < MIN_WORD_FRAMES - 1e-7) throw new Error('Word timing needs at least 3 frames.');
  const value = Math.max(limits.min, Math.min(limits.max, requested)) / fps;
  const words = c.words.map(w => ({ ...w }));
  words[index][edge] = value;
  const updated = { ...c, words, timingEstimated: false };
  validateCaptions([updated]);
  return updated;
}
/** Slide from the drag's original timing, shrinking at fixed collisions. */
export function moveWord(c: CaptionItem, index: number, startSeconds: number, fps: number): CaptionItem {
  if (!Number.isFinite(startSeconds)) throw new Error('Enter a valid word time.');
  const start = wordEdgeLimits(c, index, 'startTime', fps), end = wordEdgeLimits(c, index, 'endTime', fps);
  validateCaptions([c]);
  const word = c.words[index], rawFrames = (word.endTime - word.startTime) * fps, frames = Math.round(rawFrames);
  if (rawFrames < MIN_WORD_FRAMES - 1e-7) throw new Error('Word moves need at least 3 frames.');
  const minimum = Math.max(start.min, Math.ceil(c.startTime * fps - 1e-7));
  const maximum = Math.min(end.max, Math.floor(c.endTime * fps + 1e-7));
  if (![frames, minimum, maximum].every(Number.isSafeInteger) || maximum - minimum < MIN_WORD_FRAMES) throw new Error('No room for 3 frames.');
  const translated = Math.round(startSeconds * fps);
  const first = Math.max(minimum, Math.min(maximum - MIN_WORD_FRAMES, translated));
  const last = Math.max(first + MIN_WORD_FRAMES, Math.min(maximum, translated + frames));
  const words = c.words.map(item => ({ ...item }));
  words[index].startTime = first / fps; words[index].endTime = last / fps;
  const updated = { ...c, words, timingEstimated: false };
  validateCaptions([updated]);
  return updated;
}
