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
  const nativeReads={activeSequence:0,sequences:0,settings:0,frameRect:0,timebase:0,duration:0,playhead:0,tracks:0};
  const writes=[],requests=[];
  const timers=new Map();
  const now=()=> (options.manualTimers ? options.fixedNow??1700000000000 : Date.now())+clockOffset;
  const schedule=(callback,ms)=>{const timer=options.manualTimers?{}:setTimeout(()=>{timers.delete(timer);callback();},ms);timers.set(timer,{callback,ms});return timer;};
  const cancel=timer=>{timers.delete(timer);if(!options.manualTimers)clearTimeout(timer);};
  const sequences=['one','two'].map(id=>({guid:{toString:()=>options.guids?.[id]??id},name:id,
    getSettings:async()=>{nativeReads.settings++;return{getVideoFrameRect:async()=>{nativeReads.frameRect++;return{width:720,height:1280};}};},
    getTimebase:async()=>{nativeReads.timebase++;return 10584000000;},getEndTime:async()=>{nativeReads.duration++;return{seconds:10};},
    getPlayerPosition:async()=>{nativeReads.playhead++;return options.playhead?options.playhead(id):{seconds:id==='one'?2.5:7};},
    getVideoTrackCount:async()=>{nativeReads.tracks++;return 0;}}));
  const project={get path(){return projectPath;},getSequences:async()=>{nativeReads.sequences++;return sequences;},getActiveSequence:async()=>{nativeReads.activeSequence++;return sequences.find(s=>s.name===active);}};
  const folders=new Map();
  function folder(path) {
    if(folders.has(path))return folders.get(path);
    const entries=new Map(),value={nativePath:path,getEntries:async()=>[...entries].map(([name,file])=>({...file,name})),getEntry:async name=>{if(path==='/private/service'&&name==='service.json')serviceReads++;if(!entries.has(name))throw new Error('Entry not found');return entries.get(name);},entries};
    folders.set(path,value);return value;
  }
  const healthyService = () => ({version:1,instanceId:'a'.repeat(24),updatedAt:now(),busy:false,actions:['getFonts','getFontCatalog','showInPremiere','beginCaption','saveCaptionFrames','finishCaption','preflightCaptionClips','applyCaptionClips','readTimeline','selectCaptionClip','readCaptionMotion','readCaptionGeometry','readCaptionSelection','readCaptionAreaDescriptor','patchCaptionKeyValues','prepareCaptionTrack','readCaptionConsolidation','stageCaptionConsolidation','verifyCaptionConsolidation','rollbackCaptionConsolidation','generateNativeGraphics']});
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
  function respond(request= requests.at(-1),result={ok:true,cues:[]},extra={}){
    const name=request.id+'.json',responses=folder('/private/service/responses');
    folder('/private/service/requests').entries.delete(name);
    responses.entries.set(name,{data:{version:1,id:request.id,sequenceId:request.sequenceId,projectPath:request.projectPath,result,...extra},delete:async()=>responses.entries.delete(name)});
  }
  const native={fetchTranscript:async sequence=>sequence.name,transcribe:async sequence=>options.transcribe?options.transcribe(sequence):sequence.name};
  const module={exports:{}};
  const context={module,exports:module.exports,setTimeout:schedule,clearTimeout:cancel,Date:{now},Map,Set,require:name=>{
    if(name==='premierepro')return {Project:{getActiveProject:async()=>{projectReads++;return options.noProject?null:project;}},Constants:{TrackItemType:{CLIP:1}}};
    if(name==='uxp')return {storage:{localFileSystem:{getDataFolder:async()=>folder('/plugin-data')}}};
    if(name==='./style-presets.js')return require('../uxp/style-presets.js');
    if(name==='./storage.js')return storage;
    if(name==='./transcript.js')return native;
    if(name==='./paths.js')return require('../uxp/paths.js');
    if(name==='./text-area.js'&&options.textArea)return options.textArea;
    if(name==='./consolidation.js'&&options.consolidation)return options.consolidation;
    throw new Error('Unexpected import '+name);
  }};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/api.js',import.meta.url),'utf8'),context);
  const api=module.exports.createHostAPI({readTimeoutMs:options.readTimeoutMs??12000,serviceStartupGraceMs:options.serviceStartupGraceMs??0,serviceStartupPollMs:options.serviceStartupPollMs??5});t.after(()=>api.dispose());
  return {api,writes,requests,respond,setService,healthyService,now,fireTimeout(ms){const entry=[...timers].find(([,value])=>value.ms===ms);assert.ok(entry,'Expected timer '+ms);cancel(entry[0]);entry[1].callback();},advanceTime:ms=>{clockOffset+=ms;},select:id=>{active=id;},relocate:path=>{projectPath=path;},nativeReads:()=>({...nativeReads}),get projectReads(){return projectReads;},get serviceReads(){return serviceReads;}};
}

