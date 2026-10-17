import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const uiRequire = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = uiRequire('typescript');
const source = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const transport = ts.transpileModule(source('webview-ui/src/webview-setup.ts'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    emit(type, value) { for (const handler of handlers.get(type) || []) void handler(value); },
    count(type) { return handlers.get(type)?.size || 0; },
  };
}
function harness(t, nativeOverrides = {}) {
  const hostWindow = events(), uiWindow = events(), frame = events(), sequenceEvents = new Map();
  const timers = new Map(), calls = [], replies = [], logs = [];
  const schedule = (callback, ms) => { const timer = setTimeout(callback, ms); timers.set(timer,{callback,ms}); return timer; };
  const cancel = timer => { timers.delete(timer); clearTimeout(timer); };
  const logger = { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) };
  let setup, proxy, stops = 0, activated = 0, closed = 0, theme = 0;
  const status = { textContent: '', style: {} };
  const state = { sequenceId: 'native-sequence', captions: [], style: { fontSize: 64 } };
  const native = {
    async getActiveSequenceInfo() { calls.push(['getActiveSequenceInfo']); return { id: 'native-sequence', name: 'Native Premiere sequence' }; },
    async fetchTranscriptJSON(id) { calls.push(['fetchTranscriptJSON', id]); return '{"segments":[]}'; },
    async transcribeSequence(id) { calls.push(['transcribeSequence', id]); return '{"segments":[{"words":[]}]}'; },
    async getFonts() { return ['Arial']; },
    async getColorScheme() { return { theme: 'darkest', colors: {} }; },
    async saveSession() { throw new Error('Save the Premiere project first.'); },
    async startAgentBridge(value) { proxy = value; return async () => { stops++; }; },
    async exec() { throw new Error('The RPC allowlist must block this method.'); },
    ...nativeOverrides,
  };
  frame.postMessage = message => { replies.push(message); uiWindow.emit('message', { data: message }); };
  const hostContext = {
    require(name) {
      if (name === 'uxp') return { entrypoints: { setup(value) { setup = value; } } };
      if (name === 'premierepro') return { Constants: { SequenceEvent: { ACTIVATED: 'activated', CLOSED: 'closed' } }, EventManager: { addGlobalEventListener(name, callback) { sequenceEvents.set(name, callback); }, removeGlobalEventListener(name) { sequenceEvents.delete(name); } } };
      if (name === './api.js') return { createHostAPI: () => native };
      throw new Error('Unexpected native dependency: ' + name);
    },
    window: hostWindow,
    document: {
      createElement(name) { assert.equal(name, 'webview'); return frame; },
      getElementById(id) { return id === 'caption-host-status' ? status : { appendChild(element) { assert.equal(element, frame); } }; },
    },
    console: logger, setTimeout: schedule, clearTimeout: cancel, Map, Set,
  };
  vm.runInNewContext(source('uxp/main.js'), hostContext);
  // Deliberately model only Adobe's documented uxpHost.postMessage surface.
  // Incoming webview messages arrive on window, never on uxpHost.
  uiWindow.uxpHost = {
    postMessage(message) { hostWindow.emit('message', { data: message, source: frame }); },
  };
  const exported = {};
  const uiContext = {
    exports: exported,
    require(name) {
      if (name === './cep-api') return { createHostAPI() { throw new Error('Native transport incorrectly selected CEP.'); } };
      if (name === './lib/agent-bridge') return { startAgentBridge() { throw new Error('Native transport incorrectly selected the CEP bridge.'); } };
      throw new Error('Unexpected UI dependency: ' + name);
    },
    window: uiWindow, console: logger, setTimeout: schedule, clearTimeout: cancel, Map, Set,
  };
  vm.runInNewContext(transport, uiContext);
  const { api } = exported.initWebview({ onSequenceActivated() { activated++; }, onSequenceClosed() { closed++; }, updateColorScheme() { theme++; } });
  const handler = {
    getState() { return state; },
    async patchStyle(patch) { Object.assign(state.style, patch); return state; },
    async patchAnimation(patch) { return patch; },
    async setCaptions(captions) { state.captions = captions; return state; },
    async refresh() { return state; },
    async apply() { return { applied: true }; },
  };
  const stop = api.startAgentBridge(handler);
  t.after(async () => { stop(); await setup.plugin.destroy(); for (const timer of timers.keys()) clearTimeout(timer); });
  return { api, frame, status, setup, state, calls, replies, logs, hostWindow, uiWindow, sequenceEvents,
    proxy: () => proxy, stops: () => stops, counters: () => ({ activated, closed, theme }), stop,
    fireTimeout(ms) { const found=[...timers].find(([,value])=>value.ms===ms);assert.ok(found,'expected timeout '+ms);cancel(found[0]);found[1].callback(); },
    runBootstrap() { vm.runInNewContext(source('webview-ui/public/bootstrap.js'), { window: uiWindow, Date }); },
  };
}

