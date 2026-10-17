import test from 'node:test';
import assert from 'node:assert/strict';
import { captionCharacterCount, groupCaptionWords, parseTranscript, regroupCaptions, validateCharacterLimit } from '../webview-ui/src/lib/transcript/parser.ts';
import { validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { restoreSessionStyle } from '../webview-ui/src/lib/session/style.ts';
import { validateStylePatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { DEFAULT_STYLE, DEFAULT_MAX_CHARS } from '../webview-ui/src/lib/types.ts';

const words = text => text.split(' ').map((text, i) => ({ text, startTime: i * .3, endTime: i * .3 + .2, isActive: false }));
const cue = (id, words, patch = {}) => ({ id, words, text: words.map(w => w.text).join(' '), startTime: words[0].startTime, endTime: words.at(-1).endTime + .1, ...patch });

test('character grouping has no hidden word-count cap', () => {
  const input = words('a b c d e f g h i j k l');
  const grouped = groupCaptionWords(input, 23);
  assert.equal(grouped.length, 1); assert.equal(grouped[0].words.length, 12);
  assert.equal(captionCharacterCount(grouped[0].text), 23);
  assert.deepEqual(grouped[0].words, input); validateCaptions(grouped);
  const transcript = { segments: [{ words: input.map(w => ({ text: w.text, start: w.startTime, duration: w.endTime - w.startTime, type: 'word', eos: false })) }] };
  assert.equal(parseTranscript(transcript, 23).length, 1);
});

test('spaces and punctuation count, exact boundaries fit and one extra character splits', () => {
  const input = words('Hi, there now');
  assert.deepEqual(groupCaptionWords(input, 9).map(c => c.text), ['Hi, there', 'now']);
  assert.deepEqual(groupCaptionWords(input, 8).map(c => c.text), ['Hi,', 'there', 'now']);
  const grouped = groupCaptionWords(words('one two three four five'), 10);
  assert.ok(grouped.every(c => captionCharacterCount(c.text) <= 10)); validateCaptions(grouped);
});

test('Unicode graphemes count as visible characters and long words stay intact', () => {
  assert.equal(captionCharacterCount('é e\u0301 😀 👩🏽‍💻'), 7);
  assert.deepEqual(groupCaptionWords(words('😀 é'), 3).map(c => c.text), ['😀 é']);
  const input = words('extraordinary a b');
  assert.deepEqual(groupCaptionWords(input, 3).map(c => c.text), ['extraordinary', 'a b']);
  assert.deepEqual(groupCaptionWords(input, 3).flatMap(c => c.words), input);
});

test('regroup can increase or decrease the limit across old automatic caption boundaries', () => {
  const input = words('one two three four five six seven eight');
  const old = [cue('old-one', input.slice(0, 6)), cue('old-two', input.slice(6))];
  const before = structuredClone(old);
  const joined = regroupCaptions(old, 56);
  assert.equal(joined.length, 1); assert.equal(joined[0].id, 'old-one'); assert.equal(joined[0].words.length, 8);
  const split = regroupCaptions(joined, 10);
  assert.ok(split.length > 2); assert.ok(split.every(c => captionCharacterCount(c.text) <= 10));
  assert.deepEqual(split.flatMap(c => c.words), input); assert.deepEqual(old, before);
  assert.equal(new Set(split.map(c => c.id)).size, split.length); validateCaptions(split);
  assert.equal(regroupCaptions(split, 56).length, 1);
});

test('regroup preserves sentence flags, pauses, speaker and placement boundaries', () => {
  const input = words('one two three four five six'); input[1].endOfSentence = true;
  const old = [cue('one', input.slice(0, 2)), cue('two', input.slice(2, 4)), cue('three', input.slice(4), { position: { x: .1, y: .4 }, timingEstimated: true })];
  const result = regroupCaptions(old, 100);
  assert.deepEqual(result.map(c => c.text), ['one two', 'three four', 'five six']);
  assert.deepEqual(result[2].position, { x: .1, y: .4 }); assert.equal(result[2].timingEstimated, true);
  const speakers = [cue('a', input.slice(2, 4), { speaker: 'A' }), cue('b', input.slice(4), { speaker: 'B' })];
  assert.equal(regroupCaptions(speakers, 100).length, 2);
  const pause = words('before after'); pause[1].startTime = 2; pause[1].endTime = 2.2;
  assert.equal(groupCaptionWords(pause, 100).length, 2); validateCaptions(result);
});

test('linked captions regroup displayed sentences while retaining native keyframe/media identities', () => {
  const original = [cue('linked', words('keep these words'), { clipNodeId: 'clip', projectItemId: 'item', mediaPath: '/caption.mov', renderBounds: { width: 400 }, motionProfile: { signature: 'keys' } })];
  const before = structuredClone(original);
  const result = regroupCaptions(original, 5);
  assert.deepEqual(result[0].renderSegments.map(group => group.text), ['keep', 'these', 'words']);
  const { renderSegments, groupingMaxChars, ...container } = result[0];
  assert.deepEqual(container, before[0]); assert.equal(groupingMaxChars, 5);
  assert.deepEqual(original, before);
});

test('saved settings migrate old word counts to the character default without treating words as characters', () => {
  const { maxChars: _newSetting, ...legacy } = structuredClone(DEFAULT_STYLE); legacy.maxWords = 2;
  const restored = restoreSessionStyle(legacy);
  assert.equal(restored.maxChars, DEFAULT_MAX_CHARS); assert.equal(Object.hasOwn(restored, 'maxWords'), false);
  assert.equal(legacy.maxWords, 2);
  assert.equal(restoreSessionStyle({ ...legacy, maxChars: 42 }).maxChars, 42);
  for (const value of [0, -1, 1.5, NaN, Infinity, 501, '42', null]) {
    assert.throws(() => validateCharacterLimit(value));
    assert.throws(() => validateStylePatch({ maxChars: value }));
    assert.equal(restoreSessionStyle({ maxChars: value }).maxChars, DEFAULT_MAX_CHARS);
  }
  assert.deepEqual(validateStylePatch({ maxChars: 42 }), { maxChars: 42 });
  assert.throws(() => validateStylePatch({ maxWords: 6 }), /Unknown caption style/);
});
