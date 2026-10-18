import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleCaptionContainers, needsLegacyConsolidation, consolidationDraft } from '../webview-ui/src/lib/export/containers.ts';
import { captionSentenceCount, regroupCaptions } from '../webview-ui/src/lib/transcript/parser.ts';
import { split, validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { captionAtRenderTime } from '../webview-ui/src/lib/canvas/engine.ts';

const words = text => text.split(' ').map((text, index) => ({ text, startTime: index * .3, endTime: index * .3 + .2, isActive: false }));
const cue = (id, words, patch = {}) => ({ id, words, text: words.map(word => word.text).join(' '), startTime: words[0].startTime, endTime: words.at(-1).endTime + .1, ...patch });

test('all new sentence cues become one physical caption movie without changing spoken timings', () => {
  const input = words('one two three four five six'), original = [cue('one', input.slice(0, 3)), cue('two', input.slice(3))], before = structuredClone(original);
  const result = bundleCaptionContainers(original, 9);
  assert.equal(result.length, 1); assert.equal(result[0].id, 'one');
  assert.deepEqual(result[0].words, input); assert.equal(result[0].startTime, original[0].startTime); assert.equal(result[0].endTime, original.at(-1).endTime);
  assert.equal(result[0].clipNodeId, undefined); assert.equal(captionSentenceCount(result), 4);
  assert.equal(captionAtRenderTime(result[0], .05).text, 'one two');
  assert.equal(captionAtRenderTime(result[0], .65).text, 'three');
  assert.deepEqual(original, before); validateCaptions(result);
});

test('sentence gaps produce transparent frames within the single full-range clip', () => {
  const first = words('before'), second = [{ text: 'after', startTime: 2, endTime: 2.2, isActive: false }];
  const [result] = bundleCaptionContainers([cue('a', first), cue('b', second)], 56);
  assert.ok(Math.abs(result.endTime - 2.3) < 1e-12); assert.equal(captionAtRenderTime(result, 1), null);
  assert.equal(captionAtRenderTime(result, 2.1).text, 'after');
});

test('explicit manual splits remain separate physical containers on later applies', () => {
  const [bundle] = bundleCaptionContainers([cue('a', words('one two three four'))], 9);
  const parts = split(bundle, 2), result = bundleCaptionContainers(parts, 100);
  assert.equal(result.length, 2); assert.ok(result.every(caption => caption.manualSplit));
  assert.deepEqual(result.flatMap(caption => caption.words), bundle.words);
  assert.deepEqual(result.map(caption => caption.id), parts.map(caption => caption.id));
  const regrouped=regroupCaptions(parts,100);
  assert.equal(regrouped.length,2); assert.ok(regrouped.every(caption=>caption.manualSplit));
  assert.equal(bundleCaptionContainers(regrouped,100).length,2,'regrouping sentences cannot undo a manual physical split');
});

test('existing native clip identities and keyframe profiles survive applying a new grouping limit', () => {
  const input = words('one two three four'), existing = [cue('a', input.slice(0, 2), { clipNodeId: 'a', projectItemId: 'item-a', motionProfile: { signature: 'native-keys-a' } }), cue('b', input.slice(2), { clipNodeId: 'b', projectItemId: 'item-b' })];
  const grouped = regroupCaptions(existing, 100), result = bundleCaptionContainers(grouped, 100);
  assert.deepEqual(result, grouped); assert.equal(result[0].motionProfile.signature, 'native-keys-a');
});

test('bundling retains speaker boundaries and refuses to discard differing caption placements', () => {
  const input = words('one two three four'), captions = [cue('a', input.slice(0, 2), { speaker: 'A' }), cue('b', input.slice(2), { speaker: 'B' })];
  assert.equal(captionSentenceCount(bundleCaptionContainers(captions, 100)), 2);
  assert.throws(() => bundleCaptionContainers([captions[0], { ...captions[1], position: { x: .2, y: .4 } }], 100), /different frame positions/);
});

test('legacy render drafts leave all original links untouched and retain the verified source bounds and samples',()=>{
 const input=words('one two three four'),captions=[cue('a',input.slice(0,2),{clipNodeId:'old-a',position:{x:.3,y:.4}}),cue('b',input.slice(2),{clipNodeId:'old-b',position:{x:.5,y:.8}})],before=structuredClone(captions);
 const plan={bounds:{x:72,y:832,width:576,height:512,frameWidth:720,frameHeight:1280},motionProfile:{signature:'verified',samples:[{time:0,scaleX:1,scaleY:.64}]}};
 assert.equal(needsLegacyConsolidation(captions),true);const [draft]=consolidationDraft(captions,18,plan);
 assert.equal(draft.clipNodeId,undefined);assert.equal(draft.captionBundle,true);assert.deepEqual(draft.position,{x:.5,y:.85});assert.deepEqual(draft.renderBounds,plan.bounds);assert.deepEqual(draft.motionProfile,plan.motionProfile);assert.deepEqual(captions,before);
 assert.equal(needsLegacyConsolidation([{...captions[0],manualSplit:true},captions[1]]),false);
 assert.equal(needsLegacyConsolidation([{...captions[0],captionBundle:true},captions[1]]),false);
});
