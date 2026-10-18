import type { CaptionItem, CaptionSegment } from '../types';
import { validateCaptions } from './edit.ts';

/** A legacy sentence crossing two native clips remains editable in each clip's own word editor. */
export function captionSegmentRange(container: CaptionItem, segment: CaptionSegment): { start: number; end: number } | null {
  if (!segment.words.length) return null;
  const start = container.words.findIndex(word => word.startTime === segment.words[0].startTime);
  if (start < 0 || start + segment.words.length > container.words.length) return null;
  if (!segment.words.every((word, index) => {
    const source = container.words[start + index];
    return word.startTime === source.startTime && word.endTime === source.endTime && word.text === source.text;
  })) return null;
  return { start, end: start + segment.words.length };
}

/** Sentence edits change only that range of words; the native clip keeps its timing and keys. */
export function replaceCaptionSegment(container: CaptionItem, segment: CaptionSegment, updated: CaptionItem): CaptionItem {
  const range = captionSegmentRange(container, segment);
  if (!range) throw new Error('The sentence changed while it was being edited. Select it again.');
  if (updated.startTime < container.startTime - .0001 || updated.endTime > container.endTime + .0001) {
    throw new Error('Keep sentence timing inside its caption clip. Move or extend the clip in Premiere first.');
  }
  const words = [...container.words.slice(0, range.start), ...updated.words.map(word => ({ ...word })), ...container.words.slice(range.end)];
  const next = { ...container, words, text: words.map(word => word.text).join(' '), timingEstimated: container.timingEstimated || updated.timingEstimated };
  validateCaptions([next]);
  return next;
}
