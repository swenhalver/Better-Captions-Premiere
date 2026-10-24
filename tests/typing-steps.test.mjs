import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyTypingText, createTypingController, typingAnchor, typingCaret, typingRange } from '../webview-ui/src/lib/transcript/typing.ts';

const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const source = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const compile = file => ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// Objects from vm contexts have other prototypes; compare their JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const word = (text, startTime, endTime) => ({ text, startTime, endTime, isActive: false });
const bundle = () => [{ id: 'cap', text: 'Hello there. We type here now. Goodbye.', startTime: 0, endTime: 8, words: [
  word('Hello', 0, .5), word('there.', .6, 1), word('We', 2, 2.3), word('type', 2.4, 2.8), word('here', 2.9, 3.3), word('now.', 3.4, 3.9), word('Goodbye.', 6, 7),
] }];

test('a typing anchor replaces only its words, keeps surviving word timing and detects outside changes', () => {
  const captions = bundle(), anchor = typingAnchor(captions, 'cap', 2, 6);
  assert.equal(typingRange(captions, anchor).text, 'We type here now.');
  const edited = applyTypingText(captions, anchor, 'We  typed here   now.');
  assert.deepEqual(edited[0].words.map(item => item.text), ['Hello', 'there.', 'We', 'typed', 'here', 'now.', 'Goodbye.']);
  assert.deepEqual(edited[0].words.map(item => [item.startTime, item.endTime]), captions[0].words.map(item => [item.startTime, item.endTime]), 'same word count keeps every timing');
  // More words: the range grows, the words around it stay put.
  const longer = applyTypingText(captions, anchor, 'We type right here now.');
  assert.equal(typingRange(longer, anchor).text, 'We type right here now.');
  assert.deepEqual(longer[0].words.slice(0, 2), captions[0].words.slice(0, 2));
  assert.deepEqual(longer[0].words.at(-1), captions[0].words.at(-1));
  assert.throws(() => applyTypingText(captions, anchor, '   '), /empty/);
  const outside = structuredClone(captions); outside[0].words[0].text = 'Hi';
  assert.equal(typingRange(outside, anchor), null, 'a change outside the anchored words closes the editor');
  assert.throws(() => applyTypingText(outside, anchor, 'We type'), /changed while you were editing/);
});

test('the caret lands at the end of the changed region after an undo or redo', () => {
  assert.equal(typingCaret('We typed here', 'We type here', 13), 7);
  assert.equal(typingCaret('We type here', 'We typed here', 2), 8);
  assert.equal(typingCaret('abc', 'abc', 9), 3);
  assert.equal(typingCaret('hello world', 'hello', 11), 5);
});

function controller(push = () => true) {
  let time = 0, next = 0;
  const timers = new Map(), pushes = [], shown = [];
  const typing = createTypingController({
    setTimer: (run, ms) => { timers.set(++next, { run, at: time + ms }); return next; }, clearTimer: id => timers.delete(id),
    push: draft => { pushes.push(draft); return push(draft); }, show: (draft, caret) => shown.push([draft, caret]),
  });
  function advance(ms) {
    time += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= time && timers.has(id)) { timers.delete(id); timer.run(); }
  }
  return { typing, pushes, shown, advance, timers };
}

test('typing commits one step after 750 ms without keystrokes; fast typing coalesces to the latest draft', () => {
  const h = controller();
  h.typing.open('We type here');
  h.typing.input('We type here!', 13); h.advance(500);
  h.typing.input('We type here!!', 14); h.advance(700);
  assert.deepEqual(h.pushes, [], 'each keystroke restarts the pause timer');
  h.advance(50); assert.deepEqual(h.pushes, ['We type here!!']);
  h.advance(5000); assert.deepEqual(h.pushes, ['We type here!!'], 'one step per pause');
  h.typing.input('We type here!! ', 15); h.advance(800);
  assert.deepEqual(h.pushes, ['We type here!!'], 'whitespace alone is not a new step');
  assert.equal(h.typing.pending, false);
});

