import type { CaptionItem, CaptionSegment } from '../types.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';

/** Derived editor rows, matching native/core/caption_core.cpp::regroup.
 * Storage containers preserve source identities; rows span their boundaries.
 * Native grouping counts Unicode scalars and uses a 0.6-second pause threshold. */
export function nativeCaptionPhrases(captions: CaptionItem[], maxChars: number): CaptionItem[] {
  validateCharacterLimit(maxChars);
  const all = captions.flatMap(caption => caption.words);
  const rows: { start: number; end: number; segment: CaptionSegment }[] = [];
  let first = 0, count = 0, length = 0, owner = 0, ownerOffset = 0;
  const flush = () => {
    if (!count) return;
    const words = all.slice(first, first + count).map(word => ({ ...word }));
    rows.push({ start: first, end: first + count, segment: { id: `native-phrase-${captions[owner].id}-${first - ownerOffset}`,
      words, text: words.map(word => word.text).join(' '), startTime: words[0].startTime, endTime: Math.max(...words.map(word => word.endTime)) } });
    count = 0; length = 0;
  };
  let container = 0, offset = 0;
  all.forEach((word, index) => {
    while (container < captions.length - 1 && index >= offset + captions[container].words.length) {
      offset += captions[container].words.length; container++;
    }
    const punctuation = /^[.,!?;:%)\]}]/.test(word.text), chars = Array.from(word.text).length;
    const previous = all[index - 1];
    const automatic = previous && (previous.endOfSentence || /[.!?]$/.test(previous.text) ||
      !punctuation && (length + chars + 1 > maxChars || word.startTime - previous.endTime > .6));
    if (count && (word.lineBreakBefore === 'break' || word.lineBreakBefore === 'edge' || word.lineBreakBefore !== 'join' && automatic)) flush();
    if (!count) { first = index; owner = container; ownerOffset = offset; }
    length += chars + (count && !punctuation ? 1 : 0); count++;
  });
  flush();
  let firstRow = 0;
  offset = 0;
  return captions.map(caption => {
    const start = offset, end = start + caption.words.length; offset = end;
    while (firstRow < rows.length && rows[firstRow].end <= start) firstRow++;
    const renderSegments: CaptionSegment[] = [];
    for (let index = firstRow; index < rows.length && rows[index].start < end; index++) renderSegments.push(rows[index].segment);
    // Attach complete shared rows to every intersecting container. Transcript
    // helpers deduplicate them and address edits with global word offsets.
    return { ...caption, groupingMaxChars: maxChars, renderSegments };
  });
}
