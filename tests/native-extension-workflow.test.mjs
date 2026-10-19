import test from 'node:test';
import assert from 'node:assert/strict';
import { extendNativeCaptions } from '../webview-ui/src/lib/native-effect/extension-workflow.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument, rehydrateNativePanel } from '../webview-ui/src/lib/native-effect/panel.ts';

const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
const word = (text, start, end) => ({ text, start, end, endOfSentence: false });
function revision(entry) {
  return JSON.stringify({ projectPath: entry.locator.projectPath, sequenceId: 'sequence', clipNodeId: entry.clipNodeId, adjustmentLayer: true,
    start: entry.startTicks, end: entry.endTicks, inPoint: entry.inTicks, outPoint: entry.outTicks,
    components: [NATIVE_EFFECT_MATCH_NAME], documentIndex: 0, documentText: entry.documentText });
}
function fixture() {
  const document = { version: 1, binaryVersion: 4, animationAuthority: 'premiere-effect', sequenceId: 'sequence', timeOriginSeconds: 0,
    style: { ...defaultNativeStyle(), letterCase: 'uppercase' }, captions: [
      { id: 'edited-first', start: 1, end: 2, manualSplit: true, words: [word('Keep edited text!', 1, 2)] },
      { id: 'manual-tail', start: 3, end: 4, manualSplit: true, words: [word('Exact timing.', 3, 4)] },
    ] };
  const locator = { projectPath: '/project/edit.prproj', sequenceId: 'sequence', clipNodeId: 'native', trackIndex: 3, clipIndex: 0, componentIndex: 0, documentParamIndex: 0 };
  const entry = { kind: 'native-effect', clipNodeId: 'native', projectItemId: 'source', trackIndex: 3, clipIndex: 0, selected: true, maxChars: 56,
    locator, matchName: NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(document), startTicks: ticks(0), endTicks: ticks(5), inTicks: ticks(0), outTicks: ticks(5) };
  entry.revision = revision(entry);
  const { binding } = rehydrateNativePanel(entry, { id: 'sequence', name: 'Native', frameWidth: 720, frameHeight: 1280, frameRate: 24, duration: 10 });
  const context = { ok: true, revision: 'captured-complete-timeline', connection: structuredClone(entry), ticksPerFrame: ticks(1 / 24), targetEndTicks: ticks(10), targetOutTicks: ticks(10), canExtend: true };
  const calls = [], writes = [];
  let current = true;
  const api = {
    async readNativeCaptionExtension(snapshot, id) { calls.push(['read', structuredClone(snapshot), id]); return context; },
    async transcribeSequenceRange(begin, end, id) {
      calls.push(['transcribe', begin, end, id]);
      return JSON.stringify({ segments: [{ words: [{ text: 'New', start: 6, duration: .5 }, { text: 'footage.', start: 7, duration: 1, eos: true }] }] });
    },
    async extendNativeCaptionDocument(snapshot, request, id) {
      calls.push(['write', structuredClone(snapshot), id]); writes.push(structuredClone(request));
      const connection = { ...structuredClone(entry), endTicks: request.endTicks, outTicks: request.outTicks, documentText: request.documentText };
      connection.revision = revision(connection);
      return { ok: true, readbackVerified: true, retry: 'never', connection };
    },
  };
  return { binding, document, context, calls, writes, api, stillCurrent: () => current, supersede: () => { current = false; } };
}
const unconfirmed = error => error.code === 'BC_OUTPUT_UNCONFIRMED' && error.recoverable === false && error.outputApplied === true;

test('extension transcribes only uncovered footage once, retaining exact edits, styles and manual containers', async () => {
  const f = fixture(), before = structuredClone(f.binding);
  const result = await extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent);
  assert.equal(result.changed, true); assert.equal(result.appendedWords, 2);
  assert.deepEqual(f.calls.map(c => c[0]), ['read', 'transcribe', 'write']);
  assert.deepEqual(f.calls[1], ['transcribe', 5, 10, 'sequence']);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].revision, f.context.revision);
  const after = decodeNativePanelDocument(f.writes[0].documentText, 'sequence');
  assert.deepEqual(after.captions[0], f.binding.document.captions[0]);
  assert.deepEqual(after.style, f.binding.document.style);
  assert.equal(after.captions.length, 2); assert.equal(after.captions[1].id, 'manual-tail');
  assert.deepEqual(after.captions[1].words[0], f.binding.document.captions[1].words[0]);
  assert.deepEqual(after.captions[1].words.slice(1), [word('New', 6, 6.5), { ...word('footage.', 7, 8), endOfSentence: true }]);
  assert.deepEqual(f.binding, before, 'the bound document is never mutated in place');
});

test('no available extension and silent new footage never call the native setter', async () => {
  const f = fixture(); f.context.canExtend = false;
  assert.deepEqual(await extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), { changed: false, appendedWords: 0 });
  assert.deepEqual(f.calls.map(c => c[0]), ['read']);
  f.context.canExtend = true; f.api.transcribeSequenceRange = async () => JSON.stringify({ segments: [] });
  assert.equal((await extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent)).changed, false);
  assert.equal(f.writes.length, 0);
});