test('Cmd going down commits pending typing at once, and leaving flushes the rest', () => {
  const h = controller();
  h.typing.open('one');
  h.typing.input('one two', 7);
  assert.equal(h.typing.flush(), true); assert.deepEqual(h.pushes, ['one two']);
  assert.equal(h.timers.size, 0, 'the pause timer is cancelled');
  assert.equal(h.typing.flush(), false, 'nothing pending: no second step');
  h.typing.input('one two three', 13);
  const last = h.typing.close();
  assert.equal(last.draft, 'one two three'); assert.equal(h.timers.size, 0, 'closing never commits behind the merge');
  assert.deepEqual(h.pushes, ['one two']);
});

test('an undo restore updates the open draft; with unconfirmed typing it drops just that typing', () => {
  const h = controller();
  h.typing.open('We type');
  h.typing.input('We typed', 8); h.advance(750); h.typing.confirmed('We typed');
  h.typing.input('We typed it', 11); h.advance(750); h.typing.confirmed('We typed it');
  // Premiere Undo of the last step, no typing pending: the editor shows it.
  h.typing.restored('We typed');
  assert.deepEqual(h.shown.at(-1), ['We typed', 8]); assert.equal(h.typing.state.draft, 'We typed');
  h.typing.restored('We typed it');
  assert.deepEqual(h.shown.at(-1), ['We typed it', 11], 'redo restores the burst with the caret after it');
  // Unconfirmed typing, then Undo lands first (it undid the confirmed step).
  h.typing.input('We typed it all', 15);
  assert.equal(h.typing.flush(), true);
  h.typing.restored('We typed');
  assert.deepEqual(h.shown.at(-1), ['We typed it', 11], 'the restore target is the last confirmed step');
  assert.equal(h.pushes.at(-1), 'We typed it', 'and that step is committed again, since Premiere moved below it');
  assert.equal(h.typing.state.pushed, 'We typed it');
});

test('a restore that cannot be committed yet is retried after a pause', () => {
  let allow = false;
  const h = controller(() => allow);
  h.typing.open('a');
  h.typing.input('a b', 3); h.advance(750);
  h.typing.restored('x');
  assert.equal(h.typing.pending, true);
  allow = true; h.advance(750);
  assert.equal(h.pushes.at(-1), 'a', 'the last confirmed text is committed once possible');
});

// --- UXP typing session bookkeeping ---------------------------------------
function params() { const module = { exports: {} }; vm.runInNewContext(source('uxp/native-params.js'), { module, exports: module.exports, console }); return module.exports; }
const locator = { projectPath: '/p.prproj', sequenceId: 's', clipNodeId: 'c', trackIndex: 0, clipIndex: 0, componentIndex: 0, documentParamIndex: 0 };

test('typing steps record undo positions, replace a discarded redo branch, and refuse after an interleaved action', () => {
  const history = params();
  history.recordTypingStep(locator, 't1', { index: 10, token: 1 }, { index: 11, token: 2 }, 'BCDOC1:00');
  history.recordTypingStep(locator, 't1', { index: 11, token: 2 }, { index: 12, token: 3 }, 'BCDOC1:01');
  // Undo once, type again: the new step (a fresh action id) replaces the redo branch.
  history.recordTypingStep(locator, 't1', { index: 11, token: 2 }, { index: 13, token: 4 }, 'BCDOC1:01');
  const plan = history.typingCollapse(locator, 't1');
  assert.deepEqual(plain(plan.positions), [{ index: 10, token: 1 }, { index: 11, token: 2 }, { index: 13, token: 4 }]);
  assert.equal(plan.baseDocument, 'BCDOC1:00'); assert.equal(plan.baseToken, 1);
  assert.equal(history.typingCollapse(locator, 'other').reason, 'no-steps');
  // A write that added no Premiere action cannot be merged.
  history.recordTypingStep(locator, 't1', { index: 13, token: 4 }, { index: 13, token: 5 }, 'BCDOC1:02');
  assert.equal(history.typingCollapse(locator, 't1').reason, 'history-changed');
  // A step from an unknown position (another edit came between) also refuses.
  history.recordTypingStep(locator, 't2', { index: 20, token: 7 }, { index: 21, token: 8 }, 'BCDOC1:00');
  history.recordTypingStep(locator, 't2', { index: 22, token: 9 }, { index: 23, token: 10 }, 'BCDOC1:00');
  assert.equal(history.typingCollapse(locator, 't2').reason, 'history-changed');
  // Without QE there are no positions: never merge.
  history.recordTypingStep(locator, 't3', { index: null, token: 1 }, { index: null, token: 2 }, 'BCDOC1:00');
  assert.equal(history.typingCollapse(locator, 't3').reason, 'history-changed');
});

