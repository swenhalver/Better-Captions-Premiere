import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(t, options = {}) {
  let active='one',projectPath='/projects/edit.prproj',counter=0;
  let projectReads=0,clockOffset=0;
  const writes=[],requests=[];
  const sequences=['one','two'].map(id=>({guid:{toString:()=>id},name:id,getSettings:async()=>({getVideoFrameRect:async()=>({width:720,height:1280})}),getTimebase:async()=>10584000000,getEndTime:async()=>({seconds:10}),getPlayerPosition:async()=>({seconds:id==='one'?2.5:7}),getVideoTrackCount:async()=>0}));
  const project={get path(){return projectPath;},getSequences:async()=>sequences,getActiveSequence:async()=>sequences.find(s=>s.name===active)};
  const folders=new Map();
  function folder(path) {
    if(folders.has(path))return folders.get(path);
    const entries=new Map(),value={nativePath:path,getEntry:async name=>{if(!entries.has(name))throw new Error('Entry not found');return entries.get(name);},entries};
    folders.set(path,value);return value;
  }
  const healthyService = () => ({version:1,instanceId:'a'.repeat(24),updatedAt:Date.now()+clockOffset,busy:false,actions:['getFonts','showInPremiere','beginCaption','saveCaptionFrames','finishCaption','preflightCaptionClips','applyCaptionClips','readTimeline','selectCaptionClip','readCaptionMotion','readCaptionGeometry','readCaptionSelection']});
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
        if(options.autoRespond!==false)respond(value,['Arial','Georgia']);
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
    throw new Error('Unexpected import '+name);
  }};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/api.js',import.meta.url),'utf8'),context);
  const api=module.exports.createHostAPI({readTimeoutMs:options.readTimeoutMs??12000});t.after(()=>api.dispose());
  return {api,writes,requests,respond,setService,healthyService,advanceTime:ms=>{clockOffset+=ms;},select:id=>{active=id;},relocate:path=>{projectPath=path;},get projectReads(){return projectReads;}};
}

test('direct native requests and slow saves retain the captured sequence after selection changes',async t=>{
  const h=harness(t);assert.equal((await h.api.getActiveSequenceInfo()).playhead,2.5);h.select('two');assert.equal((await h.api.getActiveSequenceInfo()).playhead,7);
  assert.equal(await h.api.fetchTranscriptJSON('one'),'one');
  await h.api.saveSession({sequenceId:'one',captions:[{text:'original'}]});
  assert.equal(h.writes.at(-1).path,'/projects/Better Captions/one');
  assert.equal(h.writes.at(-1).value.sequenceId,'one');
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