test('idle playhead sampling reads only the active project, sequence and time without creating a session context',async t=>{
  const h=harness(t,{service:null});
  const position=await h.api.readPlayheadIfIdle();
  assert.deepEqual(JSON.parse(JSON.stringify(position)),{sequenceId:'one',projectPath:'/projects/edit.prproj',time:2.5});
  assert.equal(h.projectReads,1);assert.deepEqual(h.nativeReads(),{activeSequence:1,sequences:0,settings:0,frameRect:0,timebase:0,duration:0,playhead:1,tracks:0});
  assert.equal(h.serviceReads,0);assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
  await assert.rejects(h.api.loadSession('one'),/Refresh the sequence/,'a cheap sample must not pretend it captured a full session');
  h.select('two');h.relocate('/copied/project.prproj');
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.readPlayheadIfIdle())),{sequenceId:'two',projectPath:'/copied/project.prproj',time:7});
});
test('a delayed playhead read retains its captured project and GUID instead of mixing in a later active sequence',async t=>{
  let finish;const guid='{A14706AA-93BB-74D3-A5FD-C8974E471C87}',h=harness(t,{guids:{one:guid},playhead:()=>new Promise(resolve=>{finish=resolve;})});
  const sampling=h.api.readPlayheadIfIdle();await tick();h.select('two');h.relocate('/different/edit.prproj');finish({seconds:0});
  assert.deepEqual(JSON.parse(JSON.stringify(await sampling)),{sequenceId:'a14706aa-93bb-74d3-a5fd-c8974e471c87',projectPath:'/projects/edit.prproj',time:0});
  assert.equal(h.nativeReads().playhead,1);assert.equal(h.nativeReads().settings,0);assert.equal(h.requests.length,0);
});
test('playhead sampling returns no position for absent projects/sequences and invalid native times',async t=>{
  const absent=harness(t,{noProject:true});assert.equal(await absent.api.readPlayheadIfIdle(),null);assert.equal(absent.nativeReads().activeSequence,0);
  const noSequence=harness(t);noSequence.select('closed');assert.equal(await noSequence.api.readPlayheadIfIdle(),null);assert.equal(noSequence.nativeReads().playhead,0);
  for(const seconds of [-1,NaN,Infinity,undefined]){
    const h=harness(t,{playhead:()=>({seconds})});assert.equal(await h.api.readPlayheadIfIdle(),null);assert.equal(h.requests.length,0);assert.equal(h.nativeReads().tracks,0);
  }
});
test('busy and queued native work makes the sampler skip immediately without joining the queue',async t=>{
  let finish,entered;const started=new Promise(resolve=>{entered=resolve;});
  const h=harness(t,{transcribe:async()=>{entered();await new Promise(resolve=>{finish=resolve;});return 'done';}});await h.api.getActiveSequenceInfo();
  const working=h.api.transcribeSequence('one');await started;const before=h.projectReads,reads=h.nativeReads();
  assert.equal(await h.api.readPlayheadIfIdle(),null);
  const queued=h.api.getActiveSequenceInfo();assert.equal(await h.api.readPlayheadIfIdle(),null);
  assert.equal(h.projectReads,before);assert.deepEqual(h.nativeReads(),reads);assert.equal(h.requests.length,0);
  finish();assert.equal(await working,'done');await queued;assert.equal((await h.api.readPlayheadIfIdle()).time,2.5);
});
test('a pending sampler timeout keeps the single native lane occupied and never repeats the SDK read',async t=>{
  let finish;const h=harness(t,{readTimeoutMs:50,playhead:()=>new Promise(resolve=>{finish=resolve;})});
  const states=[];h.api.onTransportAvailability(state=>states.push({...state}));
  const pending=h.api.readPlayheadIfIdle();await tick();assert.equal(await h.api.readPlayheadIfIdle(),null);h.fireTimeout(50);
  await assert.rejects(pending,error=>error.code==='BC_NATIVE_PENDING'&&error.method==='readTimelinePlayhead'&&error.recoverable===true&&error.operationPending===true);
  const reads=h.projectReads;assert.equal(await h.api.readPlayheadIfIdle(),null);
  await assert.rejects(h.api.getActiveSequenceInfo(),{code:'BC_NATIVE_WAITING'});assert.equal(h.projectReads,reads);
  assert.equal(states.at(-1).state,'waiting');assert.equal(states.at(-1).method,'readTimelinePlayhead');
  finish({seconds:4});await tick();assert.equal(h.api.getTransportAvailability().state,'ready');assert.equal(h.nativeReads().playhead,1);
  assert.deepEqual(states.map(state=>state.state),['ready','waiting','ready']);assert.equal(h.requests.length,0);
});
test('disposing before or during sampling prevents new reads and late completion cannot reopen the lane',async t=>{
  const closed=harness(t);closed.api.dispose();assert.equal(await closed.api.readPlayheadIfIdle(),null);assert.equal(closed.projectReads,0);
  let finish;const h=harness(t,{playhead:()=>new Promise(resolve=>{finish=resolve;})});
  const sampling=h.api.readPlayheadIfIdle();await tick();h.api.dispose();
  await assert.rejects(sampling,error=>error.code==='BC_NATIVE_CLOSED'&&error.operationPending===true);
  finish({seconds:3});await tick();assert.equal(await h.api.readPlayheadIfIdle(),null);assert.equal(h.api.getTransportAvailability().state,'closed');assert.equal(h.nativeReads().playhead,1);
});