// --- Host, service, CEP and UXP API with a simulated Premiere history -------
function system(t) {
  let nextJob = 0, nextRequest = 0, documentText = 'BCDOC1:0000', guide = 0;
  const payloads = new Map(), requests = [];
  // Premiere's undo stack: each UXP transaction is one entry with a fresh action
  // id; QE undoStackIndex is the id of the latest applied entry (0: none), as in
  // Premiere 26.5. QE undo/redo walk the stack.
  const premiere = { stack: [], index: 0, transactions: 0, ids: 0, get id() { return this.index ? this.stack[this.index - 1].id : 0; } };
  const time = seconds => ({ seconds, ticks: String(seconds * 254016000000) });
  const documentParam = { displayName: 'Caption document (experimental)', isTimeVarying: () => false, getValue: () => documentText, setValue(value) { documentText = value; return 0; } };
  const guideParam = { displayName: 'Layout editing guide', isTimeVarying: () => false, getValue: () => guide, setValue(value) { guide = value; return 0; } };
  const properties = [documentParam, { displayName: 'Characters per line', isTimeVarying: () => false, getValue: () => 56, setValue() {} }, guideParam,
    { displayName: 'Width', isTimeVarying: () => false, getValue: () => 1536 }, { displayName: 'Global font size (64 = 1x)', isTimeVarying: () => false, getValue: () => 64 }];
  const nativeClip = { nodeId: 'native-node', projectItem: { nodeId: 'native-item', getMediaPath: () => '' }, start: time(0), end: time(2), inPoint: time(0), outPoint: time(2), isAdjustmentLayer: () => true, isSelected: () => true,
    components: Object.defineProperty([{ matchName: 'AE.com.swen.bettercaptions.native.experimental', properties: Object.defineProperty(properties, 'numItems', { get: () => properties.length }) }], 'numItems', { get: () => 1 }) };
  const nativeTrack = { clips: Object.defineProperty([nativeClip], 'numItems', { get: () => 1 }), isLocked: () => false };
  const nativeSequence = { sequenceID: 'seq-a', name: 'Captions', timebase: '10584000000', frameSizeHorizontal: 720, frameSizeVertical: 1280, end: String(2 * 254016000000), getPlayerPosition: () => time(.5), videoTracks: Object.defineProperty([nativeTrack], 'numTracks', { get: () => 1 }), audioTracks: Object.defineProperty([], 'numTracks', { get: () => 0 }) };
  const qe = { project: {
    undoStackIndex: () => premiere.id,
    undo() { if (!premiere.index) return; const entry = premiere.stack[--premiere.index]; for (const change of entry.changes) change.param.setValue(change.before); },
    redo() { if (premiere.index >= premiere.stack.length) return; const entry = premiere.stack[premiere.index++]; for (const change of entry.changes) change.param.setValue(change.after); },
  } };
  const nativeContext = vm.createContext({ app: { project: { path: '/first/edit.prproj', activeSequence: nativeSequence }, enableQE() {} }, qe, Time: function () { this.ticks = '0'; },
    File: function (file) { this.length = (payloads.get(file) ?? '').length; this.open = () => payloads.has(file); this.read = () => payloads.get(file); this.close = () => {}; } });
  vm.runInContext(source('cep/host/bridge.jsx'), nativeContext); nativeContext.$ = { global: vm.runInContext('this', nativeContext) };
  const runtime = { path, directory: info => '/first/Better Captions/' + info.id, readJob: data => { const file = '/ipc-' + ++nextJob + '.json'; payloads.set(file, JSON.stringify(data)); return file; }, disposeReadJob: file => payloads.delete(file), load: () => null, save: () => {} };
  const cepExports = {};
  vm.runInNewContext(compile('webview-ui/src/cep-api.ts'), { exports: cepExports, console, require: () => ({}), window: { require: name => name === 'node:path' ? path : runtime, __adobe_cep__: { getSystemPath: () => '/extension', evalScript(script, callback) { callback(vm.runInContext(script, nativeContext)); } } } });
  const cep = cepExports.createHostAPI();
  const service = {}; vm.runInNewContext(compile('cep/service.ts'), { exports: service, console, require: () => ({ createHostAPI: () => cep }), setTimeout, clearTimeout, setInterval, clearInterval });
  const folders = new Map();
  function folder(name) {
    if (folders.has(name)) return folders.get(name);
    const entries = new Map(), value = { nativePath: name, entries, getEntry: async file => {
      if (name === '/private/service' && file === 'service.json') return { data: { version: 1, instanceId: 'a'.repeat(24), updatedAt: Date.now(), actions: service.SERVICE_ACTIONS } };
      if (!entries.has(file)) throw new Error('Not found'); return entries.get(file);
    } };
    folders.set(name, value); return value;
  }
  // Each request runs when the UXP lane writes it; a hook can act just before one.
  let beforeRequest = null;
  const storage = { ensureFolder: async name => folder(name), privateRoot: async name => folder('/private/' + name), randomId: () => String(++nextRequest).padStart(32, '0'), readJSON: async file => file.data,
    async writeJSON(parent, name, data) {
      if (parent.nativePath !== '/private/service/requests') return;
      requests.push(data); beforeRequest?.(data);
      let result;
      try { service.validateServiceRequest(data, name); result = { result: await service.dispatchServiceRequest(cep, data) }; }
      catch (error) { result = { error: error.message, ...(error.code === 'BC_OUTPUT_UNCONFIRMED' ? { code: error.code, recoverable: false, outputApplied: error.outputApplied } : {}) }; }
      const responses = folder('/private/service/responses');
      responses.entries.set(name, { data: { version: 1, id: data.id, sequenceId: data.sequenceId, projectPath: data.projectPath, ...result }, delete: async () => responses.entries.delete(name) });
    } };
  const sequence = { guid: { toString: () => 'seq-a' }, name: 'Captions', getSettings: async () => ({ getVideoFrameRect: async () => ({ width: 720, height: 1280 }) }), getTimebase: async () => 10584000000, getEndTime: async () => ({ seconds: 2 }), getPlayerPosition: async () => ({ seconds: .5 }), getVideoTrackCount: async () => 0 };
  // The typing fast step's own UXP transaction on the guide param.
  function transaction(build, label) {
    const actions = [];
    build({ addAction(action) { actions.push(action); return true; } });
    premiere.stack.length = premiere.index;
    premiere.stack.push({ id: ++premiere.ids, changes: actions.map(action => { const before = action.param.getValue(); action.param.setValue(action.value); return { param: action.param, before, after: action.value }; }) });
    premiere.index++; premiere.transactions++; labels.push(label.replace(/^S-Captions: /, ''));
    return true;
  }
  const project = { path: '/first/edit.prproj', getActiveSequence: async () => sequence, getSequences: async () => [sequence], lockedAccess: run => run(), executeTransaction: transaction };
  const uxpGuide = { getStartValue: async () => ({ value: { value: guide } }), createKeyframe: value => ({ value }), createSetValueAction: key => ({ param: guideParam, value: key.value }) };
  const ppro = { Project: { getActiveProject: async () => project }, Constants: { TrackItemType: { CLIP: 1 } } };
  const history = params(), labels = [];
  history.captionComponent = async () => ({ params: properties.map(param => param === guideParam ? uxpGuide : {}), names: properties.map(param => param.displayName) });
  // The UXP transaction: one undo entry holding every write of the edit.
  history.commitNativeParams = async (ppro, project, sequence, prepared, writes, label) => {
    premiere.stack.length = premiere.index;
    premiere.stack.push({ id: ++premiere.ids, changes: writes.map(write => { const param = properties[write.index], before = param.getValue(); param.setValue(write.value); return { param, before, after: write.value }; }) });
    premiere.index++; premiere.transactions++; labels.push(label);
    return true;
  };
  const api = { exports: {} };
  vm.runInNewContext(source('uxp/api.js'), { module: api, exports: api.exports, setTimeout, clearTimeout, require: name => {
    if (name === 'premierepro') return ppro; if (name === 'uxp') return { storage: { localFileSystem: {} } }; if (name === './storage.js') return storage;
    if (name === './transcript.js') return {}; if (name === './paths.js') return require('../uxp/paths.js'); if (name === './native-params.js') return history;
    throw new Error('Unexpected dependency ' + name);
  } });
  const nativeApi = api.exports.createHostAPI({ serviceStartupGraceMs: 0 });
  t.after(() => nativeApi.dispose());
  async function layer() { const read = await nativeApi.readCaptionConnections('seq-a'); return read.native[0]; }
  async function write(text, label, typing) {
    const entry = await layer();
    return nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, text, 'seq-a', label, typing);
  }
  async function prime() { const entry = await layer(); return nativeApi.primeNativeTyping({ locator: entry.locator, revision: entry.revision }, 'seq-a'); }
  return { nativeApi, premiere, labels, requests, history, layer, write, prime, qe,
    get document() { return documentText; }, set document(value) { documentText = value; }, get guide() { return guide; },
    set beforeRequest(value) { beforeRequest = value; } };
}

