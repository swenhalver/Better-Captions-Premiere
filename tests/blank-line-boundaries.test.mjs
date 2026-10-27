import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceText } from '../webview-ui/src/lib/transcript/edit.ts';
import { replaceTranscriptLine, transcriptLineCaption, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { applyTypingText, typingAnchor, typingRange } from '../webview-ui/src/lib/transcript/typing.ts';
import { derivePauseLines } from '../webview-ui/src/lib/native-effect/pause-lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { clearLineMerges } from '../webview-ui/src/lib/transcript/lines.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument, prepareNativePanelUpdate, rehydrateNativePanel } from '../webview-ui/src/lib/native-effect/panel.ts';

// Blanking a line, or filling a blank again, must keep that row's own time on
// both sides. Rows here are split only by Characters per line and line wrap, or
// by a following word with no marker and no punctuation before it: the 0.7.91
// live failure, where a refilled "Return" absorbed the next line "months".
const MODES = ['fill', 'balance', 'pretty'];
const word = (text, startTime, endTime, extra = {}) => ({ text, startTime, endTime, isActive: false, ...extra });
const container = (id, words) => ({ id, words, text: words.map(item => item.text).join(' '), startTime: words[0].startTime, endTime: Math.max(...words.map(item => item.endTime)) });
const rows = captions => { const all = transcriptWords(captions); return transcriptLines(captions).map(line => {
  const words = all.slice(line.start, line.end);
  return { text: words.map(item => item.text).join(' '), start: words[0].startTime, end: Math.max(...words.map(item => item.endTime)) };
}); };
const texts = captions => rows(captions).map(row => row.text);
function edit(captions, find, text, maxChars, mode) {
  const line = transcriptLines(captions).find(row => find(transcriptWords(captions).slice(row.start, row.end)));
  assert.ok(line, 'row to edit');
  return nativeCaptionPhrases(replaceTranscriptLine(captions, line, replaceText(transcriptLineCaption(captions, line), text)), maxChars, mode);
}
const at = (start) => words => words[0].startTime === start;
// Every word outside the edited row, compared exactly; `marked` may gain only a break.
function assertOutsideExact(before, after, from, to, marked) {
  const keep = list => list.filter(item => item.startTime < from || item.startTime >= to);
  const expected = keep(transcriptWords(before)).map(item => item.startTime === marked && item.lineBreakBefore !== 'break' ? { ...item, lineBreakBefore: 'break' } : item);
  assert.deepEqual(keep(transcriptWords(after)), expected);
}

// The live fixture: "It hasn't started in" then "months", which has no marker;
// only the 25-character limit keeps them apart. The preceding row is a merged
// "Uh..." and the following word follows a sentence end.
const IT = 3.125, IN = 4.508333333333333, MONTHS = 4.988333333333333;
const liveWords = () => [word('finally', 1.23, 1.6406666666666667, { lineBreakBefore: 'edge' }), word('going.', 1.6406666666666667, 1.9926666666666666, { lineBreakBefore: 'join' }),
  word('Uh...', 2.2083333333333335, 2.875, { lineBreakBefore: 'edge' }), word('It', IT, 3.4583333333333335, { lineBreakBefore: 'break' }),
  word("hasn't", 3.4683333333333333, 3.828333333333333), word('started', 3.828333333333333, 4.2683333333333335), word('in', 4.2683333333333335, IN),
  word('months', IN, MONTHS, { endOfSentence: true }), word("I've", 7.068333333333333, 7.348333333329396, { lineBreakBefore: 'edge' }),
  word('just', 7.348333333329396, 7.548333333333332, { lineBreakBefore: 'join' })];

