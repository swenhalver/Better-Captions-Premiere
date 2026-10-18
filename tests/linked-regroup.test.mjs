import test from 'node:test';
import assert from 'node:assert/strict';
import { captionSentenceCount, regroupCaptions, refreshCaptionGroups } from '../webview-ui/src/lib/transcript/parser.ts';
import { captionAtRenderTime, CaptionRenderer, wordState } from '../webview-ui/src/lib/canvas/engine.ts';
import { validateCaptionPatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { validateCaptions, retime, replaceText } from '../webview-ui/src/lib/transcript/edit.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';

const words = text => text.split(' ').map((text, index) => ({ text, startTime: index * .3, endTime: index * .3 + .2, isActive: false }));
const cue = (id, items, patch = {}) => ({ id, text: items.map(word => word.text).join(' '), words: items,
  startTime: items[0].startTime, endTime: items.at(-1).endTime + .1,
  clipNodeId: 'clip-' + id, projectItemId: 'item-' + id, mediaPath: '/captions/' + id + '.mov',
  renderBounds: { x: 20, y: 600, width: 500, height: 512, frameWidth: 720, frameHeight: 1280 },
  motionProfile: { signature: 'native-' + id, samples: [{ time: items[0].startTime, scaleX: .8, scaleY: 1.4 }] }, ...patch });
const container = ({ groupingMaxChars, renderSegments, ...rest }) => rest;

test('decreasing and increasing a linked caption limit keeps the exact native clip and curves', () => {
  const original = [cue('a', words('one two three four five six'))], before = structuredClone(original);
  const narrow = regroupCaptions(original, 9);
  assert.deepEqual(narrow[0].renderSegments.map(group => group.text), ['one two', 'three', 'four five', 'six']);
  const wide = regroupCaptions(narrow, 100);
  assert.equal(captionSentenceCount(wide), 1); assert.equal(wide[0].renderSegments[0].text, original[0].text);
  assert.deepEqual(narrow.map(container), before); assert.deepEqual(wide.map(container), before);
  assert.deepEqual(original, before); validateCaptions(narrow); validateCaptions(wide);
});

test('a joined sentence spans two native clips with continuous word context and unchanged identities', () => {
  const input = words('one two three four five six'), original = [cue('a', input.slice(0, 3)), cue('b', input.slice(3))];
  const result = regroupCaptions(original, 100);
  assert.equal(result.length, 2); assert.equal(captionSentenceCount(result), 1);
  assert.deepEqual(result.map(container), original);
  const left = captionAtRenderTime(result[0], .75), right = captionAtRenderTime(result[1], .95);
  assert.equal(left.id, right.id); assert.equal(left.text, 'one two three four five six');
  assert.deepEqual(left.words, right.words);
  assert.equal(wordState(right.words[0], .95), 'spoken');
  assert.equal(wordState(right.words[3], .95), 'active');
  assert.equal(wordState(right.words[5], .95), 'upcoming');
  assert.equal(captionAtRenderTime(result[0], .95), null, 'native container still gates its own range');
});

test('linked regroup keeps sentence, silence, speaker and placement boundaries', () => {
  const input = words('one two three four five six'); input[1].endOfSentence = true;
  const result = regroupCaptions([cue('a', input.slice(0, 2)), cue('b', input.slice(2, 4)), cue('c', input.slice(4), { position: { x: .1, y: .4 } })], 100);
  assert.equal(captionSentenceCount(result), 3);
  assert.deepEqual(result.map(item => item.renderSegments[0].text), ['one two', 'three four', 'five six']);
  const paused = words('before after'); paused[1].startTime = 2; paused[1].endTime = 2.2;
  assert.equal(captionSentenceCount(regroupCaptions([cue('pause', paused)], 100)), 2);
});

test('regrouping a mixed session retains each linked and unapplied container without fabricating links', () => {
  const input = words('one two three four');
  const linked = cue('a', input.slice(0, 2)), unlinked = { id: 'b', text: 'three four', words: input.slice(2), startTime: .6, endTime: 1.1 };
  const result = regroupCaptions([linked, unlinked], 100);
  assert.deepEqual(result.map(container), [linked, unlinked]);
  assert.equal(captionSentenceCount(result), 1); assert.equal(result[1].clipNodeId, undefined);
});

test('saved regrouped sessions and repeated recalculation keep stable logical phrase identities', () => {
  const grouped = regroupCaptions([cue('a', words('one two three four five six'))], 9);
  assert.deepEqual(refreshCaptionGroups(grouped), grouped);
  assert.deepEqual(refreshCaptionGroups(JSON.parse(JSON.stringify(grouped))), grouped);
  const plain = [cue('plain', words('original words'))];
  assert.equal(refreshCaptionGroups(plain), plain, 'undoing regroup can restore the original ungrouped container');
});

test('agent text edits rebuild grouped sentence text and cannot inject rendered words', () => {
  const grouped = regroupCaptions([cue('a', words('one two three four'))], 8);
  const patch = structuredClone(grouped); patch[0].words[0].text = 'updated';
  patch[0].renderSegments = [{ id: 'injected', words: [], text: 'injected', startTime: 0, endTime: 5 }];
  const edited = validateCaptionPatch(patch, grouped);
  assert.equal(edited[0].text, 'updated two three four');
  assert.equal(edited[0].renderSegments[0].text, 'updated');
  assert.ok(edited[0].renderSegments.every(group => !group.text.includes('injected')));
  assert.equal(edited[0].clipNodeId, grouped[0].clipNodeId);
});

test('ordinary text, timing and placement edits recompute groups using the applied limit', () => {
  const grouped = regroupCaptions([cue('a', words('one two three four'))], 8);
  const edited = refreshCaptionGroups([retime(replaceText(grouped[0], 'new two three four'), 1, 2.1)]);
  assert.equal(edited[0].groupingMaxChars, 8); assert.equal(edited[0].renderSegments[0].text, 'new two');
  assert.equal(edited[0].renderSegments[0].startTime, 1);
  assert.equal(edited[0].renderSegments.at(-1).words.at(-1).endTime, edited[0].words.at(-1).endTime);
});

test('caption rendering paints the selected regrouped sentence rather than the old whole clip', () => {
  const texts = [], ctx = { font: '', clearRect() {}, save() {}, restore() {}, translate() {}, scale() {},
    measureText(text) { return { width: text.length * 20 }; }, fillText(text) { texts.push(text); }, strokeText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {} };
  const [grouped] = regroupCaptions([cue('a', words('one two three four'))], 8);
  const renderer = new CaptionRenderer(ctx, 720, 1280), style = { ...DEFAULT_STYLE, strokeEnabled: false };
  renderer.renderFrame(grouped, .1, style, DEFAULT_ANIMATION, { width: 600, height: 512 });
  assert.deepEqual(texts, ['one', 'two']); texts.length = 0;
  renderer.renderFrame(grouped, .7, style, DEFAULT_ANIMATION, { width: 600, height: 512 });
  assert.deepEqual(texts, ['three']); texts.length = 0;
  renderer.renderFrame(grouped, .95, style, DEFAULT_ANIMATION, { width: 600, height: 512 });
  assert.deepEqual(texts, ['four'], 'the next sentence replaces the old phrase at its spoken onset');
});
