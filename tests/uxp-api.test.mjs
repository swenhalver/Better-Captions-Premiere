import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(t, options = {}) {
  let active='one',projectPath='/projects/edit.prproj',counter=0;
  let projectReads=0,serviceReads=0,clockOffset=0;
  const writes=[],requests=[];
  const sequences=['one','two'].map(id=>({guid:{toString:()=>id},name:id,getSettings:async()=>({getVideoFrameRect:async()=>({width:720,height:1280})}),getTimebase:async()=>10584000000,getEndTime:async()=>({seconds:10}),getPlayerPosition:async()=>({seconds:id==='one'?2.5:7}),getVideoTrackCount:async()=>0}));
  const project={get path(){return projectPath;},getSequences:async()=>sequences,getActiveSequence:async()=>sequences.find(s=>s.name===active)};
  const folders=new Map();
  function folder(path) {
    if(folders.has(path))return folders.get(path);
    const entries=new Map(),value={nativePath:path,getEntry:async name=>{if(path==='/private/service'&&name==='service.json')serviceReads++;if(!entries.has(name))throw new Error('Entry not found');return entries.get(name);},entries};
    folders.set(path,value);return value;
  }
  const healthyService = () => ({version:1,instanceId:'a'.repeat(24),updatedAt:Date.now()+clockOffset,busy:false,actions:['getFonts','showInPremiere','beginCaption','saveCaptionFrames','finishCaption','preflightCaptionClips','applyCaptionClips','readTimeline','selectCaptionClip','readCaptionMotion','readCaptionGeometry','readCaptionSelection','readCaptionAreaDescriptor','patchCaptionKeyValues']});
  function setService(status) {
    const entries=folder('/private/service').entries;
    if(status===null)entries.delete('service.json');else entries.set('service.json',{data:status});
  }
  setService(Object.hasOwn(options,'service')?options.service:healthyService());
  const storage={
    randomId:()=>String(++counter).padStart(32,'0'),ensureFolder:async path=>folder(path),privateRoot:async scope=>folder('/private/'+scope),readJSON:async file=>file.data,
    writeJSON:async (parent,name,value)=>{
      writes.push({path:parent.nativePath,name,value});
      if(parent.nativePath==='/private/service/requests'){
        requests.push(value);
        // The real worker can claim a file before getEntry resolves: no input
        // remains, but its matching response is already available.
        if(options.autoRespond!==false)respond(value,options.serviceResult?await options.serviceResult(value):['Arial','Georgia']);
        else parent.entries.set(name,{data:value,delete:async()=>parent.entries.delete(name)});
      }else parent.entries.set(name,{data:value,delete:async()=>{}});
    },
  };
  function respond(request= requests.at(-1),result={ok:true,cues:[]}){
    const name=request.id+'.json',responses=folder('/private/service/responses');
    folder('/private/service/requests').entries.delete(name);
    responses.entries.set(name,{data:{version:1,id:request.id,sequenceId:request.sequenceId,projectPath:request.projectPath,result},delete:async()=>responses.entries.delete(name)});
  }
  const native={fetchTranscript:async sequence=>sequence.name,transcribe:async sequence=>options.transcribe?options.transcribe(sequence):sequence.name};
  const module={exports:{}};
  const context={module,exports:module.exports,setTimeout,clearTimeout,Date:{now:()=>Date.now()+clockOffset},Map,Set,require:name=>{
    if(name==='premierepro')return {Project:{getActiveProject:async()=>{projectReads++;return project;}},Constants:{TrackItemType:{CLIP:1}}};
    if(name==='uxp')return {storage:{localFileSystem:{}}};
    if(name==='./storage.js')return storage;
    if(name==='./transcript.js')return native;
    if(name==='./paths.js')return require('../uxp/paths.js');
    if(name==='./text-area.js'&&options.textArea)return options.textArea;
    throw new Error('Unexpected import '+name);
  }};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/api.js',import.meta.url),'utf8'),context);
  const api=module.exports.createHostAPI({readTimeoutMs:options.readTimeoutMs??12000,serviceStartupGraceMs:options.serviceStartupGraceMs??0,serviceStartupPollMs:options.serviceStartupPollMs??5});t.after(()=>api.dispose());
  return {api,writes,requests,respond,setService,healthyService,advanceTime:ms=>{clockOffset+=ms;},select:id=>{active=id;},relocate:path=>{projectPath=path;},get projectReads(){return projectReads;},get serviceReads(){return serviceReads;}};
}