test('style preset storage works without a project or renderer and serializes stale writers', async t => {
  const h = harness(t, { service: null });
  const initial = await h.api.loadStylePresets();
  assert.equal(initial.revision, 0); assert.equal(initial.presets.length, 0);
  const results = await Promise.allSettled([h.api.saveStylePresets(initial), h.api.saveStylePresets(initial)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /another panel/);
  assert.equal((await h.api.loadStylePresets()).revision, 1);
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].path, '/plugin-data');
  assert.equal(h.writes[0].name, 'style-presets.json');
  assert.equal(h.projectReads, 0); assert.equal(h.serviceReads, 0); assert.equal(h.requests.length, 0);
});

test('native graphics freezes its explicit source and mode while queued and never retries an uncertain import',async t=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const receipt={ok:true,status:'import-unconfirmed',automaticRetryAllowed:false};
 const h=harness(t,{transcribe:async()=>{entered();await gate;return 'done';},serviceResult:request=>{assert.equal(request.action,'generateNativeGraphics');return receipt;}});
 await h.api.getActiveSequenceInfo();const busy=h.api.transcribeSequence('one');await started;
 const source={sequenceId:'one',captions:[{text:'Keep original words'}],style:{fontSize:72}},mode={mode:'import-new-sequence'};
 const generating=h.api.generateNativeGraphics(source,mode,'one');source.captions[0].text='Changed later';mode.mode='save-only';
 release();await busy;assert.deepEqual(await generating,receipt);assert.equal(h.requests.length,1);assert.equal(h.requests[0].sequenceId,'one');assert.equal(h.requests[0].projectPath,'/projects/edit.prproj');
 assert.equal(h.requests[0].args[0].captions[0].text,'Keep original words');assert.equal(h.requests[0].args[1].mode,'import-new-sequence');assert.equal(h.requests[0].expiresAt,undefined,'generation must not be treated as a replayable read');
 for(const args of [[{...source,sequenceId:'two'},mode,'one'],[source,{},'one'],[source,{mode:'auto'},'one']])await assert.rejects(h.api.generateNativeGraphics(...args),/explicit native graphics/);
 assert.equal(h.requests.length,1);
});

