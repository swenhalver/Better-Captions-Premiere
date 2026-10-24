import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
function fixture(apply) {
  let time = 0, next = 0, context = { sequenceId: 'one', signature: 'first', needed: true, ready: true };
  const timers = new Map(), statuses = [], calls = [], exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL('../webview-ui/src/lib/live-output.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, Date, setTimeout: (fn, delay) => { timers.set(++next, { fn, at: time + delay }); return next; }, clearTimeout: id => timers.delete(id) });
  let superseded = 0;
  const controller = exports.createLiveOutput({ current: () => context, now: () => time, debounce: 400,
    apply: async captured => { calls.push(captured.signature); await apply?.(captured); }, supersede: () => superseded++, onStatus: status => statuses.push(status) });
  async function advance(ms) {
    time += ms;
    for (let count = 0; count < 50; count++) {
      for (let flush = 0; flush < 8; flush++) await Promise.resolve();
      const due = [...timers].find(([, task]) => task.at <= time);
      if (!due) { await Promise.resolve(); await Promise.resolve(); if (![...timers.values()].some(task => task.at <= time)) break; else continue; }
      timers.delete(due[0]); due[1].fn(); await Promise.resolve(); await Promise.resolve();
    }
  }
  return { controller, calls, statuses, advance, get superseded() { return superseded; }, get context() { return context; }, set context(value) { context = value; } };
}
test('rapid edits coalesce into one latest render after editing pauses', async () => {
  const h = fixture(); h.controller.notify(); await h.advance(200);
  h.context = { ...h.context, signature: 'latest' }; h.controller.notify();
  await h.advance(399); assert.deepEqual(h.calls, []); await h.advance(1); assert.deepEqual(h.calls, ['latest']);
  await h.advance(5000); assert.deepEqual(h.calls, ['latest']); h.controller.stop();
});
test('new edits supersede an in-flight render and serialize the next version', async () => {
  let release; const h = fixture(() => new Promise(resolve => { release = resolve; }));
  h.controller.notify(); await h.advance(400); assert.deepEqual(h.calls, ['first']);
  h.context = { ...h.context, signature: 'new' }; h.controller.notify(); await h.advance(2000);
  assert.equal(h.superseded, 1); assert.deepEqual(h.calls, ['first']); release(); await h.advance(0);
  assert.deepEqual(h.calls, ['first', 'new']); h.controller.stop(); release();
});
test('a pending native read never permits another output call until availability returns', async () => {
  let attempts = 0;
  const h = fixture(() => { if (++attempts === 1) { h.context = { ...h.context, ready: false }; throw Object.assign(new Error('waiting'), { code: 'BC_NATIVE_PENDING', method: 'readTimeline', recoverable: true }); } });
  h.controller.notify(); await h.advance(400); await h.advance(2000); assert.equal(attempts, 1);
  h.context = { ...h.context, ready: true }; h.controller.notify(); await h.advance(500);
  assert.equal(attempts, 2); h.controller.stop();
});
test('an uncertain native mutation is never replayed, even after edits or ready notifications', async () => {
  const h = fixture(() => { throw Object.assign(new Error('uncertain write'), { code: 'BC_NATIVE_PENDING', recoverable: false }); });
  h.controller.notify(); await h.advance(400); h.context = { ...h.context, signature: 'another edit' }; h.controller.notify(); await h.advance(10000);
  assert.equal(h.calls.length, 1); assert.equal(h.controller.diagnostics().blocked, true); h.controller.stop();
});
test('a mutation timeout cannot authorize replay with a malformed recoverable flag', async () => {
  const h = fixture(() => { throw Object.assign(new Error('mutation timeout'), { code: 'BC_NATIVE_PENDING', method: 'applyCaptionClips', recoverable: true }); });
  h.controller.notify(); await h.advance(400);
  h.context = { ...h.context, signature: 'next edit' }; h.controller.notify(); await h.advance(5000);
  assert.equal(h.calls.length, 1); assert.equal(h.controller.diagnostics().blocked, true); h.controller.stop();
});
test('post-commit uncertainty stays visible even after the links are saved', async () => {
  const h = fixture(() => {
    h.context = { ...h.context, needed: false };
    throw Object.assign(new Error('Placement needs verification'), { code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false });
  });
  h.controller.notify(); await h.advance(400); h.controller.notify(); await h.advance(5000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.statuses.at(-1).phase, 'error'); assert.match(h.statuses.at(-1).message, /verification/);
  h.controller.stop();
});
test('uncertainty in the old sequence cannot strand queued work for a different sequence', async () => {
  let reject;
  const h = fixture(context => context.sequenceId === 'one' ? new Promise((_, no) => reject = no) : undefined);
  h.controller.notify(); await h.advance(400);
  h.context = { ...h.context, sequenceId: 'two', signature: 'other' }; h.controller.notify(); await h.advance(400);
  reject(Object.assign(new Error('Old placement needs verification'), { code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false }));
  await h.advance(0); assert.deepEqual(h.calls, ['first', 'other']);
  h.context = { ...h.context, sequenceId: 'one', signature: 'edited old caption' }; h.controller.notify(); await h.advance(5000);
  assert.deepEqual(h.calls, ['first', 'other']); assert.match(h.statuses.at(-1).message, /Old placement/);
  h.controller.stop();
});
test('unavailable, hidden, busy and unchanged sessions do not start output', async () => {
  const h = fixture(); h.context = { ...h.context, ready: false }; h.controller.notify(); await h.advance(4000); assert.equal(h.calls.length, 0);
  h.context = { ...h.context, ready: true, needed: false }; h.controller.notify(); await h.advance(4000); assert.equal(h.calls.length, 0); h.controller.stop();
});
test('stopping cancels scheduled work and a superseded render is not shown as an error', async () => {
  const h = fixture(() => { throw Object.assign(new Error('replaced'), { code: 'BC_RENDER_SUPERSEDED' }); });
  h.controller.notify(); h.context = { ...h.context, needed: false }; await h.advance(400);
  assert.equal(h.calls.length, 0); h.context = { ...h.context, needed: true }; h.controller.notify(); h.controller.stop(); await h.advance(5000); assert.equal(h.calls.length, 0);
});

test('verified current readback settles an uncertain write without replay and permits a later fresh edit', async () => {
  let attempts = 0;
  const h = fixture(() => { if (++attempts === 1) throw Object.assign(new Error('Readback was uncertain'), { code: 'BC_OUTPUT_UNCONFIRMED' }); });
  h.controller.notify(); await h.advance(400);
  assert.equal(h.controller.diagnostics().blocked, true);
  // The caller has adopted the document independently read from the host.
  h.context = { ...h.context, signature: 'host-confirmed', needed: false };
  assert.equal(h.controller.confirmReadback('one', 'host-confirmed'), true);
  await h.advance(10000);
  assert.deepEqual(h.calls, ['first']);
  assert.equal(h.controller.diagnostics().blocked, false);
  assert.equal(h.statuses.at(-1).phase, 'idle');
  h.context = { ...h.context, signature: 'fresh edit', needed: true }; h.controller.notify();
  await h.advance(400); await h.advance(5000);
  assert.deepEqual(h.calls, ['first', 'fresh edit']); h.controller.stop();
});

test('readback for another sequence, obsolete signature or unapplied edits cannot release a blocked write', async () => {
  const h = fixture(() => { throw Object.assign(new Error('uncertain'), { code: 'BC_OUTPUT_UNCONFIRMED' }); });
  h.controller.notify(); await h.advance(400);
  h.context = { ...h.context, needed: false };
  assert.equal(h.controller.confirmReadback('other', 'first'), false);
  assert.equal(h.controller.confirmReadback('one', 'obsolete'), false);
  h.context = { ...h.context, signature: 'unsaved edit', needed: true };
  assert.equal(h.controller.confirmReadback('one', 'unsaved edit'), false);
  h.controller.notify(); await h.advance(10000);
  assert.equal(h.controller.diagnostics().blocked, true);
  assert.deepEqual(h.calls, ['first']); h.controller.stop();
});

test('readback cannot settle an operation still running or suppress its later uncertainty', async () => {
  let reject;
  const h = fixture(() => new Promise((_, no) => { reject = no; }));
  h.controller.notify(); await h.advance(400);
  h.context = { ...h.context, needed: false };
  assert.equal(h.controller.confirmReadback('one', 'first'), false);
  reject(Object.assign(new Error('late uncertain response'), { code: 'BC_OUTPUT_UNCONFIRMED' }));
  await h.advance(0);
  assert.equal(h.controller.diagnostics().blocked, true);
  assert.equal(h.statuses.at(-1).phase, 'error');
  assert.equal(h.controller.confirmReadback('one', 'first'), true);
  await h.advance(10000); assert.deepEqual(h.calls, ['first']); h.controller.stop();
});

test('verified readback clears only its own sequence and cannot unblock another project context', async () => {
  const h = fixture();
  h.controller.block('one', 'First sequence requires verification');
  h.controller.block('two', 'Other sequence requires verification');
  h.context = { ...h.context, needed: false };
  assert.equal(h.controller.confirmReadback('one', 'first'), true);
  assert.equal(h.statuses.at(-1).phase, 'idle');
  assert.equal(h.controller.diagnostics().blocked, true);
  h.context = { sequenceId: 'two', signature: 'other edit', needed: true, ready: true };
  h.controller.notify(); await h.advance(10000);
  assert.deepEqual(h.calls, []); assert.match(h.statuses.at(-1).message, /Other sequence/);
  assert.equal(h.controller.confirmReadback('one', 'first'), false); h.controller.stop();
});
test('after the layer is read back (Premiere Undo), returning to an earlier written state writes it again', async () => {
  const h = fixture(); h.controller.notify(); await h.advance(400);
  assert.deepEqual(h.calls, ['first']);
  // Premiere Undo: the editor adopts the older layer, so nothing is needed.
  h.context = { ...h.context, signature: 'older', needed: false }; h.controller.forget(); await h.advance(400);
  // The user (or a typing restore) brings back exactly the state written before.
  h.context = { ...h.context, signature: 'first', needed: true }; h.controller.notify(); await h.advance(400);
  assert.deepEqual(h.calls, ['first', 'first']);
  h.controller.stop();
});
