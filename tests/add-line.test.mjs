import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLineMerges, insertTranscriptLine, newLineRoom, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { applyTypingText, typingAnchor } from '../webview-ui/src/lib/transcript/typing.ts';
import { derivePauseLines, pauseCadence } from '../webview-ui/src/lib/native-effect/pause-lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';

// Add line inserts a blank line at a line boundary in free time only, unless a
// neighbour borrow is chosen. Every other word keeps its text, times and markers.
const FPS = 30;
const word = (text, startTime, endTime, extra = {}) => ({ text, startTime, endTime, isActive: false, ...extra });
const container = (id, words, envelope = {}) => ({ id, words, text: words.map(item => item.text).join(' '),
  startTime: words[0].startTime, endTime: Math.max(...words.map(item => item.endTime)), ...envelope });
const rows = captions => { const all = transcriptWords(captions); return transcriptLines(captions).map(line => {
  const words = all.slice(line.start, line.end);
  return { text: words.map(item => item.text).join(' '), start: words[0].startTime, end: Math.max(...words.map(item => item.endTime)) };
}); };
const strip = captions => structuredClone(captions).map(({ renderSegments: _r, ...rest }) => rest);
// Two touching lines, a two-second silence, then a third line in its own container.
const fixture = () => nativeCaptionPhrases([
  container('a', [word('Hello', 1, 1.4), word('there.', 1.4, 2, { endOfSentence: true }), word('How', 2, 2.3, { lineBreakBefore: 'break' }), word('are', 2.3, 2.6), word('you?', 2.6, 3, { endOfSentence: true })], { startTime: .5 }),
  container('b', [word('Fine', 5, 5.5, { lineBreakBefore: 'break' }), word('thanks.', 5.5, 6, { endOfSentence: true })], { endTime: 7 }),
], 150, 'fill');
const regroup = (captions, change) => { const plain = strip(captions); change(plain); return nativeCaptionPhrases(plain, 150, 'fill'); };
const options = (side, extra = {}) => ({ frameRate: FPS, cadence: 1, side, ...extra });
// Words outside the new line, compared exactly; `marked` may gain only a break.
function assertOthersExact(before, after, marked, patch = {}) {
  const expected = transcriptWords(before).map(item => ({ ...item, ...(item.startTime === marked && item.lineBreakBefore !== 'break' ? { lineBreakBefore: 'break' } : {}), ...(patch[item.startTime] ?? {}) }))
    .map(item => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
  assert.deepEqual(transcriptWords(after).filter(item => item.text !== ''), expected);
}

test('below a line before a silence: the new line takes one cadence right after it', () => {
  const before = fixture(), { captions, start } = insertTranscriptLine(before, 5, options('after'));
  assert.equal(start, 5);
  assert.deepEqual(rows(captions).map(row => [row.text, row.start, row.end]), [['Hello there.', 1, 2], ['How are you?', 2, 3], ['', 3, 4], ['Fine thanks.', 5, 6]]);
  assert.equal(transcriptWords(captions)[5].lineBreakBefore, 'break');
  assertOthersExact(before, captions, 5);
  // The words join the storage container that holds the next word; the outer extent stays.
  assert.deepEqual(captions.map(item => [item.startTime, item.endTime]), [[.5, 3], [3, 7]]);
  validateCaptions(captions);
});

test('above a line after a silence: the new line ends where it starts and takes its removed pause rows', () => {
  const before = regroup(fixture(), captions => { captions[1].words[0].pauseLinesRemoved = 1; });
  const { captions } = insertTranscriptLine(before, 5, options('before'));
  const words = transcriptWords(captions);
  assert.deepEqual([words[5].text, words[5].startTime, words[5].endTime, words[5].pauseLinesRemoved], ['', 4, 5, 1]);
  assert.equal(words[6].pauseLinesRemoved, undefined);
  assertOthersExact(before, captions, 5, { 5: { pauseLinesRemoved: undefined } });
});

test('in a pause, the new line replaces one pause row and the others stay', () => {
  const settings = { visibleLines: 4, blankLineSeconds: .5 }, before = fixture();
  const cadence = pauseCadence(before, settings.blankLineSeconds);
  assert.equal(derivePauseLines(before, settings).length, 4);
  for (const side of ['after', 'before']) {
    const { captions } = insertTranscriptLine(before, 5, { frameRate: FPS, cadence, side });
    assert.equal(derivePauseLines(captions, settings).length, 3, side);
  }
});

test('a short gap is used whole; a touching boundary is refused without a borrow', () => {
  const before = regroup(fixture(), captions => { captions[0].words[2] = word('How', 2.1, 2.3, { lineBreakBefore: 'break' }); });
  assert.deepEqual(newLineRoom(before, 2, options('after')), { window: { startTime: 2, endTime: 2.1 } });
  const touching = fixture();
  assert.deepEqual(newLineRoom(touching, 2, options('after')), { problem: 'No free time here. Shorten the line above or below first.' });
  assert.throws(() => insertTranscriptLine(touching, 2, options('before')), /No free time here/);
  assert.match(newLineRoom(touching, 1, options('after')).problem, /Select the line again/, 'inside a line');
});

test('a neighbour borrow trims only the last word above, by half of it up to one cadence', () => {
  const before = fixture(), { captions, borrowed } = insertTranscriptLine(before, 2, options('after', { borrow: 'neighbour' }));
  // "there." lasts 18 frames: it gives 9, ending at 1.7.
  assert.deepEqual(borrowed, { index: 1, edge: 'endTime', time: 2 - 9 / FPS, frames: 9, text: 'there.' });
  assert.deepEqual(rows(captions).map(row => row.text), ['Hello there.', '', 'How are you?', 'Fine thanks.']);
  assertOthersExact(before, captions, 2, { 1.4: { endTime: 2 - 9 / FPS } });
  validateCaptions(captions);
  // A one-frame word above cannot give; the first word below gives instead.
  const short = regroup(fixture(), captions => { captions[0].words[1] = word('there.', 2 - 1 / FPS, 2, { endOfSentence: true }); captions[0].words[0] = word('Hello', 1, 2 - 1 / FPS); });
  assert.equal(newLineRoom(short, 2, options('after', { borrow: 'neighbour' })).borrow.edge, 'startTime');
});

test('first and last positions stay inside the storage envelopes', () => {
  const before = fixture();
  const first = insertTranscriptLine(before, 0, options('before'));
  assert.deepEqual(rows(first.captions)[0], { text: '', start: .5, end: 1 });
  assert.equal(first.captions[0].startTime, .5);
  const last = insertTranscriptLine(before, 7, options('after'));
  assert.deepEqual(rows(last.captions).at(-1), { text: '', start: 6, end: 7 });
  assert.equal(last.captions.at(-1).endTime, 7);
  const tight = fixture();
  tight[0].startTime = 1;
  assert.match(newLineRoom(tight, 0, options('before')).problem, /No free time/);
});

test('the new line keeps its own row through refresh and reflow, and typing fills it', () => {
  const { captions } = insertTranscriptLine(fixture(), 5, options('after'));
  for (const maxChars of [15, 40, 150]) {
    for (const mode of ['fill', 'balance', 'pretty']) {
      const regrouped = nativeCaptionPhrases(clearLineMerges(strip(captions)), maxChars, mode);
      assert.ok(rows(regrouped).some(row => row.text === '' && row.start === 3 && row.end === 4), `${maxChars} ${mode}`);
    }
  }
  const anchor = typingAnchor(captions, 'b', 5, 6, true);
  const typed = applyTypingText(captions, anchor, 'Silence follows');
  const refreshed = nativeCaptionPhrases(strip(typed), 150, 'fill');
  assert.deepEqual(rows(refreshed).map(row => row.text), ['Hello there.', 'How are you?', 'Silence follows', 'Fine thanks.']);
  assert.deepEqual(rows(refreshed).find(row => row.text === 'Silence follows'), { text: 'Silence follows', start: 3, end: 4 });
});