test('direct native requests and slow saves retain the captured sequence after selection changes',async t=>{
  const h=harness(t);assert.equal((await h.api.getActiveSequenceInfo()).playhead,2.5);h.select('two');assert.equal((await h.api.getActiveSequenceInfo()).playhead,7);
  assert.equal(await h.api.fetchTranscriptJSON('one'),'one');
  await h.api.saveSession({sequenceId:'one',captions:[{text:'original'}]});
  assert.equal(h.writes.at(-1).path,'/projects/Better Captions/one');
  assert.equal(h.writes.at(-1).value.sequenceId,'one');
});

test('Windows sessions save beside the captured project and preserve raw project identity in service requests',async t=>{
  const h=harness(t);h.relocate('D:\\Project Data\\Café\\edit.prproj');await h.api.getActiveSequenceInfo();
  await h.api.saveSession({sequenceId:'one',captions:[]});assert.equal(h.writes.at(-1).path,'D:/Project Data/Café/Better Captions/one');
  await h.api.getFonts();assert.equal(h.requests.at(-1).projectPath,'D:\\Project Data\\Café\\edit.prproj');
});

test('font loading initializes native context and accepts a renderer that claims immediately',async t=>{
  const h=harness(t);const fonts=await h.api.getFonts();
  assert.deepEqual(Array.from(fonts),['Arial','Georgia']);
  assert.equal(h.requests[0].sequenceId,'one');assert.equal(h.requests[0].action,'getFonts');
  assert.equal(h.requests[0].projectPath,'/projects/edit.prproj');
  assert.equal(h.requests[0].expiresAt-h.requests[0].createdAt,10000);
});

