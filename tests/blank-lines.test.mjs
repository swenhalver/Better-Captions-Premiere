import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceText, validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { changeTranscriptLineBreak, replaceTranscriptLine, transcriptLineCaption, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { applyTypingText, createTypingController, typingAnchor, typingRange } from '../webview-ui/src/lib/transcript/typing.ts';
import { derivePauseLines } from '../webview-ui/src/lib/native-effect/pause-lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { lineStarts } from '../webview-ui/src/lib/native-effect/line-wrap.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME, validateNativeDocument } from '../webview-ui/src/lib/native-effect/contract.ts';
import { decodeNativeTransportTimeOrigin, encodeNativeDocument, encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument, prepareNativePanelUpdate, rehydrateNativePanel } from '../webview-ui/src/lib/native-effect/panel.ts';

const clone = structuredClone;
const word = (text, startTime, endTime, extra = {}) => ({ text, startTime, endTime, isActive: false, ...extra });
const container = (id, words) => ({ id, words, text: words.map(item => item.text).join(' '), startTime: words[0].startTime, endTime: Math.max(...words.map(item => item.endTime)) });
// Three sentences, three lines; the middle one carries styling metadata.
const story = () => [container('a', [word('First', 0, .4), word('line.', .4, .9, { endOfSentence: true })]),
  container('b', [word('Second', 2, 2.5, { pauseLinesRemoved: 1 }), word('line', 2.5, 3), word('here.', 3, 3.5, { endOfSentence: true })]),
  container('c', [word('Third', 6, 6.4), word('line.', 6.4, 7, { endOfSentence: true })])];
const grouped = captions => nativeCaptionPhrases(captions, 56);
const lineText = captions => transcriptLines(captions).map(line => transcriptWords(captions).slice(line.start, line.end).map(item => item.text).join(' '));
function blankLine(captions, index) {
  const line = transcriptLines(captions)[index];
  return replaceTranscriptLine(captions, line, replaceText(transcriptLineCaption(captions, line), ''));
}

test('deleting every word of a line leaves one timed blank row and preserves all other words exactly', () => {
  const before = grouped(story()), after = grouped(blankLine(before, 1));
  assert.deepEqual(lineText(after), ['First line.', '', 'Third line.']);
  const words = transcriptWords(after);
  assert.deepEqual(words[2], word('', 2, 3.5, { pauseLinesRemoved: 1, lineBreakBefore: 'break' }), 'the blank keeps the line time and its pause deletions');
  // The only other change is the intentional break that keeps the next line apart.
  assert.deepEqual([words[0], words[1], words[3], words[4]], [...before[0].words, { ...before[2].words[0], lineBreakBefore: 'break' }, before[2].words[1]]);
  assert.deepEqual(after.map(caption => caption.id), ['a', 'b', 'c'], 'storage identities stay');
  validateCaptions(after);
  // Retyping restores text in the same time window; one word takes all of it.
  const restored = grouped(replaceTranscriptLine(after, transcriptLines(after)[1], replaceText(transcriptLineCaption(after, transcriptLines(after)[1]), 'Back')));
  assert.deepEqual(transcriptWords(restored)[2], word('Back', 2, 3.5, { pauseLinesRemoved: 1, lineBreakBefore: 'break' }));
  const longer = grouped(replaceTranscriptLine(after, transcriptLines(after)[1], replaceText(transcriptLineCaption(after, transcriptLines(after)[1]), 'Back again now.')));
  assert.deepEqual(lineText(longer), ['First line.', 'Back again now.', 'Third line.']);
  const typed = transcriptWords(longer).slice(2, 5);
  assert.equal(typed[0].startTime, 2); assert.equal(typed.at(-1).endTime, 3.5); assert.equal(typed[0].pauseLinesRemoved, 1);
});

test('blank lines stand alone even beside joins and punctuation, and consecutive blanks stay separate rows', () => {
  const input = [word('Before', 0, 1), word('', 1, 2, { lineBreakBefore: 'join' }), word(',after', 2, 3, { lineBreakBefore: 'join' })];
  for (const mode of ['fill', 'balance', 'pretty']) assert.deepEqual(lineStarts(input, 56, mode), [true, true, true]);
  const twice = grouped(blankLine(blankLine(grouped(story()), 0), 1));
  assert.deepEqual(lineText(twice), ['', '', 'Third line.']);
  assert.throws(() => changeTranscriptLineBreak(twice, transcriptLines(twice)[0]), /blank line stands alone/);
  // The whole transcript can become blank; it stays one valid timed row per line.
  const empty = grouped(blankLine(twice, 2));
  assert.deepEqual(lineText(empty), ['', '', '']);
  validateCaptions(empty);
});

