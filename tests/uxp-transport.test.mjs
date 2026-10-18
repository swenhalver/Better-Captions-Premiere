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
  let nativeAvailability={version:1,revision:0,state:'ready',method:null,reason:'idle'};
  const nativeObservers=new Set();
  const native = {
    getTransportAvailability() { return {...nativeAvailability}; },
    onTransportAvailability(listener) { nativeObservers.add(listener);listener({...nativeAvailability});return ()=>nativeObservers.delete(listener); },
    async getActiveSequenceInfo() { calls.push(['getActiveSequenceInfo']); return { id: 'native-sequence', name: 'Native Premiere sequence' }; },
    async fetchTranscriptJSON(id) { calls.push(['fetchTranscriptJSON', id]); return '{"segments":[]}'; },
    async transcribeSequence(id) { calls.push(['transcribeSequence', id]); return '{"segments":[{"words":[]}]}'; },
    async getFonts() { return ['Arial']; },
    async getFontCatalog() { return [{family:'Arial',weights:[400,700],italic:true}]; },
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
    handler, proxy: () => proxy, stops: () => stops, counters: () => ({ activated, closed, theme }), stop,
    availability(status) { nativeAvailability={...status};for(const listener of nativeObservers)listener({...status}); },
    availabilityObservers:()=>nativeObservers.size,
    fireTimeout(ms) { const found=[...timers].find(([,value])=>value.ms===ms);assert.ok(found,'expected timeout '+ms);cancel(found[0]);found[1].callback(); },
    runBootstrap() { vm.runInNewContext(source('webview-ui/public/bootstrap.js'), { window: uiWindow, Date }); },
  };
}

test('font catalog metadata and explicit system errors round trip through both fixed native allowlists',async t=>{
  const expected=[{family:'Literal, 字體',weights:[380,400.444,617],italic:false,variable:{min:380,max:617}}];
  let calls=0;
  const app=harness(t,{async getFontCatalog(){calls++;if(calls===2)throw new Error('System font enumeration is unavailable.');return expected;}});
  assert.deepEqual(JSON.parse(JSON.stringify(await app.api.getFontCatalog())),expected);
  await assert.rejects(app.api.getFontCatalog(),/System font enumeration is unavailable/);assert.equal(calls,2);
  assert.deepEqual(Array.from(await app.api.getFonts()),['Arial'],'the original family-name method remains available');
});
test('preset library reads and writes round trip through the bounded UXP allowlist', async t => {
  const library = { version: 1, revision: 3, presets: [] };
  const app = harness(t, { async loadStylePresets() { return library; }, async saveStylePresets(value) { assert.equal(value.revision, 3); return { ...value, revision: 4 }; } });
  assert.deepEqual(await app.api.loadStylePresets(), library);
  assert.equal((await app.api.saveStylePresets(library)).revision, 4);
});

