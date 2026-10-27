import type { CaptionItem, CaptionWord } from '../types';
import { replaceText, validateCaptions } from './edit.ts';
import { captionWordOffset, replaceTranscriptLine, transcriptWords } from './lines.ts';

/** The words one open line editor replaces: everything after `start` words and
 * before the last `suffix` words. `transcript` anchors the complete stream;
 * otherwise offsets are local to captionId. Words outside stay fixed through
 * every typing step, undo and redo. */
export interface TypingAnchor { captionId: string; start: number; suffix: number; before: string; after: string; transcript?: boolean;
  /** An empty range (a pause row being typed into) puts its words into this time window. */
  window?: { startTime: number; endTime: number }; }
// The first following word's boundary belongs to the edited range: text typed
// into a pause row adds a manual break before the next line.
const wordsKey = (words: CaptionWord[], following = false) => JSON.stringify(words.map((word, index) => [word.text, word.startTime, word.endTime, following && !index ? null : word.lineBreakBefore]));

export function typingAnchor(captions: CaptionItem[], captionId: string, start: number, end: number, transcript = false, window?: { startTime: number; endTime: number }): TypingAnchor {
  const caption = captions.find(item => item.id === captionId);
  const words = transcript ? transcriptWords(captions) : caption?.words ?? [];
  const empty = end === start && !!window && Number.isFinite(window.startTime) && window.endTime > window.startTime;
  if (!caption || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start && !empty || end > words.length) throw new Error('Select the line again to edit it.');
  return { captionId, start, suffix: words.length - end, before: wordsKey(words.slice(0, start)), after: wordsKey(words.slice(end), true), ...(transcript ? { transcript: true } : {}), ...(empty ? { window: { ...window! } } : {}) };
}

/** The anchored words in these captions, or null when anything outside them changed. */
export function typingRange(captions: CaptionItem[], anchor: TypingAnchor) {
  const caption = captions.find(item => item.id === anchor.captionId);
  if (!caption) return null;
  const all = anchor.transcript ? transcriptWords(captions) : caption.words;
  const end = all.length - anchor.suffix;
  if (end < anchor.start || end === anchor.start && !anchor.window || wordsKey(all.slice(0, anchor.start)) !== anchor.before || wordsKey(all.slice(end), true) !== anchor.after) return null;
  const words = all.slice(anchor.start, end);
  return { caption, owner: caption, start: anchor.start, end, words, text: words.map(word => word.text).join(' '),
    transcriptStart: anchor.transcript ? anchor.start : captionWordOffset(captions, caption.id) + anchor.start };
}

/** The text a draft saves as: words separated by single spaces. */
export const typingText = (draft: string) => draft.trim().split(/\s+/).filter(Boolean).join(' ');

/** The captions with the anchored words replaced by a draft, validated exactly
 * like the line editor's save: surviving words keep their timing. */
export function applyTypingText(captions: CaptionItem[], anchor: TypingAnchor, draft: string): CaptionItem[] {
  const range = typingRange(captions, anchor);
  if (!range) throw new Error('This line changed while you were editing. Cancel and select it again.');
  const { caption, words } = range;
  const source: CaptionItem = { ...caption, words, text: range.text,
    ...(words.length ? { startTime: words[0].startTime, endTime: Math.max(...words.map(word => word.endTime)) } : anchor.window) };
  const updated = replaceText(source, draft);
  // An empty draft in a pause row leaves the pause as it is.
  if (!updated.words.length) return JSON.parse(JSON.stringify(captions)) as CaptionItem[];
  const result = replaceTranscriptLine(captions, { key: 'typing', caption, start: range.transcriptStart, end: range.transcriptStart + words.length }, updated);
  validateCaptions(result);
  return result;
}

/** Caret after the editor's text is replaced: at the end of the changed region. */
export function typingCaret(before: string, after: string, caret: number): number {
  if (before === after) return Math.min(caret, after.length);
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before[start] === after[start]) start++;
  let end = 0;
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.length - end;
}

export interface TypingControllerOptions {
  /** Quiet time after the last keystroke before the draft becomes a step. */
  delay?: number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** Puts a draft into the caption session as one "Typing" step. False when it is invalid or must wait. */
  push: (draft: string) => boolean;
  /** Replaces the open editor's text and caret. */
  show: (draft: string, caret: number) => void;
}
export interface TypingState { draft: string; caret: number; pushed: string; confirmed: string; open: string; }

/** The open line editor's typing steps.
 * - A pause of `delay` ms (or Cmd going down, or leaving) commits the draft as one step.
 * - `confirmed` is the text the layer holds after the last confirmed write or restore.
 * - Premiere Undo/Redo arrives as `restored(text)`. With no unconfirmed typing the
 *   editor shows that text. With unconfirmed typing, undo drops just that typing:
 *   the editor goes back to `confirmed`, which is committed again if Premiere moved past it. */
export function createTypingController(options: TypingControllerOptions) {
  let state: TypingState | null = null, timer: unknown = null;
  const cancel = () => { if (timer !== null) { options.clearTimer(timer); timer = null; } };
  function flush(): boolean {
    cancel();
    if (!state) return false;
    const text = typingText(state.draft);
    // An empty draft is a step too: it leaves the line blank.
    if (text === state.pushed || !options.push(state.draft)) return false;
    state.pushed = text;
    return true;
  }
  function retry() {
    cancel();
    if (state && typingText(state.draft) !== state.pushed) timer = options.setTimer(() => { timer = null; flush(); }, options.delay ?? 750);
  }
  return {
    get state(): Readonly<TypingState> | null { return state; },
    /** True while the draft holds typing that is not a step yet. */
    get pending() { return !!state && typingText(state.draft) !== state.pushed; },
    open(text: string, caret = text.length) { cancel(); state = { draft: text, caret, pushed: text, confirmed: text, open: text }; },
    input(draft: string, caret: number) {
      if (!state) return;
      state.draft = draft; state.caret = caret;
      retry();
    },
    flush,
    /** A write holding this text was confirmed by Premiere. */
    confirmed(text: string) { if (state) state.confirmed = text; },
    /** Premiere Undo/Redo put this text into the anchored words. */
    restored(text: string) {
      if (!state) return;
      cancel();
      const draft = state.draft, unconfirmed = typingText(draft) !== state.confirmed;
      const target = unconfirmed ? state.confirmed : text;
      state.pushed = text; state.confirmed = text;
      state.caret = typingCaret(draft, target, state.caret); state.draft = target;
      options.show(target, state.caret);
      if (target !== text) { if (options.push(target)) state.pushed = target; else retry(); }
    },
    /** Tries a pending draft again after a pause, e.g. once a merge has finished. */
    retry,
    close() { cancel(); const last = state; state = null; return last; },
  };
}
export type TypingController = ReturnType<typeof createTypingController>;