test('a line across storage containers becomes one blank word; an emptied container is dropped', () => {
  const split = [container('left', [word('One', 0, .5), word('two', .5, 1)]), container('right', [word('three.', 1, 1.5, { endOfSentence: true })]), container('later', [word('Later.', 5, 6, { endOfSentence: true })])];
  const rows = grouped(split);
  assert.deepEqual(lineText(rows), ['One two three.', 'Later.']);
  const after = grouped(blankLine(rows, 0));
  assert.deepEqual(after.map(caption => [caption.id, caption.words.map(item => item.text)]), [['left', ['']], ['later', ['Later.']]]);
  assert.deepEqual(after[0].words[0], word('', 0, 1.5, { lineBreakBefore: 'break' }));
  assert.deepEqual(after[1].words[0], word('Later.', 5, 6, { endOfSentence: true, lineBreakBefore: 'break' }));
});

test('typing into a pause slot inserts its own line there and leaves the other slots, including prior deletions', () => {
  const settings = { blankLineSeconds: 1, visibleLines: 8 };
  // 7 s of silence between the lines: seven complete slots, one deleted.
  const source = grouped([container('a', [word('Before.', 0, 1, { endOfSentence: true })]), container('b', [word('After.', 8, 9, { endOfSentence: true, pauseLinesRemoved: 1 })])]);
  const pauses = derivePauseLines(source, settings);
  assert.equal(pauses.length, 6);
  for (const slot of [0, 2, 5]) {
    const pause = pauses[slot], next = transcriptLines(source).find(line => line.start === pause.nextWordIndex);
    const window = { startTime: pause.startTime, endTime: pause.endTime };
    const line = { key: 'typing', caption: next.caption, start: pause.nextWordIndex, end: pause.nextWordIndex, window };
    const after = grouped(replaceTranscriptLine(source, line, replaceText(transcriptLineCaption(source, line), 'New words')));
    assert.deepEqual(lineText(after), ['Before.', 'New words', 'After.'], 'slot ' + slot);
    const words = transcriptWords(after);
    assert.equal(words[1].startTime, pause.startTime); assert.equal(words[2].endTime, pause.endTime);
    assert.equal(words[1].lineBreakBefore, 'break'); assert.equal(words[3].lineBreakBefore, 'break');
    assert.deepEqual(words[0], source[0].words[0]); assert.equal(words[3].startTime, 8); assert.equal(words[3].pauseLinesRemoved, 1);
    const remaining = derivePauseLines(after, settings);
    assert.equal(remaining.length, 5, 'slot ' + slot + ' keeps the other five pause rows');
    assert.deepEqual(remaining.filter(row => row.endTime <= pause.startTime).length, slot);
  }
});

test('typing anchors follow a line through blank and back, and type into an empty pause range', () => {
  const captions = grouped(story()), row = transcriptLines(captions)[1];
  const anchor = typingAnchor(captions, row.caption.id, row.start, row.end, true);
  const blank = applyTypingText(captions, anchor, '');
  assert.deepEqual(typingRange(blank, anchor).words.map(item => item.text), ['']);
  assert.equal(typingRange(applyTypingText(captions, anchor, 'Second line here.'), anchor).text, 'Second line here.');
  // An empty range needs its time window; text goes into it before the next line.
  const pauses = derivePauseLines(captions, { blankLineSeconds: 1, visibleLines: 4 }), pause = pauses.find(item => item.nextWordIndex === 5);
  assert.throws(() => typingAnchor(captions, 'c', 5, 5, true), /Select the line again/);
  const empty = typingAnchor(captions, 'c', 5, 5, true, { startTime: pause.startTime, endTime: pause.endTime });
  assert.equal(typingRange(captions, empty).text, '');
  assert.deepEqual(applyTypingText(captions, empty, '  '), captions, 'an empty draft leaves the pause');
  const typed = applyTypingText(captions, empty, 'Inserted words');
  // The next line gains a manual break, which belongs to the edited range.
  assert.equal(transcriptWords(typed)[7].lineBreakBefore, 'break');
  assert.equal(typingRange(typed, empty).text, 'Inserted words');
  assert.equal(typingRange(clone(captions), empty).text, '', 'Undo back to the pause keeps the editor open');
  const outside = clone(captions); outside[0].words[0].text = 'Changed';
  assert.equal(typingRange(outside, empty), null);
});

