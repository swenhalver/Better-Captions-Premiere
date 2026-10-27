import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCaptionPatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { groupCaptionWords, regroupCaptions } from '../webview-ui/src/lib/transcript/parser.ts';

function sentences() {
  const words = 'one two three four five six'.split(' ').map((text, index) => ({
    text, startTime: index * .3, endTime: index * .3 + .2, isActive: false,
    ...((index + 1) % 2 === 0 ? { endOfSentence: true } : {}),
  }));
  return groupCaptionWords(words, 100);
}

test('agent caption edits preserve sentence-only boundaries for later regrouping', () => {
  const original = sentences(), snapshot = structuredClone(original);
  const edited = validateCaptionPatch(structuredClone(original), original);
  assert.deepEqual(edited.flatMap(c => c.words), original.flatMap(c => c.words));
  assert.deepEqual(regroupCaptions(edited, 100).map(c => c.text), ['one two', 'three four', 'five six']);
  assert.deepEqual(original, snapshot);
});

test('the per-caption position edit roundtrip retains markers on every caption', () => {
  const original = sentences();
  // Both native and CEP set_position pass their mapped array through this validator.
  const mapped = original.map((caption, index) => index === 2 ? { ...caption, position: { x: .2, y: .4 } } : caption);
  const edited = validateCaptionPatch(mapped, original);
  assert.equal(edited.flatMap(c => c.words).filter(w => w.endOfSentence).length, 3);
  assert.deepEqual(edited[2].position, { x: .2, y: .4 });
  assert.deepEqual(regroupCaptions(edited, 100).map(c => c.text), ['one two', 'three four', 'five six']);
  assert.equal(Object.hasOwn(original[2], 'position'), false);
});

test('false sentence markers are retained and absent markers stay absent', () => {
  const original = sentences();
  original[0].words[0].endOfSentence = false;
  const edited = validateCaptionPatch(original, original);
  assert.equal(edited[0].words[0].endOfSentence, false);
  assert.equal(Object.hasOwn(edited[1].words[0], 'endOfSentence'), false);
});

test('agent caption validation rejects non-Boolean sentence markers', () => {
  for (const value of [null, 0, 1, 'true', {}, []]) {
    const original = sentences(), patch = structuredClone(original);
    patch[0].words[0].endOfSentence = value;
    assert.throws(() => validateCaptionPatch(patch, original), /Expected true or false/);
  }
});


test('agent patch preserves omitted sentence and explicit line markers and validates supplied boundaries',()=>{
 const current=[{id:'line',text:'One. two',startTime:0,endTime:2,words:[{text:'One.',startTime:0,endTime:1,endOfSentence:true,lineBreakBefore:'break',pauseLinesRemoved:2},{text:'two',startTime:1,endTime:2,lineBreakBefore:'join'}]}];
 const patch=structuredClone(current);for(const word of patch[0].words){delete word.endOfSentence;delete word.lineBreakBefore;delete word.pauseLinesRemoved;}
 const result=validateCaptionPatch(patch,current);
 assert.equal(result[0].words[0].pauseLinesRemoved,2);assert.equal(result[0].words[0].endOfSentence,true);assert.equal(result[0].words[0].lineBreakBefore,'break');assert.equal(result[0].words[1].lineBreakBefore,'join');
 for(const invalid of ['auto',null,0,true]){const next=structuredClone(patch);next[0].words[1].lineBreakBefore=invalid;assert.throws(()=>validateCaptionPatch(next,current),/Invalid line boundary/);}
});
