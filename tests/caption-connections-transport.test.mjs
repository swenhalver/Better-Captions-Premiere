import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript');
const source=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const compile=file=>ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const collection=(values,key='numItems')=>Object.defineProperty(values,key,{get:()=>values.length});
function events(){const handlers=new Map();return{addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},removeEventListener(type,fn){handlers.get(type)?.delete(fn);},emit(type,event){for(const fn of handlers.get(type)??[])void fn(event);}};}
function system(t){
 let projectPath='/first/edit.prproj',nextJob=0,nextRequest=0,documentText='BCDOC1:424341500200000000000000',setterMode='normal',transcribe=async()=>null,savedSession=null;
 const payloads=new Map(),requests=[],nativeWrites=[],cepSaves=[],sidecars=[],ipcFolders=new Map(),hostCalls=[];
 const time=seconds=>({seconds,ticks:String(seconds*254016000000)});
 const documentParam={displayName:'Caption document (experimental)',isTimeVarying:()=>false,getValue:()=>documentText,setValue(value){nativeWrites.push(value);if(setterMode==='ignored')return 0;documentText=value;return 0;}};
 let characterLimit=56,playheadTicks=String(.5*254016000000);const keyframeSeeks=[];
 const groupingParam={displayName:'Characters per caption',isTimeVarying:()=>false,getValue:()=>characterLimit,setValue(value){characterLimit=value;return 0;}};
 const geometry={};
 for(const [key,label,value] of [['position','Position',[.5,.9]],['width','Width',1536],['height','Height',150]])geometry[key]={displayName:label,value,animated:false,keys:[],isTimeVarying(){return this.animated;},areKeyframesSupported:()=>true,getValue(){return this.value;},getKeys(){return this.keys.map(k=>({ticks:k.ticks}));},getValueAtKey(t){return this.keys.find(k=>k.ticks===t.ticks).value;},getValueAtTime(t){return this.keys.find(k=>k.ticks===t.ticks)?.value??this.keys[0].value;},setValue(next){nativeWrites.push({parameter:key,value:next});if(setterMode!=='ignored')this.value=next;}};
 const nativeClip={nodeId:'native-node',projectItem:{nodeId:'native-item',getMediaPath:()=>''},start:time(0),end:time(2),inPoint:time(0),outPoint:time(2),isAdjustmentLayer:()=>true,isSelected:()=>true,getSpeed:()=>1,isSpeedReversed:()=>false,
  components:collection([{matchName:'AE.com.swen.bettercaptions.native.experimental',properties:collection([documentParam,groupingParam,...Object.values(geometry)])}])};
 const nativeTrack={clips:collection([nativeClip]),isLocked:()=>false};
 const nativeSequence={sequenceID:'seq-a',name:'Captions',timebase:'10584000000',frameSizeHorizontal:720,frameSizeVertical:1280,end:String(2*254016000000),getPlayerPosition:()=>({ticks:playheadTicks,seconds:Number(playheadTicks)/254016000000}),setPlayerPosition(t){keyframeSeeks.push(t);playheadTicks=t;},videoTracks:collection([nativeTrack],'numTracks'),audioTracks:collection([],'numTracks')};
 const nativeProject={get path(){return projectPath;},activeSequence:nativeSequence};
 const nativeContext=vm.createContext({app:{project:nativeProject},Time:function(){this.ticks='0';},File:function(file){this.length=(payloads.get(file)??'').length;this.open=()=>payloads.has(file);this.read=()=>payloads.get(file);this.close=()=>{};}});
 vm.runInContext(source('cep/host/bridge.jsx'),nativeContext);nativeContext.$={global:vm.runInContext('this',nativeContext)};
 const runtime={path,directory:info=>info.projectPath.replace(/\/[^/]*$/,'')+'/Better Captions/'+info.id,readJob:data=>{const file='/ipc-'+ ++nextJob+'.json';payloads.set(file,JSON.stringify(data));return file;},disposeReadJob:file=>payloads.delete(file),load:()=>savedSession,save:(folder,data)=>cepSaves.push({folder,data})};
 const cepExports={};vm.runInNewContext(compile('webview-ui/src/cep-api.ts'),{exports:cepExports,console,require:()=>({}),window:{require:name=>name==='node:path'?path:runtime,__adobe_cep__:{getSystemPath:()=>'/extension',evalScript(script,callback){if(script.startsWith('BetterCaptionsHost.'))hostCalls.push(script.slice('BetterCaptionsHost.'.length).split('(')[0]);callback(vm.runInContext(script,nativeContext));}}}});
 const cep=cepExports.createHostAPI();
 const service={};vm.runInNewContext(compile('cep/service.ts'),{exports:service,console,require:()=>({createHostAPI:()=>cep}),setTimeout,clearTimeout,setInterval,clearInterval});
 function folder(name){if(ipcFolders.has(name))return ipcFolders.get(name);const entries=new Map();const value={nativePath:name,entries,getEntry:async file=>{if(name==='/private/service'&&file==='service.json')return{data:{version:1,instanceId:'a'.repeat(24),updatedAt:Date.now(),actions:service.SERVICE_ACTIONS}};if(file==='captions.better-captions.json'&&savedSession!==null)return{data:savedSession};if(!entries.has(file))throw new Error('Not found');return entries.get(file);}};ipcFolders.set(name,value);return value;}
 const storage={ensureFolder:async name=>folder(name),privateRoot:async name=>folder('/private/'+name),randomId:()=>String(++nextRequest).padStart(32,'0'),readJSON:async file=>file.data,
  async writeJSON(parent,name,data){
   if(parent.nativePath==='/private/service/requests'){
    requests.push(data);let result;
    try{service.validateServiceRequest(data,name);result={result:await service.dispatchServiceRequest(cep,data)};}
    catch(error){result={error:error.message,...(error.code==='BC_OUTPUT_UNCONFIRMED'?{code:error.code,recoverable:false,outputApplied:error.outputApplied}:{})};}
    const responses=folder('/private/service/responses');responses.entries.set(name,{data:{version:1,id:data.id,sequenceId:data.sequenceId,projectPath:data.projectPath,...result},delete:async()=>responses.entries.delete(name)});
   }else sidecars.push({folder:parent.nativePath,name,data});
  }};
 const sequence={guid:{toString:()=>nativeSequence.sequenceID},name:'Captions',getSettings:async()=>({getVideoFrameRect:async()=>({width:720,height:1280})}),getTimebase:async()=>10584000000,getEndTime:async()=>({seconds:2}),getPlayerPosition:async()=>({seconds:.5}),getVideoTrackCount:async()=>0};
 const project={get path(){return projectPath;},getActiveSequence:async()=>sequence,getSequences:async()=>[sequence]};
 const ppro={Project:{getActiveProject:async()=>project},Constants:{TrackItemType:{CLIP:1},SequenceEvent:{ACTIVATED:'activate',CLOSED:'closed'}},EventManager:{addGlobalEventListener(){},removeGlobalEventListener(){}}};
 const nativeModule={exports:{}};vm.runInNewContext(source('uxp/api.js'),{module:nativeModule,exports:nativeModule.exports,setTimeout,clearTimeout,require:name=>{
  if(name==='premierepro')return ppro;if(name==='uxp')return{storage:{localFileSystem:{}}};if(name==='./storage.js')return storage;
  if(name==='./transcript.js')return{fetchTranscript:async()=>null,transcribe:()=>transcribe()};if(name==='./paths.js')return require('../uxp/paths.js');
  if(name==='./agent.js')return{startAgentBridge:async()=>async()=>{}};throw new Error('Unexpected native dependency '+name);
 }});
 const nativeApi=nativeModule.exports.createHostAPI({serviceStartupGraceMs:0});
 const hostWindow=events(),uiWindow=events(),frame=events();let entrypoints;
 const status={style:{},textContent:''};frame.postMessage=data=>uiWindow.emit('message',{data});
 vm.runInNewContext(source('uxp/main.js'),{window:hostWindow,setTimeout,clearTimeout,console,document:{createElement:()=>frame,getElementById:id=>id==='caption-host-status'?status:{appendChild(){}}},require:name=>{
  if(name==='uxp')return{entrypoints:{setup(value){entrypoints=value;}}};if(name==='premierepro')return ppro;if(name==='./api.js')return{createHostAPI:()=>nativeApi};throw new Error(name);
 }});
 uiWindow.uxpHost={postMessage:data=>hostWindow.emit('message',{data,source:frame})};
 const uiExports={};vm.runInNewContext(compile('webview-ui/src/webview-setup.ts'),{exports:uiExports,window:uiWindow,setTimeout,clearTimeout,console,require:()=>({createHostAPI(){throw new Error('The visible native editor must use UXP.');}})});
 const api=uiExports.initWebview({}).api,stop=api.startAgentBridge({getState:()=>null,patchStyle:()=>null,setCaptions:()=>null,refresh:()=>null,apply:()=>null});
 t.after(async()=>{await tick();stop();await entrypoints.plugin.destroy();nativeApi.dispose();});
 return{api,nativeApi,cep,service,requests,nativeWrites,geometry,keyframeSeeks,cepSaves,sidecars,payloads,hostCalls,nativeSequence,
  get projectPath(){return projectPath;},set projectPath(value){projectPath=value;},set sequenceId(value){nativeSequence.sequenceID=value;},set savedSession(value){savedSession=value;},set setterMode(value){setterMode=value;},set transcribe(value){transcribe=value;},get document(){return documentText;}};
}
test('connection reads and existing native edits round trip through actual webview, UXP, service, CEP and host code',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();
 const summary=await h.api.readCaptionConnections(undefined,[],{includeDocuments:false});assert.equal(summary.ok,true);assert.equal(summary.native[0].documentText,undefined);assert.equal(h.nativeWrites.length,0);
 const full=await h.api.readCaptionConnections();assert.equal(full.native[0].documentText,h.document);assert.equal(full.projectPath,h.projectPath);
 const text='BCDOC1:424341500200000001000000',entry=full.native[0];
 const updated=await h.api.writeNativeCaptionDocument({locator:entry.locator,revision:entry.revision},text);
 assert.equal(updated.readbackVerified,true);assert.equal(updated.documentText,text);assert.deepEqual(h.nativeWrites,[text]);
 assert.deepEqual(h.requests.map(request=>request.action),['readCaptionConnections','readCaptionConnections','writeNativeCaptionDocument']);
 for(const request of h.requests.slice(0,2)){assert.equal(request.sequenceId,'seq-a');assert.equal(request.projectPath,'/first/edit.prproj');assert.equal(request.expiresAt-request.createdAt,10000);}
 assert.equal(Object.hasOwn(h.requests[2],'expiresAt'),false,'the setter must never acquire the expiring-read contract');assert.equal(h.payloads.size,0,'private host jobs are cleaned after reads and writes');
});
test('a native setter readback failure stays typed and nonrecoverable across all actual transport adapters',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();const full=await h.api.readCaptionConnections();h.setterMode='ignored';
 await assert.rejects(h.api.writeNativeCaptionDocument({locator:full.native[0].locator,revision:full.native[0].revision},'BCDOC1:ab'),error=>error.code==='BC_OUTPUT_UNCONFIRMED'&&error.method==='writeNativeCaptionDocument'&&error.recoverable===false&&error.operationPending===false&&error.outputApplied===false);
 assert.equal(h.nativeWrites.length,1);await tick();assert.equal(h.nativeWrites.length,1,'no adapter may repeat the setter after an uncertain acknowledgement');
});
test('discovery rejects injected sequence arguments and expired read requests before calling an API',async t=>{
 const h=system(t),base={version:1,id:'a'.repeat(32),createdAt:Date.now(),sequenceId:'seq-a',projectPath:'/first/edit.prproj',action:'readCaptionConnections',args:[[],{includeDocuments:false}]};
 assert.equal(h.service.validateServiceRequest(base,base.id+'.json').action,'readCaptionConnections');
 for(const args of [[[]],[[],{includeDocuments:false},'other'],[[],{includeDocuments:false,script:'code'}]])assert.throws(()=>h.service.validateServiceRequest({...base,args},base.id+'.json'),/arguments/i);
 assert.throws(()=>h.service.validateServiceRequest({...base,createdAt:Date.now()-11000},base.id+'.json'),/expired/);
 assert.equal(h.nativeWrites.length,0);assert.equal(h.requests.length,0);
});
test('fresh same-GUID project reads can reconnect Save As without redirecting queued old-project native writes',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();const full=await h.api.readCaptionConnections(),entry=full.native[0];
 let finish,entered;const started=new Promise(resolve=>{entered=resolve;});h.transcribe=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 const pending=h.nativeApi.transcribeSequence('seq-a');await started;h.projectPath='/second/edit.prproj';
 const refresh=h.nativeApi.getActiveSequenceInfo();
 const oldWrite=h.nativeApi.writeNativeCaptionDocument({locator:entry.locator,revision:entry.revision},'BCDOC1:ab','seq-a');
 const rejected=assert.rejects(oldWrite,/project location changed|another project path|project changed/i);
 finish(null);await pending;assert.equal((await refresh).projectPath,'/second/edit.prproj');await rejected;
 assert.equal(h.nativeWrites.length,0);assert.equal(h.requests.filter(request=>request.action==='writeNativeCaptionDocument').length,0);
 const again=await h.nativeApi.readCaptionConnections('seq-a');assert.equal(again.projectPath,'/second/edit.prproj');assert.equal(again.native[0].locator.projectPath,'/second/edit.prproj');
});
test('old-project sidecar snapshots are rejected after refresh in both UXP and CEP adapters',async t=>{
 const h=system(t);await h.nativeApi.getActiveSequenceInfo();await h.cep.getActiveSequenceInfo();h.projectPath='/second/edit.prproj';
 await h.nativeApi.getActiveSequenceInfo();await h.cep.getActiveSequenceInfo();
 const old={sequenceId:'seq-a',projectPath:'/first/edit.prproj',captions:[]};
 await assert.rejects(h.nativeApi.saveSession(old),/another project path/);await assert.rejects(h.cep.saveSession(old),/another project path/);
 assert.equal(h.sidecars.length,0);assert.equal(h.cepSaves.length,0);
 await h.nativeApi.saveSession({...old,projectPath:'/second/edit.prproj'});assert.equal(h.sidecars[0].folder,'/second/Better Captions/seq-a');
});
test('queued sidecar saves retain their request-time project context and immutable snapshot',async t=>{
 const h=system(t);await h.nativeApi.getActiveSequenceInfo();let finish,entered;
 const started=new Promise(resolve=>{entered=resolve;});h.transcribe=()=>{entered();return new Promise(resolve=>{finish=resolve;});};
 const pending=h.nativeApi.transcribeSequence('seq-a');await started;h.projectPath='/second/edit.prproj';
 const refreshed=h.nativeApi.getActiveSequenceInfo(),data={sequenceId:'seq-a',projectPath:'/first/edit.prproj',captions:[]},save=h.nativeApi.saveSession(data);
 const rejected=assert.rejects(save,/project location changed|another project path/i);data.projectPath='/second/edit.prproj';finish(null);await pending;await refreshed;await rejected;
 assert.equal(h.sidecars.length,0);
});
test('saved sidecar GUIDs accept only equivalent balanced GUID forms and normalize to the captured context',async t=>{
 const h=system(t),guid='a14706aa-93bb-74d3-a5fd-c8974e471c87';h.sequenceId=guid;
 await h.nativeApi.getActiveSequenceInfo();await h.cep.getActiveSequenceInfo();
 const saved={sequenceId:'{'+guid.toUpperCase()+'}',projectPath:h.projectPath,captions:[{id:'kept'}]};h.savedSession=saved;
 for(const api of [h.nativeApi,h.cep]){
  const loaded=await api.loadSession();assert.equal(loaded.sequenceId,guid);assert.equal(loaded.captions[0].id,'kept');
 }
 assert.equal(saved.sequenceId,'{'+guid.toUpperCase()+'}','read normalization must not mutate the loaded source object');
 for(const sequenceId of ['b14706aa-93bb-74d3-a5fd-c8974e471c87','{'+guid,guid+'}',guid.replaceAll('-','')]){
  h.savedSession={...saved,sequenceId};
  await assert.rejects(h.nativeApi.loadSession(),/another sequence/);await assert.rejects(h.cep.loadSession(),/another sequence/);
 }
 h.sequenceId='seq-a';await h.nativeApi.getActiveSequenceInfo();await h.cep.getActiveSequenceInfo();h.savedSession={...saved,sequenceId:'SEQ-A'};
 await assert.rejects(h.nativeApi.loadSession(),/another sequence/);await assert.rejects(h.cep.loadSession(),/another sequence/);
 assert.equal(h.sidecars.length,0);assert.equal(h.cepSaves.length,0);assert.equal(h.requests.length,0);assert.equal(h.nativeWrites.length,0);
});
test('the actual private service preserves unconfirmed-write metadata and completed request IDs never execute again',async t=>{
 const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'better-captions-connections-'))),service={};
 let writes=0,outputApplied=false;
 vm.runInNewContext(compile('cep/service.ts'),{exports:service,console,setTimeout,clearTimeout,setInterval,clearInterval,require:()=>({createHostAPI(){throw new Error('The test API must be injected.');}})});
 const worker=service.startBackendService({api:{getActiveSequenceInfo:async id=>({id,projectPath:'/first/edit.prproj'}),writeNativeCaptionDocument:async()=>{writes++;throw Object.assign(new Error('Native document readback was not confirmed.'),{code:'BC_OUTPUT_UNCONFIRMED',recoverable:false,outputApplied});}},
  fs,path,os,crypto,process,platform:require('../cep/platform.cjs'),root:path.join(directory,'service'),intervalMs:60000});
 t.after(()=>{worker.stop();fs.rmSync(directory,{recursive:true,force:true});});
 for(const applied of [false,true]){
  outputApplied=applied;
  const request={version:1,id:crypto.randomBytes(16).toString('hex'),createdAt:Date.now(),sequenceId:'seq-a',projectPath:'/first/edit.prproj',action:'writeNativeCaptionDocument',args:[{locator:{clipNodeId:'native-node'},revision:'captured'},'BCDOC1:ab']};
  const input=path.join(worker.root,'requests',request.id+'.json'),output=path.join(worker.root,'responses',request.id+'.json');
  fs.writeFileSync(input,JSON.stringify(request));await worker.poll();
  const receipt=JSON.parse(fs.readFileSync(output,'utf8'));
  assert.equal(receipt.code,'BC_OUTPUT_UNCONFIRMED');assert.equal(receipt.recoverable,false);assert.equal(receipt.outputApplied,applied);
  assert.equal(receipt.sequenceId,request.sequenceId);assert.equal(receipt.projectPath,request.projectPath);assert.equal(receipt.id,request.id);assert.equal(fs.existsSync(input),false);
  const before=writes;fs.writeFileSync(input,JSON.stringify(request));await worker.poll();assert.equal(writes,before,'an existing response prevents a second execution, including uncertain writes');
 }
 assert.equal(writes,2);
});
test('panel character limits cross all installed transport adapters and preserve native document bytes',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();
 const initial=await h.api.readCaptionConnections(),entry=initial.native[0];assert.equal(entry.maxChars,56);
 const result=await h.api.writeNativeCaptionDocument({locator:entry.locator,revision:entry.revision,grouping:{before:56,value:24}},entry.documentText);
 assert.equal(result.readbackVerified,true);assert.equal(result.maxChars,24);assert.equal(result.documentText,entry.documentText);
 assert.equal(h.nativeWrites.length,0,'character regroup alone never calls the document setter');
 const actual=await h.api.readCaptionConnections();assert.equal(actual.native[0].maxChars,24);assert.equal(actual.native[0].documentText,entry.documentText);
});