test('an empty draft is a typing step for a line but not for an empty pause', () => {
  const pushed = [], controller = createTypingController({ setTimer: () => 1, clearTimer() {}, push: draft => { pushed.push(draft); return true; }, show() {} });
  controller.open('Some words'); controller.input('', 0);
  assert.equal(controller.flush(), true); assert.deepEqual(pushed, ['']);
  controller.open(''); controller.input('   ', 3);
  assert.equal(controller.flush(), false); assert.deepEqual(pushed, ['']);
});

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
function nativeDocument() {
  const style = defaultNativeStyle(); style.current.bubble = true; style.current.fontFamily = 'Georgia';
  return { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 3600.37, style,
    captions: [{ id: 'one', start: 2.1, end: 7.3, manualSplit: false, words: [
      { text: 'First.', start: 2.1, end: 2.4, endOfSentence: true },
      { text: 'Second', start: 3.3, end: 3.8, endOfSentence: false, pauseLinesRemoved: 2 },
      { text: 'line.', start: 3.9, end: 4.7, endOfSentence: true },
      { text: 'Third.', start: 6.9, end: 7.3, endOfSentence: true, lineBreakBefore: 'break' },
    ] }] };
}
function entry(doc) {
  const locator = { projectPath: '/Projects/native.prproj', sequenceId: `{${id.toUpperCase()}}`, clipNodeId: 'native-clip', trackIndex: 2, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const result = { kind: 'native-effect', clipNodeId: 'native-clip', projectItemId: 'native-item', trackIndex: 2, clipIndex: 0,
    startTicks: ticks(1.7), endTicks: ticks(11.7), inTicks: ticks(3600.13), outTicks: ticks(3610.13), selected: true,
    locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc) };
  result.revision = JSON.stringify({ projectPath: locator.projectPath, sequenceId: locator.sequenceId, clipNodeId: result.clipNodeId, adjustmentLayer: true,
    start: result.startTicks, end: result.endTicks, inPoint: result.inTicks, outPoint: result.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: locator.documentParamIndex, documentText: result.documentText });
  return result;
}
const sequence = () => ({ id, name: 'Native captions', duration: 20, frameWidth: 720, frameHeight: 1280, frameRate: 25, playhead: 2.6 });

test('native documents carry a blank word through the codec, readers, panel and back, keeping exact source times', () => {
  const original = nativeDocument();
  const { session, binding } = rehydrateNativePanel(entry(original), sequence());
  const offset = binding.timelineOffsetSeconds;
  assert.notEqual(7.3 + offset - offset, 7.3, 'this placement offset would round a converted time');
  const middle = transcriptLines(session.captions)[1];
  const edited = { ...clone(session), captions: blankLine(session.captions, 1) };
  assert.equal(middle.end - middle.start, 2);
  const prepared = prepareNativePanelUpdate(binding, edited);
  assert.deepEqual(prepared.captions[0].words, [original.captions[0].words[0], { text: '', start: 3.3, end: 4.7, endOfSentence: false, lineBreakBefore: 'break', pauseLinesRemoved: 2 }, original.captions[0].words[3]],
    'the shifted Third. keeps its stored bytes; the blank keeps the exact stored line time');
  assert.deepEqual(prepared.style, original.style); assert.equal(prepared.timeOriginSeconds, 3600.37);
  const text = encodeNativeTransportText(prepared);
  assert.equal(decodeNativeTransportTimeOrigin(text), 3600.37);
  assert.deepEqual(decodeNativePanelDocument(text, id).captions[0].words[1], { text: '', start: 3.3, end: 4.7, endOfSentence: false, lineBreakBefore: 'break', pauseLinesRemoved: 2 });
  // Reopening shows the blank row, which takes text again.
  const reopened = rehydrateNativePanel(entry(prepared), sequence()).session.captions;
  assert.deepEqual(lineText(reopened), ['First.', '', 'Third.']);
  const retyped = replaceTranscriptLine(reopened, transcriptLines(reopened)[1], replaceText(transcriptLineCaption(reopened, transcriptLines(reopened)[1]), 'Second line.'));
  assert.deepEqual(lineText(grouped(retyped)), ['First.', 'Second line.', 'Third.']);
});

test('only word text may be empty, and a blank word needs a positive duration', () => {
  const blank = nativeDocument(); blank.captions[0].words[1].text = '';
  assert.equal(validateNativeDocument(blank).captions[0].words[1].text, '');
  const instant = clone(blank); instant.captions[0].words[1].end = 3.3;
  assert.throws(() => validateNativeDocument(instant), /positive duration/);
  const spaces = clone(blank); spaces.captions[0].words[1].text = ' ';
  assert.throws(() => validateNativeDocument(spaces), /Invalid or oversized native transcript text/);
  // Readers accept an empty word but never an empty container identity or font family.
  const bytes = encodeNativeDocument(blank), carrier = encodeNativeTransportText(blank);
  assert.equal(decodeNativePanelDocument(carrier, id).captions[0].words[1].text, '');
  const emptyIdentity = Buffer.from(bytes); emptyIdentity.writeUInt32LE(0, 12);
  const withoutIdentity = Buffer.concat([emptyIdentity.subarray(0, 16), emptyIdentity.subarray(16 + 3)]);
  const asCarrier = buffer => 'BCDOC1:' + buffer.toString('hex');
  assert.throws(() => decodeNativePanelDocument(asCarrier(withoutIdentity), id), /string/);
  assert.throws(() => decodeNativeTransportTimeOrigin(asCarrier(withoutIdentity)), /string length/);
  const font = Buffer.from('Georgia'), at = Buffer.from(bytes).indexOf(font);
  const withoutFont = Buffer.concat([Buffer.from(bytes).subarray(0, at - 4), Buffer.from([0, 0, 0, 0]), Buffer.from(bytes).subarray(at + font.length)]);
  assert.throws(() => decodeNativePanelDocument(asCarrier(withoutFont), id), /string|font/i);
  assert.throws(() => decodeNativeTransportTimeOrigin(asCarrier(withoutFont)), /string length|font/i);
});
