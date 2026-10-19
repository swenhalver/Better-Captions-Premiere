import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../webview-ui/src/lib/program-monitor.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const pendingRead = method => Object.assign(new Error('The original native read is still running.'), {
  code: 'BC_NATIVE_PENDING', method, recoverable: true, operationPending: true,
});
const uncertainWrite = () => Object.assign(new Error('Premiere has not confirmed the caption write.'), {
  code: 'BC_NATIVE_PENDING', method: 'applyCaptionClips', recoverable: false, operationPending: true,
});
function fixture(t, options = {}) {
  let time = 0, next = 0, context = { sequenceId: 'one', captionId: 'cue', clipNodeId: 'node', savedSignature: 'original' };
  let signature = 'original', available = true, beforeRead = options.beforeRead, read = options.read, apply = options.apply;
  const timers = new Map(), statuses = [], reads = [], writes = [], selections = [];
  const output = {};
  vm.runInNewContext(source, { exports: output, Date,
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const watcher = output.startProgramMonitorWatcher({
    autoStart: options.autoStart ?? false, interval: 100, stableFor: 200, now: () => time,
    current: () => available ? context : null,
    async beforeRead() { if (!available) return; selections.push(context?.sequenceId); await beforeRead?.(); },
    async readSignature(captured) { reads.push(captured); return read ? read(captured) : signature; },
    async apply(captured) { writes.push(captured); await apply?.(captured); },
    onStatus(status) { statuses.push(status); },
  });
  t.after(() => watcher.stop());
  async function settle() { for (let count = 0; count < 30; count++) await Promise.resolve(); }
  async function advance(ms) {
    time += ms;
    for (let count = 0; count < 100; count++) {
      await settle();
      const due = [...timers].find(([, task]) => task.at <= time);
      if (!due) return;
      timers.delete(due[0]); due[1].callback();
    }
    assert.fail('The watcher scheduled an unbounded timer loop.');
  }
  return { watcher, statuses, reads, writes, selections, timers, advance, settle,
    set available(value) { available = value; },
    set context(value) { context = value; }, get context() { return context; },
    set signature(value) { signature = value; },
    set beforeRead(value) { beforeRead = value; },
    set read(value) { read = value; },
    set apply(value) { apply = value; },
  };
}

test('a typed selection timeout waits for native availability and resumes automatically without overlapping its late operation', async t => {
  const f = fixture(t, { autoStart: true });
  let nativeBusy = false, timedOut = false;
  f.beforeRead = () => {
    assert.equal(nativeBusy, false, 'another native operation must not start before the late response');
    if (!timedOut) { timedOut = true; nativeBusy = true; f.available = false; throw pendingRead('readCaptionSelection'); }
  };
  await f.advance(100); assert.equal(f.selections.length, 1); assert.equal(f.reads.length, 0);
  assert.equal(f.statuses.at(-1).phase, 'waiting');
  await f.advance(5000); assert.equal(f.selections.length, 1); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  nativeBusy = false; f.available = true; f.watcher.reset();
  await f.advance(100); assert.equal(f.selections.length, 2); assert.equal(f.reads.length, 1);
  f.signature = 'changed'; await f.advance(100); await f.advance(200);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].sequenceId, 'one');
});

test('known unstarted geometry reads recover automatically but untyped failures remain paused', async t => {
  const f = fixture(t, { autoStart: true }); let failed = false;
  f.read = () => { if (!failed) { failed = true; throw Object.assign(new Error('Queued read never started.'), { code: 'BC_NATIVE_QUEUE_EXPIRED', method: 'readCaptionGeometry', recoverable: true, operationPending: false }); } return 'original'; };
  await f.advance(100); assert.equal(f.reads.length, 1); assert.equal(f.statuses.at(-1).phase, 'waiting');
  await f.advance(1499); assert.equal(f.reads.length, 1);
  await f.advance(1); await f.advance(100); assert.equal(f.reads.length, 2);
  f.read = () => { throw new Error('The caption identity changed.'); };
  await f.advance(100); const count = f.reads.length;
  await f.advance(10000); assert.equal(f.reads.length, count); assert.equal(f.statuses.at(-1).phase, 'error');
});

test('a reflow rejected by a known read or an unstarted native request retries after bounded recovery', async t => {
  for (const failure of [pendingRead('readCaptionMotion'),
    Object.assign(new Error('Native queue is busy.'), { code: 'BC_NATIVE_BUSY', method: 'applyCaptionClips', recoverable: true, operationPending: false }),
    Object.assign(new Error('Renderer has not started.'), { code: 'BC_RENDERER_UNAVAILABLE', method: 'applyCaptionClips', recoverable: true, operationPending: false }),
  ]) {
    const f = fixture(t, { autoStart: true }); let attempts = 0;
    f.apply = () => { if (++attempts === 1) throw failure; };
    await f.advance(100); f.signature = 'changed'; await f.advance(100); await f.advance(200);
    assert.equal(f.writes.length, 1); assert.equal(f.statuses.at(-1).phase, 'waiting');
    await f.advance(1499); assert.equal(f.writes.length, 1);
    await f.advance(1); await f.advance(100); await f.advance(200);
    assert.equal(f.writes.length, 2); assert.equal(f.statuses.at(-1).phase, 'ready');
    await f.advance(5000); assert.equal(f.writes.length, 2); f.watcher.stop();
  }
});

