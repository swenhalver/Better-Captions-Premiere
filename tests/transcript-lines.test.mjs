import test from 'node:test';
import assert from 'node:assert/strict';
import { changeTranscriptLineBreak, replaceTranscriptLine, replaceTranscriptWords, transcriptLineCaption, transcriptLineLane, transcriptLines, transcriptWords, withTranscriptLines } from '../webview-ui/src/lib/transcript/lines.ts';
import { replaceText, retime, validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { applyTypingText, typingAnchor, typingRange } from '../webview-ui/src/lib/transcript/typing.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { moveWordEdge } from '../webview-ui/src/lib/transcript/timing.ts';
import { refreshCaptionGroups } from '../webview-ui/src/lib/transcript/parser.ts';

const speech = words => words.map(word => [word.text, word.startTime, word.endTime, word.endOfSentence]);
function fixture(cuts = [0, 4]) {
  const words = 'one two three four five six seven eight'.split(' ').map((text, index) => ({ text, startTime: index, endTime: index + .5, isActive: false }));
  const captions = cuts.map((start, index) => {
    const part = words.slice(start, cuts[index + 1] ?? words.length);
    return { id: 'store-' + index, words: part, text: part.map(word => word.text).join(' '), startTime: part[0].startTime, endTime: part.at(-1).endTime, manualSplit: true };
  });
  return withTranscriptLines(captions, [0, 2, 4, 6].map(start => ({ start, end: start + 2, key: 'line-' + start })));
}
const texts = captions => transcriptLines(captions).map(line => transcriptLineCaption(captions, line).text);

test('rendered transcript rows are complete and unique when their words span storage', () => {
  const captions = fixture([0, 3, 5]);
  assert.deepEqual(texts(captions), ['one two', 'three four', 'five six', 'seven eight']);
  assert.deepEqual(transcriptLines(captions).flatMap(line => transcriptLineCaption(captions, line).words), transcriptWords(captions));
  const broken = structuredClone(captions); broken[0].renderSegments[0].words[0].text = 'not source';
  assert.throws(() => transcriptLines(broken), /do not match/);
});

test('merge joins only the selected and next line, identically within or across storage', () => {
  let expected;
  for (const cuts of [[0], [0, 4], [0, 3, 5]]) {
    const captions = fixture(cuts), before = structuredClone(captions);
    const merged = changeTranscriptLineBreak(captions, transcriptLines(captions)[1]);
    assert.deepEqual(texts(merged), ['one two', 'three four five six', 'seven eight']);
    assert.deepEqual(texts(nativeCaptionPhrases(merged,11)), texts(merged), 'native regroup keeps the explicit join across every storage layout');
    assert.deepEqual(speech(transcriptWords(merged)), speech(transcriptWords(captions)));
    assert.deepEqual(merged.map(c => c.id), captions.map(c => c.id));
    assert.deepEqual(captions, before);
    const boundaries = transcriptWords(merged).map(word => word.lineBreakBefore);
    assert.deepEqual(boundaries.slice(2, 7), ['edge','join','join','join','edge'], 'merge edges, not manual breaks');
    if (expected) assert.deepEqual(transcriptWords(merged), expected); else expected = transcriptWords(merged);
    assert.deepEqual(texts(refreshCaptionGroups(merged, 3)), ['one', 'two', 'three four five six', 'seven', 'eight'], 'a deliberate join overrides character limits without freezing unrelated lines');
  }
});

test('split is an explicit word boundary, including inside a cross-storage merged line', () => {
  for (const cuts of [[0], [0, 4], [0, 3, 5]]) {
    const captions = fixture(cuts), merged = changeTranscriptLineBreak(captions, transcriptLines(captions)[1]);
    const split = changeTranscriptLineBreak(merged, transcriptLines(merged)[1], 5);
    assert.deepEqual(texts(split), ['one two', 'three four five', 'six', 'seven eight']);
    assert.deepEqual(texts(nativeCaptionPhrases(split,11)), texts(split), 'native regroup preserves the explicit split and joined words');
    assert.deepEqual(split.map(c => c.id), captions.map(c => c.id));
    assert.deepEqual(speech(transcriptWords(split)), speech(transcriptWords(captions)));
    assert.equal(transcriptWords(split)[5].lineBreakBefore, 'break');
    assert.throws(() => changeTranscriptLineBreak(split, transcriptLines(split)[1], 2), /interior word/);
  }
});

test('per-line retiming crosses the old storage edge and preserves neighboring speech', () => {
  let expected;
  for (const cuts of [[0], [0, 3], [0, 4]]) {
    const captions = fixture(cuts), line = transcriptLines(captions)[1];
    const updated = replaceTranscriptLine(captions, line, retime(transcriptLineCaption(captions, line), 1.75, 3.75));
    assert.equal(transcriptWords(updated)[2].startTime, 1.75);
    assert.equal(transcriptWords(updated)[3].endTime, 3.75);
    assert.deepEqual(speech(transcriptWords(updated).slice(0,2)), speech(transcriptWords(captions).slice(0,2)));
    assert.deepEqual(speech(transcriptWords(updated).slice(4)), speech(transcriptWords(captions).slice(4)));
    if (expected) assert.deepEqual(transcriptWords(updated), expected); else expected = transcriptWords(updated);
    assert.deepEqual(texts(updated), texts(captions)); validateCaptions(updated);
    assert.throws(() => replaceTranscriptLine(captions, line, retime(transcriptLineCaption(captions, line), 1.25, 3.75)), /overlap/);
  }
});

test('word lane neighbours and timing limits continue across storage edges', () => {
  const captions = fixture([0, 4]), line = transcriptLines(captions)[2], lane = transcriptLineLane(captions, line);
  assert.deepEqual(lane.caption.words.map(word => word.text), ['four','five','six','seven']);
  assert.deepEqual([lane.start,lane.end,lane.focusStart,lane.focusEnd], [3,7,1,3]);
  const editedLane = moveWordEdge(lane.caption, 1, 'startTime', 3.75, 24);
  const updated = replaceTranscriptWords(captions, lane.start, lane.end, editedLane.words);
  assert.equal(transcriptWords(updated)[4].startTime, 3.75);
  assert.equal(updated[1].startTime, 3.75, 'storage follows speech into the old boundary gap');
  assert.deepEqual(speech(transcriptWords(updated).slice(0,4)), speech(transcriptWords(captions).slice(0,4)));
  validateCaptions(updated);
});

test('typing across storage preserves deliberate joins and outside words through count changes and undo snapshots', () => {
  const original = fixture([0, 4]), merged = changeTranscriptLineBreak(original, transcriptLines(original)[1]);
  const anchor = typingAnchor(merged, 'store-0', 2, 6, true);
  const updated = applyTypingText(merged, anchor, 'three four added five six');
  assert.equal(typingRange(updated, anchor).text, 'three four added five six');
  assert.deepEqual(transcriptWords(updated).slice(2,7).map(word => word.lineBreakBefore), ['edge','join','join','join','join']);
  assert.deepEqual(speech(transcriptWords(updated).slice(0,2)), speech(transcriptWords(merged).slice(0,2)));
  assert.deepEqual(speech(transcriptWords(updated).slice(-2)), speech(transcriptWords(merged).slice(-2)));
  assert.equal(typingRange(merged, anchor).text, 'three four five six');
  assert.deepEqual(texts(original), ['one two','three four','five six','seven eight']);
  assert.deepEqual(texts(updated), ['one two','three four added five six','seven eight']);
  assert.deepEqual(texts(applyTypingText(updated, anchor, 'short')), ['one two','short','seven eight']);
});

test('the reported opening split merges with only finally going, preserving the following line', () => {
  const source = fixture([0,3]), labels = ["Alright,", "This", "Thing's", 'finally', 'going.', 'It', "hasn't", 'started'];
  const captions = withTranscriptLines(source.map(c => { const words = c.words.map(word => ({ ...word, text: labels[word.startTime] })); return { ...c, words, text: words.map(w => w.text).join(' ') }; }),
    [{start:0,end:3,key:'opening'},{start:3,end:5,key:'finally'},{start:5,end:8,key:'next'}]);
  const merged = changeTranscriptLineBreak(captions, transcriptLines(captions)[0]);
  assert.deepEqual(texts(merged), ["Alright, This Thing's finally going.", "It hasn't started"]);
  assert.equal(merged.length, 2);
  assert.deepEqual(speech(transcriptWords(merged)), speech(transcriptWords(captions)));
});

test('pause removal boundary metadata follows replacement first words and remains on source words through split/merge', () => {
  const base = fixture([0, 3, 5]);
  base[0].words[2].pauseLinesRemoved = 2;
  const captions = withTranscriptLines(base, transcriptLines(base).map(line => ({ start:line.start, end:line.end, key:line.segment.id })));
  const row = transcriptLines(captions)[1];
  for (const draft of ['replacement four', 'replacement', 'added three four', 'three four added', 'four']) {
    const updated = replaceTranscriptLine(captions, row, replaceText(transcriptLineCaption(captions, row), draft));
    const words = transcriptWords(updated), current = transcriptLineCaption(updated, transcriptLines(updated)[1]);
    assert.equal(current.words[0].pauseLinesRemoved, 2, draft);
    assert.equal(words.filter(word => word.pauseLinesRemoved !== undefined).length, 1, draft);
    assert.deepEqual(speech(words.slice(0, 2)), speech(transcriptWords(captions).slice(0, 2)));
    assert.deepEqual(speech(words.slice(-4)), speech(transcriptWords(captions).slice(-4)));
    assert.equal(transcriptLines(updated)[1].segment.words[0].pauseLinesRemoved, 2);
  }
  const merged = changeTranscriptLineBreak(captions, transcriptLines(captions)[0]);
  assert.equal(transcriptWords(merged)[2].pauseLinesRemoved, 2);
  const split = changeTranscriptLineBreak(merged, transcriptLines(merged)[0], 2);
  assert.equal(transcriptLineCaption(split, transcriptLines(split)[1]).words[0].pauseLinesRemoved, 2);
  assert.deepEqual(transcriptWords(captions), transcriptWords(base));
});

test('native typing preserves pause deletion metadata through word-count changes and undo/redo readback snapshots', () => {
  const base = fixture([0, 3, 5]); base[0].words[2].pauseLinesRemoved = 3;
  const original = withTranscriptLines(base, transcriptLines(base).map(line => ({ start:line.start, end:line.end, key:line.segment.id })));
  const anchor = typingAnchor(original, 'store-0', 2, 4, true);
  const typed = applyTypingText(original, anchor, 'new opening four');
  assert.equal(typingRange(typed, anchor).words[0].pauseLinesRemoved, 3);
  assert.equal(transcriptWords(typed).filter(word => word.pauseLinesRemoved !== undefined).length, 1);
  const shorter = applyTypingText(typed, anchor, 'replacement');
  assert.equal(typingRange(shorter, anchor).words[0].pauseLinesRemoved, 3);
  for (const snapshot of [original, typed, shorter, original, typed]) {
    const restored = structuredClone(snapshot);
    assert.equal(typingRange(restored, anchor).words[0].pauseLinesRemoved, 3);
    assert.deepEqual(speech(transcriptWords(restored).slice(-4)), speech(transcriptWords(original).slice(-4)));
    validateCaptions(restored);
  }
});
