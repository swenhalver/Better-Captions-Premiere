import type { AnimationConfig, CaptionItem, CaptionWord, StyleConfig, TranscriptJSON } from '../types';
import { captionCharacterCount, groupCaptionWords, validateCharacterLimit } from '../transcript/parser.ts';
import { validateCaptions } from '../transcript/edit.ts';

export interface GraphicsFrameRate { numerator: number; denominator: number; }
export interface NativeGraphicsPlanInput {
  captions: CaptionItem[];
  style: StyleConfig;
  animation?: AnimationConfig;
  transcriptJson?: TranscriptJSON | null;
  sequence: {
    id: string;
    name?: string;
    frameRate: number | GraphicsFrameRate;
    frameWidth: number;
    frameHeight: number;
  };
}
export interface GraphicsWordReference {
  captionId: string;
  wordIndex: number;
  text: string;
  startTime: number;
  endTime: number;
}
export interface NativeGraphicsPhrase {
  id: string;
  ordinal: number;
  text: string;
  sourceCaptionIds: string[];
  words: GraphicsWordReference[];
  sourceStartTime: number;
  sourceEndTime: number;
  /** Half-open sequence-frame range, with no timecode/drop-frame arithmetic. */
  startFrame: number;
  endFrame: number;
  srtStartMs: number;
  srtEndMs: number;
  speaker?: string;
  intendedPosition?: { x: number; y: number };
  manualSplit: boolean;
}
export interface NativeGraphicsWarning { code: string; message: string; phraseIds?: string[]; }
export interface NativeGraphicsManifest {
  format: 'better-captions-native-graphics-plan';
  version: 1;
  sequence: Omit<NativeGraphicsPlanInput['sequence'], 'frameRate'> & { frameRate: GraphicsFrameRate };
  characterLimit: number;
  phrases: NativeGraphicsPhrase[];
  /** Authoring intent is retained here; its presence does not mean SRT applies it. */
  source: Omit<NativeGraphicsPlanInput, 'sequence'>;
  handoff: {
    format: 'srt';
    carries: ['plain-text', 'phrase-timing'];
    graphicsUpgrade: 'manual-premiere-command';
    nativeGraphicsVerified: false;
    appliesWordStyles: false;
    createsShapes: false;
    appliesGeometryKeyframes: false;
    appliesDynamicReflow: false;
    programmaticNativeTextEditing: false;
  };
  reconnection: {
    status: 'unbound';
    identityBasis: 'source-caption-id-and-word-index';
    /** Source movie/effect links must never be mistaken for new graphic links. */
    nativeLinks: [];
  };
  warnings: NativeGraphicsWarning[];
}

export const NATIVE_GRAPHICS_LIMITS = Object.freeze({
  captions: 2000, words: 20000, phrases: 2000, textCharacters: 250000,
  durationSeconds: 86400, snapshotNodes: 400000, snapshotCharacters: 2000000,
});

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }
function frameRate(value: number | GraphicsFrameRate): GraphicsFrameRate {
  let numerator: number, denominator: number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 240) throw new Error('Frame rate must be between 1 and 240 fps.');
    // Premiere can report common fractional rates as 23.976 or 29.97. The
    // manifest records the exact ratio; callers can supply a ratio explicitly.
    const ntsc = [24000, 30000, 48000, 60000, 120000].find(n => Math.abs(value - n / 1001) < .0005);
    if (ntsc) { numerator = ntsc; denominator = 1001; }
    else {
      denominator = 1000000; numerator = Math.round(value * denominator);
      if (Math.abs(numerator / denominator - value) > 1e-9) throw new Error('Supply an exact numerator/denominator for this nonstandard frame rate.');
      const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
    }
  } else {
    numerator = value?.numerator; denominator = value?.denominator;
  }
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 1 || denominator < 1 || numerator > 1000000 || denominator > 1000000 || numerator / denominator < 1 || numerator / denominator > 240) {
    throw new Error('Frame rate needs positive integer numerator/denominator values up to 1000000 and a rate from 1 to 240 fps.');
  }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/** A detached JSON snapshot, bounded before serialization and free of executable values. */
function snapshot<T>(input: T): T {
  const active = new Set<object>(); let nodes = 0, characters = 0;
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > NATIVE_GRAPHICS_LIMITS.snapshotNodes || depth > 32) throw new Error('Authoring snapshot is too large or too deeply nested.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > NATIVE_GRAPHICS_LIMITS.snapshotCharacters) throw new Error('Authoring snapshot contains too much text.');
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === undefined || active.has(value)) throw new Error('Authoring snapshot must contain finite, non-cyclic JSON data.');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Authoring snapshot must contain plain JSON objects.');
    active.add(value);
    const result: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Authoring snapshot contains an unsupported object key.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new Error('Authoring snapshot cannot contain accessors.');
      if (descriptor.value !== undefined) (result as Record<string, unknown>)[key] = copy(descriptor.value, depth + 1);
    }
    active.delete(value);
    return result;
  };
  return copy(input, 0) as T;
}

