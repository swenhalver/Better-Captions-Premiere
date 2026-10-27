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

export interface CaptionSegmentLane { caption: CaptionItem; start: number; end: number; focusStart: number; focusEnd: number; }

/** The word lane adds one neighbouring word on each side, so a sentence's
 * first and last words can be retimed across the line ending. */
export function captionSegmentLane(container: CaptionItem, segment: CaptionSegment): CaptionSegmentLane | null {
  const range = captionSegmentRange(container, segment);
  if (!range) return null;
  const start = Math.max(0, range.start - 1), end = Math.min(container.words.length, range.end + 1);
  const words = container.words.slice(start, end);
  const caption = { ...container, words, text: words.map(word => word.text).join(' '),
    startTime: start < range.start ? words[0].startTime : container.startTime,
    endTime: end > range.end ? words[words.length - 1].endTime : container.endTime };
  return { caption, start, end, focusStart: range.start - start, focusEnd: range.end - start };
}

/** Word timing edits replace only the lane's words, including its neighbours. */
export function replaceCaptionSegmentLane(container: CaptionItem, segment: CaptionSegment, updated: CaptionItem): CaptionItem {
  const lane = captionSegmentLane(container, segment);
  if (!lane || updated.words.length !== lane.end - lane.start) throw new Error('The sentence changed while it was being edited. Select it again.');
  const words = [...container.words.slice(0, lane.start), ...updated.words.map(word => ({ ...word })), ...container.words.slice(lane.end)];
  const next = { ...container, words, text: words.map(word => word.text).join(' '), timingEstimated: container.timingEstimated || updated.timingEstimated };
  validateCaptions([next]);
  return next;
}
