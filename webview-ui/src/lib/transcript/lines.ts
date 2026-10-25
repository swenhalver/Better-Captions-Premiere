import type { CaptionItem, CaptionSegment, CaptionWord } from '../types';
import { isBlankWord, validateCaptions } from './edit.ts';

export interface TranscriptLine {
  key: string;
  caption: CaptionItem;
  segment?: CaptionSegment;
  /** Word offsets in the complete transcript, independent of storage. */
  start: number;
  end: number;
  /** An empty range (start === end), such as a pause row being typed into,
   * has no words of its own; new words go into this time window. */
  window?: { startTime: number; endTime: number };
}
/** A line made of one blank word: a timed row with no visible text. */
export const isBlankLine = (words: CaptionWord[]) => words.length > 0 && words.every(isBlankWord);
export const transcriptWords = (captions: CaptionItem[]) => captions.flatMap(caption => caption.words);
export function captionWordOffset(captions: CaptionItem[], id: string): number {
  let offset = 0;
  for (const caption of captions) {
    if (caption.id === id) return offset;
    offset += caption.words.length;
  }
  throw new Error('Select the line again.');
}
export function lineSegment(words: CaptionWord[], id: string): CaptionSegment {
  if (!words.length) throw new Error('A line needs at least one word.');
  return { id, words: words.map(word => ({ ...word })), text: words.map(word => word.text).join(' '),
    startTime: words[0].startTime, endTime: Math.max(...words.map(word => word.endTime)) };
}
const sameWord = (a: CaptionWord, b: CaptionWord) => a.text === b.text && a.startTime === b.startTime && a.endTime === b.endTime;

/** A rendered line may span any number of storage containers. Duplicate copies
 * of a cross-container render segment are shown once, with complete words. */
export function transcriptLines(captions: CaptionItem[]): TranscriptLine[] {
  const words = transcriptWords(captions), candidates: TranscriptLine[] = [];
  const indices = new Map(words.map((word, index) => [word.startTime, index]));
  const owners = captions.flatMap(caption => caption.words.map(() => caption));
  const offsets = new Map<string, number>();
  let total = 0;
  for (const caption of captions) { offsets.set(caption.id, total); total += caption.words.length; }
  let offset = 0;
  for (const caption of captions) {
    if (caption.renderSegments?.length) {
      for (const segment of caption.renderSegments) {
        const start = indices.get(segment.words[0]?.startTime) ?? -1;
        if (start < 0 || !segment.words.every((word, index) => words[start + index] && sameWord(words[start + index], word))) {
          throw new Error('The rendered lines do not match the transcript. Refresh S-Captions.');
        }
        const owner = owners[start];
        candidates.push({ key: owner.id + ':line-' + (start - offsets.get(owner.id)!), caption: owner, segment, start, end: start + segment.words.length });
      }
    } else candidates.push({ key: caption.id + ':line-0', caption, start: offset, end: offset + caption.words.length });
    offset += caption.words.length;
  }
  const rows: TranscriptLine[] = [];
  for (const row of candidates.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = rows.at(-1);
    if (previous?.start === row.start && previous.end === row.end) continue;
    if (previous && previous.end > row.start) throw new Error('Rendered lines overlap. Refresh S-Captions.');
    if (row.start !== (previous?.end ?? 0)) throw new Error('Some transcript words have no rendered line. Refresh S-Captions.');
    rows.push(row);
  }
  if ((rows.at(-1)?.end ?? 0) !== words.length) throw new Error('Some transcript words have no rendered line. Refresh S-Captions.');
  return rows;
}

export function transcriptLineCaption(captions: CaptionItem[], line: TranscriptLine): CaptionItem {
  const words = transcriptWords(captions).slice(line.start, line.end);
  if (!words.length) {
    if (!line.window) throw new Error('Select the line again.');
    return { ...line.caption, id: line.caption.id, words: [], text: '', renderSegments: undefined, ...line.window };
  }
  return { ...line.caption, ...lineSegment(words, line.segment?.id ?? line.caption.id), id: line.caption.id };
}

/** A timing lane contains one word on either side even across storage edges. */
export function transcriptLineLane(captions: CaptionItem[], line: TranscriptLine) {
  const all = transcriptWords(captions), start = Math.max(0, line.start - 1), end = Math.min(all.length, line.end + 1);
  const words = all.slice(start, end);
  return { caption: { ...line.caption, ...lineSegment(words, line.caption.id),
      startTime: start === 0 ? Math.min(captions[0].startTime, words[0].startTime) : words[0].startTime,
      endTime: end === all.length ? Math.max(captions.at(-1)!.endTime, words.at(-1)!.endTime) : words.at(-1)!.endTime },
    start, end, focusStart: line.start - start, focusEnd: line.end - start };
}