test('native controls round trip through webview, UXP, expiring read service and exact host; setter is never retried',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();const entry=(await h.api.readCaptionConnections()).native[0],snapshot={locator:entry.locator,revision:entry.revision};
 const controls=await h.api.readNativeCaptionControls(snapshot);assert.equal(controls.width.value,1536);assert.equal(controls.insideClip,true);
 const after=await h.api.editNativeCaptionControl(snapshot,{revision:controls.revision,parameter:'width',operation:'set',value:600,atTicks:controls.timelineTicks});
 assert.equal(after.readbackVerified,true);assert.equal(after.width.value,600);assert.deepEqual(h.nativeWrites,[{parameter:'width',value:600}]);
 const read=h.requests.find(r=>r.action==='readNativeCaptionControls'),write=h.requests.find(r=>r.action==='editNativeCaptionControl');assert.equal(read.expiresAt-read.createdAt,10000);assert.equal(Object.hasOwn(write,'expiresAt'),false);
 h.setterMode='ignored';await assert.rejects(h.api.editNativeCaptionControl(snapshot,{revision:after.revision,parameter:'width',operation:'set',value:500,atTicks:after.timelineTicks}),e=>e.code==='BC_OUTPUT_UNCONFIRMED'&&e.recoverable===false);
 assert.equal(h.nativeWrites.length,2);await tick();assert.equal(h.nativeWrites.length,2);assert.equal(h.payloads.size,0);
});