test('completed native graphics receipts survive a project change after the service finishes without retrying',async t=>{
 for(const status of ['saved','imported','import-unconfirmed']){
  const generationId='a'.repeat(32),directory='/projects/Better Captions/one/native-graphics-'+generationId;
  const receipt={ok:true,version:1,generationId,source:{sequenceId:'one',projectPath:'/projects/edit.prproj'},status,importAttempted:status!=='saved',automaticRetryAllowed:false,
   artifacts:{directory,xml:directory+'/graphics.xml',manifest:directory+'/manifest.json',srt:directory+'/source-plan.srt'},verification:status==='imported'?'new-sequence-identity-and-settings':'artifacts-only',warnings:['Retain this generation before any manual retry.'],
   ...(status==='imported'?{nativeSequence:{id:'created-native-sequence',name:'Better Captions graphics '+generationId}}:{})};
  let h;h=harness(t,{serviceResult:request=>{assert.equal(request.action,'generateNativeGraphics');h.relocate('/projects/changed-after-'+status+'.prproj');return receipt;}});
  await h.api.getActiveSequenceInfo();
  const result=await h.api.generateNativeGraphics({sequenceId:'one',projectPath:'/projects/edit.prproj',captions:[],style:{}},{mode:status==='saved'?'save-only':'import-new-sequence'},'one');
  assert.equal(result,receipt,'the exact completed receipt must remain available after a project switch or Save As');
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].sequenceId,'one');assert.equal(h.requests[0].projectPath,'/projects/edit.prproj');
 }
});

test('native graphics receipt preservation keeps pre-write and envelope checks while other writes retain their final context guard',async t=>{
 const stale=harness(t);await stale.api.getActiveSequenceInfo();stale.relocate('/projects/before-request.prproj');
 await assert.rejects(stale.api.generateNativeGraphics({sequenceId:'one',captions:[],style:{}},{mode:'save-only'},'one'),/project location changed/);assert.equal(stale.requests.length,0);
 const mismatch=harness(t,{autoRespond:false});await mismatch.api.getActiveSequenceInfo();
 const generating=mismatch.api.generateNativeGraphics({sequenceId:'one',captions:[],style:{}},{mode:'save-only'},'one');await tick();
 mismatch.respond(mismatch.requests[0],{ok:true,status:'saved'},{projectPath:'/foreign/project.prproj'});
 await assert.rejects(generating,/mismatched response/);assert.equal(mismatch.requests.length,1);
 let other;other=harness(t,{serviceResult:request=>{assert.equal(request.action,'beginCaption');other.relocate('/projects/changed-after-other-write.prproj');return '/generated/caption';}});await other.api.getActiveSequenceInfo();
 await assert.rejects(other.api.beginCaption('caption-one','one'),/project location changed/);assert.equal(other.requests.length,1);
});