test('closing the editor merges its typing steps: undo back to the first, then one final step', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  // The panel's message channel delivers an omitted typing session as null.
  await h.write('BCDOC1:0001', 'Style', null);
  const open = h.document, base = h.premiere.index;
  for (const text of ['BCDOC1:0002', 'BCDOC1:0003', 'BCDOC1:0004']) await h.write(text, 'Typing', 'typing-a');
  assert.equal(h.premiere.index, base + 3, 'one undo position per typing step');
  const locator = (await h.layer()).locator;
  const merged = await h.nativeApi.collapseNativeTyping(locator, 'typing-a', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 3);
  assert.equal(h.premiere.index, base, 'Premiere is back before the first typing step');
  assert.equal(h.document, open, 'and the layer holds the text from when the editor opened');
  assert.equal(merged.revision, (await h.layer()).revision);
  await h.write('BCDOC1:0004', 'Edit text');
  assert.equal(h.premiere.index, base + 1, 'the merged text is a single step');
  assert.equal(h.premiere.stack.length, base + 1, 'which discarded the typing steps from the redo branch');
  assert.deepEqual(h.labels, ['Style', 'Typing', 'Typing', 'Typing', 'Edit text']);
  // One Premiere Undo takes back the whole edit.
  h.qe.project.undo();
  const restored = await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(restored.restored, true); assert.equal(h.document, open);
});

