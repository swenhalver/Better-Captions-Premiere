import type { CaptionItem, CaptionSegment } from '../types.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';

/** Derived editor rows, matching native/core/caption_core.cpp::regroup.
 * These are phrases inside the effect's physical clip, never new clip links.
 * Native grouping counts Unicode scalars and uses a 0.6-second pause threshold. */
export function nativeCaptionPhrases(captions: CaptionItem[], maxChars: number): CaptionItem[] {
  validateCharacterLimit(maxChars);
  return captions.map(caption => {
    const renderSegments: CaptionSegment[] = [];
    let first = 0, count = 0, length = 0;
    const flush = () => {
      if (!count) return;
      const words = caption.words.slice(first, first + count).map(word => ({ ...word }));
      renderSegments.push({ id: `native-phrase-${caption.id}-${first}`, words, text: words.map(w => w.text).join(' '),
        startTime: words[0].startTime, endTime: Math.max(...words.map(w => w.endTime)) });
      count = 0; length = 0;
    };
    caption.words.forEach((word, index) => {
      const punctuation = /^[.,!?;:%)\]}]/.test(word.text), chars = Array.from(word.text).length;
      if (count && !punctuation && (length + chars + 1 > maxChars || word.startTime - caption.words[index - 1].endTime > .6)) flush();
      if (!count) first = index;
      length += chars + (count && !punctuation ? 1 : 0); count++;
      if (word.endOfSentence || /[.!?]$/.test(word.text)) flush();
    });
    flush();
    return { ...caption, groupingMaxChars: maxChars, renderSegments };
  });
}