test('warm native control service operations cross one host boundary and retain exact project/settings checks',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();const entry=(await h.api.readCaptionConnections()).native[0],snapshot={locator:entry.locator,revision:entry.revision};
 h.hostCalls.length=0;const controls=await h.api.readNativeCaptionControls(snapshot);assert.deepEqual(h.hostCalls,['readNativeCaptionControls']);
 h.hostCalls.length=0;const after=await h.api.editNativeCaptionControl(snapshot,{revision:controls.revision,parameter:'width',operation:'set',value:600,atTicks:controls.timelineTicks});
 assert.equal(after.readbackVerified,true);assert.deepEqual(h.hostCalls,['editNativeCaptionControl']);assert.equal(h.nativeWrites.length,1);
 h.nativeSequence.frameSizeHorizontal=1920;await assert.rejects(h.api.readNativeCaptionControls(snapshot),/sequence settings changed/);assert.equal(h.nativeWrites.length,1);
 h.nativeSequence.frameSizeHorizontal=720;h.projectPath='/other/edit.prproj';
 await assert.rejects(h.cep.dispatchNativeCaptionControlRequest({action:'editNativeCaptionControl',sequenceId:'seq-a',projectPath:'/first/edit.prproj',args:[snapshot,{revision:after.revision,parameter:'width',operation:'set',value:500,atTicks:after.timelineTicks}]}),/project changed/);
 assert.equal(h.nativeWrites.length,1);
});