function safeSrtWord(text: string): void {
  // A single SRT body line cannot inject a new cue. Do not quietly strip text,
  // decode entities or rely on undocumented Premiere markup interpretation.
  if (typeof text !== 'string' || !text.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/u.test(text) || /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/iu.test(text) || /\{\\/u.test(text)) {
    throw new Error('SRT words must be plain text without line breaks, control characters, markup or encoded entities. Edit the text before exporting.');
  }
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('SRT text contains an incomplete Unicode character.');
  }
}

function validateInput(input: NativeGraphicsPlanInput): void {
  if (!input || !Array.isArray(input.captions) || input.captions.length > NATIVE_GRAPHICS_LIMITS.captions) throw new Error(`Use at most ${NATIVE_GRAPHICS_LIMITS.captions} source captions per native graphics handoff.`);
  let words = 0, characters = 0;
  for (const [index, caption] of input.captions.entries()) {
    if (!caption || typeof caption.id !== 'string' || !caption.id.trim() || caption.id.length > 256) throw new Error('Each source caption needs a nonempty ID of at most 256 characters.');
    if (!Array.isArray(caption.words) || (words += caption.words.length) > NATIVE_GRAPHICS_LIMITS.words) throw new Error(`Use at most ${NATIVE_GRAPHICS_LIMITS.words} words per native graphics handoff.`);
    if (caption.endTime > NATIVE_GRAPHICS_LIMITS.durationSeconds) throw new Error('Native graphics handoffs are limited to the first 24 hours of a sequence.');
    if (index && caption.startTime < input.captions[index - 1].endTime) throw new Error(`Source caption ${index + 1} overlaps the previous caption; fix its timing before exporting.`);
    for (const [wordIndex, word] of caption.words.entries()) {
      if (!word) throw new Error('A source caption contains a missing word.');
      safeSrtWord(word.text); characters += word.text.length;
      if (characters > NATIVE_GRAPHICS_LIMITS.textCharacters) throw new Error(`Use at most ${NATIVE_GRAPHICS_LIMITS.textCharacters} text characters per native graphics handoff.`);
      if (word.startTime < caption.startTime || word.endTime > caption.endTime) throw new Error('Keep every source word strictly inside its caption timing.');
      if (wordIndex && word.startTime < caption.words[wordIndex - 1].endTime) throw new Error('Source word timings overlap; fix the overlap before exporting.');
    }
  }
  validateCaptions(input.captions);
  validateCharacterLimit(input.style?.maxChars);
  const sequence = input.sequence;
  if (!sequence || typeof sequence.id !== 'string' || !sequence.id.trim() || sequence.id.length > 256) throw new Error('A native graphics handoff needs a nonempty sequence ID of at most 256 characters.');
  if (![sequence.frameWidth, sequence.frameHeight].every(value => Number.isInteger(value) && value >= 1 && value <= 16384)) throw new Error('Sequence dimensions must be whole pixels from 1 to 16384.');
}

function timestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3600000), minutes = Math.floor(milliseconds / 60000) % 60, seconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
}

/**
 * Plan only: no host calls, native mutations, file writes, network or eval.
 * SRT contains plain phrase text/timing. Rich authoring intent stays in the
 * manifest until a separately verified native writer can apply it faithfully.
 */
