import type { CaptionWord, LineWrap } from '../types.ts';
export type { LineWrap };

/** How words fill the lines between hard breaks. Mirrors native/core/caption_core.cpp::lineStarts,
 * including tie-breaks, so the panel's rows and the native renderer's lines are identical.
 * - fill: as many words on each line as fit.
 * - balance: Fill's number of lines, with line lengths as even as possible.
 * - pretty: Fill, unless the last line is a single word or under a third of the limit;
 *   then the last two lines are split again, avoiding a one-word last line and evening the pair. */
export const LINE_WRAPS: readonly LineWrap[] = ['fill', 'balance', 'pretty'];
/** Pause between words that always starts a new line. */
export const LINE_PAUSE_SECONDS = .6;
/** No line lasts longer than this, unless one word or merged run alone does. */
export const MAX_LINE_SECONDS = 5.5;

export function validateLineWrap(value: unknown): LineWrap {
  if (!LINE_WRAPS.includes(value as LineWrap)) throw new Error('Choose Fill, Balance or Pretty line wrapping.');
  return value as LineWrap;
}

type WrapWord = Pick<CaptionWord, 'text' | 'startTime' | 'endTime' | 'endOfSentence' | 'lineBreakBefore'>;
/** Words glued to the previous one (a merge join, or a leading punctuation token)
 * form one unbreakable unit. Width counts Unicode scalars plus one space before
 * each word that does not start with punctuation. */
interface Unit { first: number; width: number; start: number; end: number; hardBefore: boolean; }

export function lineStarts(words: readonly WrapWord[], maxChars: number, mode: LineWrap = 'fill', pause = LINE_PAUSE_SECONDS): boolean[] {
  validateLineWrap(mode);
  const units: Unit[] = [];
  words.forEach((word, index) => {
    const chars = Array.from(word.text).length, punctuation = /^[.,!?;:%)\]}]/.test(word.text);
    let hard = index === 0, glue = false;
    if (index) {
      const previous = words[index - 1];
      // A blank line (empty text) always stands alone, whatever the markers.
      if (!word.text || !previous.text) hard = true;
      else if (word.lineBreakBefore === 'break' || word.lineBreakBefore === 'edge') hard = true;
      else if (word.lineBreakBefore === 'join') glue = true;
      else if (previous.endOfSentence || /[.!?]$/.test(previous.text)) hard = true;
      else if (punctuation) glue = true;
      else hard = word.startTime - previous.endTime > pause;
    }
    if (glue) { const unit = units[units.length - 1]; unit.width += chars + (punctuation ? 0 : 1); unit.end = Math.max(unit.end, word.endTime); }
    else units.push({ first: index, width: chars, start: word.startTime, end: word.endTime, hardBefore: hard });
  });
  // A single unit always fits, so an overlong word or merged run stands alone.
  const fits = (i: number, j: number, width: number, end: number) => j === i + 1 || width <= maxChars && end - units[i].start <= MAX_LINE_SECONDS;
  const fill = (a: number, b: number) => {
    const starts: number[] = [];
    for (let i = a; i < b;) {
      let j = i + 1, width = units[i].width, end = units[i].end;
      while (j < b && fits(i, j + 1, width + 1 + units[j].width, Math.max(end, units[j].end))) { width += 1 + units[j].width; end = Math.max(end, units[j].end); j++; }
      starts.push(i); i = j;
    }
    return starts;
  };
  // Fewest lines first, then the smallest sum of squared line widths (the most
  // even lines). Equal costs keep the longer earlier line, nearest to Fill.
  const balance = (a: number, b: number) => {
    const n = b - a, lines = new Array<number>(n + 1).fill(0), cost = new Array<number>(n + 1).fill(0), next = new Array<number>(n + 1).fill(b);
    for (let k = n - 1; k >= 0; k--) {
      const i = a + k; let width = 0, end = 0, chosen = false;
      for (let j = i + 1; j <= b; j++) {
        width += units[j - 1].width + (j - 1 > i ? 1 : 0); end = j - 1 > i ? Math.max(end, units[j - 1].end) : units[i].end;
        if (!fits(i, j, width, end)) break;
        const l = 1 + lines[j - a], c = width * width + cost[j - a];
        if (!chosen || l < lines[k] || l === lines[k] && c <= cost[k]) { lines[k] = l; cost[k] = c; next[k] = j; chosen = true; }
      }
    }
    const starts: number[] = [];
    for (let i = a; i < b; i = next[i - a]) starts.push(i);
    return starts;
  };
  const span = (i: number, j: number) => { let width = 0; for (let k = i; k < j; k++) width += units[k].width + (k > i ? 1 : 0); return width; };
  const end = (i: number, j: number) => { let value = units[i].end; for (let k = i + 1; k < j; k++) value = Math.max(value, units[k].end); return value; };
  // Fill, unless its last line is one unit or under a third of the limit. Then
  // the last two lines are split again: a last line of two or more units first,
  // then the most even pair, then the longer first line.
  const pretty = (a: number, b: number) => {
    const starts = fill(a, b);
    if (starts.length < 2) return starts;
    const last = starts[starts.length - 1];
    if (b - last > 1 && 3 * span(last, b) >= maxChars) return starts;
    const tail = starts[starts.length - 2];
    let best = last, bestSingle = true, bestCost = Infinity;
    for (let s = tail + 1; s < b; s++) {
      const first = span(tail, s), second = span(s, b);
      if (!fits(tail, s, first, end(tail, s)) || !fits(s, b, second, end(s, b))) continue;
      const single = b - s === 1, cost = first * first + second * second;
      if (!single && bestSingle || single === bestSingle && cost <= bestCost) { best = s; bestSingle = single; bestCost = cost; }
    }
    starts[starts.length - 1] = best;
    return starts;
  };
  const starts = words.map(() => false);
  for (let a = 0; a < units.length;) {
    let b = a + 1;
    while (b < units.length && !units[b].hardBefore) b++;
    for (const unit of mode === 'balance' ? balance(a, b) : mode === 'pretty' ? pretty(a, b) : fill(a, b)) starts[units[unit].first] = true;
    a = b;
  }
  return starts;
}
