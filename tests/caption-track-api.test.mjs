import test from 'node:test';
import {decodeNativePanelDocument} from '../webview-ui/src/lib/native-effect/panel.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {prepareNativeCreation} from '../webview-ui/src/lib/native-effect/create.ts';
import {DEFAULT_STYLE,DEFAULT_ANIMATION} from '../webview-ui/src/lib/types.ts';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript');
const source=fs.readFileSync(new URL('../webview-ui/src/cep-api.ts',import.meta.url),'utf8');
function fixture(options={}){
 const nativePath=options.platform==='win32'?path.win32:options.platform==='darwin'?path.posix:path;
 const prefix=options.platform==='win32'?'C:\\Project':'/project';
 const context={id:'seq-a',projectPath:options.platform?nativePath.join(prefix,'edit.prproj'):'/project/edit.prproj',width:720,height:1280,fps:24,ticksPerFrame:'10584000000',tracks:[{index:0,locked:false}]},directory=options.platform?nativePath.join(prefix,'Better Captions','seq-a'):'/project/Better Captions/seq-a',jobs=new Map(),calls=[],probes=[];
 const media=options.platform?nativePath.join(directory,'caption-bundle-run','caption.mov'):directory+'/caption-bundle-run/caption.mov';
 let current={...context};
 const runtime={path:nativePath,directory:()=>directory,writeJSON:(file,data)=>jobs.set(file,data),readJob(data){const file='/private/read-'+jobs.size+'.json';jobs.set(file,data);return file;},disposeReadJob:file=>jobs.delete(file),
  fs:{lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>options.symlink===true}),realpathSync:file=>file},
  platform:{resolveTool:name=>'/trusted/'+name},
  async run(...args){probes.push(args);if(options.afterProbe)current=options.afterProbe(current);return options.probe??JSON.stringify({streams:[{codec_type:'video'}]});}};
 const window={require:name=>name==='node:path'?nativePath:name==='node:crypto'?crypto:runtime,__adobe_cep__:{getSystemPath:()=>'/extension',evalScript(expression,callback){
  if(expression==='"BC_NATIVE_EVAL_V1"')return callback('BC_NATIVE_EVAL_V1');
  if(expression.includes('/*better-captions-host-ready-v1*/'))return callback('{"version":1,"ok":true,"loaded":false}'); if(expression.includes('/*better-captions-host-global-v1*/'))return callback('BC_HOST_GLOBAL_READY_V1');
  const method=expression.slice('BetterCaptionsHost.'.length,expression.indexOf('(')),args=JSON.parse('['+expression.slice(expression.indexOf('(')+1,-1)+']');
  calls.push({method,args});
  if(method==='context')return callback(JSON.stringify(current));
  const payload=jobs.get(args[0]);assert.ok(payload,'host mutation must receive its own saved job');
  calls[calls.length-1].payload=payload;
  if(['readTimeline','readCaptionMotion','readCaptionGeometry','readCaptionSelection','readCaptionAreaDescriptor','selectCaptionClip','apply','preflight','readCaptionConsolidation','stageCaptionConsolidation','verifyCaptionConsolidation','rollbackCaptionConsolidation'].includes(method))return callback(JSON.stringify({ok:true,cues:[]}));
  if(method==='createNativeCaptionDocument')return callback(JSON.stringify({ok:true,readbackVerified:true}));
  if(method!=='prepareCaptionTrack')return assert.fail('Unexpected native method '+method);
  const create=payload.track===-1&&!payload.cues.every(cue=>cue.clipNodeId);
  callback(JSON.stringify({ok:true,sequenceId:context.id,projectPath:context.projectPath,
   destination:{mode:create?'create':'linked',trackIndex:create?1:null,expectedVideoTrackCount:1,newCaptionCount:create?1:0},
   seed:create?{id:payload.cues[0].id,path:payload.cues[0].path,...options.seed}:null}));
 }}};
 const exports={},code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,window,console,require:name=>{if(name==='./lib/native-effect/panel.ts')return {decodeNativePanelDocument};assert.match(name,/style-presets/);return {};}});
 const caption={id:'bundle',text:'A whole caption track.',startTime:.25,endTime:5,mediaPath:media};
 return {api:exports.createHostAPI(),caption,context,directory,jobs,calls,probes,media};
}
test('automatic-track adapter proves generated media is video-only and preserves exact captured timing and source',async()=>{
 const f=fixture();await f.api.getActiveSequenceInfo();const result=await f.api.prepareCaptionTrack([f.caption],-1,'seq-a');
 assert.equal(result.seed.videoOnly,true);assert.equal(result.seed.path,f.media);
 assert.deepEqual(JSON.parse(JSON.stringify(f.probes)),[['/trusted/ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',f.media],{timeout:15000}]]);
 const payload=[...f.jobs.values()][0];assert.equal(payload.sequenceId,'seq-a');assert.equal(payload.projectPath,f.context.projectPath);assert.equal(payload.track,-1);assert.equal(payload.cues[0].startFrame,6);assert.equal(payload.cues[0].endFrame,120);assert.equal(payload.cues[0].path,f.media);
 assert.deepEqual(f.calls.map(call=>call.method),['context','context','context','prepareCaptionTrack']);
});
test('audio, multiple video streams, malformed media, and a changed project cannot reach the import endpoint',async()=>{
 for(const options of [
  {probe:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'audio'}]})},
  {probe:JSON.stringify({streams:[{codec_type:'video'},{codec_type:'video'}]})},
  {probe:JSON.stringify({streams:[]})},{probe:'broken-json'},
  {afterProbe:current=>({...current,projectPath:'/project/other.prproj'})},
 ]){
  const f=fixture(options);await f.api.getActiveSequenceInfo();await assert.rejects(f.api.prepareCaptionTrack([f.caption],-1,'seq-a'));
  assert.equal(f.calls.filter(call=>call.method==='prepareCaptionTrack').length,0);assert.equal(f.jobs.size,0);
 }
});
test('only exact generated media paths can be prepared, never symbolic links or another sequence assets',async()=>{
 for(const options of [{symlink:true},{}]){
  const f=fixture(options);await f.api.getActiveSequenceInfo();const caption=options.symlink?f.caption:{...f.caption,mediaPath:'/project/Better Captions/other/caption-bundle/caption.mov'};
  await assert.rejects(f.api.prepareCaptionTrack([caption],-1,'seq-a'),/generated|symbolic link/);assert.equal(f.probes.length,0);assert.equal(f.jobs.size,0);
 }
});
test('an all-linked caption update prepares no track and retains its previous source identity without probing',async()=>{
 const f=fixture(),linked={...f.caption,clipNodeId:'clip-a',projectItemId:'item-a'},previous={...linked,mediaPath:f.directory+'/caption-old-run/caption.mov'};
 await f.api.getActiveSequenceInfo();const result=await f.api.prepareCaptionTrack([linked],-1,'seq-a',[previous]);
 assert.equal(result.seed,null);assert.equal(f.probes.length,0);const payload=[...f.jobs.values()][0];assert.equal(payload.cues[0].clipNodeId,'clip-a');assert.equal(payload.cues[0].previousPath,previous.mediaPath);
});
test('the adapter refuses a host seed that identifies a different caption or media path',async()=>{
 for(const seed of [{id:'other-caption'},{path:'/other/caption.mov'}]){
  const f=fixture({seed});await f.api.getActiveSequenceInfo();await assert.rejects(f.api.prepareCaptionTrack([f.caption],-1,'seq-a'),/different temporary caption source/);
 }
});
test('bundle ownership and exact source identity survive every fixed timeline, geometry, selection and descriptor adapter',async()=>{
 const f=fixture(),caption={...f.caption,clipNodeId:'canonical-node',projectItemId:'shared-item',captionBundle:true,renderBounds:{x:0,y:0,width:576,height:512,frameWidth:720,frameHeight:1280}};
 await f.api.getActiveSequenceInfo();
 await f.api.readTimeline([caption],'seq-a');await f.api.readCaptionMotion([caption],'seq-a');await f.api.readCaptionGeometry([caption],'seq-a');await f.api.readCaptionSelection([caption],'seq-a');await f.api.readCaptionAreaDescriptor(caption,'seq-a');await f.api.selectCaptionClip(caption,'seq-a');
 await f.api.preflightCaptionClips([caption],-1,'seq-a');await f.api.applyCaptionClips([caption],-1,'seq-a');
 const native=f.calls.filter(call=>call.method!=='context');assert.equal(native.length,8);
 for(const call of native){
  const cue=call.payload.cues[0];assert.equal(cue.captionBundle,true,call.method);assert.equal(cue.clipNodeId,'canonical-node',call.method);assert.equal(cue.projectItemId,'shared-item',call.method);
  assert.equal(cue.mediaPath??cue.previousPath,f.media,call.method);assert.equal(call.payload.sequenceId,'seq-a',call.method);
 }
});

