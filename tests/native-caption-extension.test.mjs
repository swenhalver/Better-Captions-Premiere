import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNativeCaptionExtension } from '../webview-ui/src/lib/native-effect/extend.ts';
import { defaultNativeStyle } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';

const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
const word = (text, start, end) => ({ text, start, end, endOfSentence: false });
function fixture() {
  const original = word('Previously edited!', 1, 2);
  return { document: { version: 1, binaryVersion: 4, animationAuthority: 'premiere-effect', sequenceId: 'sequence', timeOriginSeconds: 0,
    style: { ...defaultNativeStyle(), letterCase: 'uppercase' },
    captions: [{ id: 'first', start: 1, end: 2, manualSplit: true, words: [original] },
      { id: 'manual-tail', start: 3, end: 4, manualSplit: true, words: [word('Keep my timing.', 3, 4)] }] },
    placement: { sequenceId: 'sequence', startTicks: ticks(0), endTicks: ticks(5), inTicks: ticks(0), outTicks: ticks(5), ticksPerFrame: ticks(1 / 24) } };
}

test('append retains edited text, exact old word timings, styles and manual containers in one document', () => {
  const { document, placement } = fixture(), before = structuredClone(document);
  const result = prepareNativeCaptionExtension(document, placement, ticks(10), [word('Wrong retranscription', 1, 2), word('New', 6, 6.5), word('footage.', 7, 8)]);
  assert.deepEqual(document, before, 'pure planner cannot mutate the bound source');
  assert.deepEqual(result.document.captions[0], before.captions[0]);
  assert.deepEqual(result.document.captions[1].words.slice(0, 1), before.captions[1].words);
  assert.deepEqual(result.document.style, before.style);
  assert.equal(result.document.captions.length, 2);
  assert.equal(result.document.captions[1].id, 'manual-tail');
  assert.equal(result.document.captions[1].manualSplit, true);
  assert.equal(result.appendedWords, 2);
  assert.equal(result.appendFromSeconds, 5);
  assert.equal(result.endTicks, ticks(10));
  assert.equal(result.outTicks, ticks(10));
});

test('moved, source-trimmed caption maps sequence words into its exact existing document clock', () => {
  const { document, placement } = fixture();
  document.timeOriginSeconds = 3600;
  placement.startTicks = ticks(10); placement.endTicks = ticks(15);
  placement.inTicks = ticks(3600); placement.outTicks = ticks(3605);
  const result = prepareNativeCaptionExtension(document, placement, ticks(20), [word('Added', 16, 17)]);
  assert.deepEqual(result.document.captions[1].words.at(-1), word('Added', 6, 7));
  assert.equal(result.appendFromSeconds, 15);
  assert.equal(result.outTicks, ticks(3610));
  assert.equal(result.document.timeOriginSeconds, 3600);
});

test('trimmed hidden source words remain protected and are revealed without duplication', () => {
  const { document, placement } = fixture();
  document.captions[1].words.push(word('Hidden edited tail', 6, 7));
  document.captions[1].end = 7;
  const result = prepareNativeCaptionExtension(document, placement, ticks(10), [word('Original hidden tail', 6, 7), word('New', 8, 9)]);
  assert.equal(result.appendFromSeconds, 7);
  assert.equal(result.revealsStoredWords, true);
  assert.equal(result.appendedWords, 1);
  assert.equal(result.document.captions[1].words[1].text, 'Hidden edited tail');
  const revealOnly = prepareNativeCaptionExtension(document, placement, ticks(10), []);
  assert.equal(revealOnly.changed, true);
  assert.equal(encodeNativeTransportText(revealOnly.document), encodeNativeTransportText(document));
});

test('silent tail coverage is protected even when the last spoken word ends earlier', () => {
  const { document, placement } = fixture();
  const result = prepareNativeCaptionExtension(document, placement, ticks(10), [word('Old silence replacement', 4, 4.5)]);
  assert.equal(result.changed, false);
  assert.equal(result.appendedWords, 0);
  assert.equal(result.endTicks, placement.endTicks);
  assert.equal(result.outTicks, placement.outTicks);
  assert.equal(encodeNativeTransportText(result.document), encodeNativeTransportText(document));
});

test('gaps stay gaps, exact touching boundary is accepted and future words outside target are ignored', () => {
  const { document, placement } = fixture();
  const result = prepareNativeCaptionExtension(document, placement, ticks(10), [word('First', 5, 5.5), word('Gap', 8, 9), word('Future', 10, 11)]);
  assert.equal(result.appendedWords, 2);
  assert.equal(result.document.captions[1].words.at(-1).start, 8);
});

test('extension rejects ambiguous boundary crossing, reversed words and changed sequence/speed', () => {
  const { document, placement } = fixture();
  for (const fresh of [[word('Crosses old coverage', 4.9, 5.1)], [word('Crosses target', 9, 10.1)], [word('Backwards', 7, 6)], [word('Later', 7, 8), word('Earlier', 5, 6)]]) {
    assert.throws(() => prepareNativeCaptionExtension(document, placement, ticks(10), fresh));
  }
  assert.throws(() => prepareNativeCaptionExtension(document, { ...placement, sequenceId: 'other' }, ticks(10), []), /another sequence/);
  assert.throws(() => prepareNativeCaptionExtension(document, { ...placement, outTicks: ticks(6) }, ticks(10), []), /ordinary-speed/);
  assert.throws(() => prepareNativeCaptionExtension(document, placement, ticks(4), []), /after/);
  assert.throws(() => prepareNativeCaptionExtension(document, placement, ticks(10.01), []), /exact sequence frames/);
});

test('appending to a retained single container keeps one container and rejects unsafe transcript payloads', () => {
  const { document, placement } = fixture();
  document.captions = [document.captions[0]];
  const result = prepareNativeCaptionExtension(document, placement, ticks(10), [word('New', 6, 7)]);
  assert.equal(result.document.captions.length, 1);
  assert.equal(result.document.captions[0].id, 'first');
  assert.throws(() => prepareNativeCaptionExtension(document, placement, ticks(10), [word('bad\ntext', 6, 7)]), /text/);
  assert.throws(() => prepareNativeCaptionExtension(document, placement, ticks(10), [word('x'.repeat(501), 6, 7)]), /text/);
});