function conversionFixture(t,mode='success'){
 const previous=[{id:'old-a',clipNodeId:'a'},{id:'old-b',clipNodeId:'b'}],caption={id:'bundle',captionBundle:true,mediaPath:'/generated/new.mov'};
 const plan={ok:true,version:1,sequenceId:'one',projectPath:'/projects/edit.prproj',signature:'native-proof',clips:structuredClone(previous)};
 let complete=false,entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const h=harness(t,{
  serviceResult:request=>{
   if(request.action==='readCaptionConsolidation')return {...plan,signature:mode==='stale'?'changed':plan.signature};
   if(request.action==='prepareCaptionTrack')return {ok:true,sequenceId:'one',projectPath:plan.projectPath,destination:{mode:'reuse',trackIndex:2}};
   if(request.action==='stageCaptionConsolidation')return {ok:true,cues:[{id:'bundle',clipNodeId:'new-node',projectItemId:'new-item',path:caption.mediaPath,start:0,end:5}]};
   if(request.action==='verifyCaptionConsolidation')return mode==='partial'?{error:'Only some legacy clips remain'}:{ok:true,complete,clips:structuredClone(previous)};
   if(request.action==='rollbackCaptionConsolidation')return {ok:true,rolledBack:true};
   assert.fail('Unexpected conversion action '+request.action);
  },
  consolidation:{async removeLegacyClips(ppro,project,sequence,proof,verify){
   assert.equal(sequence.name,'one');assert.equal(proof.signature,'native-proof');entered();if(mode==='gated')await gate;
   if(mode==='reject'||mode==='partial')throw new Error('native transaction refused');
   assert.equal((await verify()).complete,false);complete=true;
   if(mode==='uncertain')throw new Error('native response lost');
   assert.equal((await verify()).complete,true);
  }},
 });
 return {...h,previous,caption,plan,started,release};
}

test('deleted-link recovery stays frozen through automatic destination preparation and final Apply',async t=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const h=harness(t,{serviceResult:async request=>{
  if(request.action==='preflightCaptionClips')return {ok:true};
  if(request.action==='prepareCaptionTrack'){entered();await gate;return {ok:true,sequenceId:'one',projectPath:'/projects/edit.prproj',destination:{mode:'reuse',trackIndex:2}};}
  if(request.action==='applyCaptionClips')return {ok:true,cues:[{id:'bundle',clipNodeId:'new-node'}]};
  assert.fail('Unexpected recovery action '+request.action);
 }});
 const captions=[{id:'bundle',mediaPath:'/generated/new.mov'}],previous=[{id:'bundle'}],deleted=[{id:'bundle',clipNodeId:'old-node',projectItemId:'old-item',mediaPath:'/generated/old.mov'}];
 await h.api.getActiveSequenceInfo();await h.api.preflightCaptionClips(captions,-1,'one',deleted);
 const pending=h.api.applyCaptionClips(captions,-1,'one',previous,deleted);await started;deleted[0].clipNodeId='edited-later';captions[0].id='edited-later';previous[0].id='edited-later';release();assert.equal((await pending).cues[0].clipNodeId,'new-node');
 assert.deepEqual(h.requests.map(request=>request.action),['preflightCaptionClips','prepareCaptionTrack','applyCaptionClips']);
 for(const request of h.requests.slice(1)){assert.equal(request.sequenceId,'one');assert.equal(request.args[0][0].id,'bundle');assert.equal(request.args[2][0].id,'bundle');assert.equal(request.args[3][0].clipNodeId,'old-node');assert.equal(request.args[3][0].mediaPath,'/generated/old.mov');}
 assert.equal(h.requests.at(-1).args[1],2);
 await assert.rejects(h.api.preflightCaptionClips(captions,-1,'one','injected'),/Invalid deleted/);await assert.rejects(h.api.applyCaptionClips(captions,-1,'one',previous,{}),/Invalid deleted/);assert.equal(h.requests.length,3);
});

