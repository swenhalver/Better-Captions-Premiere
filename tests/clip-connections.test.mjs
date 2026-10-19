import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionKey, sameSequenceId, reconnectLegacyCaptions, nativeAboveDisabledBackups } from '../webview-ui/src/lib/clip-connections.ts';
import { MAX_NATIVE_CARRIER_BYTES } from '../webview-ui/src/lib/native-effect/encode.ts';

const id = 'F18A14EA-2BE5-4393-A113-C1B43BFCAB1E';
const expected = { id, projectPath: '/projects/Caption edit.prproj' };
const ticks = seconds => String(Math.round(seconds * 254016000000));
const clone = value => structuredClone(value);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function caption(patch = {}) {
  return { id: 'caption-one', text: 'Keep these words', startTime: 0, endTime: 2,
    words: [{ text: 'Keep', startTime: 0, endTime: .4, isActive: false }, { text: 'these', startTime: .5, endTime: .9, isActive: false }, { text: 'words', startTime: 1, endTime: 1.5, isActive: false }],
    clipNodeId: 'old-node', projectItemId: 'project-item', mediaPath: '/projects/Better Captions/sequence/caption.mov',
    position: { x: .2, y: .8 }, renderBounds: { x: 100, y: 600, width: 576, height: 512, frameWidth: 1920, frameHeight: 1080 },
    motionProfile: { signature: 'saved-width-animation', watchSignature: 'saved-watch', samples: [{ time: .5, scaleX: .75, scaleY: 1 }] },
    layoutOverflow: true, manualSplit: true, captionBundle: true, groupingMaxChars: 20,
    renderSegments: [{ id: 'sentence', text: 'Keep these words', startTime: 0, endTime: 2, words: [{ text: 'Keep these words', startTime: 0, endTime: 1.5, isActive: false }] }], ...patch };
}
function legacy(patch = {}) {
  const value = { kind: 'generated-movie', clipNodeId: 'live-node', projectItemId: 'project-item', path: '/projects/Better Captions/sequence/caption.mov', trackIndex: 2, clipIndex: 0, startTime: 0, endTime: 2, startTicks: '0', endTicks: ticks(2), inTicks: '0', outTicks: ticks(2), selected: false, ...patch };
  return value;
}
function native(patch = {}) {
  return { kind: 'native-effect', clipNodeId: 'native-node', projectItemId: 'native-item', trackIndex: 3, clipIndex: 0,
    startTicks: '0', endTicks: ticks(2), inTicks: '0', outTicks: ticks(2), selected: false, matchName: 'ca.swen.bettercaptions.native', connectionRevision: 'native-connection-1',
    locator: { projectPath: expected.projectPath, sequenceId: '{' + id.toLowerCase() + '}', clipNodeId: 'native-node', trackIndex: 3, clipIndex: 0, componentIndex: 1, documentParamIndex: 0 }, ...patch };
}
function snapshot(legacy = [], native = [], selectedClipNodeIds = []) {
  return { ok: true, version: 1, readOnly: true, projectPath: expected.projectPath, sequenceId: '{' + id.toLowerCase() + '}', nativeSequenceId: id.toLowerCase(), playhead: .5, playheadTicks: ticks(.5), selectedClipNodeIds, native, legacy, warnings: [] };
}
const reconnect = (captions, value) => reconnectLegacyCaptions(captions, value, expected);

test('sequence equivalence normalizes only actual GUID braces and case', () => {
  assert.equal(sameSequenceId(id, '{' + id.toLowerCase() + '}'), true);
  assert.equal(sameSequenceId(id.toLowerCase(), id), true);
  for (const [a, b] of [['opaque-sequence', 'OPAQUE-SEQUENCE'], ['{opaque}', 'opaque'], ['{{' + id + '}}', id], [' ' + id, id], ['', ''], [null, id]]) assert.equal(sameSequenceId(a, b), false);
  assert.equal(sameSequenceId('opaque-sequence', 'opaque-sequence'), true);
});