test('native UXP transport runs with only uxpHost.postMessage and preserves request arguments/errors', async t => {
  const app = harness(t);
  assert.equal(app.api.isDemo, false);
  assert.equal((await app.api.getActiveSequenceInfo()).id, 'native-sequence');
  assert.equal(await app.api.fetchTranscriptJSON('native-sequence'), '{"segments":[]}');
  await app.api.transcribeSequence('native-sequence');
  assert.deepEqual(app.calls.at(-1), ['transcribeSequence', 'native-sequence']);
  await assert.rejects(app.api.saveSession({}), /Save the Premiere project first/);
  assert.equal(app.uiWindow.uxpHost.addEventListener, undefined);
});

test('the packaged panel ID and explicit viewport layout match the native webview container', t => {
  const app = harness(t);
  assert.ok(app.setup.panels.betterCaptions);
  assert.equal(app.frame.src, 'plugin:/client/index.html');
  const html = source('uxp/index.html');
  assert.match(html, /height: 100vh/);
  assert.match(html, /\.caption-host__webview \{ position: absolute; top: 0; left: 0; width: 100vw; height: 100vh/);
  assert.match(html, /id="caption-host-status"/);
});

test('native-to-editor agent calls round trip asynchronously', async t => {
  const app = harness(t);
  await tick();
  const proxy = app.proxy();
  assert.ok(proxy);
  assert.equal((await proxy.getState()).sequenceId, 'native-sequence');
  await proxy.patchStyle({ fontSize: 88 });
  assert.equal(app.state.style.fontSize, 88);
  assert.equal((await proxy.apply()).applied, true);
  assert.equal(app.status.style.display, 'none');
});

test('host method allowlist rejects unrelated native functions and ignores other webviews', async t => {
  const app = harness(t);
  app.hostWindow.emit('message', { source: app.frame, data: { channel: 'better-captions', id: 'ui-denied', method: 'exec', args: [] } });
  app.hostWindow.emit('message', { source: {}, data: { channel: 'better-captions', id: 'ui-other-source', method: 'getActiveSequenceInfo', args: [] } });
  await tick();
  assert.match(app.replies.find(reply => reply.id === 'ui-denied').error.message, /Unsupported Premiere caption method/);
  assert.equal(app.replies.some(reply => reply.id === 'ui-other-source'), false);
});

test('sequence and theme events use documented window messaging', async t => {
  const app = harness(t);
  app.sequenceEvents.get('activated')(); app.sequenceEvents.get('closed')();
  app.frame.emit('loadstop', {});
  await tick();
  assert.deepEqual(app.counters(), { activated: 1, closed: 1, theme: 1 });
});

test('bootstrap, load and CSP errors reach a visible native status without relaxing CSP', async t => {
  const app = harness(t);
  await tick();
  app.frame.emit('loaderror', { code: -1001, message: 'Local editor page failed.' });
  assert.match(app.status.textContent, /Local editor page failed.*-1001/);
  app.runBootstrap();
  app.uiWindow.emit('error', { message: 'Module import failed.' });
  await tick();
  assert.match(app.status.textContent, /Module import failed/);
  app.uiWindow.emit('securitypolicyviolation', { violatedDirective: 'script-src', blockedURI: 'plugin:/wrong.js' });
  await tick();
  assert.match(app.status.textContent, /Content security policy blocked script-src/);
  assert.match(source('webview-ui/index.html'), /script-src 'self'/);
  assert.doesNotMatch(source('webview-ui/index.html'), /unsafe-eval/);
  assert.match(source('webview-ui/index.html'), /src="\.\/bootstrap\.js"/);
});

test('hiding the panel preserves hooks; plugin destruction and UI unmount clean up their own listeners', async t => {
  const app = harness(t);
  await tick();
  app.setup.panels.betterCaptions.hide();
  assert.equal(app.stops(), 0);
  app.stop();
  assert.equal(app.uiWindow.count('message'), 0);
  await app.setup.plugin.destroy();
  assert.equal(app.stops(), 1);
  assert.equal(app.hostWindow.count('message'), 0);
  // Avoid calling the plugin destroy hook a second time in the fixture cleanup.
  app.setup.plugin.destroy = async () => {};
});
test('native panel visibility reaches the editor on readiness and every show or hide',async t=>{
  const app=harness(t);const visible=[];
  app.uiWindow.addEventListener('message',event=>{if(event.data?.type==='better-captions-panel-visibility')visible.push(event.data.visible);});
  await tick();assert.equal(visible.at(-1),false,'readiness repeats the current hidden state after the UI listener exists');
  app.setup.panels.betterCaptions.show();app.setup.panels.betterCaptions.hide();
  assert.deepEqual(visible.slice(-2),[true,false]);assert.equal(app.stops(),0,'visibility pauses polling without removing authorized agent hooks');
});
test('a lost frontend read response trips a circuit instead of issuing overlapping native calls',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const app=harness(t,{readCaptionGeometry:()=>gate});await tick();
  const read=app.api.readCaptionGeometry([],'native-sequence');await tick();app.fireTimeout(15000);
  await assert.rejects(read,/timeout did not cancel/);const calls=app.calls.length;
  await assert.rejects(app.api.getActiveSequenceInfo(),/previous Premiere read has not returned/);assert.equal(app.calls.length,calls);
  finish({ok:true,cues:[]});await tick();assert.equal((await app.api.getActiveSequenceInfo()).id,'native-sequence');
});
