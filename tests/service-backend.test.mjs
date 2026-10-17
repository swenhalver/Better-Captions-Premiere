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
function options(t, api) { const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'better-captions-service-'))); t.after(() => fs.rmSync(temporary, { recursive: true, force: true })); return { api, fs, path, os, crypto, process, root: path.join(temporary, 'service'), intervalMs: 60000 }; }
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
test('text-box rendering and selection use captured identity without accepting a caller-supplied sequence', async () => {
  const calls = [], caption = { id: 'cue', clipNodeId: 'node', projectItemId: 'item', mediaPath: '/generated/caption.mov' };
  const bounds = { x: 100, y: 500, width: 400, height: 300, frameWidth: 720, frameHeight: 1280 };
  const api = {
    getActiveSequenceInfo: info,
    finishCaption: (...args) => calls.push(['finish', ...args]),
    selectCaptionClip: (...args) => calls.push(['select', ...args]),
    readCaptionMotion: (...args) => calls.push(['motion', ...args]),
  };
  await service.dispatchServiceRequest(api, request('finishCaption', ['/managed/folder', 24, 48, bounds]));
  await service.dispatchServiceRequest(api, request('selectCaptionClip', [caption]));
  await service.dispatchServiceRequest(api, request('readCaptionMotion', [[caption]]));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['finish', '/managed/folder', 24, 48, 'seq-a', bounds],
    ['select', caption, 'seq-a'], ['motion', [caption], 'seq-a'],
  ]);
  for (const action of ['selectCaptionClip', 'readCaptionMotion']) {
    const extra = request(action, [caption, 'other-sequence']);
    assert.throws(() => service.validateServiceRequest(extra, extra.id + '.json'), /arguments/);
  }
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
test('an expired queued read is discarded before any native context or geometry call',async t=>{
  let calls=0;const api={getActiveSequenceInfo:async()=>{calls++;return info('seq-a');},readCaptionGeometry:()=>{calls++;}};
  const worker=service.startBackendService(options(t,api));t.after(worker.stop);
  const data=request('readCaptionGeometry',[[]]);data.createdAt=Date.now()-11000;data.expiresAt=data.createdAt+10000;
  const input=writeRequest(worker.root,data);await worker.poll();
  assert.equal(calls,0);assert.equal(fs.existsSync(input),false);
  const response=JSON.parse(fs.readFileSync(path.join(worker.root,'responses',data.id+'.json'),'utf8'));
  assert.match(response.error,/expired before execution/);
});
test('one active worker excludes a second instance even for different requests and while stopping an unresolved job',async t=>{
  let calls=0,finish;const gate=new Promise(resolve=>{finish=resolve;});
  const configuration=options(t,{getActiveSequenceInfo:info,getFonts:async()=>{calls++;if(calls===1)await gate;return ['Arial'];}});
  const first=service.startBackendService(configuration);t.after(first.stop);
  writeRequest(first.root,request());const running=first.poll();await new Promise(resolve=>setImmediate(resolve));
  const second=service.startBackendService(configuration);t.after(second.stop);const next=writeRequest(first.root,request());
  await second.poll();assert.equal(second.active,false);assert.equal(calls,1);assert.equal(fs.existsSync(next),true);
  first.stop();await second.poll();assert.equal(second.active,false,'stopping cannot release a worker lock while its native call is unresolved');
  finish();await running;await second.poll();assert.equal(second.active,true);assert.equal(calls,2);
});
test('a poll processes a bounded batch instead of draining a large native request queue',async t=>{
  let calls=0;const worker=service.startBackendService(options(t,{getActiveSequenceInfo:info,getFonts:async()=>{calls++;return ['Arial'];}}));t.after(worker.stop);
  for(let i=0;i<7;i++)writeRequest(worker.root,request());
  await worker.poll();assert.ok(calls>0&&calls<=4);assert.equal(fs.readdirSync(path.join(worker.root,'requests')).filter(name=>name.endsWith('.json')).length,7-calls);
});
test('a crashed worker can be recovered only after its owner process is gone',t=>{
  const configuration=options(t,{getActiveSequenceInfo:info,getFonts:async()=>[]});fs.mkdirSync(configuration.root,{recursive:true});
  fs.writeFileSync(path.join(configuration.root,'worker.lock.json'),JSON.stringify({version:1,instanceId:'a'.repeat(24),pid:2147483647}));
  const worker=service.startBackendService(configuration);t.after(worker.stop);assert.equal(worker.active,true);
  const owner=JSON.parse(fs.readFileSync(path.join(configuration.root,'worker.lock.json'),'utf8'));assert.equal(owner.pid,process.pid);assert.notEqual(owner.instanceId,'a'.repeat(24));
});
test('geometry and opt-in diagnostics preserve captured sequence identity and reject extended read lifetimes',async()=>{
  const calls=[],api={getActiveSequenceInfo:info,readCaptionGeometry:(...args)=>calls.push(['geometry',...args]),readCaptionMotion:(...args)=>calls.push(['motion',...args])};
  await service.dispatchServiceRequest(api,request('readCaptionGeometry',[[{id:'cue'}]]));
  await service.dispatchServiceRequest(api,request('readCaptionMotion',[[{id:'cue'}],{includeDiagnostics:true}]));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['geometry',[{id:'cue'}],'seq-a'],['motion',[{id:'cue'}],'seq-a',{includeDiagnostics:true}]]);
  const data=request('readCaptionGeometry',[[]]);data.expiresAt=data.createdAt+11000;
  assert.throws(()=>service.validateServiceRequest(data,data.id+'.json'),/expired before execution/);
});