test('connection keys scope canonical GUIDs to the complete project path', () => {
  assert.equal(connectionKey(expected), connectionKey({ ...expected, id: '{' + id.toLowerCase() + '}' }));
  assert.notEqual(connectionKey(expected), connectionKey({ ...expected, projectPath: '/other/Caption edit.prproj' }));
  assert.notEqual(connectionKey(expected), connectionKey({ ...expected, projectPath: '/projects/caption edit.prproj' }));
  assert.notEqual(connectionKey(expected), connectionKey({ ...expected, id: 'another-sequence' }));
  assert.notEqual(connectionKey({ id }), connectionKey(expected));
});

test('local Windows project keys normalize separators and drive case without folding path components', () => {
  assert.equal(connectionKey({ id, projectPath: 'D:\\Media\\Caption edit.prproj' }), connectionKey({ id, projectPath: 'd:/Media/Caption edit.prproj' }));
  assert.notEqual(connectionKey({ id, projectPath: 'd:/Media/Caption edit.prproj' }), connectionKey({ id, projectPath: 'd:/media/Caption edit.prproj' }));
  assert.equal(connectionKey({ id, projectPath: '/projects//Caption edit.prproj' }), connectionKey(expected));
  assert.equal(connectionKey({ id, projectPath: 'D:\\' }), connectionKey({ id, projectPath: 'd:/' }));
});

test('remote, relative, traversal and malformed local paths are rejected without touching captions', () => {
  for (const projectPath of ['relative.prproj', 'file:///projects/edit.prproj', '//server/share/edit.prproj', '\\\\server\\share\\edit.prproj', 'C:relative.prproj', '/projects/../edit.prproj', 'C:\\projects\\.\\edit.prproj', '/projects/bad\u0000.prproj', '/projects/back\\slash.prproj', 'C:\\projects\\bad?.prproj']) {
    assert.throws(() => connectionKey({ id, projectPath }), /path|local|traversal/i);
  }
  assert.throws(() => connectionKey({ id: '', projectPath: expected.projectPath }), /sequence identity/);
});

test('an exact native node, item and path wins over copies while preserving every saved caption field', () => {
  const input = freeze([caption({ clipNodeId: 'known-node' })]);
  const reply = freeze(snapshot([legacy({ clipNodeId: 'copy', trackIndex: 3 }), legacy({ clipNodeId: 'known-node', selected: true, startTime: 10, endTime: 12, startTicks: ticks(10), endTicks: ticks(12) })], [], ['known-node']));
  const result = reconnect(input, reply);
  assert.equal(result.changed, false); assert.equal(result.selectedId, input[0].id); assert.equal(result.captions[0], input[0]);
  assert.deepEqual(result.unresolved, []); assert.deepEqual(result.ambiguous, []);
  assert.equal(result.captions[0].startTime, 0); assert.equal(result.captions[0].endTime, 2, 'Reconnection does not sync native timing');
});

test('one unique item and complete media path can repair a stale or absent node without adopting native geometry or timing', () => {
  for (const clipNodeId of ['stale-node', undefined]) {
    const original = freeze(caption({ clipNodeId })), result = reconnect([original], snapshot([legacy({ startTime: 10, endTime: 12, startTicks: ticks(10), endTicks: ticks(12), position: { x: .9, y: .1 }, renderBounds: { width: 1 }, motionProfile: { signature: 'foreign' } })]));
    assert.equal(result.changed, true); assert.equal(result.captions[0].clipNodeId, 'live-node');
    assert.deepEqual({ ...result.captions[0], clipNodeId }, original);
    assert.equal(result.captions[0].words, original.words); assert.equal(result.captions[0].renderBounds, original.renderBounds); assert.equal(result.captions[0].motionProfile, original.motionProfile);
  }
});