/** Replace an anchored word range, keeping unrelated storage/link metadata.
 * Storage envelopes follow moved words; they impose no extra timing boundary. */
export function replaceTranscriptWords(captions: CaptionItem[], start: number, end: number, replacement: CaptionWord[], timingEstimated?: boolean): CaptionItem[] {
  const all = transcriptWords(captions);
  // An empty range (start === end) inserts the replacement before word `start`.
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > all.length || !replacement.length) throw new Error('Select the line again.');
  // Validate actual speech first, so overlap errors do not depend on storage.
  const words = [...all.slice(0, start), ...replacement, ...all.slice(end)];
  validateCaptions([{ id: 'transcript', text: words.map(word => word.text).join(' '), words, timelineFloor: captions[0].timelineFloor,
    startTime: Math.min(captions[0].startTime, words[0].startTime), endTime: Math.max(captions.at(-1)!.endTime, words.at(-1)!.endTime) }]);
  const equalCount = replacement.length === end - start;
  let offset = 0;
  const result = captions.flatMap((caption, index) => {
    const first = offset, last = first + caption.words.length;
    offset = last;
    // An insertion joins the container holding word `start`, or the last one at the end.
    const holds = first <= start && (start < last || index === captions.length - 1);
    if (start === end ? !holds : last <= start || first >= end) return [{ ...caption }];
    const prefix = caption.words.slice(0, Math.max(0, start - first));
    const suffix = caption.words.slice(Math.max(0, end - first));
    const inserted = equalCount ? replacement.slice(Math.max(first, start) - start, Math.min(last, end) - start) : holds ? replacement : [];
    const words = [...prefix, ...inserted.map(word => ({ ...word })), ...suffix];
    if (!words.length) return [];
    return [{ ...caption, words, text: words.map(word => word.text).join(' '),
      startTime: words[0].startTime !== caption.words[0].startTime ? words[0].startTime : caption.startTime,
      endTime: words.at(-1)!.endTime !== caption.words.at(-1)!.endTime ? words.at(-1)!.endTime : caption.endTime,
      ...(timingEstimated === undefined ? {} : { timingEstimated }) }];
  });
  for (let index = 1; index < result.length; index++) {
    const previous = result[index - 1], current = result[index];
    if (previous.endTime > current.startTime) {
      const boundary = Math.max(previous.words.at(-1)!.endTime, Math.min(previous.endTime, current.words[0].startTime));
      previous.endTime = boundary; current.startTime = boundary;
    }
  }
  validateCaptions(result);
  return result;
}

/** Keep a known set of line ranges visible until the host derives them again. */
export function withTranscriptLines(captions: CaptionItem[], ranges: { start: number; end: number; key: string }[]): CaptionItem[] {
  const all = transcriptWords(captions);
  const segments = ranges.map(range => ({ ...range, segment: lineSegment(all.slice(range.start, range.end), range.key) }));
  let offset = 0;
  return captions.map(caption => {
    const start = offset, end = offset + caption.words.length; offset = end;
    return { ...caption, renderSegments: segments.filter(range => range.start < end && range.end > start).map(range => range.segment) };
  });
}

/** Replace one line's words. Text typed into an empty range (a pause row)
 * becomes its own line, and so does a line that is blanked or a blank that is
 * filled again: a manual break before it and before the next line, so it keeps
 * its own time however short its new text is. */
