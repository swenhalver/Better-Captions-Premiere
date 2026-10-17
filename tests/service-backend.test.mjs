import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const source = fs.readFileSync(new URL('../cep/service.ts', import.meta.url), 'utf8');
function loadService() {
  const exports = {}, code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, console, setTimeout, setInterval, clearInterval, require: () => ({ createHostAPI: () => { throw new Error('Tests must inject the API'); } }) });
  return exports;
}
const service = loadService();
const request = (action = 'getFonts', args = []) => ({ version: 1, id: crypto.randomBytes(16).toString('hex'), createdAt: Date.now(), sequenceId: 'seq-a', projectPath: '/project/test.prproj', action, args });
function options(t, api) { const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'better-captions-service-'))); t.after(() => fs.rmSync(temporary, { recursive: true, force: true })); return { api, fs, path, os, crypto, root: path.join(temporary, 'service'), intervalMs: 60000 }; }
function writeRequest(root, data) { const file = path.join(root, 'requests', data.id + '.json'); fs.writeFileSync(file, JSON.stringify(data)); return file; }
const info = async id => ({ id, projectPath: '/project/test.prproj' });

test('service rejects arbitrary execution actions, stale timestamps and malformed argument counts', () => {
  for (const action of ['eval', 'exec', 'run', 'shell', 'transcribeSequence', 'saveSession']) {
    const data = request(action); assert.throws(() => service.validateServiceRequest(data, data.id + '.json'), /Unsupported/);
  }
  const expired = request(); expired.createdAt = Date.now() - 120001; assert.throws(() => service.validateServiceRequest(expired, expired.id + '.json'), /expired/);
  const invalidTime = request(); delete invalidTime.createdAt; assert.throws(() => service.validateServiceRequest(invalidTime, invalidTime.id + '.json'), /expired/);
  const invalidArgs = request('beginCaption', ['caption', 'injected-sequence']); assert.throws(() => service.validateServiceRequest(invalidArgs, invalidArgs.id + '.json'), /arguments/);
});
test('service inserts captured sequence identity and preserves previous-caption arguments', async () => {
  const calls = [], api = { getActiveSequenceInfo: info, applyCaptionClips: (...args) => calls.push(args) };
  const data = request('applyCaptionClips', [[{ id: 'cue' }], 2, [{ id: 'old' }]]);
  await service.dispatchServiceRequest(api, data);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[[{ id: 'cue' }], 2, 'seq-a', [{ id: 'old' }]]]);
});
test('a project mismatch is rejected before any timeline method executes', async () => {
  let changed = false; const api = { getActiveSequenceInfo: async () => ({ id: 'seq-a', projectPath: '/other.prproj' }), applyCaptionClips: () => { changed = true; } };
  await assert.rejects(service.dispatchServiceRequest(api, request('applyCaptionClips', [[], 0])), /changed/); assert.equal(changed, false);
});
test('queue claims requests atomically and writes matching private responses', async t => {
  let calls = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const api = { getActiveSequenceInfo: info, getFonts: async () => { calls++; await gate; return ['Arial']; } };
  const configuration = options(t, api), worker = service.startBackendService(configuration); t.after(worker.stop);
  const data = request(), input = writeRequest(worker.root, data), running = worker.poll();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fs.existsSync(input), false, 'request is claimed before awaiting work');
  const second = service.startBackendService(configuration); t.after(second.stop); await second.poll();
  release(); await running; assert.equal(calls, 1);
  const output = path.join(worker.root, 'responses', data.id + '.json'), result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.id, data.id); assert.equal(result.sequenceId, 'seq-a'); assert.equal(result.projectPath, '/project/test.prproj'); assert.deepEqual(result.result, ['Arial']);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600); assert.equal(fs.statSync(worker.root).mode & 0o777, 0o700);
  writeRequest(worker.root, data); await worker.poll(); assert.equal(calls, 1, 'replay uses completed response without executing again');
});
test('symbolic-link queue roots are rejected', t => {
  const configuration = options(t, {}), target = path.join(path.dirname(configuration.root), 'elsewhere'); fs.mkdirSync(target); fs.symlinkSync(target, configuration.root);
  assert.throws(() => service.startBackendService(configuration), /real private directory/);
});