test('a changed project location cannot redirect a pending caption save or render request',async t=>{
  const h=harness(t);await h.api.getActiveSequenceInfo();h.relocate('/other/edit.prproj');
  await assert.rejects(h.api.saveSession({sequenceId:'one'}),/project location changed/);
  await assert.rejects(h.api.beginCaption('caption-one','one'),/project location changed/);
  assert.equal(h.writes.length,0);
});
test('a native read timeout blocks later calls until the original claimed request actually returns',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:30});await h.api.getActiveSequenceInfo();
  const pending=h.api.readCaptionGeometry([{id:'caption'}],'one');
  await assert.rejects(pending,/Native requests are paused/);
  assert.equal(h.requests.length,1);const reads=h.projectReads;
  await assert.rejects(h.api.getActiveSequenceInfo(),/previous Premiere read has not finished/);
  assert.equal(h.projectReads,reads,'a timeout cannot release the native lane and issue another call');
  h.respond();await delay(180);
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one','the lane may resume only after the real response arrives');
});
test('queued reads expire without starting native work while long transcription retains its separate deadline',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const h=harness(t,{readTimeoutMs:30,transcribe:()=>gate});await h.api.getActiveSequenceInfo();
  const transcription=h.api.transcribeSequence('one');await tick();const reads=h.projectReads;
  await assert.rejects(h.api.readCaptionSelection([],'one'),/expired while waiting/);
  assert.equal(h.projectReads,reads);assert.equal(h.requests.length,0);
  finish('native transcript');assert.equal(await transcription,'native transcript');
});
test('native requests have bounded backpressure instead of an unlimited queue',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const h=harness(t,{transcribe:()=>gate});await h.api.getActiveSequenceInfo();
  const transcription=h.api.transcribeSequence('one');await tick();
  const queued=Array.from({length:8},()=>h.api.getActiveSequenceInfo());
  await assert.rejects(h.api.getActiveSequenceInfo(),/busy/);
  finish('done');await transcription;await Promise.all(queued);
});
test('geometry and explicit Motion diagnostics use only their allowlisted transport arguments',async t=>{
  const h=harness(t);await h.api.getActiveSequenceInfo();
  await h.api.readCaptionGeometry([{id:'cue'}],'one');assert.equal(h.requests.at(-1).action,'readCaptionGeometry');
  await h.api.readCaptionMotion([{id:'cue'}],'one');assert.equal(h.requests.at(-1).args.length,1);
  await h.api.readCaptionMotion([{id:'cue'}],'one',{includeDiagnostics:true,exec:'blocked'});
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1).args)),[[{id:'cue'}],{includeDiagnostics:true}]);
});
test('an apparently unclaimed request is not treated as proof that no worker can be running it',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:500});await h.api.getActiveSequenceInfo();
  let settled=false;const pending=h.api.readCaptionGeometry([],'one').finally(()=>{settled=true;});await tick();
  h.advanceTime(8000);await delay(190);
  assert.equal(settled,false,'a racy seven-second file check must not release the native lane');
  h.respond();await pending;
});
for(const unavailable of ['missing','stale','unsupported'])test(`an unavailable background renderer (${unavailable}) fails before request writes and leaves direct native calls available`,async t=>{
  const h=harness(t),status=h.healthyService();
  if(unavailable==='stale')status.updatedAt-=20000;
  if(unavailable==='unsupported')status.actions=['readTimeline'];
  h.setService(unavailable==='missing'?null:status);
  await assert.rejects(h.api.getFonts(),/Save your work, restart Premiere/);
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0,'an unavailable service must not leave a request that poisons the serial lane');
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one');assert.equal(await h.api.fetchTranscriptJSON('one'),'one');
  h.setService(h.healthyService());assert.deepEqual(Array.from(await h.api.getFonts()),['Arial','Georgia'],'the same API instance can use a recovered service');
});
test('a fresh busy background renderer is available and retains the existing in-flight deadline protections',async t=>{
  const h=harness(t),status=h.healthyService();status.busy=true;h.setService(status);
  assert.deepEqual(Array.from(await h.api.getFonts()),['Arial','Georgia']);assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getFonts');
});
test('startup grace waits only for the private heartbeat and sends one request once the renderer is ready',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:100});
  const pending=h.api.getFonts();await tick();const nativeReads=h.projectReads;
  await delay(15);assert.equal(h.projectReads,nativeReads,'heartbeat polling must not repeat native context calls');
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.ok(h.serviceReads>=2);
  h.setService(h.healthyService());assert.deepEqual(Array.from(await pending),['Arial','Georgia']);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getFonts');
});
test('a stale startup heartbeat can be replaced by a ready renderer within the grace period',async t=>{
  const h=harness(t,{serviceStartupGraceMs:100}),old=h.healthyService();old.updatedAt-=20000;old.version=0;h.setService(old);
  const pending=h.api.getFonts();await delay(15);assert.equal(h.requests.length,0);
  h.setService(h.healthyService());assert.deepEqual(Array.from(await pending),['Arial','Georgia']);assert.equal(h.requests.length,1);
});
for(const incompatible of ['version','action'])test(`a fresh incompatible renderer ${incompatible} fails immediately without heartbeat retries`,async t=>{
  const h=harness(t,{serviceStartupGraceMs:1000}),status=h.healthyService();
  if(incompatible==='version')status.version=2;else status.actions=['readTimeline'];h.setService(status);
  await assert.rejects(h.api.getFonts(),/unavailable or out of date/);
  assert.equal(h.serviceReads,1);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one');
});
test('an unavailable renderer after startup grace leaves the lane recoverable without a dangling request',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:30,readTimeoutMs:200});
  await assert.rejects(h.api.getFonts(),/Save your work, restart Premiere/);
  assert.ok(h.serviceReads>=2);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one');
  h.setService(h.healthyService());assert.deepEqual(Array.from(await h.api.getFonts()),['Arial','Georgia']);assert.equal(h.requests.length,1);
});
test('zero startup grace preserves an immediate unavailable response',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:0});await assert.rejects(h.api.getFonts(),/unavailable/);
  assert.equal(h.serviceReads,1);assert.equal(h.requests.length,0);
});
test('configured startup grace is capped at five seconds of elapsed heartbeat time',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:60000});
  const pending=assert.rejects(h.api.getFonts(),/unavailable/);await tick();h.advanceTime(6000);await pending;
  assert.equal(h.requests.length,0);assert.equal((await h.api.getActiveSequenceInfo()).id,'one');
});
test('a queued startup check reserves its remaining serial deadline instead of poisoning the lane',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const h=harness(t,{service:null,serviceStartupGraceMs:150,readTimeoutMs:200,transcribe:()=>gate});await h.api.getActiveSequenceInfo();
  const transcription=h.api.transcribeSequence('one');await tick();const startup=assert.rejects(h.api.getFonts(),/unavailable/);
  await delay(130);finish('done');await transcription;await startup;
  assert.equal(h.requests.length,0);assert.equal((await h.api.getActiveSequenceInfo()).id,'one');
});
test('disposing during startup stops heartbeat polling without writing a service request',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:100});
  const pending=assert.rejects(h.api.getFonts(),/plugin closed/);await tick();const reads=h.serviceReads;h.api.dispose();
  await pending;await delay(15);assert.equal(h.serviceReads,reads);assert.equal(h.requests.length,0);
});

