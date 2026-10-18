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
    changed: async (...args) => { changed++; await ports.changed?.(...args); },
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
test('the initial Motion read samples the confirmed native playhead instead of persisted session time', async t => {
  const h = harness(t); h.nativeTime = 10.75;
  await h.controller.sync();
  assert.equal(h.context.currentTime, 10, 'The saved session time still differs from Premiere');
  assert.deepEqual(h.reads.map(read => read.frame), [18]); assert.equal(h.view.frame, 18); assert.equal(h.edits.length, 0);
});
test('Refresh from playhead confirms the current native time on every explicit read', async t => {
  const h = harness(t); h.nativeTime = 11; await h.controller.sync();
  h.nativeTime = 12.5; await h.controller.refresh();
  assert.equal(h.context.currentTime, 10); assert.deepEqual(h.reads.map(read => read.frame), [24, 60]); assert.equal(h.view.frame, 60);
});
test('a failed or invalid playhead confirmation pauses reads until explicit Refresh', async t => {
  let result = new Error('Premiere playhead unavailable');
  const h = harness(t, { getTime: () => { if (result instanceof Error) throw result; return result; } });
  await h.controller.sync(); assert.equal(h.reads.length, 0); assert.match(h.errors[0], /playhead unavailable/);
  h.context = { ...h.context, currentTime: 11 }; await h.controller.sync(); assert.equal(h.errors.length, 1);
  result = NaN; await h.controller.refresh(); assert.equal(h.reads.length, 0); assert.match(h.errors[1], /confirm the current playhead/);
  result = 12; await h.controller.refresh(); assert.equal(h.view.frame, 48); assert.equal(h.reads.length, 1);
  assert.deepEqual(h.busy, [true, false, true, false, true, false]);
});
test('an old initial playhead failure cannot pause the queued new caption or dispatch an old read', async t => {
  const old = deferred();
  const h = harness(t, { getTime: context => context.caption.id === 'one' ? old.promise : 12 });
  const pending = h.controller.sync(); await settle();
  h.context = context('two'); h.controller.sync();
  old.reject(new Error('Old playhead confirmation failed')); await pending; await settle();
  assert.equal(h.errors.length, 0); assert.deepEqual(h.reads.map(read => read.id), ['two']); assert.equal(h.view.frame, 48);
});
test('hiding during initial playhead confirmation prevents native Motion reads and stale errors', async t => {
  const pending = deferred(); const h = harness(t, { getTime: () => pending.promise });
  const reading = h.controller.sync(); await settle();
  h.context = { ...h.context, visible: false }; h.controller.sync();
  pending.reject(new Error('Hidden playhead confirmation failed')); await reading; await settle();
  assert.equal(h.reads.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.view, null); assert.deepEqual(h.busy, [true, false]);
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
function keyedState(frame) {
  const next = state(frame);
  next.tracks.position.keys = [
    { ticks: '0', frame: 0, value: [100, 200], interpolation: 'native' },
    { ticks: '254016000000', frame: 24, value: [500, 600], interpolation: 'linear' },
  ];
  next.tracks.position.animated = true; return next;
}
test('selected-key value edits retain exact ticks and rebase XY from that key after the playhead moves', async t => {
  const h = harness(t, { read: (_context, frame) => keyedState(frame) }); await h.controller.sync();
  h.context = { ...h.context, currentTime: 13 }; h.nativeTime = 13;
  await h.controller.sync();
  await h.controller.change({ operation: 'set-key', track: 'position', keyTicks: '254016000000' }, { index: 0, value: 777 });
  assert.equal(h.edits[0].request.frame, 72); assert.equal(h.edits[0].request.keyTicks, '254016000000');
  assert.deepEqual(h.edits[0].request.value, [777, 600], 'Keep the selected key’s Y instead of copying playhead Y');
});
test('selected-key move, delete and interpolation commands keep their exact target at a different native frame', async t => {
  for (const request of [
    { operation: 'move-key', targetFrame: 48 }, { operation: 'remove-key' }, { operation: 'interpolation', interpolation: 'hold' },
  ]) {
    const h = harness(t, { read: (_context, frame) => keyedState(frame) }); await h.controller.sync(); h.nativeTime = 13;
    await h.controller.change({ ...request, track: 'position', keyTicks: '254016000000' });
    assert.equal(h.edits[0].request.frame, 72); assert.equal(h.edits[0].request.keyTicks, '254016000000');
    if (request.operation === 'move-key') assert.equal(h.edits[0].request.targetFrame, 48);
  }
});
test('a selected key removed by a native drag is never silently redirected to the playhead key', async t => {
  let removed = false;
  const h = harness(t, { read: (_context, frame) => removed ? state(frame) : keyedState(frame) }); await h.controller.sync(); removed = true;
  await h.controller.change({ operation: 'set-key', track: 'position', keyTicks: '254016000000' }, { index: 0, value: 777 });
  assert.equal(h.edits.length, 0); assert.match(h.errors[0], /selected keyframe changed/);
});
test('selected-key timing rejects non-frame or out-of-caption destinations before dispatch', async t => {
  const h = harness(t, { read: (_context, frame) => keyedState(frame) }); await h.controller.sync();
  for (const targetFrame of [-1, 96, 3.5, NaN]) {
    await h.controller.refresh(); await h.controller.change({ operation: 'move-key', track: 'position', keyTicks: '254016000000', targetFrame });
  }
  assert.equal(h.edits.length, 0); assert.equal(h.errors.length, 4);
});
test('confirmed edit state is returned to the caller and change callback, including Redo capability', async t => {
  let confirmed; const h = harness(t, { edit: (_context, request) => ({ ...state(request.frame), canUndo: true, canRedo: true }), changed: (_context, next) => { confirmed = next; } });
  await h.controller.sync(); const result = await h.controller.change({ operation: 'redo' });
  assert.equal(result.canRedo, true); assert.equal(confirmed, result); assert.equal(h.view, result);
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
test('multiple native dirty refreshes during a read coalesce into one latest read-only refresh', async t => {
  const first = deferred(); let reads = 0;
  const h = harness(t, { read: (_context, frame) => ++reads === 1 ? first.promise : state(frame) });
  const pending = h.controller.sync(); await settle();
  h.nativeTime = 13; h.controller.refresh(); h.controller.refresh(); h.controller.refresh();
  assert.equal(h.reads.length, 1); first.resolve(state(0)); await pending; await settle();
  assert.deepEqual(h.reads.map(read => read.frame), [0, 72]); assert.equal(h.view.frame, 72); assert.equal(h.edits.length, 0);
  await settle(); assert.equal(h.reads.length, 2);
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
  const playhead = deferred(); let confirmations = 0;
  const h = harness(t, { getTime: () => ++confirmations === 1 ? 10 : playhead.promise }); await h.controller.sync();
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
function presentationHarness() {
  const derived = source.match(/  const identity=\$derived[^\n]+\n  const displayIdentity=\$derived[^\n]+\n  const shownArea=\$derived[^\n]+\n  const readOnly=\$derived[^\n]+/)?.[0];
  const publish = source.match(/    state:(next=>\{[^\n]+?\}),busy:/)?.[1];
  const clear = source.match(/\$effect\(\(\)=>\{(if\(!visible\|\|!expanded\|\|cachedArea\?\.key!==displayIdentity\)cachedArea=null;)\}\);/)?.[1];
  assert.ok(derived && publish && clear, 'Exercise the component’s actual presentation expressions and state callback');
  const compiled = ts.transpileModule(`type TextAreaState=any;
    let sequenceId='seq',caption={id:'one',clipNodeId:'clip-one',mediaPath:'/one.mov',startTime:10,endTime:14},frameRate=24;
    let visible=true,expanded=true,disabled=false,busy=false,problem='',area=null,cachedArea=null;
    function view(){${derived.replaceAll('$derived(', '(')};return {identity,displayIdentity,shownArea,readOnly};}
    export function publish(next){const {identity,displayIdentity}=view();(${publish})(next);}
    export function update(patch){if(patch.caption)caption=patch.caption;if(patch.sequenceId)sequenceId=patch.sequenceId;if('visible'in patch)visible=patch.visible;if('disabled'in patch)disabled=patch.disabled;if('busy'in patch)busy=patch.busy;if('problem'in patch)problem=patch.problem;const{displayIdentity}=view();${clear}}
    export const state=view;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const api = {}; vm.runInNewContext(compiled, { exports: api }); return api;
}
test('the same clip retains presentation values without edit authority through busy, refresh and failure', () => {
  const h = presentationHarness(); h.publish(state(0)); assert.equal(h.state().readOnly, false);
  h.update({ disabled: true }); h.publish(null);
  assert.equal(h.state().shownArea.tracks.width.value[0], 900); assert.equal(h.state().readOnly, true);
  h.update({ disabled: false, busy: true, caption: { ...context().caption, mediaPath: '/one-refreshed.mov' } });
  assert.equal(h.state().shownArea.frame, 0); assert.equal(h.state().readOnly, true);
  h.update({ busy: false, problem: 'Refresh caption Motion.' }); assert.equal(h.state().shownArea.frame, 0); assert.equal(h.state().readOnly, true);
  h.update({ problem: '' }); h.publish(state(48)); assert.equal(h.state().shownArea.frame, 48); assert.equal(h.state().readOnly, false);
});
test('presentation values cannot cross captions, sequences or hidden-panel lifetimes', () => {
  for (const change of [{ caption: context('two').caption }, { caption: { ...context().caption, clipNodeId: 'replacement-clip' } }, { sequenceId: 'other' }, { visible: false }]) {
    const h = presentationHarness(); h.publish(state(0)); h.update(change); h.publish(null);
    assert.equal(h.state().shownArea, null); assert.equal(h.state().readOnly, true);
    h.update({ visible: true }); assert.equal(h.state().shownArea, null, 'Returning must wait for a fresh native read');
  }
});
test('playhead frames are bounded to the selected caption', () => {
  assert.equal(captionFrame(context(), 2), 0); assert.equal(captionFrame(context(), 100), 95);
});
test('area, agent and export busy owners cannot unlock each other', () => {
  const main = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8');
  const functions = main.match(/  function setTimelineBusy\(busy: boolean\) \{[\s\S]*?\n  function setAgentAreaBusy\(busy: boolean\) \{[^\n]+\}/)?.[0];
  assert.ok(functions, 'Exercise the production busy aggregation functions');
  const compiled = ts.transpileModule(`let exportBusy=false,areaBusy=false,agentAreaBusy=false,timelineBusy=false,automaticReflow=false;const motionWatcher={reset(){}};${functions}\nexport const apply=setTimelineBusy,area=setAreaBusy,agent=setAgentAreaBusy,busy=()=>timelineBusy;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const api = {}; vm.runInNewContext(compiled, { exports: api });
  api.apply(true); api.area(true); api.apply(false); assert.equal(api.busy(), true); api.area(false); assert.equal(api.busy(), false);
  api.area(true); api.apply(true); api.area(false); assert.equal(api.busy(), true); api.apply(false); assert.equal(api.busy(), false);
  api.agent(true); api.area(false); api.apply(false); assert.equal(api.busy(), true); api.agent(false); assert.equal(api.busy(), false);
  api.agent(true); api.apply(true); api.agent(false); assert.equal(api.busy(), true); api.apply(false); assert.equal(api.busy(), false);
});
function selectionHarness(nativeSelect = async () => ({ ok: true, time: 10.2 })) {
  const main = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8');
  const functions = main.match(/  async function seekCaption\(time: number\)[\s\S]*?(?=  async function areaChanged)/)?.[0];
  assert.ok(functions, 'Exercise the production explicit caption-selection action');
  const nativeCalls = [], caption = { id: 'one', clipNodeId: 'clip-one', startTime: 10, endTime: 12, words: [{ startTime: 10, endTime: 10.4 }] };
  const manager = { current: { sequenceId: 'seq', captions: [caption], currentTime: 10 }, setCurrentTime(time) { this.current.currentTime = time; } };
  const nativeAPI = { isDemo: false, showInPremiere: async () => { nativeCalls.push('seek'); }, selectCaptionClip: async () => { nativeCalls.push('select'); return nativeSelect(); } };
  const compiled = ts.transpileModule(`type CaptionItem=any;declare const api:any,sessionManager:any;let timelineBusy=false,selectedId='one',selectionHint=null,error='',nativeSelection=null,selectingCaption=false,selectionRevision=0;const plain=(value:any)=>JSON.parse(JSON.stringify(value)),message=(error:any)=>String(error.message||error),watchRevisionChanged=()=>{},showInPremiere=async(time:number)=>api.showInPremiere(time);${functions}\nexport const select=selectSelectedCaption,state=()=>({selectionHint,error});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = {}; vm.runInNewContext(compiled, { exports: output, api: nativeAPI, sessionManager: manager });
  return { ...output, manager, nativeCalls };
}
test('handle guidance is shown only after an explicit confirmed native selection', async () => {
  const h = selectionHarness(); assert.equal(h.state().selectionHint, null); assert.equal(h.nativeCalls.length, 0);
  await h.select(); assert.deepEqual(h.nativeCalls, ['seek', 'select']);
  assert.deepEqual(clone(h.state().selectionHint), { sequenceId: 'seq', captionId: 'one' }); assert.equal(h.state().error, '');
});
test('selection callback failures remain visible and do not show handle guidance', async () => {
  for (const callback of [async () => { throw new Error('Native selection failed'); }, async () => ({ ok: false })]) {
    const h = selectionHarness(callback); await h.select();
    assert.equal(h.state().selectionHint, null); assert.match(h.state().error, /selection/i);
  }
});
test('a selection reply from an old sequence cannot show handle guidance', async () => {
  const pending = deferred(), h = selectionHarness(() => pending.promise); const selecting = h.select(); await settle();
  h.manager.current = { ...h.manager.current, sequenceId: 'other' }; pending.resolve({ ok: true, time: 10.2 }); await selecting;
  assert.equal(h.state().selectionHint, null);
});
