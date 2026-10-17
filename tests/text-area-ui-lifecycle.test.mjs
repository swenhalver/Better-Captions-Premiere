import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../webview-ui/src/components/TextAreaControls.svelte', import.meta.url), 'utf8');
const moduleSource = source.match(/<script module lang="ts">([\s\S]*?)<\/script>/)?.[1];
assert.ok(moduleSource, 'Test the controller exported by the actual Svelte component');
const code = ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = {};
vm.runInNewContext(code, { exports: loaded });
const { captionFrame, createTextAreaController } = loaded;
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function context(id = 'one') {
  return { key: `seq-${id}`, sequenceId: 'seq', caption: { id, clipNodeId: `clip-${id}`, startTime: 10, endTime: 14 },
    frameRate: 24, currentTime: 10, visible: true, disabled: false };
}
function state(frame) {
  return { signature: `native-${frame}`, frame, count: 96, startTime: 10, frameRate: 24, canUndo: false,
    tracks: { position: { value: [100 + frame, 200 + frame], keys: [] }, width: { value: [900], keys: [] }, height: { value: [400], keys: [] } } };
}
function harness(t, ports = {}) {
  let current = context(), view = null, nativeTime = null, changed = 0;
  const reads = [], edits = [], busy = [], errors = [], published = [];
  const controller = createTextAreaController({
    current: () => current,
    read: async (captured, frame) => { reads.push({ id: captured.caption.id, frame }); return ports.read ? ports.read(captured, frame) : state(frame); },
    edit: async (captured, request) => { edits.push({ id: captured.caption.id, request: clone(request) }); return ports.edit ? ports.edit(captured, request) : state(request.frame); },
    getTime: async captured => ports.getTime ? ports.getTime(captured) : nativeTime ?? current.currentTime,
    seek: async (captured, time) => { if (ports.seek) await ports.seek(captured, time); current = { ...current, currentTime: time }; controller.sync(); },
    state: next => { view = next; published.push(next); }, busy: value => busy.push(value), error: message => errors.push(message),
    changed: async () => { changed++; },
  });
  t.after(() => controller.stop());
  return { controller, reads, edits, busy, errors, published, get view() { return view; }, get changed() { return changed; },
    get context() { return current; }, set context(value) { current = value; }, set nativeTime(value) { nativeTime = value; } };
}