test('Windows media normalization requires the complete item/path pair and stores the native path spelling', () => {
  const expectedWindows = { id, projectPath: 'C:\\Projects\\Edit.prproj' };
  const original = caption({ mediaPath: 'D:\\Captions\\été words.mov' }), reply = snapshot([legacy({ path: 'd:/Captions/été words.mov' })]);
  reply.projectPath = 'c:/Projects/Edit.prproj';
  const result = reconnectLegacyCaptions([original], reply, expectedWindows);
  assert.equal(result.changed, true); assert.equal(result.captions[0].clipNodeId, 'live-node'); assert.equal(result.captions[0].mediaPath, 'd:/Captions/été words.mov');
  assert.equal(original.mediaPath, 'D:\\Captions\\été words.mov');
});

test('clip names and media basenames never repair an item or directory mismatch', () => {
  for (const change of [{ projectItemId: 'other-item' }, { path: '/unrelated/caption.mov' }, { path: '/projects/Better Captions/sequence/CAPTION.mov' }]) {
    const original = freeze(caption()), result = reconnect([original], snapshot([legacy({ ...change, name: original.text })]));
    assert.equal(result.changed, false); assert.equal(result.captions[0], original); assert.deepEqual(result.unresolved, [original.id]); assert.deepEqual(result.ambiguous, []);
  }
});

test('missing and incomplete links remain intact while completely unlinked new captions are left alone', () => {
  const missing = caption(), partial = caption({ id: 'partial', projectItemId: undefined }), fresh = caption({ id: 'new', clipNodeId: undefined, projectItemId: undefined, mediaPath: undefined });
  const input = freeze([missing, partial, fresh]), result = reconnect(input, snapshot());
  assert.equal(result.changed, false); assert.deepEqual(result.captions, input); assert.deepEqual(result.unresolved, ['caption-one', 'partial']); assert.deepEqual(result.ambiguous, []);
  assert.equal(result.captions[0].clipNodeId, 'old-node', 'Do not clear missing links and trigger duplicate placement');
});

test('duplicate native copies require one unique exact timing match rather than choosing the first row', () => {
  const original = caption(), copies = [legacy({ clipNodeId: 'later', startTime: 10, endTime: 12, startTicks: ticks(10), endTicks: ticks(12) }), legacy({ clipNodeId: 'same-time', clipIndex: 1 })];
  for (const ordered of [copies, [...copies].reverse()]) {
    const result = reconnect([original], snapshot(ordered));
    assert.equal(result.captions[0].clipNodeId, 'same-time'); assert.deepEqual(result.ambiguous, []);
  }
});

test('duplicates with no exact timing or two exact timings remain ambiguous and preserve their old links', () => {
  for (const copies of [
    [legacy({ clipNodeId: 'one', startTime: 10, endTime: 12 }), legacy({ clipNodeId: 'two', startTime: 20, endTime: 22 })],
    [legacy({ clipNodeId: 'one' }), legacy({ clipNodeId: 'two', trackIndex: 3 })],
  ]) {
    const original = freeze(caption()), result = reconnect([original], snapshot(copies));
    assert.equal(result.changed, false); assert.equal(result.captions[0], original); assert.deepEqual(result.ambiguous, [original.id]); assert.deepEqual(result.unresolved, []); assert.equal(result.selectedId, null);
  }
});

test('manual split captions sharing a source reconnect to their unique native timing containers', () => {
  const first = caption({ id: 'first', clipNodeId: 'stale-first' }), second = caption({ id: 'second', clipNodeId: 'stale-second', startTime: 2, endTime: 4,
    words: [{ text: 'Second', startTime: 2, endTime: 3, isActive: false }], renderBounds: { width: 900 }, motionProfile: { signature: 'second-width' } });
  const input = freeze([first, second]), result = reconnect(input, snapshot([legacy({ clipNodeId: 'right-half', clipIndex: 1, startTime: 2, endTime: 4, startTicks: ticks(2), endTicks: ticks(4), inTicks: ticks(2), outTicks: ticks(4) }), legacy({ clipNodeId: 'left-half' })]));
  assert.deepEqual(result.captions.map(c => c.clipNodeId), ['left-half', 'right-half']); assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.captions.map(c => [c.id, c.startTime, c.endTime, c.manualSplit]), input.map(c => [c.id, c.startTime, c.endTime, c.manualSplit]));
  assert.equal(result.captions[0].motionProfile, first.motionProfile); assert.equal(result.captions[1].motionProfile, second.motionProfile); assert.equal(result.captions[1].renderBounds, second.renderBounds);
});

