import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLineMerges, deleteTranscriptLine, insertTranscriptLine, replaceTranscriptLine, transcriptLineCaption, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { replaceText, validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { derivePauseLines } from '../webview-ui/src/lib/native-effect/pause-lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';

// Delete line removes one displayed line's words (or a blank line's empty word).
// Nothing is retimed; only the next line's boundary and removed-pause markers change.
const word = (text, startTime, endTime, extra = {}) => ({ text, startTime, endTime, isActive: false, ...extra });
const container = (id, words, envelope = {}) => ({ id, words, text: words.map(item => item.text).join(' '),
  startTime: words[0].startTime, endTime: Math.max(...words.map(item => item.endTime)), ...envelope });
const strip = captions => structuredClone(captions).map(({ renderSegments: _r, ...rest }) => rest);
const regroup = (captions, maxChars = 150) => nativeCaptionPhrases(strip(captions), maxChars, 'fill');
const texts = captions => { const all = transcriptWords(captions); return transcriptLines(captions).map(line => all.slice(line.start, line.end).map(item => item.text).join(' ')); };
const line = (captions, index) => transcriptLines(captions)[index];
const plain = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
// Every surviving word, compared exactly; `patch` names the expected marker changes by start time.
function assertSurvivorsExact(before, after, removed, patch = {}) {
  const expected = transcriptWords(before).filter(item => !removed.includes(item.startTime))
    .map(item => plain({ ...item, ...(patch[item.startTime] ?? {}) }));
  assert.deepEqual(transcriptWords(after).map(plain), expected);
}
// Three lines in two containers: the middle one spans the container boundary.
const crossing = () => regroup([
  container('a', [word('Alpha', 1, 1.3), word('beta.', 1.3, 1.6, { endOfSentence: true }), word('Gamma', 1.7, 2)], { startTime: .5 }),
  container('b', [word('delta.', 2, 2.3, { endOfSentence: true }), word('Epsilon', 2.4, 2.7), word('zeta.', 2.7, 3, { endOfSentence: true })], { endTime: 4 }),
]);

test('a line spanning two storage containers is removed with all its words; neighbours keep their words and times', () => {
  const before = crossing();
  assert.deepEqual(texts(before), ['Alpha beta.', 'Gamma delta.', 'Epsilon zeta.']);
  const after = deleteTranscriptLine(before, line(before, 1));
  assert.deepEqual(texts(after), ['Alpha beta.', 'Epsilon zeta.']);
  assertSurvivorsExact(before, after, [1.7, 2], { 2.4: { lineBreakBefore: 'break' } });
  // Both containers stay with their own identities; the outer extent is untouched.
  assert.deepEqual(after.map(item => [item.id, item.words.map(w => w.text).join(' '), item.startTime, item.endTime]), [['a', 'Alpha beta.', .5, 1.6], ['b', 'Epsilon zeta.', 2.4, 4]]);
  validateCaptions(after);
  assert.deepEqual(texts(regroup(after)), ['Alpha beta.', 'Epsilon zeta.'], 'a refresh regroups to the same lines');
});

test('a container left empty is dropped, and the first, last and only line can be deleted too', () => {
  const before = crossing();
  const first = deleteTranscriptLine(before, line(before, 0));
  assert.deepEqual(texts(first), ['Gamma delta.', 'Epsilon zeta.']);
  // Nothing precedes the new first line, so even its markers stay as they were.
  assertSurvivorsExact(before, first, [1, 1.3]);
  const last = deleteTranscriptLine(before, line(before, 2));
  assert.deepEqual(texts(last), ['Alpha beta.', 'Gamma delta.']);
  assertSurvivorsExact(before, last, [2.4, 2.7]);
  const lone = regroup([container('only', [word('Just', 1, 1.4), word('this.', 1.4, 2, { endOfSentence: true })])]);
  assert.deepEqual(deleteTranscriptLine(lone, line(lone, 0)), [], 'the only line leaves no captions, not a blank line');
  let emptied = before;
  while (transcriptWords(emptied).length) emptied = deleteTranscriptLine(emptied, line(emptied, 0));
  assert.deepEqual(emptied, []);
  // Containers holding only deleted words go.
  const own = regroup([container('a', [word('One.', 1, 1.5, { endOfSentence: true })]), container('b', [word('Two.', 2, 2.5, { endOfSentence: true })]), container('c', [word('Three.', 3, 3.5, { endOfSentence: true })])]);
  assert.deepEqual(deleteTranscriptLine(own, line(own, 1)).map(item => item.id), ['a', 'c']);
});

test('the next line keeps its own row: the line before never regroups into it, through refresh and reflow', () => {
  // Short, close words without punctuation: only the deleted middle line separates them.
  const before = nativeCaptionPhrases([container('a', [word('left', 1, 1.2), word('middle', 1.3, 1.5, { lineBreakBefore: 'break' }), word('right', 1.6, 1.8, { lineBreakBefore: 'break' })])], 150, 'fill');
  assert.deepEqual(texts(before), ['left', 'middle', 'right']);
  const after = deleteTranscriptLine(before, line(before, 1));
  assert.deepEqual(texts(after), ['left', 'right']);
  // Without the break the gap (.4 s) is short enough to join: the marker is what keeps the rows.
  assert.deepEqual(texts(regroup(after.map(item => ({ ...item, words: item.words.map(({ lineBreakBefore: _b, ...rest }) => rest) })))), ['left right']);
  assert.deepEqual(texts(regroup(clearLineMerges(after))), ['left', 'right'], 'a reflow keeps the manual break');
  assert.deepEqual(texts(regroup(after, 15)), ['left', 'right'], 'and so does a new character limit');
});

test('deleting a blank line removes its empty word and keeps the lines around it as they were', () => {
  const start = regroup([container('a', [word('Before.', 1, 2, { endOfSentence: true })]), container('b', [word('After.', 5, 6, { endOfSentence: true, lineBreakBefore: 'break' })])]);
  const { captions: before } = insertTranscriptLine(start, 1, { frameRate: 30, cadence: 1, side: 'after' });
  assert.deepEqual(texts(before), ['Before.', '', 'After.']);
  const after = deleteTranscriptLine(before, line(before, 1));
  assert.deepEqual(texts(after), ['Before.', 'After.']);
  assert.ok(transcriptWords(after).every(item => item.text), 'no blank word remains');
  assertSurvivorsExact(before, after, [2]);
  // Clearing text is different: it leaves the timed blank line.
  const cleared = replaceTranscriptLine(start, line(start, 0), replaceText(transcriptLineCaption(start, line(start, 0)), ''));
  assert.deepEqual(texts(cleared), ['', 'After.']);
});

test('the deleted line does not come back as pause rows, and no shown pause row disappears', () => {
  const settings = { visibleLines: 8, blankLineSeconds: .5 };
  // Gaps of 1 s (2 rows) and 2.5 s (5 rows) around a half-second line.
  const before = regroup([container('a', [word('One.', 1, 2, { endOfSentence: true }), word('Two.', 3, 3.5, { endOfSentence: true }), word('Three.', 6, 7, { endOfSentence: true })])]);
  assert.equal(derivePauseLines(before, settings).length, 7);
  const after = deleteTranscriptLine(before, line(before, 1), captions => derivePauseLines(captions, settings));
  // The merged 4 s gap could show 8 rows; one is hidden, so the 7 rows stay.
  assert.equal(derivePauseLines(after, settings).length, 7);
  assertSurvivorsExact(before, after, [3], { 6: { lineBreakBefore: 'break', pauseLinesRemoved: 1 } });
  // Without pause settings (no native layer) markers only carry over.
  assertSurvivorsExact(before, deleteTranscriptLine(before, line(before, 1)), [3], { 6: { lineBreakBefore: 'break' } });
});

test('earlier pause deletions on both sides of the line are kept through refresh, reflow and new pause settings', () => {
  const settings = { visibleLines: 8, blankLineSeconds: .5 }, rows = () => captions => derivePauseLines(captions, settings);
  // The deleted line had one pause row removed before it, the next line two.
  const before = regroup([container('a', [word('One.', 1, 2, { endOfSentence: true }), word('Two.', 3, 3.5, { endOfSentence: true, pauseLinesRemoved: 1 }), word('Three.', 6, 7, { endOfSentence: true, pauseLinesRemoved: 2 })])]);
  assert.equal(derivePauseLines(before, settings).length, 1 + 3);
  const after = deleteTranscriptLine(before, line(before, 1), rows());
  const merged = transcriptWords(after)[1];
  assert.equal(derivePauseLines(after, settings).length, 4, 'the same rows show');
  assert.equal(merged.pauseLinesRemoved, 4, 'the merged gap hides both earlier deletions (3) and the line’s own time (1)');
  assert.ok(merged.pauseLinesRemoved >= 1 + 2);
  for (const changed of [regroup(after), regroup(clearLineMerges(after)), regroup(after, 15)]) {
    assert.equal(transcriptWords(changed)[1].pauseLinesRemoved, 4); assert.equal(derivePauseLines(changed, settings).length, 4);
  }
  // Other settings recount the merged gap and subtract the same removals: a
  // longer cadence or a lower cap shows fewer rows, never resurrected ones.
  assert.equal(derivePauseLines(after, { visibleLines: 8, blankLineSeconds: 1 }).length, 0);
  assert.equal(derivePauseLines(after, { visibleLines: 6, blankLineSeconds: .5 }).length, 2);
  assert.equal(derivePauseLines(after, { visibleLines: 8, blankLineSeconds: .4 }).length, 4, 'a shorter cadence is still capped at 8, less the same 4');
  // Without settings both removals are summed onto the next line.
  assert.equal(transcriptWords(deleteTranscriptLine(before, line(before, 1)))[1].pauseLinesRemoved, 3);
});

test('at the Visible lines cap the shown rows are kept; only rows the cap already hid fold in', () => {
  const settings = { visibleLines: 3, blankLineSeconds: .5 };
  const before = regroup([container('a', [word('One.', 1, 2, { endOfSentence: true }), word('Two.', 4, 4.5, { endOfSentence: true, pauseLinesRemoved: 1 }), word('Three.', 7, 8, { endOfSentence: true, pauseLinesRemoved: 1 })])]);
  assert.equal(derivePauseLines(before, settings).length, 2 + 2);
  const after = deleteTranscriptLine(before, line(before, 1), captions => derivePauseLines(captions, settings));
  // Three rows is the most one gap can show; none is hidden, so none of the shown rows go.
  assert.equal(derivePauseLines(after, settings).length, 3);
  assert.equal(transcriptWords(after)[1].pauseLinesRemoved, undefined);
});

test('deletion refuses anything but a whole displayed line', () => {
  const before = crossing();
  for (const range of [{ start: 0, end: 1 }, { start: 1, end: 3 }, { start: 2, end: 2 }, { start: 5, end: 7 }]) assert.throws(() => deleteTranscriptLine(before, range), /Select the line again/);
});