test('Escape (or unchanged text) merges back to the opening text and adds no step', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document, base = h.premiere.index;
  await h.write('BCDOC1:0002', 'Typing', 'typing-b');
  await h.write('BCDOC1:0003', 'Typing', 'typing-b');
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-b', 'seq-a');
  assert.equal(merged.collapsed, true);
  assert.equal(h.document, open); assert.equal(h.premiere.index, base);
  assert.equal(h.premiere.stack.length, 2, 'the typing steps stay on the redo branch; nothing new was committed');
  assert.deepEqual(plain(await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-b', 'seq-a')), { collapsed: false, reason: 'no-steps' });
});

test('typing again after an in-field Undo starts a fresh action id and still merges', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document, base = h.premiere.index;
  for (const text of ['BCDOC1:0002', 'BCDOC1:0003', 'BCDOC1:0004']) await h.write(text, 'Typing', 'typing-i');
  h.qe.project.undo(); h.qe.project.undo();
  await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, 'BCDOC1:0002');
  await h.write('BCDOC1:0005', 'Typing', 'typing-i');
  assert.equal(h.premiere.id, 4, 'Premiere numbers the new step after every earlier action');
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-i', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 2);
  assert.equal(h.premiere.index, base); assert.equal(h.document, open);
});

test('a merge after Premiere Undo within the typing steps undoes only the remaining ones', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document, base = h.premiere.index;
  for (const text of ['BCDOC1:0002', 'BCDOC1:0003', 'BCDOC1:0004']) await h.write(text, 'Typing', 'typing-c');
  h.qe.project.undo();
  await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, 'BCDOC1:0003', 'Undo while typing restores the previous pause point');
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-c', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 2);
  assert.equal(h.premiere.index, base); assert.equal(h.document, open);
});

test('the merge refuses, changing nothing, when Premiere history moved away from the typing steps', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  for (const text of ['BCDOC1:0002', 'BCDOC1:0003']) await h.write(text, 'Typing', 'typing-d');
  // The user did something else in Premiere: another undo entry on top.
  h.premiere.stack.length = h.premiere.index; h.premiere.stack.push({ id: ++h.premiere.ids, changes: [] }); h.premiere.index++;
  const index = h.premiere.index, text = h.document;
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-d', 'seq-a');
  assert.deepEqual(plain(merged), { collapsed: false, reason: 'moved' });
  assert.equal(h.premiere.index, index); assert.equal(h.document, text, 'the typing steps and text stay intact');
});

