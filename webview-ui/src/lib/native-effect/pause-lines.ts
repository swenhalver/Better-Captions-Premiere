import type { CaptionItem } from '../types.ts';
import { isBlankLine, transcriptLines, transcriptWords, withTranscriptLines } from '../transcript/lines.ts';

export interface PauseLineSettings {
  visibleLines: number;
  /** Seconds per blank row; zero uses the whole stream's average spoken line. */
  blankLineSeconds: number;
}

export interface PauseLine {
  key: string;
  startTime: number;
  endTime: number;
  /** First word of the following text line, in the complete transcript. */
  nextWordIndex: number;
  /** Zero-based surviving row index within this pause. */
  index: number;
}

/** Native silence-row derivation, shared by paged and rolling presentation.
 * Text rows come from current grouping; storage containers add no boundaries.
 * Removing a row changes only its count, never speech or pause timestamps. */
export function derivePauseLines(captions: CaptionItem[], settings: PauseLineSettings): PauseLine[] {
  if (!Number.isInteger(settings.visibleLines) || settings.visibleLines < 1 || settings.visibleLines > 8 ||
      !Number.isFinite(settings.blankLineSeconds) || settings.blankLineSeconds < 0 || settings.blankLineSeconds > 30) {
    throw new Error('Invalid pause line settings.');
  }
  const words = transcriptWords(captions);
  const lines = transcriptLines(captions).map(line => ({ start: line.start, blank: isBlankLine(words.slice(line.start, line.end)),
    startTime: words[line.start].startTime,
    endTime: Math.max(...words.slice(line.start, line.end).map(word => word.endTime)) }));
  if (!lines.length) return [];
  // Blank lines are silence, not speech: they do not set the pace.
  const spoken = lines.filter(line => line.endTime > line.startTime && !line.blank);
  const cadence = settings.blankLineSeconds > 0 ? settings.blankLineSeconds :
    spoken.length ? spoken.reduce((total, line) => total + (line.endTime - line.startTime), 0) / spoken.length : .6;
  const result: PauseLine[] = [];
  for (let line = 1; line < lines.length; line++) {
    const previous = lines[line - 1], next = lines[line];
    const removed = words[next.start].pauseLinesRemoved ?? 0;
    if (!Number.isInteger(removed) || removed < 0 || removed > 8) throw new Error('Invalid removed pause lines.');
    const count = Math.max(0, Math.min(settings.visibleLines, Math.floor((next.startTime - previous.endTime) / cadence)) - removed);
    for (let index = 0; index < count; index++) result.push({ key: `pause:${next.start}:${index}`,
      startTime: previous.endTime + index * cadence,
      endTime: index + 1 < count ? previous.endTime + (index + 1) * cadence : next.startTime,
      nextWordIndex: next.start, index });
  }
  return result;
}

/** Address the following source word rather than a transient rendered row ID.
 * Refresh shared segment copies without changing the current line boundaries. */
export function removePauseLine(captions: CaptionItem[], nextWordIndex: number): CaptionItem[] {
  const lines = transcriptLines(captions), words = transcriptWords(captions);
  if (!Number.isInteger(nextWordIndex) || nextWordIndex <= 0 || nextWordIndex >= words.length ||
      !lines.some(line => line.start === nextWordIndex)) throw new Error('Select the pause line again.');
  const removed = words[nextWordIndex].pauseLinesRemoved ?? 0;
  if (!Number.isInteger(removed) || removed < 0 || removed >= 8) throw new Error('No more pause lines can be removed.');
  let offset = 0;
  const updated = captions.map(caption => ({ ...caption, words: caption.words.map(word => {
    const index = offset++;
    return index === nextWordIndex ? { ...word, pauseLinesRemoved: removed + 1 } : { ...word };
  }) }));
  return withTranscriptLines(updated, lines.map(line => ({ start: line.start, end: line.end, key: line.segment?.id ?? line.key })));
}