test('legacy conversion keeps one serial native lane and freezes its identities through verified replacement',async t=>{
 const h=conversionFixture(t,'gated');await h.api.getActiveSequenceInfo();
 const pending=h.api.applyConsolidatedCaption(h.caption,h.previous,h.plan,'one');await h.started;
 h.caption.id='changed-by-editor';h.previous[0].clipNodeId='unrelated';h.plan.signature='changed-by-editor';
 const before=h.requests.length,queued=h.api.getActiveSequenceInfo();await tick();assert.equal(h.requests.length,before);
 h.release();assert.equal((await pending).cues[0].clipNodeId,'new-node');assert.equal((await queued).id,'one');
 assert.deepEqual(h.requests.map(request=>request.action),['readCaptionConsolidation','prepareCaptionTrack','stageCaptionConsolidation','verifyCaptionConsolidation','verifyCaptionConsolidation']);
 for(const request of h.requests){assert.equal(request.sequenceId,'one');assert.equal(request.projectPath,'/projects/edit.prproj');}
 const stage=h.requests[2];assert.equal(stage.args[1],2);assert.equal(stage.args[2][0].clipNodeId,'a');assert.equal(stage.args[3].signature,'native-proof');assert.equal(Object.hasOwn(stage,'expiresAt'),false);
 for(const request of h.requests.slice(3)){assert.equal(request.args[0].id,'bundle');assert.equal(request.args[0].clipNodeId,'new-node');assert.equal(request.args[1][0].clipNodeId,'a');assert.equal(request.args[2].signature,'native-proof');}
 assert.equal(typeof h.api.stageCaptionConsolidation,'undefined');assert.equal(typeof h.api.rollbackCaptionConsolidation,'undefined');
});

test('legacy conversion rolls back only a fully verified untouched original set',async t=>{
 const stale=conversionFixture(t,'stale');await stale.api.getActiveSequenceInfo();await assert.rejects(stale.api.applyConsolidatedCaption(stale.caption,stale.previous,stale.plan,'one'),/geometry changed/);assert.equal(stale.requests.length,1);
 const rejected=conversionFixture(t,'reject');await rejected.api.getActiveSequenceInfo();await assert.rejects(rejected.api.applyConsolidatedCaption(rejected.caption,rejected.previous,rejected.plan,'one'),/Original clips were preserved/);
 assert.deepEqual(rejected.requests.slice(-2).map(request=>request.action),['verifyCaptionConsolidation','rollbackCaptionConsolidation']);
 const partial=conversionFixture(t,'partial');await partial.api.getActiveSequenceInfo();await assert.rejects(partial.api.applyConsolidatedCaption(partial.caption,partial.previous,partial.plan,'one'),/native transaction refused/);
 assert.equal(partial.requests.some(request=>request.action==='rollbackCaptionConsolidation'),false,'uncertain partial removal must retain the replacement');
});