test('native key edits use the internal CEP lane without deadlock or exposing a public arbitrary patch method',async t=>{
  let editStarted,continueEdit;const entered=new Promise(resolve=>{editStarted=resolve;}),gate=new Promise(resolve=>{continueEdit=resolve;});
  const descriptor={ok:true,path:'/projects/caption.mov',nativeMotion:{test:'captured'}};
  const caption={id:'cue',clipNodeId:'clip',projectItemId:'item',mediaPath:descriptor.path,renderBounds:{width:576,height:512},words:[{text:'private words'}]};
  const patch={version:1,descriptor,updates:[{property:'width',ticks:'0',expectedValue:100,value:125}]};
  const request={signature:'sig',frame:23,operation:'set-key',track:'width',keyTicks:'0',value:[720]};
  const h=harness(t,{serviceResult:input=>input.action==='readCaptionAreaDescriptor'?descriptor:{ok:true,descriptor,updates:patch.updates},textArea:{
    editArea:async(ppro,project,sequence,captured,input,revalidate,options)=>{
      assert.equal(sequence.name,'one');assert.deepEqual(captured,descriptor);assert.deepEqual(input,request);
      editStarted();await gate;
      caption.projectItemId='UI-mutated';caption.mediaPath='/unrelated.mov';caption.renderBounds.width=1;
      const fresh=await revalidate();assert.deepEqual(fresh,descriptor);
      return options.patchKeyValues(patch);
    },
  }});
  await h.api.getActiveSequenceInfo();h.select('two');await h.api.getActiveSequenceInfo();
  const editing=h.api.editCaptionArea(caption,'one',request);await entered;
  const before=h.projectReads,queued=h.api.getActiveSequenceInfo();await tick();assert.equal(h.projectReads,before,'the outer edit retains the serial native lane');
  continueEdit();assert.equal((await editing).ok,true);assert.equal((await queued).id,'two');
  assert.deepEqual(h.requests.map(r=>r.action),['readCaptionAreaDescriptor','readCaptionAreaDescriptor','patchCaptionKeyValues']);
  assert.ok(h.requests.every(r=>r.sequenceId==='one'));
  for(const input of h.requests){assert.equal(input.args[0].projectItemId,'item');assert.equal(input.args[0].mediaPath,descriptor.path);assert.equal(input.args[0].renderBounds.width,576);assert.equal(Object.hasOwn(input.args[0],'words'),false);}
  assert.deepEqual(h.requests.at(-1).args[1],patch);
  assert.equal(Object.hasOwn(h.requests.at(-1),'expiresAt'),false,'a mutation must not acquire the read-expiry contract');
  assert.equal(h.api.patchCaptionKeyValues,undefined,'only the trusted native editor gets the bounded internal callback');
});