test('known exact claims are reserved before stale matches, regardless of saved-caption order', () => {
  const stale = caption({ id: 'stale', startTime: 10, endTime: 12 }), known = caption({ id: 'known', clipNodeId: 'known-node' });
  const reply = snapshot([legacy({ clipNodeId: 'known-node' }), legacy({ clipNodeId: 'remaining-node', startTime: 20, endTime: 22 })]);
  for (const input of [[stale, known], [known, stale]]) {
    const result = reconnect(input, reply);
    assert.equal(result.captions.find(c => c.id === 'stale').clipNodeId, 'remaining-node'); assert.equal(result.captions.find(c => c.id === 'known').clipNodeId, 'known-node'); assert.deepEqual(result.ambiguous, []);
  }
});

test('two saved claims cannot silently reuse a single native clip, for either stale or exact nodes', () => {
  for (const clipNodeId of ['stale', 'live-node']) {
    const captions = [caption({ id: 'one', clipNodeId }), caption({ id: 'two', clipNodeId })];
    for (const input of [captions, [...captions].reverse()]) {
      const result = reconnect(input, snapshot([legacy({ selected: true })], [], ['live-node']));
      assert.equal(result.changed, false); assert.deepEqual(new Set(result.ambiguous), new Set(['one', 'two'])); assert.equal(result.selectedId, null); assert.deepEqual(result.unresolved, []);
    }
  }
});

test('selection follows one verified legacy link and remains null for native, unrelated or multiple selections', () => {
  const original = caption();
  assert.equal(reconnect([original], snapshot([legacy({ selected: true })], [], ['live-node'])).selectedId, original.id);
  for (const selected of [[], ['unrelated'], ['live-node', 'unrelated']]) {
    const result = reconnect([original], snapshot([legacy({ selected: selected.includes('live-node') })], [], selected)); assert.equal(result.selectedId, null);
  }
  assert.equal(reconnect([original], snapshot([legacy()], [native({ selected: true })], ['native-node'])).selectedId, null);
});

test('native discovery metadata is validated but never converted into legacy transcript captions', () => {
  const input = freeze([caption({ clipNodeId: undefined, projectItemId: undefined, mediaPath: undefined })]), carrier = native({ documentText: '{"text":"Other native words"}', revision: 'native-document-1', selected: true });
  const result = reconnect(input, freeze(snapshot([], [carrier], ['native-node'])));
  assert.equal(result.changed, false); assert.equal(result.selectedId, null); assert.deepEqual(result.captions, input);
  const summary = native(); assert.equal(summary.documentText, undefined);
  assert.doesNotThrow(() => reconnect(input, snapshot([], [summary])));
});

test('full native revision envelopes may exceed the document carrier budget by bounded identity metadata', () => {
  const revision = JSON.stringify({ documentText: 'a'.repeat(MAX_NATIVE_CARRIER_BYTES), projectPath: expected.projectPath, clipNodeId: 'native-node' });
  assert.ok(revision.length > MAX_NATIVE_CARRIER_BYTES);
  assert.doesNotThrow(() => reconnect([caption()], snapshot([legacy()], [native({ revision })])));
  assert.throws(() => reconnect([caption()], snapshot([legacy()], [native({ revision: 'a'.repeat(MAX_NATIVE_CARRIER_BYTES + 65537) })])), /malformed/);
});