test('fixed native service dispatcher refuses redirected snapshots, extra arguments and arbitrary host names',async t=>{
 const h=system(t);await h.api.getActiveSequenceInfo();const entry=(await h.api.readCaptionConnections()).native[0],snapshot={locator:entry.locator,revision:entry.revision};
 const base={action:'readNativeCaptionControls',sequenceId:'seq-a',projectPath:'/first/edit.prproj',args:[snapshot]};h.hostCalls.length=0;
 for(const change of [{action:'writeNativeCaptionDocument'},{action:'context'},{args:[snapshot,'injected']},{script:'code'},{projectPath:'/other/edit.prproj'},{sequenceId:'other'}]){
  await assert.rejects(h.cep.dispatchNativeCaptionControlRequest({...base,...change}),/envelope|snapshot/);
 }
 assert.deepEqual(h.hostCalls,[]);assert.deepEqual(h.nativeWrites,[]);
});

test('keyframe navigation round trips all adapters as a single exact-tick seek, preserving parameter data',async t=>{
 const h=system(t);await tick();await h.api.getActiveSequenceInfo();const entry=(await h.api.readCaptionConnections()).native[0],snapshot={locator:entry.locator,revision:entry.revision};
 h.geometry.position.animated=true;h.geometry.position.keys=[{ticks:'0',value:[.25,.6]},{ticks:String(.75*254016000000),value:[.75,.8]}];
 const before=await h.api.readNativeCaptionControls(snapshot),next=await h.api.seekNativeCaptionKeyframe(snapshot,{parameter:'position',direction:'next',revision:before.revision,atTicks:before.timelineTicks});
 assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,String(.75*254016000000));assert.equal(JSON.stringify(next.position.value),JSON.stringify([.75,.8]));assert.deepEqual(h.nativeWrites,[]);assert.deepEqual(h.keyframeSeeks,[String(.75*254016000000)]);
 const request=h.requests.find(r=>r.action==='seekNativeCaptionKeyframe');assert.equal(Object.hasOwn(request,'expiresAt'),false);assert.equal(request.args.length,2);assert.equal(h.payloads.size,0);
});
