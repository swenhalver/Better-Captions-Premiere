import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(new URL('../webview-ui/src/lib/export/program-monitor.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {}; vm.runInNewContext(code, { exports });
const captions = [
  { id: 'first', startTime: 0, endTime: 1.5, words: [{ startTime: .1, endTime: .6 }] },
  { id: 'selected', startTime: 2, endTime: 3, words: [{ startTime: 2.1, endTime: 2.7 }] },
];
const options = { frameRate: 24, duration: 4, currentTime: 0, selectedId: 'selected' };

test('refresh preserves the actual Premiere caption frame despite a stale panel time', async () => {
  const calls = [], api = { getActiveSequenceInfo: async () => ({ id: 'sequence', playhead: 13 / 24 }), showInPremiere: async (...args) => calls.push(args) };
  const time = await exports.refreshProgramMonitor(api, captions, 'sequence', options);
  assert.equal(time, 13 / 24); assert.deepEqual(calls, [[14 / 24, 'sequence'], [13 / 24, 'sequence']]);
});
test('a playhead outside captions selects a spoken frame rather than the caption fade-in start', () => {
  const result = exports.programMonitorPosition(captions, 3.5, { ...options, currentTime: 3.5 });
  assert.ok(result.time > 2.1 && result.time < 2.7); assert.ok(result.time > captions[1].startTime + .15);
});
test('refresh rejects a changed active sequence before seeking', async () => {
  let sought = false; const api = { getActiveSequenceInfo: async () => ({ id: 'other', playhead: .5 }), showInPremiere: async () => { sought = true; } };
  await assert.rejects(exports.refreshProgramMonitor(api, captions, 'sequence', options), /active sequence changed/); assert.equal(sought, false);
});
test('a failed native seek is returned instead of reporting a successful Program Monitor refresh', async () => {
  const api = { getActiveSequenceInfo: async () => ({ id: 'sequence', playhead: .5 }), showInPremiere: async () => { throw new Error('Premiere refused seek'); } };
  await assert.rejects(exports.refreshProgramMonitor(api, captions, 'sequence', options), /Premiere refused seek/);
});
test('refresh at the final frame jogs backwards and returns to the same frame', () => {
  const [caption] = [{ id: 'end', startTime: 3, endTime: 4, words: [{ startTime: 3, endTime: 4 }] }];
  const result = exports.programMonitorPosition([caption], 95 / 24, options);
  assert.equal(result.time, 95 / 24); assert.equal(result.refreshTime, 94 / 24);
});
test('a frame-aligned leading gap advances inside speech instead of showing an empty pop/typewriter frame', () => {
  const phrase = { id: 'first', startTime: 0, endTime: 1, words: [{ startTime: .04, endTime: .5 }] };
  const result = exports.programMonitorPosition([phrase], 0, options);
  assert.ok(result.time >= .04 && result.time < .5);
});