test('an availability reset retires the old read-recovery timer instead of invalidating a fresh native read', async t => {
  const f = fixture(t);
  f.read = () => { throw pendingRead('readCaptionGeometry'); };
  await f.watcher.tick(); assert.equal(f.timers.size, 1);
  let finishRead; f.read = () => new Promise(resolve => { finishRead = resolve; });
  f.watcher.reset(); const read = f.watcher.tick();
  await f.advance(1500); finishRead('changed'); await read;
  assert.equal(f.watcher.diagnostics().lastObserved, 'changed', 'an obsolete recovery timer must not discard the new native result');
  assert.equal(f.watcher.diagnostics().candidate, 'changed'); assert.equal(f.writes.length, 0);
});

test('recovery resets and visibility changes cannot overlap an unresolved selection or geometry read', async t => {
  for (const phase of ['selection', 'geometry']) {
    const f = fixture(t); let finish, active = 0, peak = 0;
    const read = () => { active++; peak = Math.max(peak, active); return new Promise(resolve => { finish = value => { active--; resolve(value); }; }); };
    if (phase === 'selection') f.beforeRead = read; else f.read = read;
    const first = f.watcher.tick(); await f.settle();
    f.watcher.reset(); f.watcher.notifyRevision('new-input'); f.watcher.setVisible(false); f.watcher.setVisible(true);
    await f.watcher.tick(); await f.advance(10000); assert.equal(peak, 1); assert.equal(active, 1);
    finish('original'); await first; assert.equal(f.writes.length, 0); assert.equal(active, 0);
  }
});

test('a stale geometry failure cannot schedule recovery or overwrite the newly selected caption state', async t => {
  const f = fixture(t); let rejectRead;
  f.read = () => new Promise((resolve, reject) => { rejectRead = reject; });
  const read = f.watcher.tick(); await f.settle();
  f.context = { ...f.context, captionId: 'new-cue', clipNodeId: 'new-node' };
  rejectRead(pendingRead('readCaptionGeometry')); await read;
  assert.equal(f.timers.size, 0); assert.equal(f.watcher.diagnostics().readPaused, false);
  f.read = () => 'original'; await f.watcher.tick();
  assert.equal(f.reads.at(-1).captionId, 'new-cue'); assert.equal(f.writes.length, 0);
});

test('an uncertain native write is never replayed after availability, revisions or newly changed geometry', async t => {
  const f = fixture(t); f.apply = () => { throw uncertainWrite(); };
  await f.watcher.tick(); f.signature = 'changed'; await f.watcher.tick();
  await f.advance(200); await f.watcher.tick(); assert.equal(f.writes.length, 1);
  f.apply = async () => {}; f.watcher.reset(); f.watcher.notifyRevision('another-edit');
  f.signature = 'changed-again'; await f.watcher.tick(); await f.advance(200); await f.watcher.tick();
  assert.equal(f.writes.length, 1, 'an availability wake cannot authorize replay of the sequence after an uncertain write');
  f.context = { ...f.context, sequenceId: 'two' }; f.watcher.notifyRevision('another-sequence');
  await f.watcher.tick(); await f.advance(200); await f.watcher.tick(); assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].sequenceId, 'two');
  f.context = { ...f.context, sequenceId: 'one' }; f.watcher.notifyRevision('return-to-uncertain-sequence');
  await f.watcher.tick(); await f.advance(200); await f.watcher.tick(); assert.equal(f.writes.length, 2);
});

test('a write that becomes uncertain while context is unavailable is remembered before its late error is discarded', async t => {
  const f = fixture(t); let failWrite;
  f.apply = () => new Promise((resolve, reject) => { failWrite = reject; });
  await f.watcher.tick(); f.signature = 'changed'; await f.watcher.tick(); await f.advance(200);
  const applying = f.watcher.tick(); await f.settle(); assert.equal(f.writes.length, 1);
  f.available = false; failWrite(uncertainWrite()); await applying;
  f.available = true; f.apply = async () => {}; f.watcher.reset();
  await f.watcher.tick(); await f.advance(200); await f.watcher.tick();
  assert.equal(f.writes.length, 1, 'the waiting context cannot hide an uncertain write from the replay guard');
});

test('post-commit verification failures and incorrectly flagged mutation timeouts remain blocked across resets', async t => {
  for (const failure of [
    Object.assign(new Error('Native output was placed but its verification failed.'), { code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: true }),
    Object.assign(new Error('A mutation timeout cannot be a safe read.'), { code: 'BC_NATIVE_PENDING', method: 'applyCaptionClips', recoverable: true, operationPending: true }),
  ]) {
    const f = fixture(t); f.apply = () => { throw failure; };
    await f.watcher.tick(); f.signature = 'changed'; await f.watcher.tick(); await f.advance(200); await f.watcher.tick();
    assert.equal(f.writes.length, 1); assert.equal(f.statuses.at(-1).phase, 'error');
    f.apply = async () => {}; f.watcher.reset(); f.signature = 'new-size';
    await f.watcher.tick(); await f.advance(10000); await f.watcher.tick();
    assert.equal(f.writes.length, 1); assert.equal(f.watcher.diagnostics().mutationPaused, true);
  }
});