test('legacy conversion round trips through the panel while internal stage and removal endpoints remain private',async t=>{
 const previous=[{id:'old-a'},{id:'old-b'}],caption={id:'bundle'},plan={ok:true,version:1,signature:'native-proof'};
 const app=harness(t,{
  async readCaptionConsolidation(captions,id){assert.deepEqual(captions,previous);assert.equal(id,'native-sequence');return plan;},
  async applyConsolidatedCaption(c,old,proof,id){assert.deepEqual(c,caption);assert.deepEqual(old,previous);assert.deepEqual(proof,plan);assert.equal(id,'native-sequence');return {ok:true,cues:[{id:'bundle'}]};},
 });
 assert.deepEqual(await app.api.readCaptionConsolidation(previous,'native-sequence'),plan);
 assert.equal((await app.api.applyConsolidatedCaption(caption,previous,plan,'native-sequence')).ok,true);
 for(const method of ['stageCaptionConsolidation','rollbackCaptionConsolidation','verifyCaptionConsolidation']){
  assert.equal(typeof app.api[method],'undefined');
  const id='ui-blocked-'+method;app.hostWindow.emit('message',{data:{channel:'better-captions',id,method,args:[]},source:app.frame});await tick();
  assert.match(app.replies.find(reply=>reply.id===id)?.error?.message,/Unsupported/i);
 }
});

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
  for(const method of ['getTransportAvailability','onTransportAvailability']){
    const id='ui-local-only-'+method;
    app.hostWindow.emit('message',{source:app.frame,data:{channel:'better-captions',id,method,args:[]}});await tick();
    assert.match(app.replies.find(reply=>reply.id===id)?.error?.message,/Unsupported Premiere caption method/,'availability helpers are local observers, never RPC methods');
  }
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
  assert.equal(app.availabilityObservers(),0,'plugin destruction removes its native availability subscription');
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
  await assert.rejects(app.api.getActiveSequenceInfo(),error=>error.code==='BC_NATIVE_WAITING'&&error.recoverable===true&&error.operationPending===true);assert.equal(app.calls.length,calls);
  finish({ok:true,cues:[]});await tick();assert.equal((await app.api.getActiveSequenceInfo()).id,'native-sequence');
});
test('native timeout availability reaches the editor and its real completion wakes subscribers without retrying work',async t=>{
  const app=harness(t);await tick();const statuses=[];
  const unsubscribe=app.api.onTransportAvailability(status=>statuses.push(status));
  assert.equal(app.api.getTransportAvailability().state,'ready');assert.equal(app.availabilityObservers(),1);
  const calls=app.calls.length;
  app.availability({version:1,revision:1,state:'waiting',method:'readCaptionSelection',reason:'native-timeout'});await tick();
  assert.equal(statuses.at(-1).state,'waiting');assert.equal(statuses.at(-1).method,'readCaptionSelection');
  await assert.rejects(app.api.saveSession({}),{code:'BC_NATIVE_WAITING'});assert.equal(app.calls.length,calls);
  app.availability({version:1,revision:2,state:'ready',method:null,reason:'idle'});await tick();
  assert.deepEqual(statuses.map(status=>status.state),['ready','waiting','ready']);assert.equal(app.calls.length,calls,'ready is a notification, never a replay');
  assert.equal((await app.api.getActiveSequenceInfo()).id,'native-sequence');
  unsubscribe();const count=statuses.length;
  app.availability({version:1,revision:3,state:'waiting',method:'readCaptionSelection',reason:'native-timeout'});await tick();assert.equal(statuses.length,count);
});
test('all late read IDs must return before a native-ready event can reopen the webview circuit',async t=>{
  let finishGeometry,finishSelection;const geometry=new Promise(resolve=>{finishGeometry=resolve;}),selection=new Promise(resolve=>{finishSelection=resolve;});
  const app=harness(t,{readCaptionGeometry:()=>geometry,readCaptionSelection:()=>selection});await tick();
  const statuses=[];app.api.onTransportAvailability(status=>statuses.push(status));
  const a=app.api.readCaptionGeometry([],'native-sequence'),b=app.api.readCaptionSelection([],'native-sequence');await tick();
  app.fireTimeout(15000);app.fireTimeout(15000);await assert.rejects(a,{code:'BC_NATIVE_PENDING'});await assert.rejects(b,{code:'BC_NATIVE_PENDING'});
  app.availability({version:1,revision:1,state:'waiting',method:'readCaptionSelection',reason:'native-timeout'});await tick();
  finishGeometry({ok:true,cues:[]});await tick();
  app.availability({version:1,revision:2,state:'ready',method:null,reason:'idle'});await tick();
  assert.equal(app.api.getTransportAvailability().state,'waiting');assert.equal(app.api.getTransportAvailability().reason,'panel-timeout');
  app.frame.postMessage({channel:'better-captions',id:'ui-unrelated',result:{ok:true}});await tick();
  await assert.rejects(app.api.getActiveSequenceInfo(),{code:'BC_NATIVE_WAITING'});
  finishSelection({ok:true,captionId:null});await tick();
  assert.equal(app.api.getTransportAvailability().state,'ready');assert.equal(statuses.filter(status=>status.state==='ready').length,2);
  assert.equal((await app.api.getActiveSequenceInfo()).id,'native-sequence');
});
test('an ambiguous mutation timeout cannot be retried or released by a generic availability event',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});let applies=0;
  const app=harness(t,{applyCaptionClips:()=>{applies++;return gate;}});await tick();
  const write=app.api.applyCaptionClips([],0,'native-sequence');await tick();app.fireTimeout(30*60*1000);
  await assert.rejects(write,error=>error.code==='BC_NATIVE_PENDING'&&error.method==='applyCaptionClips'&&error.recoverable===false&&error.operationPending===true);
  app.availability({version:1,revision:1,state:'ready',method:null,reason:'idle'});await tick();
  await assert.rejects(app.api.applyCaptionClips([],0,'native-sequence'),{code:'BC_NATIVE_WAITING'});assert.equal(applies,1);
  finish({ok:true,cues:[]});await tick();assert.equal(app.api.getTransportAvailability().state,'ready');assert.equal(applies,1);
});
test('only validated monotonic availability notifications change the lane and close remains terminal',async t=>{
  const app=harness(t);await tick();const statuses=[];
  app.api.onTransportAvailability(status=>{statuses.push({...status});status.state='closed';});
  const message=status=>app.frame.postMessage({channel:'better-captions',type:'better-captions-native-availability',...status});
  message({version:1,revision:10,state:'waiting',method:'readCaptionSelection',reason:'native-timeout'});
  for(const invalid of [
    {version:1,revision:9,state:'ready',method:null,reason:'idle'},
    {version:1,revision:10,state:'ready',method:null,reason:'idle'},
    {version:2,revision:11,state:'ready',method:null,reason:'idle'},
    {version:1,revision:11,state:'ready',method:'readCaptionSelection',reason:'idle'},
    {version:1,revision:Infinity,state:'ready',method:null,reason:'idle'},
    {version:1,revision:11,state:'waiting',method:'exec',reason:'native-timeout'},
  ])message(invalid);
  assert.equal(app.api.getTransportAvailability().state,'waiting');assert.equal(statuses.length,2);
  message({version:1,revision:11,state:'ready',method:null,reason:'idle'});assert.equal(app.api.getTransportAvailability().state,'ready');
  message({version:1,revision:12,state:'closed',method:null,reason:'closed'});message({version:1,revision:13,state:'ready',method:null,reason:'idle'});
  assert.equal(app.api.getTransportAvailability().state,'closed');await assert.rejects(app.api.getActiveSequenceInfo(),{code:'BC_NATIVE_CLOSED'});
});
test('structured transport errors preserve safe retry evidence while mutation timeouts stay nonrecoverable',async t=>{
  const failure=(method,recoverable)=>Object.assign(new Error('The native operation is still running.'),{code:'BC_NATIVE_PENDING',method,recoverable,operationPending:true,privateDetails:'never serialize'});
  const app=harness(t,{readCaptionSelection:async()=>{throw failure('readCaptionSelection',true);},applyCaptionClips:async()=>{throw failure('applyCaptionClips',true);}});await tick();
  await assert.rejects(app.api.readCaptionSelection([],'native-sequence'),error=>error.code==='BC_NATIVE_PENDING'&&error.recoverable===true&&error.operationPending===true&&error.privateDetails===undefined);
  await assert.rejects(app.api.applyCaptionClips([],0,'native-sequence'),error=>error.code==='BC_NATIVE_PENDING'&&error.recoverable===false&&error.operationPending===true);
  assert.equal(app.api.getTransportAvailability().state,'ready','an error never fabricates native completion or a new replay');
});

test('fixed area agent requests round trip as data while the internal CEP patch stays private', async t => {
  const app = harness(t); await tick();
  const calls = [], caption = { captionId: 'cue' }, edit = { captionId: 'cue', operation: 'set', track: 'width', value: [65] };
  app.handler.readArea = async payload => { calls.push(['read', payload]); return { signature: 'native-read' }; };
  app.handler.editArea = async payload => { calls.push(['edit', payload]); return { signature: 'native-edited' }; };
  assert.equal((await app.proxy().readArea(caption)).signature, 'native-read');
  assert.equal((await app.proxy().editArea(edit)).signature, 'native-edited');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['read', caption], ['edit', edit]]);
  assert.equal(app.api.patchCaptionKeyValues, undefined, 'The mutation helper is not a public webview host API');
  app.hostWindow.emit('message', { source: app.frame, data: { channel: 'better-captions', id: 'ui-private-patch', method: 'patchCaptionKeyValues', args: [] } });
  await tick(); assert.match(app.replies.find(reply => reply.id === 'ui-private-patch').error.message, /Unsupported Premiere caption method/);
  delete app.handler.editArea;
  await assert.rejects(app.proxy().editArea(edit), /Caption area editing is unavailable/);
});