test('a merge that meets an unexpected position part way redoes what it undid', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  for (const text of ['BCDOC1:0002', 'BCDOC1:0003', 'BCDOC1:0004']) await h.write(text, 'Typing', 'typing-e');
  // Something rewrote the token of the middle step's entry behind S-Captions' back.
  h.premiere.stack[h.premiere.index - 2].changes[0].before = 12345;
  const index = h.premiere.index, guide = h.guide;
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-e', 'seq-a');
  assert.equal(merged.collapsed, false); assert.equal(merged.reason, 'mismatch');
  assert.equal(h.premiere.index, index); assert.equal(h.guide, guide);
});

test('a typing write refuses to bury a Premiere Undo whose document is not back yet', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  await h.write('BCDOC1:0002', 'Typing', 'typing-f');
  const entry = await h.layer();
  h.qe.project.undo(); // Cmd+Z landed; no read has restored the document yet.
  await assert.rejects(h.nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, 'BCDOC1:0003', 'seq-a', 'Typing', 'typing-f'), error => error.code === 'BC_NATIVE_STALE');
  assert.equal(h.document, 'BCDOC1:0002', 'nothing was written');
  // After a read put the document back, a write from the old revision is stale too.
  await h.nativeApi.readCaptionConnections('seq-a');
  await assert.rejects(h.nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, 'BCDOC1:0003', 'seq-a', 'Typing', 'typing-f'), error => error.code === 'BC_NATIVE_STALE');
});

test('a Premiere Undo that lands while a typing step is being saved is honoured: nothing is written', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  await h.write('BCDOC1:0002', 'Typing', 'typing-g');
  await h.write('BCDOC1:0003', 'Typing', 'typing-g');
  const entry = await h.layer(), index = h.premiere.index;
  // Cmd+Z arrives after the step was prepared, before its document is written.
  let fired = false;
  h.beforeRequest = request => { if (!fired && request.action === 'writeNativeCaptionDocument' && request.args[0].phase === 'write') { fired = true; h.qe.project.undo(); } };
  await assert.rejects(h.nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, 'BCDOC1:0004', 'seq-a', 'Typing', 'typing-g'), error => error.code === 'BC_NATIVE_STALE');
  assert.equal(h.premiere.index, index - 1, 'Premiere stays where the user\'s Undo put it');
  assert.equal(h.premiere.stack.length, index, 'and its redo branch is intact');
  await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, 'BCDOC1:0002', 'and the layer shows that step');
  // The session still merges from there.
  const merged = await h.nativeApi.collapseNativeTyping(entry.locator, 'typing-g', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 1);
});

test('typing steps record nothing for merging without QE undo positions', async t => {
  const h = system(t);
  delete h.qe.project.undoStackIndex;
  await h.nativeApi.getActiveSequenceInfo();
  await h.write('BCDOC1:0002', 'Typing', 'typing-h');
  assert.deepEqual(plain(await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-h', 'seq-a')), { collapsed: false, reason: 'history-changed' });
  assert.equal(h.document, 'BCDOC1:0002');
});

// --- Typing fast step: the undo step first, the document right after ---------
test('a typing step commits its Premiere undo step before its document is written', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document;
  const primed = await h.prime();
  assert.equal(primed.primed, true); assert.equal(primed.seeded, true, 'a layer without a remembered token is seeded first');
  assert.equal(h.premiere.index, 0, 'priming adds no undo step');
  let atWrite = null;
  h.beforeRequest = request => { if (request.action === 'writeNativeCaptionDocument' && request.args[0].phase === 'step') atWrite = { steps: h.premiere.index, document: h.document }; };
  const result = await h.write('BCDOC1:0002', 'Typing', 'typing-fast');
  assert.deepEqual(atWrite, { steps: 1, document: open }, 'the undo step was in Premiere before the document write started');
  assert.equal(typeof result.fastStep.at, 'number');
  assert.equal(h.document, 'BCDOC1:0002'); assert.deepEqual(h.labels, ['Typing']);
  assert.equal(h.requests.filter(request => request.args?.[0]?.phase === 'prepare').length, 1, 'only the prime prepared; the step itself needs one host call');
  // Cmd+Z takes back exactly that burst; Shift+Cmd+Z brings it back.
  h.qe.project.undo(); await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, open);
  h.qe.project.redo(); await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, 'BCDOC1:0002');
  // The next burst is fast again from the followed position, and still merges.
  await h.write('BCDOC1:0003', 'Typing', 'typing-fast');
  assert.equal(h.requests.filter(request => request.args?.[0]?.phase === 'step').length, 2);
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-fast', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 2);
  assert.equal(h.document, open); assert.equal(h.premiere.index, 0);
});

