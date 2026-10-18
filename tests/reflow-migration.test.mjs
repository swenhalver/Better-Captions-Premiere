import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const loaded = {};
vm.runInNewContext(transpile(readFileSync(new URL('../webview-ui/src/lib/program-monitor.ts', import.meta.url), 'utf8')), { exports: loaded, setTimeout, clearTimeout, Date });
const { legacyMotionBaseline, legacyMotionIdentity, startProgramMonitorWatcher } = loaded;
const liveOutput = {};
vm.runInNewContext(transpile(readFileSync(new URL('../webview-ui/src/lib/live-output.ts', import.meta.url), 'utf8')), { exports: liveOutput });
const connections = {};
vm.runInNewContext(transpile(readFileSync(new URL('../webview-ui/src/lib/clip-connections.ts', import.meta.url), 'utf8')), { exports: connections, require: () => ({ MAX_NATIVE_CARRIER_BYTES: 16 * 1024 * 1024 }) });
const clone = value => JSON.parse(JSON.stringify(value));
const profile = (signature, x = .99, watchSignature) => ({ signature, ...(watchSignature ? { watchSignature } : {}), samples: [
  { time: .5, scaleX: x, scaleY: .99 }, { time: 1.5, scaleX: x, scaleY: .99 },
] });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function harness(t, options = {}) {
  const caption = { id: 'cue', clipNodeId: 'clip', projectItemId: 'item', mediaPath: '/caption.mov', startTime: 0, endTime: 2,
    text: 'words', words: [], motionProfile: profile('rendered-99') };
  const session = { sequenceId: 'sequence', captions: [caption], hasTranscript: true, isLoading: false, currentTime: .5, frameRate: 1, style: {}, animation: {} };
  const manager = { current: session, sessions: new Map([['sequence', session]]) };
  const document = { hidden: false, visibilityState: 'visible', hasFocus: () => false, activeElement: null };
  let calls = 0;
  const api = { isDemo: false,
    readCaptionMotion: async (items, id) => { calls++; assert.equal(items.length, 1); assert.equal(id, 'sequence'); assert.equal(items[0].motionProfile, undefined, 'Do not send saved per-frame samples back to the host'); return options.read ? options.read(items, id) : { ok: true, cues: [{ id: 'cue', clipNodeId: 'clip', projectItemId: 'item', path: '/caption.mov', motionProfile: profile('live-99', .99, 'geometry-99') }] }; }
  };
  const source = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  // Execute the production controller functions; only Svelte reactivity/mounting are shimmed.
  const extension = `
    export { getState, ensureLegacyBaseline, motionContext, motionPauseReason };
    appliedSignatures[outputKey(sessionManager.current)] = outputSignature(sessionManager.current);
    export function baselineCacheSize() { return legacyBaselines.size; }
    export function setTestState(change) {
      if ('hostPanelVisible' in change) hostPanelVisible = change.hostPanelVisible;
      if ('selectedId' in change) selectedId = change.selectedId;
      if ('nativeSelection' in change) nativeSelection = change.nativeSelection;
      if ('timelineBusy' in change) timelineBusy = change.timelineBusy;
      if ('areaBusy' in change) areaBusy = change.areaBusy;
      if ('reflowStatus' in change) reflowStatus = change.reflowStatus;
    }
  `;
  const exports = {};
  vm.runInNewContext(transpile(source + extension), {
    exports, document, window: {}, HTMLElement: class {},
    $state: Object.assign(value => value, { raw: value => value }), $derived: value => value, $effect() {},
    require(name) {
      if (name === 'svelte') return { onMount() {}, tick: async () => {} };
      if (name === './webview-setup') return { initWebview: () => ({ api }) };
      if (name === './lib/session/manager.svelte') return { sessionManager: manager };
      if (name === './lib/program-monitor') return loaded;
      if (name === './lib/live-output') return liveOutput;
      if (name === './lib/clip-connections') return connections;
      return {};
    }
  });
  exports.setTestState({ selectedId: 'cue', nativeSelection: { sequenceId: 'sequence', captionId: 'cue', clipNodeId: 'clip' } });
  return { ...exports, manager, session, caption, document, get calls() { return calls; } };
}

