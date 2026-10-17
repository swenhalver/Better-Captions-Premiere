import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript');
const code = ts.transpileModule(readFileSync(new URL('../webview-ui/src/lib/program-monitor.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const output = {};
vm.runInNewContext(code, { exports: output, setTimeout, clearTimeout, Date });
const { captionLinks, createCaptionSelectionSync, panelVisibilityMessage, startProgramMonitorWatcher } = output;
function fixture(t) {
  let clock = 0, context = { sequenceId: 'sequence', captionId: 'caption-1', clipNodeId: 'clip-1', savedSignature: 'size-100' };
  let signature = 'size-100', reads = 0, applies = 0, readError = false, applyError = false;
  const statuses = [];
  const watcher = startProgramMonitorWatcher({ autoStart: false, now: () => clock, current: () => context,
    readSignature: async () => { reads++; if (readError) throw new Error('Read failed'); return signature; },
    apply: async () => { applies++; if (applyError) throw new Error('Render failed'); }, onStatus: value => statuses.push(value),
  });
  t.after(() => watcher.stop());
  return { watcher, statuses, get applies() { return applies; }, get reads() { return reads; }, set context(value) { context = value; }, get context() { return context; },
    set signature(value) { signature = value; }, set clock(value) { clock = value; }, set readError(value) { readError = value; }, set applyError(value) { applyError = value; } };
}
test('selected box reflow waits for stable dimensions and renders once', async t => {
  const f = fixture(t); await f.watcher.tick();
  f.signature = 'size-120'; await f.watcher.tick(); assert.equal(f.applies, 0);
  f.clock = 749; await f.watcher.tick(); assert.equal(f.applies, 0);
  f.clock = 750; await f.watcher.tick(); assert.equal(f.applies, 1);
  f.clock = 1500; await f.watcher.tick(); assert.equal(f.applies, 1);
});
test('continued resizing resets the quiet interval and position-only signatures do nothing', async t => {
  const f = fixture(t); await f.watcher.tick(); await f.watcher.tick(); assert.equal(f.applies, 0);
  f.signature = 'size-110'; await f.watcher.tick();
  f.clock = 600; f.signature = 'size-120'; await f.watcher.tick();
  f.clock = 1000; await f.watcher.tick(); assert.equal(f.applies, 0);
  f.clock = 1350; await f.watcher.tick(); assert.equal(f.applies, 1);
});
test('busy, demo or unlinked contexts do not poll', async t => {
  const f = fixture(t); f.context = null; await f.watcher.tick(); assert.equal(f.reads, 0); assert.equal(f.applies, 0);
});
test('a failed render is not retried until dimensions change or the user updates', async t => {
  const f = fixture(t); await f.watcher.tick(); f.signature = 'size-120'; await f.watcher.tick();
  f.applyError = true; f.clock = 750; await f.watcher.tick(); assert.equal(f.applies, 1);
  f.clock = 1500; await f.watcher.tick(); assert.equal(f.applies, 1);
  f.applyError = false; f.signature = 'size-130'; await f.watcher.tick();
  f.clock = 2250; await f.watcher.tick(); assert.equal(f.applies, 2);
  assert.ok(f.statuses.some(status => status.phase === 'error'));
});
test('a read failure pauses polling until explicit reset', async t => {
  const f = fixture(t); f.readError = true; await f.watcher.tick(); await f.watcher.tick(); assert.equal(f.reads, 1);
  f.readError = false; f.watcher.reset(); await f.watcher.tick(); assert.equal(f.reads, 2);
});
test('updated saved render signatures become the baseline without feedback loops', async t => {
  const f = fixture(t); await f.watcher.tick(); f.signature = 'size-120'; f.context = { ...f.context, savedSignature: 'size-120' };
  await f.watcher.tick(); f.clock = 1500; await f.watcher.tick(); assert.equal(f.applies, 0);
});
test('selection changes discard a stale native read before any rendering', async () => {
  let resolveRead, context = { sequenceId: 'first', captionId: 'one', clipNodeId: 'node', savedSignature: 'old' }, applies = 0;
  const watcher = startProgramMonitorWatcher({ autoStart: false, current: () => context, readSignature: () => new Promise(resolve => { resolveRead = resolve; }), apply: async () => { applies++; }, onStatus() {} });
  const pending = watcher.tick(); context = { ...context, sequenceId: 'second' }; resolveRead('new'); await pending;
  assert.equal(applies, 0); watcher.stop();
});
test('stopping discards outstanding native reads', async () => {
  let resolveRead, applies = 0;
  const watcher = startProgramMonitorWatcher({ autoStart: false, current: () => ({ sequenceId: 'one', captionId: 'one', clipNodeId: 'one', savedSignature: 'old' }), readSignature: () => new Promise(resolve => { resolveRead = resolve; }), apply: async () => { applies++; }, onStatus() {} });
  const pending = watcher.tick(); watcher.stop(); resolveRead('new'); await pending; assert.equal(applies, 0);
});
const selectionContext = () => ({ sequenceId: 'sequence', revision: 0, captions: [
  { id: 'caption-1', clipNodeId: 'clip-1', projectItemId: 'item-1', mediaPath: '/one.mov' },
  { id: 'caption-2', clipNodeId: 'clip-2', projectItemId: 'item-2', mediaPath: '/two.mov' },
] });
test('native caption selection is followed before reading its box profile', async () => {
  const context = selectionContext();
  let selected = 'caption-1', native = null;
  const motionReads = [];
  const selection = createCaptionSelectionSync({ current: () => context,
    read: async () => ({ ok: true, captionId: 'caption-2', clipNodeId: 'clip-2', time: 4.25 }),
    accept(value) { native = value; selected = value.captionId; },
  });
  const watcher = startProgramMonitorWatcher({ autoStart: false, beforeRead: () => selection.sync(),
    current: () => native?.captionId ? { sequenceId: context.sequenceId, captionId: selected, clipNodeId: native.clipNodeId, savedSignature: 'size-100' } : null,
    readSignature: async value => { motionReads.push(value.captionId); return 'size-100'; },
    apply: async () => assert.fail('Selection alone must not render'), onStatus() {},
  });
  await watcher.tick();
  assert.equal(selected, 'caption-2'); assert.equal(native.time, 4.25); assert.deepEqual(motionReads, ['caption-2']);
  selection.stop(); watcher.stop();
});
test('none or multiple native selections pause box reads without clearing transcript selection', async () => {
  const context = selectionContext(); let selected = 'caption-1', native = null, reads = 0;
  const selection = createCaptionSelectionSync({ current: () => context,
    read: async () => ({ ok: true, captionId: null, time: 2 }), accept(value) { native = value; if (value.captionId) selected = value.captionId; },
  });
  const watcher = startProgramMonitorWatcher({ autoStart: false, beforeRead: () => selection.sync(),
    current: () => native?.captionId ? { sequenceId: context.sequenceId, captionId: selected, clipNodeId: native.clipNodeId } : null,
    readSignature: async () => { reads++; return 'size-100'; }, apply: async () => {}, onStatus() {},
  });
  await watcher.tick(); assert.equal(selected, 'caption-1'); assert.equal(reads, 0);
  selection.stop(); watcher.stop();
});
test('selection and box polling share one async mutex', async () => {
  let resolveSelection, selectionReads = 0, boxReads = 0;
  const watcher = startProgramMonitorWatcher({ autoStart: false,
    beforeRead: () => { selectionReads++; return new Promise(resolve => { resolveSelection = resolve; }); },
    current: () => ({ sequenceId: 'sequence', captionId: 'caption-1', clipNodeId: 'clip-1' }),
    readSignature: async () => { boxReads++; return 'size-100'; }, apply: async () => {}, onStatus() {},
  });
  const pending = watcher.tick(); await watcher.tick(); assert.equal(selectionReads, 1); assert.equal(boxReads, 0);
  resolveSelection(); await pending; assert.equal(boxReads, 1); watcher.stop();
});
test('sequence, busy state and newer panel selections discard stale native selection reads', async () => {
  for (const change of ['sequence', 'busy', 'revision']) {
    let context = selectionContext(), resolveSelection, accepted = 0;
    const selection = createCaptionSelectionSync({ current: () => context,
      read: () => new Promise(resolve => { resolveSelection = resolve; }), accept() { accepted++; },
    });
    const pending = selection.sync();
    if (change === 'sequence') context = { ...context, sequenceId: 'other-sequence' };
    if (change === 'busy') context = null;
    if (change === 'revision') context = { ...context, revision: 1 };
    resolveSelection({ ok: true, captionId: 'caption-2', clipNodeId: 'clip-2', time: 4 }); await pending;
    assert.equal(accepted, 0, change); selection.stop();
  }
});
test('native selection must match a saved linked caption and valid time', async () => {
  const context = selectionContext(); let accepted = 0;
  for (const value of [
    { ok: true, captionId: 'caption-2', clipNodeId: 'wrong-node', time: 4 },
    { ok: true, captionId: 'unknown', clipNodeId: 'clip-2', time: 4 },
    { ok: true, captionId: 'caption-2', clipNodeId: 'clip-2', time: NaN },
  ]) {
    const selection = createCaptionSelectionSync({ current: () => context, read: async () => value, accept() { accepted++; } });
    await assert.rejects(selection.sync()); selection.stop();
  }
  assert.equal(accepted, 0);
});
test('ineligible or stopped selection followers do not adopt native results', async () => {
  let context = null, reads = 0, accepted = 0, resolveSelection;
  const selection = createCaptionSelectionSync({ current: () => context,
    read: () => { reads++; return new Promise(resolve => { resolveSelection = resolve; }); }, accept() { accepted++; },
  });
  await selection.sync(); assert.equal(reads, 0);
  context = selectionContext(); const pending = selection.sync(); selection.stop();
  resolveSelection({ ok: true, captionId: 'caption-2', clipNodeId: 'clip-2', time: 4 }); await pending; assert.equal(accepted, 0);
});
test('hiding then showing the panel invalidates its outstanding native selection read', async () => {
  let context = selectionContext(), accepted = 0, resolveSelection;
  const selection = createCaptionSelectionSync({ current: () => context,
    read: () => new Promise(resolve => { resolveSelection = resolve; }), accept() { accepted++; },
  });
  const pending = selection.sync(); context = null; selection.invalidate(); context = selectionContext();
  resolveSelection({ ok: true, captionId: 'caption-2', clipNodeId: 'clip-2', time: 4 }); await pending;
  assert.equal(accepted, 0); selection.stop();
});
test('selection payloads contain linked identities without transcript or frame sample data', () => {
  const links = captionLinks([
    { ...selectionContext().captions[0], text: 'private words', words: [{ text: 'private' }], motionProfile: { signature: 'full', samples: [{ time: 4, scaleX: 1, scaleY: 1 }] } },
    { id: 'unlinked', text: 'not on the timeline' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(links)), [selectionContext().captions[0]]);
});
test('only explicit host panel visibility messages are accepted', () => {
  assert.equal(panelVisibilityMessage({ type: 'better-captions-panel-visibility', visible: false }), false);
  assert.equal(panelVisibilityMessage('{"type":"better-captions-panel-visibility","visible":true}'), true);
  for (const value of [null, [], 'invalid json', { visible: true }, { type: 'other', visible: false }, { type: 'better-captions-panel-visibility', visible: 'true' }]) assert.equal(panelVisibilityMessage(value), null);
});
test('selection failures stop all native polling until reset or a new revision', async () => {
  let selectionReads = 0, boxReads = 0;
  const watcher = startProgramMonitorWatcher({ autoStart: false,
    beforeRead: async () => { selectionReads++; throw new Error('Native selection is unavailable'); },
    current: () => ({ sequenceId: 'sequence', captionId: 'caption-1', clipNodeId: 'clip-1' }),
    readSignature: async () => { boxReads++; return 'size-100'; }, apply: async () => {}, onStatus() {},
  });
  watcher.notifyRevision(1); await watcher.tick(); await watcher.tick();
  assert.equal(selectionReads, 1); assert.equal(boxReads, 0);
  watcher.setVisible(false); watcher.setVisible(true); await watcher.tick(); assert.equal(selectionReads, 1);
  watcher.notifyRevision(1); await watcher.tick(); assert.equal(selectionReads, 1);
  watcher.notifyRevision(2); await watcher.tick(); assert.equal(selectionReads, 2);
  watcher.reset(); await watcher.tick(); assert.equal(selectionReads, 3); watcher.stop();
});
test('geometry read failures stop selection polling as well', async () => {
  let selectionReads = 0, boxReads = 0;
  const watcher = startProgramMonitorWatcher({ autoStart: false, beforeRead: async () => { selectionReads++; },
    current: () => ({ sequenceId: 'sequence', captionId: 'caption-1', clipNodeId: 'clip-1' }),
    readSignature: async () => { boxReads++; throw new Error('Geometry failed'); }, apply: async () => {}, onStatus() {},
  });
  await watcher.tick(); await watcher.tick(); assert.equal(selectionReads, 1); assert.equal(boxReads, 1); watcher.stop();
});
function timerFixture() {
  const timers = new Map(); let next = 0;
  const loaded = {};
  vm.runInNewContext(code, { exports: loaded, Date,
    setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  return { start: loaded.startProgramMonitorWatcher, timers,
    fire() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
    async settle() { for (let index = 0; index < 20; index++) await Promise.resolve(); },
  };
}
test('hidden panels clear timers and drop pending geometry results', async () => {
  const f = timerFixture(); let resolveRead, reads = 0, applies = 0;
  const watcher = f.start({ current: () => ({ sequenceId: 'sequence', captionId: 'caption-1', clipNodeId: 'clip-1', savedSignature: 'size-100' }),
    readSignature: () => { reads++; return new Promise(resolve => { resolveRead = resolve; }); }, apply: async () => { applies++; }, onStatus() {},
  });
  assert.equal(f.timers.size, 1); watcher.setVisible(false); assert.equal(f.timers.size, 0);
  await watcher.tick(); assert.equal(reads, 0);
  watcher.setVisible(true); f.fire(); assert.equal(reads, 1); assert.equal(f.timers.size, 0);
  watcher.setVisible(false); resolveRead('size-120'); await f.settle();
  assert.equal(f.timers.size, 0); assert.equal(applies, 0); watcher.stop();
});
test('unresolved calls never schedule timer retries, including after hide, show or reset', async () => {
  const f = timerFixture(); let resolveSelection, reads = 0;
  const watcher = f.start({ beforeRead: () => { reads++; return new Promise(resolve => { resolveSelection = resolve; }); },
    current: () => null, readSignature: async () => assert.fail('No caption is selected'), apply: async () => {}, onStatus() {},
  });
  f.fire(); assert.equal(reads, 1); assert.equal(f.timers.size, 0);
  watcher.setVisible(false); watcher.setVisible(true); watcher.reset(); watcher.notifyRevision(2);
  await watcher.tick(); assert.equal(reads, 1); assert.equal(f.timers.size, 0);
  resolveSelection(); await f.settle(); assert.equal(f.timers.size, 1); watcher.stop(); assert.equal(f.timers.size, 0);
});
test('automatic selection failures leave no retry timer until a user revision', async () => {
  const f = timerFixture(); let reads = 0;
  const watcher = f.start({ beforeRead: async () => { reads++; throw new Error('Service unavailable'); },
    current: () => null, readSignature: async () => assert.fail('Selection failed'), apply: async () => {}, onStatus() {},
  });
  f.fire(); await f.settle(); assert.equal(reads, 1); assert.equal(f.timers.size, 0);
  watcher.setVisible(false); watcher.setVisible(true); assert.equal(f.timers.size, 0);
  watcher.notifyRevision(3); assert.equal(f.timers.size, 1);
  f.fire(); await f.settle(); assert.equal(reads, 2); assert.equal(f.timers.size, 0); watcher.stop();
});
