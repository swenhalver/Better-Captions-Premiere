import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript'),acorn=require('../webview-ui/node_modules/acorn');
const source=fs.readFileSync(new URL('../webview-ui/src/cep-api.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const methods=['context','seek','selectCaptionClip','readCaptionSelection','readCaptionConnections','writeNativeCaptionDocument','createNativeCaptionDocument','readCaptionGeometry','readCaptionMotion','readCaptionAreaDescriptor','patchCaptionKeyValues','preflight','prepareCaptionTrack','apply','readTimeline','readCaptionConsolidation','stageCaptionConsolidation','verifyCaptionConsolidation','rollbackCaptionConsolidation'];
const fixtureRoot=path.resolve(import.meta.dirname,'fixtures','host-readiness');
function fixture(options={}){
 const context={ok:true,id:'seq-a',projectPath:path.join(fixtureRoot,'project','edit.prproj'),width:720,height:1280,fps:24},directory=path.join(fixtureRoot,'data','seq-a'),jobs=new Map(),commands=[],loads=[],nativeCalls=[];
 const extension=options.extension??path.join(fixtureRoot,'extension'),root=extension.startsWith('file:')?fileURLToPath(extension):extension;
 assert.equal(path.isAbsolute(root),true,'the mocked extension root must be absolute on the platform running this test');
 let changes=0,pending=null,clock=0;
 function namespace(legacy=false){return Object.fromEntries(methods.map(method=>[method,(file)=>{nativeCalls.push(method);if(method==='context')return JSON.stringify(context);if(method==='readTimeline')return JSON.stringify({ok:true,cues:(jobs.get(file)?.cues??[]).map(cue=>legacy?{id:cue.id,missing:true}:{id:cue.id,clipNodeId:cue.clipNodeId,projectItemId:cue.projectItemId,path:cue.mediaPath,missing:true})});if(method==='apply'){changes++;return options.ambiguousMutation?'EvalScript error.':JSON.stringify({ok:true,cues:[]});}return JSON.stringify({ok:true});}]));}
 function loadNamespace(file){
  assert.equal(file.fsName,path.join(root,'host','bridge.jsx'),'only the fixed extension-owned script may be loaded');loads.push(file.fsName);
  if(options.loadError)throw Object.assign(new Error(options.loadError),{line:37});
  const loaded=namespace();if(options.incompleteLoad)delete loaded.apply;return loaded;
 }
 const native=vm.createContext({JSON:undefined,File:function(file){this.fsName=file;this.exists=options.missingFile!==true;},$:{evalFile(file){native.BetterCaptionsHost=loadNamespace(file);}},__testLoadedSource(file){
  native.__testLoadedNamespace=loadNamespace(file);return 'var BetterCaptionsHost=__testLoadedNamespace;';
 }});
 native.$.global=vm.runInContext('this',native);
 if(options.ready||options.partial){native.BetterCaptionsHost=namespace(options.partial===true);if(options.partial)delete native.BetterCaptionsHost.readCaptionConsolidation;}
 const readJobPath=path.join(fixtureRoot,'private','read-job.json');
 const runtime={path,directory:()=>directory,writeJSON:(file,data)=>jobs.set(file,data),readJob:data=>{jobs.set(readJobPath,data);return readJobPath;},disposeReadJob:file=>jobs.delete(file),fs:{lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>false}),realpathSync:file=>file}};
 const window={require:name=>name==='node:path'?path:name==='node:url'?{fileURLToPath}:runtime,__adobe_cep__:{getSystemPath:()=>extension,evalScript(script,callback){
  commands.push(script);
  if(script==='"BC_NATIVE_EVAL_V1"'){
   if(options.probeThrows)throw new Error('CEP unavailable');
   return callback(Object.hasOwn(options,'probeRaw')?options.probeRaw:vm.runInContext(script,native));
  }
  if(script.includes('/*better-captions-host-ready-v1*/')){
   acorn.parse(script,{ecmaVersion:3});
   // Direct eval models ExtendScript evalFile's caller-local var declarations;
   // Node's ordinary VM-based evalFile mock otherwise always loads globally.
   const executable=options.scopeLocal?script.replace('$.evalFile(file);','eval(__testLoadedSource(file));'):script;
   if(options.scopeLocal)assert.notEqual(executable,script,'the scope simulation must replace the actual file evaluation');
   const respond=()=>callback(Object.hasOwn(options,'bootstrapRaw')?options.bootstrapRaw:vm.runInContext(executable,native));
   if(options.deferBootstrap)pending=respond;else respond();return;
  }
  if(script.includes('/*better-captions-host-global-v1*/')){
   acorn.parse(script,{ecmaVersion:3});
   if(options.globalThrows)throw new Error('CEP unavailable during global verification');
   return callback(Object.hasOwn(options,'globalRaw')?options.globalRaw:vm.runInContext(script,native));
  }
  callback(vm.runInContext(script,native));
 }}};
 const exports={};vm.runInNewContext(code,{exports,window,console,Date:class extends Date{static now(){return clock;}},require:()=>({})});
 const api=exports.createHostAPI(),caption={id:'cue',text:'caption',startTime:0,endTime:1,mediaPath:path.join(directory,'caption-cue-run','caption.mov')};
 return {api,caption,commands,loads,nativeCalls,native,get changes(){return changes;},advance:ms=>{clock+=ms;},release:()=>{assert.ok(pending);pending();}};
}
test('missing host namespace loads the one owned ES3 bridge once before any native method',async()=>{
 const h=fixture();assert.equal(h.commands.length,0,'initialization stays lazy until a host method is needed');
 await h.api.getActiveSequenceInfo();await h.api.getActiveSequenceInfo();
 assert.deepEqual(h.loads,[path.join(fixtureRoot,'extension','host','bridge.jsx')]);assert.deepEqual(h.nativeCalls,['context','context']);assert.equal(h.commands.filter(script=>script.includes('/*better-captions-host-ready-v1*/')).length,1);assert.equal(h.commands.filter(script=>script.includes('/*better-captions-host-global-v1*/')).length,1);
});
test('a complete namespace is verified without file evaluation, while an incomplete method set is reloaded',async()=>{
 const ready=fixture({ready:true});await ready.api.getActiveSequenceInfo();assert.equal(ready.loads.length,0);
 const partial=fixture({partial:true});await partial.api.getActiveSequenceInfo();assert.equal(partial.loads.length,1);assert.equal(typeof partial.native.BetterCaptionsHost.readCaptionConsolidation,'function');
});
test('caller-local evalFile replaces the stale global bridge before a separate timeline read can run',async()=>{
 const h=fixture({partial:true,scopeLocal:true}),oldGlobal=h.native.BetterCaptionsHost;
 const linked={...h.caption,clipNodeId:'clip-19',projectItemId:'item-7'};
 await h.api.getActiveSequenceInfo();
 const result=await h.api.readTimeline([linked],'seq-a');
 assert.notEqual(h.native.BetterCaptionsHost,oldGlobal,'the new caller-local namespace must be published on the global object');
 assert.equal(h.native.BetterCaptionsHost,h.native.$.global.BetterCaptionsHost);
 assert.deepEqual(JSON.parse(JSON.stringify(result.cues)),[{id:'cue',clipNodeId:'clip-19',projectItemId:'item-7',path:linked.mediaPath,missing:true}],'the separately evaluated read must return the new identity-bearing receipt');
 const verify=h.commands.findIndex(script=>script.includes('/*better-captions-host-global-v1*/'));
 assert.ok(verify>0);assert.ok(h.commands.findIndex(script=>script.startsWith('BetterCaptionsHost.context('))>verify,'no actual native method runs before cross-evaluation verification');
 assert.equal(h.loads.length,1);assert.equal(h.changes,0);
});
test('a local file load also publishes the namespace when no previous global bridge exists',async()=>{
 const h=fixture({scopeLocal:true});await h.api.getActiveSequenceInfo();
 assert.equal(typeof h.native.BetterCaptionsHost.apply,'function');assert.equal(h.loads.length,1);assert.deepEqual(h.nativeCalls,['context']);
});
test('a forged bootstrap success cannot bypass independent global method verification',async()=>{
 for(const partial of [false,true]){
  const h=fixture({partial,bootstrapRaw:'{"version":1,"ok":true,"loaded":true}'});
  const error=await h.api.getActiveSequenceInfo().catch(error=>error);
  assert.equal(error.details.phase,'global verification');assert.match(error.message,/host global readiness/);
  assert.equal(h.nativeCalls.length,0);assert.equal(h.changes,0);
  await assert.rejects(h.api.getActiveSequenceInfo());assert.equal(h.commands.length,3,'failure stays shared during the readiness cooldown');
 }
});
test('malformed or failed global verification stops all host methods with bounded diagnostics',async()=>{
 for(const options of [{globalRaw:'EvalScript error.'},{globalRaw:'"BC_HOST_GLOBAL_READY_V1"'},{globalRaw:undefined},{globalRaw:'z'.repeat(5000)},{globalThrows:true}]){
  const h=fixture(options),error=await h.api.getActiveSequenceInfo().catch(error=>error);
  assert.equal(error.details.phase,'global verification');assert.ok(error.details.responsePreview.length<=240);assert.equal(h.nativeCalls.length,0);assert.equal(h.changes,0);
 }
});
test('concurrent first reads share one pending readiness check',async()=>{
 const h=fixture({deferBootstrap:true}),first=h.api.getActiveSequenceInfo(),second=h.api.getActiveSequenceInfo();
 assert.equal(h.commands.length,2);assert.equal(h.commands[0],'"BC_NATIVE_EVAL_V1"');assert.equal(h.nativeCalls.length,0);h.release();await Promise.all([first,second]);assert.equal(h.loads.length,1);assert.deepEqual(h.nativeCalls,['context','context']);
});
test('fixed extension paths with quotes and Unicode remain data in the loader',async()=>{
 const extensionPath=path.join(fixtureRoot,'Extensions','Captions O\'Brien "字"'),extensionURL=pathToFileURL(extensionPath).href;
 assert.equal(fileURLToPath(extensionURL),extensionPath,'the quoted Unicode file URL must round trip on the current platform');
 const h=fixture({extension:extensionURL});await h.api.getActiveSequenceInfo();assert.deepEqual(h.loads,[path.join(extensionPath,'host','bridge.jsx')]);assert.equal(h.changes,0);
});
test('native script load failures retain bounded error and line details and prevent every host call',async()=>{
 const h=fixture({loadError:'Syntax "problem" \\ bad\n'+'x'.repeat(1000)});
 const error=await h.api.getActiveSequenceInfo().catch(error=>error);assert.match(error.message,/could not initialize.*Syntax "problem"/);assert.match(error.message,/line 37/);assert.equal(error.details.line,37);assert.ok(error.details.nativeError.length<=400);assert.equal(h.nativeCalls.length,0);
 await assert.rejects(h.api.getActiveSequenceInfo(),/could not initialize/);assert.equal(h.loads.length,1);assert.equal(h.commands.length,2,'a failed initialization is not silently retried');
});
test('a missing file or incomplete loaded bridge never permits a native read or mutation',async()=>{
 for(const options of [{missingFile:true},{incompleteLoad:true},{incompleteLoad:true,scopeLocal:true,partial:true}]){
  const h=fixture(options);await assert.rejects(h.api.getActiveSequenceInfo(),/could not initialize/);assert.equal(h.nativeCalls.length,0);assert.equal(h.changes,0);
 }
});
test('malformed bootstrap responses reject safely and cannot be reused as a successful readiness receipt',async()=>{
 for(const bootstrapRaw of ['EvalScript error.','null','[]','{}','{"version":1,"ok":true}','{"version":2,"ok":true,"loaded":false}',undefined,'z'.repeat(5000)]){
  const h=fixture({bootstrapRaw});const error=await h.api.getActiveSequenceInfo().catch(error=>error);assert.match(error.message,/valid caption response.*host readiness/);assert.ok(error.details.responsePreview.length<=240);assert.equal(error.details.phase,'bootstrap');
  await assert.rejects(h.api.getActiveSequenceInfo());assert.equal(h.commands.length,2);assert.equal(h.nativeCalls.length,0);assert.equal(h.changes,0);
 }
});
test('an ambiguous mutation response is diagnosed without reloading or executing the mutation twice',async()=>{
 const h=fixture({ambiguousMutation:true});await h.api.getActiveSequenceInfo();
 const error=await h.api.applyCaptionClips([h.caption],0,'seq-a').catch(error=>error);assert.match(error.message,/valid caption response.*apply.*EvalScript error/);assert.equal(error.details.method,'apply');assert.equal(h.changes,1);assert.equal(h.nativeCalls.filter(method=>method==='apply').length,1);assert.equal(h.loads.length,1);
 h.advance(2000);await h.api.getActiveSequenceInfo();assert.equal(h.changes,1);assert.equal(h.loads.length,1,'a later read does not retry the uncertain write');assert.equal(h.commands.filter(script=>script==='"BC_NATIVE_EVAL_V1"').length,1,'method failure never resets successful readiness');
});
test('a failed literal evaluator probe is distinguished from a JSX loader failure and prevents all further native work',async()=>{
 for(const options of [{probeRaw:'EvalScript error.'},{probeRaw:'"BC_NATIVE_EVAL_V1"'},{probeRaw:''},{probeRaw:null},{probeRaw:undefined},{probeThrows:true}]){
  const h=fixture(options),error=await h.api.getActiveSequenceInfo().catch(error=>error);assert.match(error.message,/native evaluator/);assert.equal(error.details.phase,'evaluator');assert.ok(error.details.responsePreview.length<=240);
  await assert.rejects(h.api.getActiveSequenceInfo(),/native evaluator/);assert.deepEqual(h.commands,['"BC_NATIVE_EVAL_V1"']);assert.equal(h.loads.length,0);assert.equal(h.nativeCalls.length,0);assert.equal(h.changes,0);
 }
 const loader=fixture({bootstrapRaw:'EvalScript error.'}),error=await loader.api.getActiveSequenceInfo().catch(error=>error);assert.equal(error.details.phase,'bootstrap');assert.match(error.message,/host readiness/);assert.equal(loader.commands[0],'"BC_NATIVE_EVAL_V1"');assert.equal(loader.commands.length,2);
});
test('a new request after readiness cooldown can recover while the failed request never retries itself',async()=>{
 for(const failure of ['probeRaw','bootstrapRaw','globalRaw','loadError']){
  const options={[failure]:'EvalScript error.'},h=fixture(options);
  await assert.rejects(h.api.getActiveSequenceInfo());const failedCommands=h.commands.length;
  delete options[failure];h.advance(999);await assert.rejects(h.api.getActiveSequenceInfo());assert.equal(h.commands.length,failedCommands,'requests in the cooldown share the rejected initialization');assert.equal(h.nativeCalls.length,0);
  h.advance(1);await h.api.getActiveSequenceInfo();assert.deepEqual(h.nativeCalls,['context']);assert.equal(h.changes,0);
  assert.equal(h.commands.filter(script=>script==='"BC_NATIVE_EVAL_V1"').length,2,'one new request starts exactly one new readiness attempt');
 }
});