// After a blank, every other row is already grouped as it will stay: a refill
// changes only the edited row's text, whatever it holds and in every wrap mode.
function assertRefill(blank, refilled, start, text, label) {
  const expected = rows(blank).map(row => row.start === start ? { ...row, text } : row);
  assert.deepEqual(rows(refilled), expected, label);
  // Host refresh: regrouping the stored words again changes nothing.
  const stripped = structuredClone(refilled).map(({ renderSegments: _r, ...rest }) => rest);
  assert.deepEqual(rows(nativeCaptionPhrases(stripped, refilled[0].groupingMaxChars, refilled.mode)), expected, label + ' after refresh');
}
const regroup = (captions, maxChars, mode) => Object.assign(nativeCaptionPhrases(captions, maxChars, mode), { mode });

test('live fixture: a cleared row refilled with one word, then several, keeps its exact time and never absorbs months', () => {
  for (const mode of MODES) {
    const source = regroup([container('a', liveWords())], 25, mode), sourceRows = rows(source), target = sourceRows.find(row => row.start === IT);
    const next = sourceRows[sourceRows.indexOf(target) + 1];
    if (mode === 'fill') assert.deepEqual(texts(source), ['finally going.', 'Uh...', "It hasn't started in", 'months', "I've just"], 'the live grouping');
    const blank = regroup(edit(source, at(IT), '', 25, mode), 25, mode);
    assert.deepEqual(rows(blank).find(row => row.start === IT), { text: '', start: IT, end: target.end }, mode);
    assertOutsideExact(source, blank, IT, target.end, next.start);
    for (const text of ['Return', 'Return again now']) {
      const one = regroup(edit(blank, at(IT), 'Return', 25, mode), 25, mode);
      const refilled = text === 'Return' ? one : regroup(edit(one, at(IT), text, 25, mode), 25, mode);
      assertRefill(blank, refilled, IT, text, `${mode}: ${text}`);
      assertOutsideExact(source, refilled, IT, target.end, next.start);
    }
    if (mode === 'fill') {
      const several = edit(edit(blank, at(IT), 'Return', 25, mode), at(IT), 'Return again now', 25, mode);
      assert.deepEqual(rows(several).slice(2, 4), [{ text: 'Return again now', start: IT, end: IN }, { text: 'months', start: IN, end: MONTHS }]);
      // A reflow forgets merges but keeps the refilled row's breaks.
      assert.deepEqual(rows(nativeCaptionPhrases(clearLineMerges(several), 25)).filter(row => row.start >= IT && row.start < MONTHS), [{ text: 'Return again now', start: IT, end: IN }, { text: 'months', start: IN, end: MONTHS }]);
    }
    // A long refill still wraps inside its own time; it is not one glued unit.
    const long = edit(edit(blank, at(IT), 'Return', 25, mode), at(IT), 'Return again now and then once more for luck', 25, mode);
    const own = rows(long).filter(row => row.start >= IT && row.end <= target.end);
    assert.ok(own.length > 1, mode + ': long refill wraps');
    assert.equal(own[0].start, IT); assert.equal(own.at(-1).end, target.end);
    assert.deepEqual(rows(long).find(row => row.start === next.start), rows(blank).find(row => row.start === next.start), mode);
  }
});

// One unpunctuated sentence, no pauses: every row comes from wrapping alone.
const plain = () => [container('a', ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map((text, index) => word(text, index * .25, (index + 1) * .25)))];

test('an auto-wrapped blank (first, middle or last row) refilled with short text merges with neither neighbour', () => {
  for (const mode of MODES) {
    const source = regroup(plain(), 10, mode), before = rows(source);
    assert.ok(before.length >= 3, mode);
    assert.ok(transcriptWords(source).every(item => !item.lineBreakBefore && !item.endOfSentence), 'no markers anywhere');
    for (let index = 0; index < before.length; index++) {
      const { start, end } = before[index], next = before[index + 1]?.start;
      const blank = regroup(edit(source, at(start), '', 10, mode), 10, mode);
      assert.deepEqual(rows(blank).find(row => row.start === start), { text: '', start, end }, `${mode} row ${index}`);
      const refilled = regroup(edit(blank, at(start), 'X', 10, mode), 10, mode);
      assertRefill(blank, refilled, start, 'X', `${mode} row ${index}`);
      assertOutsideExact(source, refilled, start, end, next);
    }
  }
});