export function buildNativeGraphicsPlan(input: NativeGraphicsPlanInput): { srt: string; manifest: NativeGraphicsManifest } {
  validateInput(input);
  const rate = frameRate(input.sequence.frameRate), fps = rate.numerator / rate.denominator;
  const source = snapshot({ captions: input.captions, style: input.style,
    ...(input.animation !== undefined ? { animation: input.animation } : {}),
    ...(input.transcriptJson !== undefined ? { transcriptJson: input.transcriptJson } : {}),
  });
  const sequence = snapshot(input.sequence);
  const phrases: NativeGraphicsPhrase[] = [], quantized: string[] = [], overCap: string[] = [];
  let run: CaptionItem[] = [];
  const flush = () => {
    if (!run.length) return;
    const owners = new Map<number, { caption: CaptionItem; wordIndex: number; word: CaptionWord }>();
    for (const caption of run) caption.words.forEach((word, wordIndex) => owners.set(word.startTime, { caption, wordIndex, word }));
    for (const group of groupCaptionWords(run.flatMap(caption => caption.words), source.style.maxChars)) {
      if (phrases.length >= NATIVE_GRAPHICS_LIMITS.phrases) throw new Error(`Grouping exceeds ${NATIVE_GRAPHICS_LIMITS.phrases} native graphic phrases; export a shorter transcript range.`);
      const origins = group.words.map(word => owners.get(word.startTime)!);
      const first = origins[0], last = origins[origins.length - 1];
      // Full endpoint identities keep regrouping distinct, while retiming,
      // spelling and style edits leave an otherwise unchanged phrase stable.
      const id = `bc-phrase:${encodeURIComponent(first.caption.id)}:${first.wordIndex}:${encodeURIComponent(last.caption.id)}:${last.wordIndex}`;
      const sourceStartTime = group.startTime, sourceEndTime = Math.min(group.endTime, last.caption.endTime);
      const startFrame = Math.round(sourceStartTime * rate.numerator / rate.denominator), endFrame = Math.round(sourceEndTime * rate.numerator / rate.denominator);
      if (endFrame <= startFrame) throw new Error(`Phrase ${phrases.length + 1} is shorter than a representable frame after rounding; extend its timing before exporting.`);
      const srtStartMs = Math.round(startFrame * rate.denominator * 1000 / rate.numerator), srtEndMs = Math.round(endFrame * rate.denominator * 1000 / rate.numerator);
      const previous = phrases.at(-1);
      if (previous && (sourceStartTime < previous.sourceEndTime || startFrame < previous.endFrame || srtStartMs < previous.srtEndMs)) throw new Error('Native graphic phrases overlap; fix the source timing before exporting.');
      if (srtEndMs <= srtStartMs) throw new Error('This phrase has no representable SRT duration.');
      if (Math.abs(startFrame / fps - sourceStartTime) > 1e-9 || Math.abs(endFrame / fps - sourceEndTime) > 1e-9 || Math.abs(srtStartMs / 1000 - startFrame / fps) > 1e-9 || Math.abs(srtEndMs / 1000 - endFrame / fps) > 1e-9) quantized.push(id);
      if (captionCharacterCount(group.text) > source.style.maxChars) overCap.push(id);
      phrases.push({ id, ordinal: phrases.length + 1, text: group.text,
        sourceCaptionIds: [...new Set(origins.map(origin => origin.caption.id))],
        words: origins.map(origin => ({ captionId: origin.caption.id, wordIndex: origin.wordIndex, text: origin.word.text, startTime: origin.word.startTime, endTime: origin.word.endTime })),
        sourceStartTime, sourceEndTime, startFrame, endFrame, srtStartMs, srtEndMs,
        ...(first.caption.speaker !== undefined ? { speaker: first.caption.speaker } : {}),
        ...(first.caption.position ? { intendedPosition: { ...first.caption.position } } : {}),
        manualSplit: origins.some(origin => !!origin.caption.manualSplit),
      });
    }
    run = [];
  };
  for (const caption of source.captions) {
    const previous = run.at(-1);
    if (previous && (previous.manualSplit || caption.manualSplit || previous.speaker !== caption.speaker || previous.position?.x !== caption.position?.x || previous.position?.y !== caption.position?.y)) flush();
    run.push(caption);
  }
  flush();
  const warnings: NativeGraphicsWarning[] = [
    { code: 'MANUAL_GRAPHICS_UPGRADE', message: 'SRT imports caption text and phrase timing. Upgrade Caption to Graphic must be performed in Premiere; this plan does not create or verify native graphic objects.' },
    { code: 'STYLE_INTENT_ONLY', message: 'Fonts, supported weights, synthetic italic, relative Bold, stroke, shadows, three word states, bubble shapes/padding/radius and current-word enlargement are preserved as intent in the manifest, not applied by SRT.' },
    { code: 'ANIMATION_AND_GEOMETRY_INTENT_ONLY', message: 'Word animation, independent box dimensions, dynamic text reflow, placement and native keyframes are not transferred by SRT. Original timing, placement and motion data remain in the manifest.' },
    { code: 'RECONNECTION_UNBOUND', message: 'Phrase IDs use source caption IDs and word indices. Inserting/deleting words or regrouping can change identities. New native graphic links require verified readback; existing movie/effect links are not reused.' },
  ];
  if (typeof sequence.frameRate === 'number' && Math.abs(sequence.frameRate - fps) > 1e-10) warnings.push({ code: 'FRAME_RATE_CANONICALIZED', message: `The supplied ${sequence.frameRate} fps is represented as ${rate.numerator}/${rate.denominator} fps. Supply an explicit ratio if that is not the sequence rate.` });
  if (quantized.length) warnings.push({ code: 'TIMING_QUANTIZED', message: 'Phrase boundaries are rounded to the nearest sequence frame, then to SRT milliseconds. Exact source seconds and frame indices are retained; word timing is authoring intent only.', phraseIds: quantized });
  if (overCap.length) warnings.push({ code: 'WHOLE_WORD_EXCEEDS_CHARACTER_CAP', message: 'A whole word exceeds the character cap. It is kept intact, matching the existing grouping behavior.', phraseIds: overCap });
  const manifest: NativeGraphicsManifest = {
    format: 'better-captions-native-graphics-plan', version: 1,
    sequence: { ...sequence, frameRate: rate }, characterLimit: source.style.maxChars, phrases, source,
    handoff: { format: 'srt', carries: ['plain-text', 'phrase-timing'], graphicsUpgrade: 'manual-premiere-command', nativeGraphicsVerified: false, appliesWordStyles: false, createsShapes: false, appliesGeometryKeyframes: false, appliesDynamicReflow: false, programmaticNativeTextEditing: false },
    reconnection: { status: 'unbound', identityBasis: 'source-caption-id-and-word-index', nativeLinks: [] }, warnings,
  };
  const srt = phrases.map(phrase => `${phrase.ordinal}\r\n${timestamp(phrase.srtStartMs)} --> ${timestamp(phrase.srtEndMs)}\r\n${phrase.text}\r\n`).join('\r\n');
  return { srt, manifest };
}
