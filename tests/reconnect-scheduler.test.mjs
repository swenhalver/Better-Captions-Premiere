import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
function fixture(inspect = async () => {}) {
  let now = 0, next = 0, ready = true, calls = 0;
  const timers = new Map(), errors = [], exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../webview-ui/src/lib/reconnect.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { exports, setTimeout(fn, delay) { timers.set(++next, { fn, at: now + delay }); return next; }, clearTimeout(id) { timers.delete(id); } });
  const controller = exports.startCaptionReconnect({ ready: () => ready, inspect: async () => { calls++; await inspect(); }, onError: error => errors.push(error), interval: 2500 });
  async function advance(ms) {
    now += ms;
    for (let count = 0; count < 40; count++) {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const due = [...timers].find(([, value]) => value.at <= now);
      if (!due) return;
      timers.delete(due[0]); due[1].fn();
    }
    throw new Error('Reconnect scheduler did not settle.');
  }
  return { controller, advance, errors, get calls() { return calls; }, set ready(value) { ready = value; } };
}
test('reconnection periodically discovers changes without requiring a refresh click', async () => {
  const h = fixture(); await h.advance(2499); assert.equal(h.calls, 0);
  await h.advance(1); assert.equal(h.calls, 1);
  await h.advance(2500); assert.equal(h.calls, 2); h.controller.stop();
});
test('transport and visibility gates prevent background native requests and resume on notification', async () => {
  const h = fixture(); h.ready = false; await h.advance(10000); assert.equal(h.calls, 0);
  h.controller.notify(); await h.advance(0); assert.equal(h.calls, 0);
  h.ready = true; h.controller.notify(); await h.advance(0); assert.equal(h.calls, 1); h.controller.stop();
});
test('a slow read keeps ownership despite repeated context and visibility notifications', async () => {
  let release; const h = fixture(() => new Promise(resolve => { release = resolve; }));
  h.controller.notify(); await h.advance(0); assert.equal(h.calls, 1);
  for (let i = 0; i < 5; i++) { h.controller.notify(); await h.advance(10000); }
  assert.equal(h.calls, 1); assert.equal(h.controller.diagnostics().inFlight, true);
  release(); await h.advance(0); assert.equal(h.calls, 2);
  h.controller.stop(); release();
});
test('failed reads back off and successful recovery restores ordinary polling', async () => {
  let failure = true; const h = fixture(async () => { if (failure) throw new Error('Native read unavailable'); });
  h.controller.notify(); await h.advance(0); assert.equal(h.calls, 1);
  await h.advance(2500); assert.equal(h.calls, 2);
  await h.advance(4999); assert.equal(h.calls, 2);
  failure = false; await h.advance(1); assert.equal(h.calls, 3);
  await h.advance(2500); assert.equal(h.calls, 4); assert.equal(h.errors.length, 2); h.controller.stop();
});
test('stopping an in-flight read does not restart it or deliver late failures', async () => {
  let reject; const h = fixture(() => new Promise((_, no) => { reject = no; }));
  h.controller.notify(); await h.advance(0); h.controller.stop();
  reject(new Error('Late read')); await h.advance(60000); h.controller.notify(); await h.advance(60000);
  assert.equal(h.calls, 1); assert.equal(h.errors.length, 0); assert.equal(h.controller.diagnostics().stopped, true);
});
