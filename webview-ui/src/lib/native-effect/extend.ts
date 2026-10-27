import { validateNativeDocument, type NativeDocument, type NativeWord } from './contract.ts';

const TICKS = 254016000000n;
const MAX_TICKS = 864000n * TICKS;
function tick(value: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,21}$/.test(value)) throw new Error('Invalid caption extension ticks.');
  const result = BigInt(value);
  if (result > MAX_TICKS) throw new Error('Caption extension exceeds the supported duration.');
  return result;
}
const seconds = (value: bigint) => Number(value) / Number(TICKS);

/** Exact ordinary-speed placement captured before transcription starts. */
export interface NativeExtensionPlacement {
  sequenceId: string;
  startTicks: string;
  endTicks: string;
  inTicks: string;
  outTicks: string;
  ticksPerFrame: string;
}

export interface NativeExtensionPlan {
  document: NativeDocument;
  /** Fresh sequence words earlier than this boundary must never replace old edits. */
  appendFromSeconds: number;
  appendedWords: number;
  revealsStoredWords: boolean;
  changed: boolean;
  endTicks: string;
  outTicks: string;
}

/**
 * Pure append planning only. The caller must fetch a fresh, sequence-relative
 * tail transcript and verify the exact host revision/collisions before applying
 * the document and duration together. This does not run transcription or touch
 * Premiere, source project-item duration, native parameters, or keyframes.
 */
export function prepareNativeCaptionExtension(
  input: NativeDocument,
  placement: NativeExtensionPlacement,
  targetEndTicks: string,
  freshSequenceWords: readonly NativeWord[],
): NativeExtensionPlan {
  const document = validateNativeDocument(input);
  if (placement.sequenceId !== document.sequenceId) throw new Error('The caption extension belongs to another sequence.');
  const start = tick(placement.startTicks), end = tick(placement.endTicks);
  const sourceIn = tick(placement.inTicks), sourceOut = tick(placement.outTicks);
  const frame = tick(placement.ticksPerFrame), target = tick(targetEndTicks);
  if (!frame || end <= start || sourceOut <= sourceIn || end - start !== sourceOut - sourceIn) throw new Error('Caption extension requires unchanged ordinary-speed clip timing.');
  if ([start, end, sourceIn, sourceOut, target].some(value => value % frame !== 0n)) throw new Error('Caption extension timing must use exact sequence frames.');
  if (target <= end) throw new Error('Caption extension must end after the existing clip.');
  const nextSourceOut = sourceOut + target - end;
  if (nextSourceOut > MAX_TICKS) throw new Error('Caption extension source duration exceeds its supported range.');
  if (!document.captions.length) throw new Error('Reconnect an existing caption before extending it.');
  const offset = document.timeOriginSeconds + seconds(start - sourceIn);
  const storedWords = document.captions.flatMap(caption => caption.words);
  const lastStoredEnd = Math.max(...storedWords.map(word => word.end));
  // The physical end protects silent tail coverage; stored words also protect
  // source text hidden by a trim. Neither may be retranscribed over old edits.
  const appendFromSeconds = Math.max(seconds(end), lastStoredEnd + offset);
  const targetSeconds = seconds(target);
  if (!Array.isArray(freshSequenceWords) || freshSequenceWords.length > 50000) throw new Error('Invalid tail transcript size.');
  const appended: NativeWord[] = [];
  let previousStart = -Infinity;
  for (const word of freshSequenceWords) {
    if (!word || typeof word.text !== 'string' || typeof word.endOfSentence !== 'boolean' || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || word.start < previousStart) throw new Error('The fresh tail transcript has invalid or unordered words.');
    previousStart = word.start;
    if (word.end <= appendFromSeconds || word.start >= targetSeconds) continue;
    // A range-aware transcript fetch must resolve boundary words explicitly;
    // never clip them silently or duplicate a possibly edited original word.
    if (word.start < appendFromSeconds || word.end > targetSeconds) throw new Error('The fresh tail transcript crosses the protected extension boundary.');
    appended.push({ text: word.text, start: word.start - offset, end: word.end - offset, endOfSentence: word.endOfSentence, ...(word.lineBreakBefore === undefined ? {} : { lineBreakBefore: word.lineBreakBefore }), ...(word.pauseLinesRemoved === undefined ? {} : { pauseLinesRemoved: word.pauseLinesRemoved }) });
  }
  const revealsStoredWords = storedWords.some(word => word.end + offset > seconds(end) && word.start + offset < targetSeconds);
  if (!appended.length && !revealsStoredWords) return { document, appendFromSeconds, appendedWords: 0, revealsStoredWords, changed: false, endTicks: placement.endTicks, outTicks: placement.outTicks };
  if (appended.length) {
    // Keep every manually split container and identity. Only the final source
    // container grows; phrase rows are derived independently by character count.
    let tail = 0;
    for (let index = 1; index < document.captions.length; index++) if (document.captions[index].end >= document.captions[tail].end) tail = index;
    const caption = document.captions[tail];
    caption.words.push(...appended);
    caption.end = Math.max(caption.end, ...appended.map(word => word.end));
  }
  return { document: validateNativeDocument(document), appendFromSeconds, appendedWords: appended.length, revealsStoredWords, changed: true, endTicks: String(target), outTicks: String(nextSourceOut) };
}