test('a word or transcript seek updates the displayed frame and subsequent keyframe edits', async t => {
  const h = harness(t); await h.controller.sync(); assert.equal(h.view.frame, 0);
  h.context = { ...h.context, currentTime: 12.5 }; await h.controller.sync();
  assert.equal(h.view.frame, 60);
  await h.controller.change({ operation: 'key', track: 'width' });
  assert.equal(h.edits[0].request.frame, 60); assert.equal(h.edits[0].request.signature, 'native-60');
});
test('an edit confirms the actual native playhead instead of trusting an old read', async t => {
  const h = harness(t); await h.controller.sync(); h.nativeTime = 12;
  await h.controller.change({ operation: 'key', track: 'height' });
  assert.equal(h.edits[0].request.frame, 48); assert.equal(h.view.frame, 48);
});
test('changing X rebases Y from the current frame before writing the shared Position key', async t => {
  const h = harness(t); await h.controller.sync(); h.nativeTime = 12;
  await h.controller.change({ operation: 'set', track: 'position' }, { index: 0, value: 777 });
  assert.deepEqual(h.edits[0].request.value, [777, 248]);
});
test('pending transcript timings cannot offset keyframe edits from the real native clip', async t => {
  const h = harness(t); h.context = { ...h.context, currentTime: 12, caption: { ...h.context.caption, startTime: 11 } };
  await h.controller.sync();
  assert.deepEqual(h.reads.map(read => read.frame), [24, 48]); assert.equal(h.view.frame, 48);
  await h.controller.change({ operation: 'key', track: 'width' }); assert.equal(h.edits[0].request.frame, 48);
  await h.controller.seek(24); await settle(); assert.equal(h.context.currentTime, 11);
});
test('playhead changes coalesce to one latest read without overlapping native work', async t => {
  const first = deferred(), latest = deferred(); let active = 0, maximum = 0;
  const h = harness(t, { read: async (_context, frame) => { active++; maximum = Math.max(maximum, active); try { return await (frame === 0 ? first.promise : latest.promise); } finally { active--; } } });
  const pending = h.controller.sync(); await settle();
  h.context = { ...h.context, currentTime: 12 }; h.controller.sync();
  h.context = { ...h.context, currentTime: 13 }; h.controller.sync();
  assert.equal(h.reads.length, 1); assert.equal(h.view, null);
  first.resolve(state(0)); await pending; await settle();
  assert.deepEqual(h.reads.map(read => read.frame), [0, 72]); assert.equal(h.view, null);
  latest.resolve(state(72)); await settle(); assert.equal(h.view.frame, 72); assert.equal(maximum, 1);
  await settle(); assert.equal(h.reads.length, 2, 'No timer or automatic read retry is installed');
});
test('hiding the panel invalidates a pending read and retains its busy ownership until it returns', async t => {
  const pending = deferred(); const h = harness(t, { read: () => pending.promise });
  const reading = h.controller.sync(); await settle(); h.context = { ...h.context, visible: false }; h.controller.sync();
  assert.deepEqual(h.busy, [true]); assert.equal(h.view, null);
  pending.resolve(state(0)); await reading; await settle(); assert.equal(h.view, null); assert.deepEqual(h.busy, [true, false]); assert.equal(h.reads.length, 1);
});
test('hiding before a queued operation starts prevents its native call', async t => {
  const h = harness(t); const pending = h.controller.sync();
  h.context = { ...h.context, visible: false }; h.controller.sync(); await pending;
  assert.equal(h.reads.length, 0); assert.equal(h.edits.length, 0);
});
test('a failed old-caption read cannot pause the queued new caption or report a stale error', async t => {
  const old = deferred(); const h = harness(t, { read: (context, frame) => context.caption.id === 'one' ? old.promise : state(frame) });
  const pending = h.controller.sync(); await settle(); h.context = { ...context('two'), currentTime: 12 }; h.controller.sync();
  old.reject(new Error('Old caption read failed')); await pending; await settle();
  assert.equal(h.errors.length, 0); assert.deepEqual(h.reads.map(read => read.id), ['one', 'two']); assert.equal(h.view.frame, 48);
  await h.controller.change({ operation: 'key', track: 'width' }); assert.equal(h.edits[0].id, 'two');
});
test('a failed read after hide cannot surface an error or poison the next visible read', async t => {
  const old = deferred(); let reads = 0;
  const h = harness(t, { read: (_context, frame) => ++reads === 1 ? old.promise : state(frame) });
  const pending = h.controller.sync(); await settle(); h.context = { ...h.context, visible: false }; h.controller.sync();
  old.reject(new Error('Hidden read failed')); await pending; await settle();
  assert.equal(h.errors.length, 0); assert.equal(h.reads.length, 1); assert.equal(h.view, null);
  h.context = { ...h.context, visible: true, currentTime: 12 }; await h.controller.sync();
  assert.equal(h.errors.length, 0); assert.equal(h.view.frame, 48); assert.equal(h.reads.length, 2);
});
test('hide then show while an old read fails preserves the queued visible frame', async t => {
  const old = deferred(); let reads = 0;
  const h = harness(t, { read: (_context, frame) => ++reads === 1 ? old.promise : state(frame) });
  const pending = h.controller.sync(); await settle(); h.context = { ...h.context, visible: false }; h.controller.sync();
  h.context = { ...h.context, visible: true, currentTime: 13 }; h.controller.sync();
  old.reject(new Error('Superseded read failed')); await pending; await settle();
  assert.equal(h.errors.length, 0); assert.equal(h.view.frame, 72); assert.equal(h.reads.length, 2);
});
test('a caption switch while confirming the playhead cannot write the previous caption', async t => {
  const playhead = deferred(); const h = harness(t, { getTime: () => playhead.promise }); await h.controller.sync();
  const changing = h.controller.change({ operation: 'key', track: 'width' }); await settle();
  h.context = context('two'); h.controller.sync(); playhead.resolve(12); await changing; await settle();
  assert.equal(h.edits.length, 0); assert.equal(h.changed, 0); assert.equal(h.reads.at(-1).id, 'two');
});
test('a seek or hide during the fresh pre-edit read cancels the write', async t => {
  const fresh = deferred(); let calls = 0;
  const h = harness(t, { read: (_context, frame) => ++calls === 1 ? state(frame) : fresh.promise }); await h.controller.sync();
  const changing = h.controller.change({ operation: 'key', track: 'width' }); await settle();
  h.context = { ...h.context, visible: false }; h.controller.sync(); fresh.resolve(state(0)); await changing;
  assert.equal(h.edits.length, 0); assert.equal(h.changed, 0);
});
test('an already dispatched edit cannot publish its result into a new caption', async t => {
  const response = deferred(); const h = harness(t, { edit: () => response.promise }); await h.controller.sync();
  const changing = h.controller.change({ operation: 'key', track: 'position' }); await settle(); assert.equal(h.edits.length, 1);
  h.context = context('two'); h.controller.sync(); response.resolve(state(0)); await changing; await settle();
  assert.equal(h.changed, 0); assert.equal(h.reads.at(-1).id, 'two');
});
test('a failed read stays paused through playhead changes until explicit Refresh', async t => {
  let failing = true;
  const h = harness(t, { read: (_context, frame) => { if (failing) throw new Error('Native read timed out'); return state(frame); } });
  await h.controller.sync(); h.context = { ...h.context, currentTime: 12 }; await h.controller.sync();
  assert.equal(h.reads.length, 1); assert.equal(h.errors.length, 1);
  failing = false; await h.controller.refresh(); assert.equal(h.reads.length, 2); assert.equal(h.view.frame, 48);
});
test('collapsed, hidden or externally busy controls do not read or mutate native Motion', async t => {
  const h = harness(t); h.context = { ...h.context, disabled: true }; await h.controller.sync();
  await h.controller.refresh(); await h.controller.change({ operation: 'key', track: 'width' }); assert.equal(h.reads.length, 0); assert.equal(h.edits.length, 0);
  h.context = { ...h.context, disabled: false, visible: false }; await h.controller.sync(); assert.equal(h.reads.length, 0);
});
test('keyframe navigation awaits its native seek before reading the new frame', async t => {
  const seek = deferred(); const h = harness(t, { seek: () => seek.promise }); await h.controller.sync();
  const moving = h.controller.seek(48); await settle(); assert.equal(h.reads.length, 1);
  seek.resolve(); await moving; await settle(); assert.equal(h.reads.at(-1).frame, 48); assert.equal(h.view.frame, 48);
});
test('stopping does not publish a pending native response or schedule a replacement read', async t => {
  const pending = deferred(); const h = harness(t, { read: () => pending.promise });
  const reading = h.controller.sync(); await settle(); h.controller.stop(); pending.resolve(state(0)); await reading;
  assert.equal(h.view, null); assert.equal(h.reads.length, 1); assert.deepEqual(h.busy, [true, false]);
});
test('playhead frames are bounded to the selected caption', () => {
  assert.equal(captionFrame(context(), 2), 0); assert.equal(captionFrame(context(), 100), 95);
});
test('area and export busy owners cannot unlock each other', () => {
  const main = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8');
  const functions = main.match(/  function setTimelineBusy\(busy: boolean\) \{[\s\S]*?\n  function setAreaBusy\(busy: boolean\) \{[^\n]+\}/)?.[0];
  assert.ok(functions, 'Exercise the production busy aggregation functions');
  const compiled = ts.transpileModule(`let exportBusy=false,areaBusy=false,timelineBusy=false,automaticReflow=false;const motionWatcher={reset(){}};${functions}\nexport const apply=setTimelineBusy,area=setAreaBusy,busy=()=>timelineBusy;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const api = {}; vm.runInNewContext(compiled, { exports: api });
  api.apply(true); api.area(true); api.apply(false); assert.equal(api.busy(), true); api.area(false); assert.equal(api.busy(), false);
  api.area(true); api.apply(true); api.area(false); assert.equal(api.busy(), true); api.apply(false); assert.equal(api.busy(), false);
});
