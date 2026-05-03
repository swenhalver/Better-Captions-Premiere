import type { TranscriptJSON, CaptionItem, CaptionWord } from "../types";

const MAX_WORDS_PER_LINE = 6;
const MAX_CHARS_PER_LINE = 40;

export function parseTranscript(
  json: TranscriptJSON,
  maxWordsPerLine = MAX_WORDS_PER_LINE,
  maxCharsPerLine = MAX_CHARS_PER_LINE,
): CaptionItem[] {
  const captions: CaptionItem[] = [];
  let captionIndex = 0;

  for (const segment of json.segments) {
    const words = segment.words.filter((w) => w.type === "word");
    let lineWords: typeof words = [];
    let lineCharCount = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordLen = word.text.replace(/[.,!?;:]/g, "").length;

      lineWords.push(word);
      lineCharCount += wordLen + (lineWords.length > 1 ? 1 : 0);

      const shouldBreak =
        word.eos ||
        lineWords.length >= maxWordsPerLine ||
        lineCharCount >= maxCharsPerLine ||
        i === words.length - 1;

      if (shouldBreak && lineWords.length > 0) {
        const firstWord = lineWords[0];
        const lastWord = lineWords[lineWords.length - 1];
        const startTime = firstWord.start;
        const endTime = lastWord.start + lastWord.duration;

        const captionWords: CaptionWord[] = lineWords.map((w) => ({
          text: w.text,
          startTime: w.start,
          endTime: w.start + w.duration,
          isActive: false,
        }));

        captions.push({
          id: `caption-${captionIndex++}`,
          words: captionWords,
          text: lineWords.map((w) => w.text).join(" "),
          startTime,
          endTime,
          speaker: segment.speaker,
        });

        lineWords = [];
        lineCharCount = 0;
      }
    }
  }

  return captions;
}

export function getCaptionAtTime(
  captions: CaptionItem[],
  time: number,
): CaptionItem | null {
  for (const caption of captions) {
    if (time >= caption.startTime && time <= caption.endTime) {
      return caption;
    }
  }
  return null;
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
