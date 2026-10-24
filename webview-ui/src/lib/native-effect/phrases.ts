import type { CaptionItem, CaptionSegment } from '../types.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';
import { lineStarts, type LineWrap } from './line-wrap.ts';

/** Derived editor rows, matching native/core/caption_core.cpp::regroup.
 * Storage containers preserve source identities; rows span their boundaries.
 * Line breaks come from line-wrap.ts, the shared mirror of the native algorithm. */
export function nativeCaptionPhrases(captions: CaptionItem[], maxChars: number, lineWrap: LineWrap = 'fill'): CaptionItem[] {
  validateCharacterLimit(maxChars);
  const all = captions.flatMap(caption => caption.words);
  const starts = lineStarts(all, maxChars, lineWrap);
  const rows: { start: number; end: number; segment: CaptionSegment }[] = [];
  let first = 0, count = 0, owner = 0, ownerOffset = 0;
  const flush = () => {
    if (!count) return;
    const words = all.slice(first, first + count).map(word => ({ ...word }));
    rows.push({ start: first, end: first + count, segment: { id: `native-phrase-${captions[owner].id}-${first - ownerOffset}`,
      words, text: words.map(word => word.text).join(' '), startTime: words[0].startTime, endTime: Math.max(...words.map(word => word.endTime)) } });
    count = 0;
  };
  let container = 0, offset = 0;
  all.forEach((_word, index) => {
    while (container < captions.length - 1 && index >= offset + captions[container].words.length) {
      offset += captions[container].words.length; container++;
    }
    if (count && starts[index]) flush();
    if (!count) { first = index; owner = container; ownerOffset = offset; }
    count++;
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