test('an Undo that lands between the fast undo step and its document write restores correctly', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document;
  await h.prime();
  h.beforeRequest = request => { if (request.action === 'writeNativeCaptionDocument' && request.args[0].phase === 'step') { h.beforeRequest = null; h.qe.project.undo(); } };
  await assert.rejects(h.write('BCDOC1:0002', 'Typing', 'typing-race'), error => error.code === 'BC_NATIVE_STALE');
  assert.equal(h.document, open, 'the document of the undone step was never written');
  assert.equal(h.premiere.index, 0); assert.equal(h.premiere.stack.length, 1, 'the step waits on the redo branch');
  await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(h.document, open);
  // Redo puts back the token, and the next read its remembered document.
  h.qe.project.redo();
  const read = await h.nativeApi.readCaptionConnections('seq-a');
  assert.equal(read.restored, true); assert.equal(h.document, 'BCDOC1:0002');
  // The redone step is part of the typing session, so leaving still merges it.
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-race', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 1); assert.equal(h.document, open);
});

test('a step undone before its write that is never redone is dropped by the next burst', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  const open = h.document;
  await h.prime();
  h.beforeRequest = request => { if (request.action === 'writeNativeCaptionDocument' && request.args[0].phase === 'step') { h.beforeRequest = null; h.qe.project.undo(); } };
  await assert.rejects(h.write('BCDOC1:0002', 'Typing', 'typing-drop'), error => error.code === 'BC_NATIVE_STALE');
  // Merging right away has nothing to undo.
  assert.deepEqual(plain(h.history.typingCollapse((await h.layer()).locator, 'typing-drop').positions), [{ index: 0, token: h.guide }]);
  await h.write('BCDOC1:0003', 'Typing', 'typing-drop');
  assert.equal(h.premiere.stack.length, 1, 'the new step replaced the redo branch');
  const merged = await h.nativeApi.collapseNativeTyping((await h.layer()).locator, 'typing-drop', 'seq-a');
  assert.equal(merged.collapsed, true); assert.equal(merged.undone, 1); assert.equal(h.document, open);
});

test('a read between the fast undo step and its write restores the typed document, and the write still confirms', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  await h.prime();
  let read = null;
  // A queued connection read runs before the step's document write.
  const entry = await h.layer();
  const reading = h.nativeApi.readCaptionConnections('seq-a').then(value => { read = value; });
  const writing = h.nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, 'BCDOC1:0002', 'seq-a', 'Typing', 'typing-read');
  await reading; const result = await writing;
  assert.equal(result.readbackVerified, true); assert.equal(h.document, 'BCDOC1:0002');
  assert.equal(read.restored, true, 'the read saw the committed step and put its document back early');
  assert.equal(h.premiere.index, 1, 'still one undo step');
});

test('the fast step stands aside when Premiere Undo moved the layer before the panel followed it', async t => {
  const h = system(t);
  await h.nativeApi.getActiveSequenceInfo();
  await h.prime();
  await h.write('BCDOC1:0002', 'Typing', 'typing-moved');
  const entry = await h.layer();
  h.qe.project.undo(); // not followed yet
  const transactions = h.premiere.transactions;
  await assert.rejects(h.nativeApi.writeNativeCaptionDocument({ locator: entry.locator, revision: entry.revision }, 'BCDOC1:0003', 'seq-a', 'Typing', 'typing-moved'), error => error.code === 'BC_NATIVE_STALE');
  assert.equal(h.premiere.transactions, transactions, 'no step buried the redo branch');
  assert.equal(h.premiere.stack.length, 1);
});