test('an uncertain native transaction that actually removed all originals retains the verified replacement',async t=>{
 const h=conversionFixture(t,'uncertain');await h.api.getActiveSequenceInfo();assert.equal((await h.api.applyConsolidatedCaption(h.caption,h.previous,h.plan,'one')).ok,true);
 assert.equal(h.requests.at(-1).action,'verifyCaptionConsolidation');assert.equal(h.requests.some(request=>request.action==='rollbackCaptionConsolidation'),false);
});

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
test('font catalog metadata crosses the captured read lane without changing installed weights or pretending it is a mutation',async t=>{
  const catalog=[{family:'Café Display',weights:[350,380,617],italic:false,variable:{min:350,max:617}}];
  const h=harness(t,{serviceResult:input=>{assert.equal(input.action,'getFontCatalog');return catalog;}});
  assert.deepEqual(JSON.parse(JSON.stringify(await h.api.getFontCatalog())),catalog);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getFontCatalog');assert.deepEqual(Array.from(h.requests[0].args),[]);
  assert.equal(h.requests[0].sequenceId,'one');assert.equal(h.requests[0].projectPath,'/projects/edit.prproj');assert.equal(h.requests[0].expiresAt-h.requests[0].createdAt,10000);
});
test('a timed-out catalog read holds the lane until its real reply and never retries itself',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:50});await h.api.getActiveSequenceInfo();
  const catalog=h.api.getFontCatalog();await tick();h.fireTimeout(50);
  await assert.rejects(catalog,error=>error.code==='BC_NATIVE_PENDING'&&error.method==='getFontCatalog'&&error.recoverable===true&&error.operationPending===true);
  await assert.rejects(h.api.getActiveSequenceInfo(),{code:'BC_NATIVE_WAITING'});assert.equal(h.requests.length,1);
  h.respond(h.requests[0],[{family:'One',weights:[400],italic:false}]);await delay(220);
  assert.equal(h.api.getTransportAvailability().state,'ready');assert.equal(h.requests.length,1);
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
  await assert.rejects(h.api.getActiveSequenceInfo(),{code:'BC_NATIVE_WAITING'});
  assert.equal(h.projectReads,reads,'a timeout cannot release the native lane and issue another call');
  h.respond();await delay(180);
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one','the lane may resume only after the real response arrives');
});
test('a late native selection reply wakes observers only after real completion and never repeats its request',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:30000});await h.api.getActiveSequenceInfo();
  const statuses=[];let resume;
  h.api.onTransportAvailability(status=>{statuses.push(status);if(status.state==='ready'&&statuses.some(item=>item.state==='waiting'))resume=h.api.getActiveSequenceInfo();});
  h.api.onTransportAvailability(()=>{throw new Error('An observer cannot interrupt the native lane');});
  assert.equal(h.api.getTransportAvailability().state,'ready');
  const read=h.api.readCaptionSelection([{id:'caption'}],'one');await tick();h.fireTimeout(30000);
  await assert.rejects(read,error=>error.code==='BC_NATIVE_PENDING'&&error.method==='readCaptionSelection'&&error.recoverable===true&&error.operationPending===true);
  assert.equal(statuses.at(-1).state,'waiting');assert.equal(statuses.at(-1).reason,'native-timeout');assert.equal(statuses.at(-1).method,'readCaptionSelection');
  const nativeReads=h.projectReads;
  await assert.rejects(h.api.getActiveSequenceInfo(),error=>error.code==='BC_NATIVE_WAITING'&&error.recoverable===true&&error.operationPending===true);
  assert.equal(h.projectReads,nativeReads);assert.equal(resume,undefined);assert.equal(h.requests.length,1);
  h.respond();h.fireTimeout(150);await tick();await tick();
  assert.equal(statuses.at(-1).state,'ready');assert.ok(statuses.at(-1).revision>statuses[1].revision);
  assert.equal((await resume).id,'one','a recovery callback can use the lane only after its real promise has settled');
  assert.deepEqual(h.requests.map(request=>request.action),['readCaptionSelection']);
  assert.equal(h.api.getTransportAvailability().state,'ready');
});
test('a late native failure also releases the availability circuit without replaying the expired read',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:30000});await h.api.getActiveSequenceInfo();
  const statuses=[];h.api.onTransportAvailability(status=>statuses.push(status));
  const read=h.api.readCaptionGeometry([],'one');await tick();h.fireTimeout(30000);await assert.rejects(read,{code:'BC_NATIVE_PENDING'});
  h.respond(undefined,undefined,{error:'The original native read failed.'});h.fireTimeout(150);await tick();await tick();
  assert.deepEqual(statuses.map(status=>status.state),['ready','waiting','ready']);assert.equal(h.requests.length,1);
  assert.equal((await h.api.getActiveSequenceInfo()).id,'one');
});
test('timed-out mutations stay occupied, report an uncertain result and are never retried on recovery',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:30000});await h.api.getActiveSequenceInfo();
  const statuses=[];h.api.onTransportAvailability(status=>statuses.push(status));
  const write=h.api.beginCaption('caption','one');await tick();h.fireTimeout(60000);
  await assert.rejects(write,error=>error.code==='BC_NATIVE_PENDING'&&error.method==='beginCaption'&&error.recoverable===false&&error.operationPending===true);
  assert.equal(statuses.at(-1).state,'waiting');assert.equal(statuses.at(-1).method,'beginCaption');
  await assert.rejects(h.api.beginCaption('caption','one'),{code:'BC_NATIVE_WAITING'});assert.equal(h.requests.length,1);
  h.respond();h.fireTimeout(150);await tick();await tick();assert.equal(statuses.at(-1).state,'ready');
  assert.deepEqual(h.requests.map(request=>request.action),['beginCaption']);
});
test('availability helpers are local snapshots, unsubscribe cleanly and never resurrect a disposed lane',async t=>{
  const h=harness(t,{autoRespond:false,readTimeoutMs:30000});await h.api.getActiveSequenceInfo();
  const initialReads=h.projectReads,statuses=[];
  const unsubscribe=h.api.onTransportAvailability(status=>{statuses.push(status);status.state='closed';});
  assert.equal(h.api.getTransportAvailability().state,'ready');assert.equal(h.projectReads,initialReads);assert.equal(h.requests.length,0);
  const read=h.api.readCaptionSelection([],'one');await tick();h.fireTimeout(30000);await assert.rejects(read,{code:'BC_NATIVE_PENDING'});
  unsubscribe();const count=statuses.length;h.api.dispose();h.respond();h.fireTimeout(150);await tick();await tick();
  assert.equal(statuses.length,count);assert.equal(h.api.getTransportAvailability().state,'closed');
  await assert.rejects(h.api.getActiveSequenceInfo(),error=>error.code==='BC_NATIVE_CLOSED'&&error.recoverable===false);
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
test('a renderer outage is safe to retry only before any mutation in the serialized job was submitted',async t=>{
  const first=harness(t,{service:null});await first.api.getActiveSequenceInfo();
  await assert.rejects(first.api.applyCaptionClips([{id:'bundle'}],0,'one'),error=>error.code==='BC_RENDERER_UNAVAILABLE'&&error.method==='applyCaptionClips'&&error.recoverable===true&&error.operationPending===false);
  assert.equal(first.requests.length,0);
  let second;second=harness(t,{serviceResult:request=>{
    assert.equal(request.action,'prepareCaptionTrack');second.setService(null);
    return {ok:true,sequenceId:'one',projectPath:'/projects/edit.prproj',destination:{mode:'reuse',trackIndex:2}};
  }});await second.api.getActiveSequenceInfo();
  await assert.rejects(second.api.applyCaptionClips([{id:'bundle'}],-1,'one'),error=>error.code==='BC_RENDERER_UNAVAILABLE'&&error.method==='applyCaptionClips'&&error.recoverable===false&&error.operationPending===false);
  assert.deepEqual(second.requests.map(request=>request.action),['prepareCaptionTrack'],'a partial job must not replay its completed preparation or start final Apply');
});
test('startup grace waits only for the private heartbeat and sends one request once the renderer is ready',async t=>{
  const h=harness(t,{service:null,serviceStartupGraceMs:100,manualTimers:true});
  const pending=h.api.getFonts();await tick();const nativeReads=h.projectReads;
  assert.equal(h.now(),1700000000000);assert.equal(h.serviceReads,1);
  for(let i=0;i<3;i++){h.advanceTime(5);h.fireTimeout(5);await tick();}
  assert.equal(h.now(),1700000000015);assert.equal(h.projectReads,nativeReads,'heartbeat polling must not repeat native context calls');
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.serviceReads,4);
  h.setService(h.healthyService());h.advanceTime(5);h.fireTimeout(5);assert.deepEqual(Array.from(await pending),['Arial','Georgia']);
  assert.equal(h.serviceReads,5);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'getFonts');
});
test('a stale startup heartbeat can be replaced by a ready renderer within the grace period',async t=>{
  const h=harness(t,{serviceStartupGraceMs:100,manualTimers:true}),old=h.healthyService();old.updatedAt-=20000;old.version=0;h.setService(old);
  const pending=h.api.getFonts();await tick();const nativeReads=h.projectReads;
  for(let i=0;i<3;i++){h.advanceTime(5);h.fireTimeout(5);await tick();}
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.equal(h.serviceReads,4);assert.equal(h.projectReads,nativeReads);
  h.setService(h.healthyService());h.advanceTime(5);h.fireTimeout(5);assert.deepEqual(Array.from(await pending),['Arial','Georgia']);
  assert.equal(h.serviceReads,5);assert.equal(h.requests.length,1);
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