test('revealing a previously trimmed edited tail skips transcription and preserves document bytes', async () => {
  const f = fixture();
  f.binding.document.captions[1].words.push(word('Already corrected hidden tail.', 6, 12));
  f.binding.document.captions[1].end = 12;
  f.binding.clip.documentText = encodeNativeTransportText(f.binding.document);
  f.binding.clip.revision = revision(f.binding.clip);
  f.binding.snapshot.revision = f.binding.clip.revision;
  f.context.connection = structuredClone(f.binding.clip);
  const before = f.binding.clip.documentText;
  const result = await extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent);
  assert.equal(result.changed, true); assert.equal(result.appendedWords, 0);
  assert.deepEqual(f.calls.map(call => call[0]), ['read', 'write']);
  assert.equal(f.writes[0].documentText, before);
  assert.equal(f.writes[0].endTicks, ticks(10));
});

test('host read failure stays a non-mutation error and is never retried', async () => {
  const f = fixture(), problem = new Error('read unavailable'); let reads = 0;
  f.api.readNativeCaptionExtension = async () => { reads++; throw problem; };
  await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), error => error === problem);
  assert.equal(reads, 1); assert.equal(f.writes.length, 0);
});

test('a switched layer after context read or during transcription cannot submit a mutation', async () => {
  for (const stage of ['readNativeCaptionExtension', 'transcribeSequenceRange']) {
    const f = fixture(), original = f.api[stage];
    f.api[stage] = async (...args) => { const result = await original(...args); f.supersede(); return result; };
    await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), /active caption layer changed/);
    assert.equal(f.writes.length, 0);
  }
});

test('stale or mismatched captured host identity/timing is rejected before transcription', async () => {
  for (const corrupt of [
    f => { f.context.connection.revision = 'new native revision'; },
    f => { f.context.connection.documentText += '00'; },
    f => { f.context.connection.locator.projectPath = '/other/edit.prproj'; },
    f => { f.context.connection.projectItemId = 'other-source'; },
    f => { f.context.connection.clipNodeId = 'other-clip'; },
    f => { f.context.connection.startTicks = ticks(1); },
    f => { f.context.targetOutTicks = ticks(11); },
  ]) {
    const f = fixture(); corrupt(f);
    await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent));
    assert.deepEqual(f.calls.map(c => c[0]), ['read']); assert.equal(f.writes.length, 0);
  }
});

test('malformed and boundary-crossing transcripts do not change the existing document', async () => {
  for (const raw of ['bad json', '{}', JSON.stringify({ segments: [{ words: [{ text: 'Crossing', start: 4.9, duration: .2 }] }] })]) {
    const f = fixture(), before = structuredClone(f.binding);
    f.api.transcribeSequenceRange = async () => raw;
    await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent));
    assert.equal(f.writes.length, 0); assert.deepEqual(f.binding, before);
  }
});

test('every rejected mutation response blocks subsequent automatic changes rather than retrying', async () => {
  for (const problem of [new Error('connection closed'), Object.assign(new Error('pending'), { code: 'BC_NATIVE_PENDING' }), Object.assign(new Error('not confirmed'), { code: 'BC_OUTPUT_UNCONFIRMED', outputApplied: false })]) {
    const f = fixture(); let attempts = 0;
    f.api.extendNativeCaptionDocument = async () => { attempts++; throw problem; };
    await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), error => unconfirmed(error) && error.cause === problem);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(attempts, 1);
  }
});

test('uncertain or wrong native readback is never accepted even when source text matches', async () => {
  for (const corrupt of [
    r => { r.ok = false; }, r => { r.readbackVerified = false; }, r => { r.retry = 'yes'; },
    r => { r.connection.documentText += '00'; }, r => { r.connection.clipNodeId = 'other'; },
    r => { r.connection.projectItemId = 'other-source'; }, r => { r.connection.locator.sequenceId = 'other-sequence'; },
    r => { r.connection.endTicks = ticks(9); }, r => { r.connection.outTicks = ticks(9); },
    r => { r.connection.startTicks = ticks(1); }, r => { r.connection.inTicks = ticks(1); }, r => { r.connection.revision = ''; },
  ]) {
    const f = fixture(), original = f.api.extendNativeCaptionDocument;
    f.api.extendNativeCaptionDocument = async (...args) => { const receipt = await original(...args); corrupt(receipt); return receipt; };
    await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), unconfirmed);
    assert.equal(f.writes.length, 1);
  }
});

test('a layer switch while the single mutation is in flight cannot overwrite the newer session', async () => {
  const f = fixture(), original = f.api.extendNativeCaptionDocument;
  f.api.extendNativeCaptionDocument = async (...args) => { const result = await original(...args); f.supersede(); return result; };
  await assert.rejects(extendNativeCaptions(f.binding, f.api, 'sequence', f.stillCurrent), unconfirmed);
  assert.equal(f.writes.length, 1);
});