test('unchanged legacy sample curves receive the live watch baseline without rendering', () => {
  const before = profile('rendered-99'), live = profile('live-99', .99, 'geometry-99');
  assert.deepEqual(clone(legacyMotionBaseline(before, live)), { signature: 'geometry-99', changed: false });
  assert.equal(before.watchSignature, undefined);
});
test('proven legacy width changes retain a rendered baseline for normal stable reflow', async () => {
  let clock = 0, applies = 0;
  const resolved = legacyMotionBaseline(profile('rendered-99'), profile('live-65', .65, 'geometry-65'));
  assert.equal(resolved.changed, true); assert.notEqual(resolved.signature, 'geometry-65');
  const watcher = startProgramMonitorWatcher({ autoStart: false, now: () => clock,
    current: () => ({ sequenceId: 'sequence', captionId: 'cue', clipNodeId: 'clip', savedSignature: resolved.signature }),
    readSignature: async () => 'geometry-65', apply: async () => { applies++; }, onStatus() {},
  });
  await watcher.tick(); assert.equal(applies, 0, 'Initial migration read cannot render');
  clock = 749; await watcher.tick(); assert.equal(applies, 0);
  clock = 750; await watcher.tick(); assert.equal(applies, 1);
  clock = 1500; await watcher.tick(); assert.equal(applies, 1); watcher.stop();
});
test('unknown, incomplete or differently timed legacy profiles require an explicit update', () => {
  const valid = profile('live', .99, 'geometry-99');
  for (const saved of [undefined, { signature: 'old', samples: [] }, { signature: 'old', samples: [valid.samples[0]] },
    { ...profile('old'), samples: [{ time: .6, scaleX: .99, scaleY: .99 }, valid.samples[1]] },
    { ...profile('old'), samples: [{ time: .5, scaleX: NaN, scaleY: 1 }, valid.samples[1]] }]) {
    assert.throws(() => legacyMotionBaseline(saved, valid), /fresh rendered text-box baseline/);
  }
  assert.throws(() => legacyMotionBaseline(profile('old'), { ...valid, watchSignature: undefined }), /fresh rendered text-box baseline/);
});
test('legacy identity includes sequence, media link, timing and saved render signature', () => {
  const original = { id: 'cue', clipNodeId: 'clip', projectItemId: 'item', mediaPath: '/one.mov', startTime: 0, endTime: 2, motionProfile: profile('rendered') };
  const key = legacyMotionIdentity('sequence', original);
  for (const change of [{ clipNodeId: 'other' }, { projectItemId: 'other' }, { mediaPath: '/two.mov' }, { endTime: 3 }, { motionProfile: profile('new-render') }]) assert.notEqual(legacyMotionIdentity('sequence', { ...original, ...change }), key);
  assert.notEqual(legacyMotionIdentity('other-sequence', original), key);
});
test('actual selection controller performs one legacy read and keeps its baseline out of persisted session state', async t => {
  const h = harness(t), before = clone(h.session);
  assert.equal(h.motionContext(), null); assert.equal(h.motionPauseReason(), 'legacy-baseline-unarmed');
  await h.ensureLegacyBaseline(); await h.ensureLegacyBaseline();
  assert.equal(h.calls, 1); assert.equal(h.motionContext().savedSignature, 'geometry-99');
  assert.deepEqual(h.session, before, 'Read-only migration does not save or modify the session');
});
test('actual legacy controller refuses missing saved samples without a native read', async t => {
  const h = harness(t); delete h.caption.motionProfile;
  await assert.rejects(h.ensureLegacyBaseline(), /fresh rendered text-box baseline/);
  await assert.rejects(h.ensureLegacyBaseline(), /fresh rendered text-box baseline/);
  assert.equal(h.calls, 0); assert.equal(h.motionContext(), null);
});
test('a recoverable legacy geometry read keeps its metadata and can succeed after availability returns', async t => {
  const failure = Object.assign(new Error('slow geometry read'), { code: 'BC_NATIVE_PENDING', method: 'readCaptionMotion', recoverable: true });
  let fail = true;
  const h = harness(t, { read: async () => {
    if (fail) throw failure;
    return { ok: true, cues: [{ id: 'cue', clipNodeId: 'clip', projectItemId: 'item', path: '/caption.mov', motionProfile: profile('live', .99, 'geometry-99') }] };
  } });
  await assert.rejects(h.ensureLegacyBaseline(), error => error === failure);
  assert.equal(h.baselineCacheSize(), 0);
  fail = false; await h.ensureLegacyBaseline(); assert.equal(h.calls, 2); assert.equal(h.motionContext().savedSignature, 'geometry-99');
});
test('actual legacy reads validate every returned link before arming automatic reflow', async t => {
  for (const change of [{ clipNodeId: 'other' }, { projectItemId: 'other' }, { path: '/other.mov' }]) {
    const h = harness(t, { read: async () => ({ ok: true, cues: [{ id: 'cue', clipNodeId: 'clip', projectItemId: 'item', path: '/caption.mov', motionProfile: profile('live', .99, 'geometry-99'), ...change }] }) });
    await assert.rejects(h.ensureLegacyBaseline(), /timeline link changed/); assert.equal(h.motionContext(), null);
    await assert.rejects(h.ensureLegacyBaseline(), /timeline link changed/); assert.equal(h.calls, 1, 'Failed identity reads never retry every poll');
  }
});
test('a stale legacy read cannot seed a newly selected caption or another sequence', async t => {
  for (const change of ['selection', 'sequence', 'media']) {
    const pending = deferred(), h = harness(t, { read: () => pending.promise });
    const loading = h.ensureLegacyBaseline();
    if (change === 'selection') h.setTestState({ selectedId: 'other' });
    if (change === 'sequence') h.manager.current = { ...h.session, sequenceId: 'other' };
    if (change === 'media') h.caption.mediaPath = '/replacement.mov';
    pending.resolve({ ok: true, cues: [{ id: 'cue', clipNodeId: 'clip', projectItemId: 'item', path: '/caption.mov', motionProfile: profile('live', .99, 'geometry-99') }] });
    await loading; assert.equal(h.motionContext(), null);
    assert.equal(h.caption.motionProfile.watchSignature, undefined);
  }
});
test('getState diagnostics use the real watcher guards, remain bounded and cannot write back into the session', t => {
  const h = harness(t), original = clone(h.session);
  const first = h.getState(); assert.equal(first.runtime.reflow.pauseReason, 'legacy-baseline-unarmed');
  assert.equal(first.runtime.hasSavedWatchSignature, false);
  first.captions[0].text = 'external'; first.runtime.selectedId = 'external';
  assert.deepEqual(h.session, original); assert.equal(h.getState().runtime.selectedId, 'cue');
  h.setTestState({ hostPanelVisible: false }); assert.equal(h.getState().runtime.reflow.pauseReason, 'host-hidden');
  h.setTestState({ hostPanelVisible: true }); h.document.hidden = true;
  assert.equal(h.getState().runtime.reflow.pauseReason, 'document-hidden');
  h.document.hidden = false; h.setTestState({ timelineBusy: true, areaBusy: true, reflowStatus: { phase: 'error', message: 'x'.repeat(2000) } });
  const busy = h.getState().runtime; assert.equal(busy.reflow.pauseReason, 'timeline-busy'); assert.equal(busy.busy.area, true); assert.equal(busy.reflow.message.length, 1000);
  assert.equal(h.calls, 0); assert.equal(h.session.runtime, undefined);
  h.manager.current = null; assert.equal(h.getState(), null);
});