test('a blank row across storage containers keeps both boundaries when refilled', () => {
  for (const mode of MODES) {
    const split = [container('left', [word('one', 0, .25), word('two', .25, .5)]), container('right', [word('three', .5, .75), word('four', .75, 1), word('five', 1, 1.25)]), container('later', [word('six', 1.25, 1.5)])];
    const source = regroup(split, 14, mode), sourceRows = rows(source), crossing = sourceRows.find(row => row.start < .5 && row.end > .5);
    assert.ok(crossing, mode + ': a row spans left and right');
    const blank = regroup(edit(source, at(crossing.start), '', 14, mode), 14, mode);
    const refilled = regroup(edit(blank, at(crossing.start), 'Hi', 14, mode), 14, mode);
    assertRefill(blank, refilled, crossing.start, 'Hi', mode);
    assertOutsideExact(source, refilled, crossing.start, crossing.end, sourceRows[sourceRows.indexOf(crossing) + 1]?.start);
  }
});

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
function entry(doc, maxChars = 25) {
  const locator = { projectPath: '/Projects/native.prproj', sequenceId: `{${id.toUpperCase()}}`, clipNodeId: 'native-clip', trackIndex: 2, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const result = { kind: 'native-effect', clipNodeId: 'native-clip', projectItemId: 'native-item', trackIndex: 2, clipIndex: 0,
    startTicks: ticks(1.7), endTicks: ticks(11.7), inTicks: ticks(3600.13), outTicks: ticks(3610.13), selected: true,
    locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc), maxChars };
  result.revision = JSON.stringify({ projectPath: locator.projectPath, sequenceId: locator.sequenceId, clipNodeId: result.clipNodeId, adjustmentLayer: true,
    start: result.startTicks, end: result.endTicks, inPoint: result.inTicks, outPoint: result.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: locator.documentParamIndex, documentText: result.documentText });
  return result;
}
const sequence = () => ({ id, name: 'Native captions', duration: 20, frameWidth: 720, frameHeight: 1280, frameRate: 25, playhead: 2.6 });
const nativeWord = item => ({ text: item.text, start: item.startTime, end: item.endTime, endOfSentence: item.endOfSentence === true, ...(item.lineBreakBefore ? { lineBreakBefore: item.lineBreakBefore } : {}) });