test('signed source in/out ticks remain ordered and bounded while timeline ticks stay nonnegative', () => {
  for (const [inTicks, outTicks] of [[ticks(-2), ticks(-1)], [ticks(-1), ticks(1)], [ticks(-864000), ticks(864000)]]) {
    assert.doesNotThrow(() => reconnect([caption()], snapshot([legacy({ inTicks, outTicks })], [native({ inTicks, outTicks })])));
  }
  for (const change of [{ inTicks: ticks(-864001) }, { outTicks: ticks(864001) }, { inTicks: ticks(-1), outTicks: ticks(-2) }, { startTicks: '-1' }, { inTicks: '-1e3' }]) {
    assert.throws(() => reconnect([caption()], snapshot([legacy({ ...change })])), /malformed/);
  }
});

test('cross-project or sequence responses and native locators fail before changing any saved link', () => {
  const input = freeze([caption()]), changes = [
    reply => { reply.projectPath = '/other/Caption edit.prproj'; }, reply => { reply.sequenceId = 'other-sequence'; }, reply => { reply.nativeSequenceId = 'other-sequence'; },
    reply => { reply.native[0].locator.projectPath = '/other/Caption edit.prproj'; }, reply => { reply.native[0].locator.sequenceId = 'other-sequence'; },
  ];
  for (const change of changes) { const reply = snapshot([legacy()], [native()]); change(reply); assert.throws(() => reconnect(input, reply), /another project or sequence/); }
  assert.equal(input[0].clipNodeId, 'old-node');
});

test('malformed headers, entries, timing, selection proofs and duplicate identities fail closed', () => {
  const input = freeze([caption()]), changes = [
    reply => { reply.ok = false; }, reply => { reply.version = 2; }, reply => { reply.readOnly = false; }, reply => { reply.playhead = NaN; },
    reply => { reply.playheadTicks = '-1'; }, reply => { reply.selectedClipNodeIds = ['same', 'same']; }, reply => { reply.legacy[0].selected = true; },
    reply => { reply.legacy[0].startTime = '0'; }, reply => { reply.legacy[0].endTime = 0; }, reply => { reply.legacy[0].inTicks = ticks(3); },
    reply => { reply.legacy[0].trackIndex = -1; }, reply => { reply.legacy.push(clone(reply.legacy[0])); }, reply => { reply.legacy[0].path = 'caption.mov'; },
    reply => { reply.native[0].locator.clipNodeId = 'other'; }, reply => { reply.native[0].locator.componentIndex = 1.5; }, reply => { reply.native[0].documentText = {}; },
    reply => { reply.native.push(clone(reply.native[0])); }, reply => { reply.warnings = [null]; }, reply => { reply.legacy = Array(10001).fill(reply.legacy[0]); },
  ];
  for (const change of changes) { const reply = snapshot([legacy()], [native()]); change(reply); assert.throws(() => reconnect(input, reply), /caption connections|path|local/i); }
  assert.throws(() => reconnect([caption(), caption()], snapshot([legacy()])), /duplicated/);
  assert.equal(input[0].clipNodeId, 'old-node');
});

test('a sole enabled native clip reconnects above disabled movie backups without overriding explicit selection',()=>{
 const value=snapshot([legacy({disabled:true})],[native({disabled:false})]);assert.equal(nativeAboveDisabledBackups(value)?.clipNodeId,'native-node');
 for(const changed of [snapshot([legacy()],[native()]),snapshot([legacy({disabled:false})],[native()]),snapshot([legacy({disabled:true})],[native({disabled:true})]),snapshot([legacy({disabled:true})],[native(),native({clipNodeId:'second'})]),snapshot([legacy({disabled:true,selected:true})],[native()],['legacy-node'])])assert.equal(nativeAboveDisabledBackups(changed),undefined);
});
test('connection visibility must be an actual boolean when supplied',()=>{
 for(const disabled of ['true',0,null])assert.throws(()=>reconnect([caption()],snapshot([legacy({disabled})])),/malformed/);
});