test('legacy conversion adapters keep captured identities, use private read jobs and reject outside media',async()=>{
 const f=fixture(),previous=[0,1].map(index=>({...f.caption,id:'old-'+index,clipNodeId:'node-'+index,projectItemId:'item-'+index,mediaPath:f.directory+'/caption-old-'+index+'/caption.mov'}));
 const plan={version:1,signature:'exact-native-proof'},caption={...f.caption,captionBundle:true};
 await f.api.getActiveSequenceInfo();await f.api.readCaptionConsolidation(previous,'seq-a');assert.equal(f.jobs.size,0,'reads must delete their temporary job');
 await f.api.stageCaptionConsolidation(caption,2,previous,plan,'seq-a');assert.equal(f.jobs.size,1,'stage retains its recovery job');
 const linked={...caption,clipNodeId:'replacement-node',projectItemId:'replacement-item'};
 await f.api.verifyCaptionConsolidation(linked,previous,plan,'seq-a');assert.equal(f.jobs.size,1);
 await f.api.rollbackCaptionConsolidation(linked,previous,plan,'seq-a');assert.equal(f.jobs.size,2);
 const native=f.calls.filter(call=>call.method!=='context');assert.equal(native.length,4);
 for(const call of native){const p=call.payload;assert.equal(p.sequenceId,'seq-a');assert.equal(p.projectPath,f.context.projectPath);assert.equal((p.legacyCues??p.cues)[1].clipNodeId,'node-1');}
 assert.equal(native[1].payload.track,2);assert.equal(native[1].payload.cues[0].captionBundle,true);assert.deepEqual(native[1].payload.plan,plan);
 assert.equal(native[2].payload.cues[0].clipNodeId,'replacement-node');
 const outside=[previous[0],{...previous[1],mediaPath:'/project/unrelated.mov'}],before=native.length;
 await assert.rejects(f.api.stageCaptionConsolidation(caption,2,outside,plan,'seq-a'),/generated/);
 assert.equal(f.calls.filter(call=>call.method!=='context').length,before);
});
test('Windows and macOS adapters retain exact deleted-link receipts at every timeline preparation boundary',async()=>{
 for(const platform of ['win32','darwin']){
  const f=fixture({platform}),oldPath=platform==='win32'?'C:\\Project\\old caption.mov':'/project/old caption.mov',deleted=[{id:'bundle',clipNodeId:'deleted-node',projectItemId:'old-item',mediaPath:oldPath}];await f.api.getActiveSequenceInfo();
  await f.api.preflightCaptionClips([f.caption],-1,'seq-a',deleted);await f.api.prepareCaptionTrack([f.caption],-1,'seq-a',[f.caption],deleted);await f.api.applyCaptionClips([f.caption],1,'seq-a',[f.caption],deleted);
  const native=f.calls.filter(call=>['preflight','prepareCaptionTrack','apply'].includes(call.method));assert.equal(native.length,3);
  for(const call of native){assert.deepEqual(call.payload.deletedLinks,deleted);assert.equal(call.payload.sequenceId,'seq-a');assert.equal(call.payload.projectPath,f.context.projectPath);assert.equal(call.payload.cues[0].path,f.media);assert.equal(call.payload.cues[0].clipNodeId,undefined);}
  await assert.rejects(f.api.preflightCaptionClips([f.caption],-1,'seq-a','other-sequence'),/Invalid deleted/);
 }
});

 test('native creation adapter binds semantic transcript duration and captured cadence before source mutation',async()=>{
 const f=fixture();await f.api.getActiveSequenceInfo();
 const input={sequenceId:'seq-a',sequenceName:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:10,style:structuredClone(DEFAULT_STYLE),animation:structuredClone(DEFAULT_ANIMATION),captions:[{id:'one',text:'Hello',words:[{text:'Hello',startTime:2,endTime:4}]}]};
 const {document,...request}=prepareNativeCreation(input,16);
 await assert.rejects(f.api.createNativeCaptionDocument({...request,endFrame:1},'seq-a'),/duration/);assert.equal(f.calls.some(c=>c.method==='createNativeCaptionDocument'),false);
 await f.api.createNativeCaptionDocument(request,'seq-a');const call=f.calls.find(c=>c.method==='createNativeCaptionDocument');assert.equal(call.payload.endFrame,96);assert.equal(call.payload.ticksPerFrame,'10584000000');assert.equal(call.payload.expectedVideoTrackCount,1);assert.match(call.payload.creationId,/^[0-9a-f-]{36}$/);assert.equal(call.payload.projectPath,f.context.projectPath);
});