test('native transport: typed steps, blur, host refresh, Undo/Redo and reopen keep the refilled row and its neighbours exact', () => {
  for (const mode of MODES) {
    const style = defaultNativeStyle(); if (mode !== 'fill') style.lineWrap = mode;
    // "It hasn't started in" spans two storage containers here.
    const original = { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 3600.37, style,
      captions: [{ id: 'one', start: 1.23, end: 3.4583333333333335, manualSplit: false, words: liveWords().slice(0, 4).map(nativeWord) },
        { id: 'two', start: 3.4683333333333333, end: 7.548333333333332, manualSplit: false, words: liveWords().slice(4).map(nativeWord) }] };
    // Each write goes through the host carrier, and the panel reads it back.
    let panel = rehydrateNativePanel(entry(original), sequence());
    const write = captions => {
      const stored = prepareNativePanelUpdate(panel.binding, { ...structuredClone(panel.session), captions });
      assert.deepEqual(decodeNativePanelDocument(encodeNativeTransportText(stored), id), stored, 'carrier round trip');
      panel = rehydrateNativePanel(entry(stored), sequence());
      return stored;
    };
    const storedWords = doc => doc.captions.flatMap(caption => caption.words), originalWords = storedWords(original);
    const itTime = () => transcriptWords(panel.session.captions).find(item => item.startTime === panel.session.captions[0].words[3].startTime).startTime;
    const open = () => { const captions = panel.session.captions, line = transcriptLines(captions).find(row => transcriptWords(captions)[row.start].startTime === itTime()); return typingAnchor(captions, line.caption.id, line.start, line.end, true); };
    const sourceRows = rows(panel.session.captions), target = sourceRows.find(row => row.start === itTime()), next = sourceRows[sourceRows.indexOf(target) + 1];
    const targetCount = transcriptLines(panel.session.captions).find(row => transcriptWords(panel.session.captions)[row.start].startTime === itTime());
    const [from, to] = [3, 3 + targetCount.end - targetCount.start];
    const expectStored = (doc, refill) => {
      const all = storedWords(doc), count = refill.length;
      assert.deepEqual(all.slice(0, from), originalWords.slice(0, from), mode + ': words before stay exact');
      assert.deepEqual(all.slice(from, from + count).map(item => item.text), refill, mode);
      assert.equal(all[from].start, originalWords[from].start, mode + ': exact stored row start');
      assert.equal(all[from + count - 1].end, originalWords[to - 1].end, mode + ': exact stored row end');
      assert.equal(all[from].lineBreakBefore, 'break');
      assert.deepEqual(all.slice(from + count), [{ ...originalWords[to], lineBreakBefore: 'break' }, ...originalWords.slice(to + 1)], mode + ': later words keep their bytes; the next one gains a break');
      assert.deepEqual(doc.style, original.style);
    };
    const expectRows = (refill) => {
      const now = rows(panel.session.captions), row = now.find(item => item.start === target.start);
      assert.deepEqual(row, { text: refill, start: target.start, end: target.end }, mode + ': ' + refill);
      assert.deepEqual(now[now.indexOf(row) + 1], next, mode + ': next row');
    };
    // Clear the row with the inline editor's typing step, then blur.
    let anchor = open();
    const blankDoc = write(applyTypingText(panel.session.captions, anchor, ''));
    expectStored(blankDoc, ['']); expectRows('');
    // Reopen the blank and type one word step by step; Undo and Redo keep the anchor.
    anchor = open();
    const steps = [panel.session.captions];
    for (const draft of ['R', 'Ret', 'Return']) steps.push(applyTypingText(steps.at(-1), anchor, draft));
    assert.equal(typingRange(steps[0], anchor).text, '', 'Undo to the blank');
    assert.equal(typingRange(steps.at(-1), anchor).text, 'Return', 'Redo');
    const oneDoc = write(steps.at(-1));
    expectStored(oneDoc, ['Return']); expectRows('Return');
    // Reopen and type several words; the neighbour survives the second refresh.
    anchor = open();
    let typed = panel.session.captions;
    for (const draft of ['Return ', 'Return again', 'Return again now']) typed = applyTypingText(typed, anchor, draft);
    expectStored(write(typed), ['Return', 'again', 'now']); expectRows('Return again now');
    // Undo restores earlier stored documents; reopening them keeps each row.
    panel = rehydrateNativePanel(entry(oneDoc), sequence()); expectRows('Return');
    panel = rehydrateNativePanel(entry(blankDoc), sequence()); expectRows('');
  }
});

test('typing into a pause slot marks its following row with a break that survives a reflow', () => {
  const settings = { blankLineSeconds: 1, visibleLines: 8 };
  const source = nativeCaptionPhrases([container('a', [word('Before', 0, 1)]), container('b', [word('after', 4, 4.5, { lineBreakBefore: 'edge' }), word('that', 4.5, 5, { lineBreakBefore: 'join' })])], 56);
  const pause = derivePauseLines(source, settings)[1], next = transcriptLines(source).find(line => line.start === pause.nextWordIndex);
  const window = { startTime: pause.startTime, endTime: pause.endTime };
  const line = { key: 'typing', caption: next.caption, start: pause.nextWordIndex, end: pause.nextWordIndex, window };
  const after = replaceTranscriptLine(source, line, replaceText(transcriptLineCaption(source, line), 'Hi'));
  const words = transcriptWords(after);
  assert.deepEqual(words.map(item => [item.text, item.lineBreakBefore]), [['Before', undefined], ['Hi', 'break'], ['after', 'break'], ['that', 'join']]);
  assert.deepEqual(texts(nativeCaptionPhrases(clearLineMerges(after), 56)), ['Before', 'Hi', 'after that']);
});