export function replaceTranscriptLine(captions: CaptionItem[], line: TranscriptLine, updated: CaptionItem): CaptionItem[] {
  const rows = transcriptLines(captions), count = updated.words.length, delta = count - (line.end - line.start);
  const inserting = line.start === line.end;
  const bounded = inserting || isBlankLine(updated.words) || isBlankLine(transcriptWords(captions).slice(line.start, line.end));
  let result = replaceTranscriptWords(captions, line.start, line.end,
    bounded ? updated.words.map((word, index) => index ? word : { ...word, lineBreakBefore: 'break' as const }) : updated.words, updated.timingEstimated);
  if (bounded) {
    let offset = 0;
    const following = line.start + count;
    result = result.map(caption => {
      const first = offset; offset += caption.words.length;
      if (following < first || following >= offset) return caption;
      const words = caption.words.map((word, index) => first + index === following && word.lineBreakBefore !== 'break' ? { ...word, lineBreakBefore: 'break' as const } : word);
      return { ...caption, words };
    });
  }
  const ranges: { start: number; end: number; key: string }[] = [];
  let inserted = false;
  const insert = (key: string) => { if (!inserted && count) ranges.push({ key: line.segment?.id ?? key, start: line.start, end: line.start + count }); inserted = true; };
  for (const row of rows) {
    const key = row.segment?.id ?? row.key;
    if (row.end <= line.start) ranges.push({ key, start: row.start, end: row.end });
    else if (row.start >= line.end) { if (inserting) insert(line.key); ranges.push({ key, start: row.start + delta, end: row.end + delta }); }
    else {
      if (row.start < line.start) ranges.push({ key: key + ':before', start: row.start, end: line.start });
      insert(key);
      if (row.end > line.end) ranges.push({ key: key + ':after', start: line.end + delta, end: row.end + delta });
    }
  }
  insert(line.key);
  return withTranscriptLines(result, ranges);
}

const mergeMarker = (word: CaptionWord) => word.lineBreakBefore === 'join' || word.lineBreakBefore === 'edge';
/** A reflow (Characters per line or Smart line fit) forgets merged lines: every
 * 'join' and merge 'edge' goes, while manual split 'break's and removed pause
 * lines stay. Storage identities and word times are untouched. */
export function clearLineMerges(captions: CaptionItem[]): CaptionItem[] {
  return captions.map(caption => caption.words.some(mergeMarker) ? { ...caption,
    words: caption.words.map(word => { if (!mergeMarker(word)) return word; const { lineBreakBefore: _merge, ...rest } = word; return rest; }) } : caption);
}

/** Freeze these row boundaries in the document, independently of character,
 * punctuation and pause grouping, until the next reflow. A split's caret is a
 * manual 'break'; the frozen rows' outer edges are 'edge's (an existing manual
 * break there stays) and their insides 'join's. All source words and storage
 * identities stay. */
export function changeTranscriptLineBreak(captions: CaptionItem[], line: TranscriptLine, splitAt?: number): CaptionItem[] {
  const rows = transcriptLines(captions);
  if (line.start < 0 || line.end <= line.start || line.end > transcriptWords(captions).length) throw new Error('Select the line again.');
  const next = rows.find(row => row.end > line.end);
  if (splitAt === undefined && !next) throw new Error('There is no next line to merge.');
  const all = transcriptWords(captions);
  if (splitAt === undefined && (isBlankLine(all.slice(line.start, line.end)) || isBlankLine(all.slice(next!.start, next!.end)))) throw new Error('A blank line stands alone. Type text into it before merging.');
  if (splitAt !== undefined && (!Number.isInteger(splitAt) || splitAt <= line.start || splitAt >= line.end)) throw new Error('Select an interior word to split the line.');
  const end = splitAt === undefined ? next!.end : line.end;
  const words = transcriptWords(captions).map((word, index) => ({ ...word,
    ...(index === splitAt ? { lineBreakBefore: 'break' as const } :
      (index === line.start || index === end) && word.lineBreakBefore !== 'break' ? { lineBreakBefore: 'edge' as const } :
      index > line.start && index < end ? { lineBreakBefore: 'join' as const } : {}) }));
  let offset = 0;
  const result = captions.map(caption => { const start = offset; offset += caption.words.length; return { ...caption, words: words.slice(start, offset) }; });
  const ranges: { start: number; end: number; key: string }[] = [];
  let inserted = false;
  for (const row of rows) {
    const key = row.segment?.id ?? row.key;
    if (row.end <= line.start || row.start >= end) { ranges.push({ start: row.start, end: row.end, key }); continue; }
    if (row.start < line.start) ranges.push({ start: row.start, end: line.start, key: key + ':before' });
    if (!inserted) {
      const key = line.segment?.id ?? line.key;
      if (splitAt === undefined) ranges.push({ start: line.start, end, key });
      else ranges.push({ start: line.start, end: splitAt, key }, { start: splitAt, end, key: key + ':split-' + splitAt });
      inserted = true;
    }
    if (row.end > end) ranges.push({ start: end, end: row.end, key: key + ':after' });
  }
  return withTranscriptLines(result, ranges);
}