test('legacy verification cache stays bounded while old identities can be checked again after eviction', async t => {
  const h = harness(t, { read: async items => ({ ok: true, cues: [{ id: items[0].id, clipNodeId: items[0].clipNodeId, projectItemId: items[0].projectItemId, path: items[0].mediaPath, motionProfile: profile('live', .99, 'geometry-99') }] }) });
  for (let index = 0; index < 65; index++) {
    h.caption.mediaPath = `/caption-${index}.mov`; h.caption.motionProfile.signature = `render-${index}`;
    await h.ensureLegacyBaseline();
  }
  assert.equal(h.calls, 65); assert.equal(h.baselineCacheSize(), 64);
  h.caption.mediaPath = '/caption-0.mov'; h.caption.motionProfile.signature = 'render-0';
  await h.ensureLegacyBaseline(); assert.equal(h.calls, 66); assert.equal(h.baselineCacheSize(), 64);
});
test('legacy scale strings and oversized signatures cannot arm reflow', () => {
  const live = profile('live', .99, 'geometry-99');
  for (const saved of [{ ...profile('old'), signature: 'x'.repeat(500000) }, { ...profile('old'), samples: [{ time: .5, scaleX: '.99', scaleY: .99 }, live.samples[1]] }]) {
    assert.throws(() => legacyMotionBaseline(saved, live), /fresh rendered text-box baseline/);
  }
});
