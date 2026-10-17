import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const TICKS = 254016000000, TPF = 8475667200, FPS = TICKS / TPF;
function collection(values = [], size = 'numItems') { Object.defineProperty(values, size, { get: () => values.length }); return values; }
class Time { constructor(seconds = 0) { this.seconds = seconds; } get seconds() { return this._ticks / TICKS; } set seconds(value) { this._ticks = Math.round(value * TICKS); } get ticks() { return String(this._ticks); } set ticks(value) { this._ticks = Number(value); } }
function hostFixture() {
  const files = new Map(), imports = [], overwrites = [], knownItems = new Map(); let nextItem = 1, nextClip = 1;
  const item = (media, id = 'item-' + nextItem++) => ({ nodeId: id, type: 1, media, inSeconds: 0, outSeconds: 1,
    getMediaPath() { return this.media; }, changeMediaPath(value) { if (this.failNext) { this.failNext = false; throw new Error('Simulated relink failure'); } this.media = value; return 0; }, refreshMedia() { this.refreshes=(this.refreshes??0)+1;return 0; },
    setInPoint(value) { this.inSeconds = value; }, setOutPoint(value) { this.outSeconds = value; } });
  const bin = name => ({ name, type: 2, children: collection(), createBin(name) { const child = bin(name); this.children.push(child); return child; } });
  const root = bin('Root'), clips = collection();
  function addClip(projectItem, start, end, target = clips) { const clip = { nodeId: 'clip-' + nextClip++, projectItem, name: 'Original caption', start: new Time(start), end: new Time(end), inPoint: new Time(), outPoint: new Time(end - start), selected: false, isSelected() { return this.selected; }, setSelected(value) { if (!this.failSelection || !value) this.selected = !!value; return this.selected === !!value ? 0 : 1; }, motion: { position: [101, 222], scale: 127, keys: ['preserve this'] }, remove() { const index = target.indexOf(this); if (index >= 0) target.splice(index, 1); } }; target.push(clip); return clip; }
  const track = { name: 'Video 1', clips, isLocked: () => false, overwriteClip(projectItem, seconds) { overwrites.push(seconds); return addClip(projectItem, seconds, seconds + projectItem.outSeconds); } };
  const sequence = { sequenceID: 'seq-a', name: 'Test sequence', timebase: String(TPF), frameSizeHorizontal: 1920, frameSizeVertical: 1080, end: String(10 * TICKS), videoTracks: collection([track], 'numTracks'), audioTracks: collection([], 'numTracks'), playhead: new Time(), getPlayerPosition() { const time = new Time(); time.ticks = this.playhead.ticks; return time; }, setPlayerPosition(ticks) { if (this.refuseSeek) return false; this.playhead.ticks = this.ignoreSeek ? this.playhead.ticks : ticks; return true; } };
  const project = { path: '/project/test.prproj', activeSequence: sequence, sequences: collection([sequence], 'numSequences'), rootItem: root, importFiles(paths, suppress, target) { imports.push(...paths); for (const path of paths) { const value = item(path); target.children.push(value); knownItems.set(path, value); } return true; } };
  class File { constructor(path) { this.path = path; this.exists = files.has(path); this.length = (files.get(path) ?? '').length; } open() { return files.has(this.path); } read() { return files.get(this.path); } close() {} }
  const nativeCalls={timeObjects:0};
  class NativeTime extends Time { constructor(...args){super(...args);nativeCalls.timeObjects++;} }
  const sandbox = { app: { project }, File, Time: NativeTime, JSON: undefined, isFinite, Math, Number, String, Error };
  vm.runInNewContext(fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8'), sandbox);
  function payload(cues) { const value = { sequenceId: sequence.sequenceID, projectPath: project.path, width: 1920, height: 1080, fps: FPS, track: 0, cues }; files.set('/job.json', JSON.stringify(value)); return '/job.json'; }
  function cue(id, startFrame = 0, endFrame = 30, extra = {}) { const path = '/render/' + id + '.mov'; files.set(path, 'media'); return { id, text: id, startFrame, endFrame, path, ...extra }; }
  function selectPayload(clip, extra = {}, context = {}) { const value = { sequenceId: sequence.sequenceID, projectPath: project.path, cues: [{ id: 'caption', clipNodeId: clip.nodeId, projectItemId: clip.projectItem.nodeId, mediaPath: clip.projectItem.media, words: [{ text: 'Caption', startTime: clip.start.seconds + .1, endTime: clip.start.seconds + .5 }], ...extra }], ...context }; files.set('/select.json', JSON.stringify(value)); return '/select.json'; }
  return { host: sandbox.BetterCaptionsHost, files, imports, overwrites, item, addClip, clips, track, sequence, project, payload, cue, selectPayload, nativeCalls };
}
function attachNativeMotion(clip, overrides={}) {
  function parameter(displayName,value){return {displayName,value,keys:[],sampled:[],writes:[],mode:'linear',isTimeVarying(){return this.keys.length>0;},getValue(){if(this.keys.length)throw new Error('Animated getValue must not be read at the playhead');return structuredClone(this.value);},getKeys(){return this.keys.map(key=>new Time(key.time));},getValueAtKey(time){return structuredClone(this.keys.find(key=>Math.abs(key.time-time.seconds)<1e-7).value);},getValueAtTime(time){this.sampled.push(time.seconds);if(!this.keys.length)return structuredClone(this.value);const first=this.keys[0],last=this.keys.at(-1);if(this.mode==='hold')return structuredClone(time.seconds<last.time?first.value:last.value);const progress=Math.max(0,Math.min(1,(time.seconds-first.time)/(last.time-first.time)));return Array.isArray(first.value)?first.value.map((v,i)=>v+(last.value[i]-v)*progress):first.value+(last.value-first.value)*progress;},setValue(value){this.writes.push(structuredClone(value));if(this.ignoreNext){this.ignoreNext=false;return 0;}this.value=structuredClone(value);return 0;},setValueAtKey(time,value){this.writes.push({time:time.seconds,value:structuredClone(value)});this.keys.find(key=>Math.abs(key.time-time.seconds)<1e-7).value=structuredClone(value);return 0;}};}
  const params={position:parameter('Position',[.5,.5]),height:parameter('Scale',100),width:parameter('Scale Width',100),uniform:parameter('Uniform Scale',true),rotation:parameter('Rotation',0),anchor:parameter('Anchor Point',[.5,.5])};
  for(const [name,value]of Object.entries(overrides))Object.assign(params[name],value);
  clip.components=collection([{matchName:'AE.ADBE Motion',displayName:'Motion',properties:collection(Object.values(params))}]);return params;
}
function motionPayload(f,clip,patch={},options={}){
  f.files.set('/motion.json',JSON.stringify({sequenceId:f.sequence.sequenceID,projectPath:f.project.path,cues:[{id:'caption',clipNodeId:clip.nodeId,projectItemId:clip.projectItem.nodeId,mediaPath:clip.projectItem.media,startTime:clip.start.seconds,endTime:clip.end.seconds,...patch}],...options}));return '/motion.json';
}
const bounds=(x=480,y=648,width=960,height=432)=>({x,y,width,height,frameWidth:1920,frameHeight:1080});
test('text-area descriptor reads exact clip/source geometry and refuses mismatched or locked links',()=>{
 const f=hostFixture(),clip=f.addClip(f.item('/caption.mov'),2,4);attachNativeMotion(clip);clip.inPoint=new Time(1);
 const payload=()=>motionPayload(f,clip,{renderBounds:bounds()});
 let result=JSON.parse(f.host.readCaptionAreaDescriptor(payload()));
 assert.equal(result.ok,true);assert.equal(result.startTicks,clip.start.ticks);assert.equal(result.inTicks,clip.inPoint.ticks);assert.equal(result.track,0);assert.equal(result.bounds.width,960);
 result=JSON.parse(f.host.readCaptionAreaDescriptor(motionPayload(f,clip,{renderBounds:bounds(),projectItemId:'other'})));assert.match(result.error,/link changed/);
 f.track.isLocked=()=>true;assert.match(JSON.parse(f.host.readCaptionAreaDescriptor(payload())).error,/Unlock/);
 assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);
});
test('text-area descriptor supplies fresh named CEP Uniform Scale proof without sampling or changing Motion',()=>{
 const f=hostFixture(),clip=f.addClip(f.item('/caption.mov'),2,4),params=attachNativeMotion(clip);
 const read=()=>JSON.parse(f.host.readCaptionAreaDescriptor(motionPayload(f,clip,{renderBounds:bounds()})));
 let result=read();
 assert.deepEqual(result.motionBinding,{version:1,componentMatchName:'AE.ADBE Motion',parameterCount:6,widthIndex:2,uniformIndex:3,rotationIndex:4,uniform:{animated:false,value:true}});
 params.uniform.value=0;result=read();assert.deepEqual(result.motionBinding.uniform,{animated:false,value:false});
 assert.ok(Object.values(params).every(param=>param.sampled.length===0&&param.writes.length===0));
 params.uniform.displayName='';result=read();assert.match(result.error,/separate caption width and height/);
 assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);
});
function geometryCue(f,clip,renderBounds=bounds(),extra={}) { return f.cue('caption',0,30,{clipNodeId:clip.nodeId,projectItemId:clip.projectItem.nodeId,previousPath:clip.projectItem.media,renderBounds,...extra}); }
function currentMotion(params,time=0){const values={};for(const [name,param]of Object.entries(params))values[name]=param.getValueAtTime(new Time(time));return values;}
function worldPoint(logical,sourceBounds,motion){
  const origin=sourceBounds??{x:0,y:0,width:1920,height:1080},sy=motion.height/100,sx=motion.uniform?sy:motion.width/100,rad=motion.rotation*Math.PI/180;
  const x=(logical[0]-origin.x-motion.anchor[0]*origin.width)*sx,y=(logical[1]-origin.y-motion.anchor[1]*origin.height)*sy;
  return [motion.position[0]*1920+x*Math.cos(rad)-y*Math.sin(rad),motion.position[1]*1080+x*Math.sin(rad)+y*Math.cos(rad)];
}
function closePoint(actual,expected){assert.equal(actual.length,expected.length);for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-6,`${actual} differs from ${expected}`);}

function automaticPayload(f,cues){const file=f.payload(cues),data=JSON.parse(f.files.get(file));data.track=-1;f.files.set(file,JSON.stringify(data));return file;}
function addVideoTrack(f,options={}){
 const clips=collection(),track={name:'Video '+(f.sequence.videoTracks.length+1),clips,isLocked:()=>false,
  overwriteClip(item,seconds){f.overwrites.push(seconds);return f.addClip(item,seconds,seconds+item.outSeconds,clips);},...options};
 f.sequence.videoTracks.push(track);return track;
}
test('automatic preflight plans one new top track without importing media or changing the sequence',()=>{
 const f=hostFixture(),footage=f.addClip(f.item('/footage.mov'),0,10),file=automaticPayload(f,[f.cue('bundle',6,186)]);
 f.files.delete('/render/bundle.mov');
 const result=JSON.parse(f.host.preflight(file));
 assert.equal(result.ok,true);assert.deepEqual(result.destination,{mode:'create',trackIndex:1,expectedVideoTrackCount:1,newCaptionCount:1});
 assert.equal(f.sequence.videoTracks.length,1);assert.deepEqual(f.clips,[footage]);assert.equal(f.imports.length,0);assert.equal(f.project.rootItem.children.length,0);assert.equal(f.overwrites.length,0);
});
test('automatic Apply reuses only an unlocked, enabled, empty top track above occupied footage',()=>{
 const f=hostFixture(),footage=f.addClip(f.item('/footage.mov'),0,10),top=addVideoTrack(f),cue=f.cue('bundle',6,186);
 const result=JSON.parse(f.host.apply(automaticPayload(f,[cue])));
 assert.equal(result.ok,true);assert.equal(result.cues.length,1);assert.equal(result.cues[0].track,1);assert.equal(top.clips.length,1);
 assert.equal(top.clips[0].start.ticks,String(6*TPF));assert.equal(top.clips[0].end.ticks,String(186*TPF));assert.deepEqual(f.clips,[footage]);assert.equal(f.sequence.videoTracks.length,2);
});
test('automatic destination never chooses a lower empty track or unlocks or unmutes the top track',()=>{
 for(const state of ['occupied','locked','muted']){
  const f=hostFixture(),top=addVideoTrack(f,{isLocked:()=>state==='locked',isMuted:()=>state==='muted'});
  if(state==='occupied')f.addClip(f.item('/upper-footage.mov'),0,1,top.clips);
  const result=JSON.parse(f.host.preflight(automaticPayload(f,[f.cue('bundle')])));
  assert.equal(result.ok,true);assert.equal(result.destination.mode,'create');assert.equal(result.destination.trackIndex,2);assert.equal(f.sequence.videoTracks.length,2);
  assert.equal(top.isLocked(),state==='locked');assert.equal(top.isMuted(),state==='muted');assert.equal(f.imports.length,0);
 }
});
test('track preparation imports one exact seed idempotently and final Apply reuses the new empty track',()=>{
 const f=hostFixture(),footage=f.addClip(f.item('/footage.mov'),0,10),file=automaticPayload(f,[f.cue('bundle',6,186)]);
 const first=JSON.parse(f.host.prepareCaptionTrack(file)),second=JSON.parse(f.host.prepareCaptionTrack(file));
 assert.equal(first.ok,true);assert.deepEqual(second,first);assert.equal(first.seed.path,'/render/bundle.mov');assert.equal(first.seed.startTicks,String(6*TPF));assert.equal(first.seed.endTicks,String(186*TPF));assert.equal(first.seed.durationTicks,String(180*TPF));
 assert.equal(f.imports.length,1);assert.equal(f.overwrites.length,0);assert.equal(f.sequence.videoTracks.length,1);assert.deepEqual(f.clips,[footage]);
 const top=addVideoTrack(f),result=JSON.parse(f.host.apply(file));
 assert.equal(result.ok,true);assert.equal(result.cues.length,1);assert.equal(result.cues[0].projectItemId,first.seed.projectItemId);assert.equal(result.cues[0].track,1);assert.equal(top.clips.length,1);assert.equal(f.imports.length,1);assert.equal(f.sequence.videoTracks.length,2);
});
test('CEP Apply refuses an uncreated automatic destination before imports or timeline edits',()=>{
 const f=hostFixture(),footage=f.addClip(f.item('/footage.mov'),0,10),result=JSON.parse(f.host.apply(automaticPayload(f,[f.cue('bundle')])));
 assert.match(result.error,/UXP panel/);assert.equal(result.rolledBack,true);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);assert.deepEqual(f.clips,[footage]);
});
test('track preparation validates every cue and captured project before importing the seed',()=>{
 for(const problem of ['missing-media','overlap','stale-project','stale-link']){
  const f=hostFixture();f.addClip(f.item('/footage.mov'),0,10);
  const cues=[f.cue('bundle',0,30),f.cue('second',30,60)],file=automaticPayload(f,cues);
  if(problem==='missing-media')f.files.delete(cues[1].path);
  if(problem==='overlap'){cues[1].startFrame=29;automaticPayload(f,cues);}
  if(problem==='stale-project')f.project.path='/project/other.prproj';
  if(problem==='stale-link'){cues[1].clipNodeId='missing';automaticPayload(f,cues);}
  assert.ok(JSON.parse(f.host.prepareCaptionTrack(file)).error,problem);assert.equal(f.imports.length,0,problem);assert.equal(f.overwrites.length,0,problem);assert.equal(f.project.rootItem.children.length,0,problem);
 }
});
test('automatic linked updates retain their exact track, clip identity and manual Motion',()=>{
 const f=hostFixture(),media=f.item('/old-caption.mov'),caption=f.addClip(media,0,1),before=structuredClone(caption.motion);
 const upper=addVideoTrack(f);f.addClip(f.item('/upper-footage.mov'),0,10,upper.clips);
 const cue=f.cue('updated',0,30,{clipNodeId:caption.nodeId,projectItemId:media.nodeId,previousPath:media.media}),file=automaticPayload(f,[cue]);
 const plan=JSON.parse(f.host.preflight(file)),prepared=JSON.parse(f.host.prepareCaptionTrack(file));
 assert.deepEqual(plan.destination,{mode:'linked',trackIndex:null,expectedVideoTrackCount:2,newCaptionCount:0});assert.equal(prepared.seed,null);assert.equal(f.imports.length,0);
 const result=JSON.parse(f.host.apply(file));assert.equal(result.ok,true);assert.equal(result.cues[0].track,0);assert.equal(result.cues[0].clipNodeId,caption.nodeId);assert.equal(f.clips[0],caption);assert.deepEqual(caption.motion,before);assert.equal(f.overwrites.length,0);assert.equal(f.sequence.videoTracks.length,2);
});
test('automatic new cues and linked cues keep separate destinations without relocating existing clips',()=>{
 const f=hostFixture(),media=f.item('/old-caption.mov'),caption=f.addClip(media,0,1),top=addVideoTrack(f);
 const result=JSON.parse(f.host.apply(automaticPayload(f,[f.cue('old',0,30,{clipNodeId:caption.nodeId,projectItemId:media.nodeId,previousPath:media.media}),f.cue('new',0,30)])));
 assert.equal(result.ok,true);assert.deepEqual(result.cues.map(cue=>cue.track),[0,1]);assert.equal(f.clips[0],caption);assert.equal(top.clips.length,1);
});
test('automatic track planning is bounded and permits reusing an empty 256th track',()=>{
 const f=hostFixture();while(f.sequence.videoTracks.length<256)addVideoTrack(f);
 const file=automaticPayload(f,[f.cue('bundle')]);let result=JSON.parse(f.host.preflight(file));assert.equal(result.ok,true);assert.equal(result.destination.trackIndex,255);
 f.addClip(f.item('/top-footage.mov'),0,1,f.sequence.videoTracks[255].clips);
 result=JSON.parse(f.host.prepareCaptionTrack(file));assert.match(result.error,/256 video tracks/);assert.equal(f.imports.length,0);
});
test('a seed already referenced by a timeline clip cannot be reused to create another track',()=>{
 const f=hostFixture();f.addClip(f.item('/footage.mov'),0,10);const file=automaticPayload(f,[f.cue('bundle')]),first=JSON.parse(f.host.prepareCaptionTrack(file));
 const imported=f.project.rootItem.children[0].children[0];f.addClip(imported,2,8);
 const result=JSON.parse(f.host.prepareCaptionTrack(file));assert.match(result.error,/already used/);assert.equal(f.imports.length,1);assert.equal(f.overwrites.length,0);assert.equal(imported.nodeId,first.seed.projectItemId);
});

function deletedCaptionFixture() {
 const f=hostFixture(),footage=f.addClip(f.item('/footage.mov'),0,10),top=addVideoTrack(f),old=f.addClip(f.item('/caption-old.mov'),0,1,top.clips);
 const link={id:'bundle',clipNodeId:old.nodeId,projectItemId:old.projectItem.nodeId,mediaPath:old.projectItem.media};
 const read=(patch={})=>{f.files.set('/read-deleted.json',JSON.stringify({sequenceId:f.sequence.sequenceID,projectPath:f.project.path,cues:[link],...patch}));return JSON.parse(f.host.readTimeline('/read-deleted.json'));};
 const job=(cues=[f.cue('bundle')],links=[link])=>{const file=automaticPayload(f,cues),payload=JSON.parse(f.files.get(file));payload.deletedLinks=links;f.files.set(file,JSON.stringify(payload));return file;};
 return {...f,footage,top,old,link,read,job};
}
test('timeline absence receipts include exact native identities for deleted clips and whole deleted tracks',()=>{
 for(const wholeTrack of [false,true]){
  const f=deletedCaptionFixture(),live=f.read();assert.equal(live.ok,true);assert.equal(live.cues[0].clipNodeId,f.link.clipNodeId);assert.equal(live.cues[0].projectItemId,f.link.projectItemId);assert.equal(live.cues[0].path,f.link.mediaPath);
  if(wholeTrack)f.sequence.videoTracks.pop();else f.old.remove();
  const missing=f.read();assert.equal(missing.ok,true);assert.deepEqual(missing.cues,[{id:f.link.id,clipNodeId:f.link.clipNodeId,projectItemId:f.link.projectItemId,path:f.link.mediaPath,missing:true}]);
  const file=f.job(),preflight=JSON.parse(f.host.preflight(file));assert.equal(preflight.ok,true);assert.equal(preflight.destination.mode,wholeTrack?'create':'reuse');
  const prepared=JSON.parse(f.host.prepareCaptionTrack(file));assert.equal(prepared.ok,true);assert.equal(f.overwrites.length,0);
  if(wholeTrack)addVideoTrack(f);
  const result=JSON.parse(f.host.apply(file));assert.equal(result.ok,true,JSON.stringify(result));assert.notEqual(result.cues[0].clipNodeId,f.link.clipNodeId);assert.notEqual(result.cues[0].projectItemId,f.link.projectItemId);assert.equal(result.cues[0].track,1);assert.deepEqual(f.clips,[f.footage]);
 }
});
test('remaining fragments, copies, reimported media, audio references and reused node ids prevent absence receipts',()=>{
 for(const survivor of ['fragment','copy','media-copy','audio','node-id','windows-path-case']){
  const f=deletedCaptionFixture();f.old.remove();
  let item=f.old.projectItem,target=f.top.clips;
  if(survivor==='media-copy')item=f.item(f.link.mediaPath);
  if(survivor==='node-id')item=f.item('/different-source.mov');
  if(survivor==='audio'){const audio={clips:collection()};f.sequence.audioTracks.push(audio);target=audio.clips;}
  if(survivor==='windows-path-case'){f.link.mediaPath='C:\\Project\\Caption.mov';item=f.item('c:/project/caption.MOV');}
  const clip=f.addClip(item,1,2,target);if(survivor==='node-id')clip.nodeId=f.link.clipNodeId;
  if(survivor==='fragment')clip.inPoint=new Time(1);
  const read=f.read();assert.match(read.error,/still has|link changed/,survivor);
  assert.match(JSON.parse(f.host.prepareCaptionTrack(f.job())).error,/still has/,survivor);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);
 }
});
test('recreating deleted active-sequence captions does not modify copies in another sequence',()=>{
 const f=deletedCaptionFixture(),otherClips=collection(),other=f.addClip(f.old.projectItem,5,6,otherClips);f.old.remove();
 f.project.sequences.push({sequenceID:'other',videoTracks:collection([{clips:otherClips}],'numTracks'),audioTracks:collection([],'numTracks')});
 assert.equal(f.read().ok,true);const result=JSON.parse(f.host.apply(f.job()));assert.equal(result.ok,true);assert.deepEqual(otherClips,[other]);assert.equal(other.projectItem.media,f.link.mediaPath);assert.equal(other.start.seconds,5);assert.notEqual(result.cues[0].projectItemId,other.projectItem.nodeId);
});
test('Undo or re-add after rendering or automatic track preparation is rejected before another import or native write',()=>{
 for(const stage of ['preflight','prepared']){
  const f=deletedCaptionFixture();f.old.remove();f.sequence.videoTracks.pop();const file=f.job();assert.equal(f.read().ok,true);
  if(stage==='prepared')assert.equal(JSON.parse(f.host.prepareCaptionTrack(file)).ok,true);else assert.equal(JSON.parse(f.host.preflight(file)).ok,true);
  const imports=f.imports.length,top=addVideoTrack(f);top.clips.push(f.old);
  const result=JSON.parse(stage==='prepared'?f.host.apply(file):f.host.prepareCaptionTrack(file));assert.match(result.error,/still has/);assert.equal(f.imports.length,imports);assert.equal(f.overwrites.length,0);assert.deepEqual(top.clips,[f.old]);
 }
});
test('one deleted clip can be recreated while surviving linked captions retain exact identity and Motion',()=>{
 const f=deletedCaptionFixture(),survivor=f.addClip(f.item('/surviving-caption.mov'),1,2,f.top.clips),motion=structuredClone(survivor.motion);f.old.remove();
 const top=addVideoTrack(f),newCue=f.cue('bundle'),linked=f.cue('survivor',30,60,{clipNodeId:survivor.nodeId,projectItemId:survivor.projectItem.nodeId,previousPath:survivor.projectItem.media});
 const result=JSON.parse(f.host.apply(f.job([newCue,linked])));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.cues[0].track,2);assert.equal(result.cues[1].track,1);assert.equal(result.cues[1].clipNodeId,survivor.nodeId);assert.equal(f.top.clips[0],survivor);assert.deepEqual(survivor.motion,motion);assert.equal(top.clips.length,1);assert.deepEqual(f.clips,[f.footage]);
});
test('ambiguous, incomplete and stale deletion receipts fail closed before imports',()=>{
 const variations=[links=>[links[0],links[0]],()=>null,()=>({}),()=>[{id:'bundle'}],links=>[{...links[0],mediaPath:'../caption.mov'}],links=>[{...links[0],clipNodeId:42}]];
 for(const change of variations){const f=deletedCaptionFixture();f.old.remove();const result=JSON.parse(f.host.prepareCaptionTrack(f.job(undefined,change([f.link]))));assert.match(result.error,/Invalid|incomplete|Duplicate/);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);}
 for(const context of [{sequenceId:'other'},{projectPath:'/different.prproj'}]){const f=deletedCaptionFixture();f.old.remove();assert.match(f.read(context).error,/changed/);assert.equal(f.imports.length,0);}
 const f=deletedCaptionFixture();f.old.remove();assert.match(f.read({cues:[f.link,f.link]}).error,/identities/);
});
test('absence inspection never treats an unreadable, oversized or malformed timeline as empty',()=>{
 const changes=[f=>{f.sequence.videoTracks=collection(Array.from({length:257},()=>({clips:collection()})),'numTracks');},f=>{f.top.clips=collection(Array.from({length:2001},()=>f.footage));},f=>{f.top.clips={numItems:NaN};},f=>{f.top.clips.push({nodeId:'unreadable'});},f=>{f.footage.projectItem.getMediaPath=()=>{throw new Error('native read failed');};}];
 for(const change of changes){const f=deletedCaptionFixture();f.old.remove();change(f);assert.ok(f.read().error);assert.ok(JSON.parse(f.host.prepareCaptionTrack(f.job())).error);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);}
});

function razorFixture(){
 const f=hostFixture(),media=f.item('/caption-bundle-old.mov'),first=f.addClip(media,30/FPS,60/FPS),second=f.addClip(media,60/FPS,120/FPS);
 first.outPoint=frameTimeForTest(30);second.inPoint=frameTimeForTest(30);second.outPoint=frameTimeForTest(90);
 const a=attachNativeMotion(first,{uniform:{value:false}}),b=attachNativeMotion(second,{uniform:{value:false},width:{keys:[{time:0,value:100},{time:90/FPS,value:190}]},position:{keys:[{time:0,value:[.4,.6]},{time:90/FPS,value:[.6,.7]}]}});
 const caption=f.cue('bundle',30,120,{clipNodeId:first.nodeId,projectItemId:media.nodeId,previousPath:media.media,captionBundle:true,renderBounds:bounds(),previousRenderBounds:bounds()});
 const readFile=()=>motionPayload(f,first,{captionBundle:true,startTime:30/FPS,endTime:120/FPS,renderBounds:bounds()});
 return {...f,media,first,second,a,b,caption,readFile};
}
function frameTimeForTest(frame){const time=new Time();time.ticks=String(frame*TPF);return time;}
function consolidationFixture(){
 const f=hostFixture(),a=f.addClip(f.item('/legacy-a.mov'),0,1),b=f.addClip(f.item('/legacy-b.mov'),1,2);
 const pa=attachNativeMotion(a,{uniform:{value:false},position:{value:[364.8160457611084/720,1066.3050842285156/1280]},height:{value:331.22640625/512*100}}),pb=attachNativeMotion(b,{uniform:{value:false},position:{value:[.5,.85]}});
 const legacy=[a,b].map((clip,index)=>({id:'old-'+index,clipNodeId:clip.nodeId,projectItemId:clip.projectItem.nodeId,mediaPath:clip.projectItem.media,startTime:clip.start.seconds,endTime:clip.end.seconds,renderBounds:bounds()}));
 const top=addVideoTrack(f),overwrite=top.overwriteClip;top.overwriteClip=function(...args){const clip=overwrite.apply(this,args),params=attachNativeMotion(clip);for(const p of Object.values(params)){
  p.setTimeVarying=()=>0;p.addKey=time=>{p.keys.push({time:time.seconds,value:structuredClone(p.value)});p.keys.sort((a,b)=>a.time-b.time);return 0;};
  p.setInterpolationTypeAtKey=()=>{p.mode='hold';return 0;};
 }return clip;};
 const planFile=()=>{f.files.set('/legacy.json',JSON.stringify({sequenceId:f.sequence.sequenceID,projectPath:f.project.path,cues:legacy}));return '/legacy.json';};
 const plan=()=>JSON.parse(f.host.readCaptionConsolidation(planFile()));
 const stage=(proof=plan())=>{const data={sequenceId:f.sequence.sequenceID,projectPath:f.project.path,width:1920,height:1080,fps:FPS,track:1,legacyCues:legacy,plan:proof,cues:[f.cue('combined',0,Math.round(2*FPS),{captionBundle:true,renderBounds:bounds()})]};f.files.set('/stage.json',JSON.stringify(data));return {data,result:JSON.parse(f.host.stageCaptionConsolidation('/stage.json'))};};
 // Align to exact sequence frames, matching native exported captions.
 const cut=30*TPF/TICKS,end=60*TPF/TICKS;a.end=new Time(cut);a.outPoint=new Time(cut);b.start=new Time(cut);b.end=new Time(end);b.outPoint=new Time(cut);
 legacy[0].endTime=cut;legacy[1].startTime=cut;legacy[1].endTime=end;
 return {...f,a,b,pa,pb,legacy,top,plan,stage};
}

test('legacy conversion stages one hold-keyed replacement while preserving the two original static geometries',()=>{
 const f=consolidationFixture(),before=[nativeSnapshot(f.a),nativeSnapshot(f.b)],proof=f.plan();assert.equal(proof.ok,true);
 assert.equal(proof.clips[0].motion.height.value,331.22640625/512*100);assert.deepEqual(proof.clips[0].motion.position.value,[364.8160457611084/720,1066.3050842285156/1280]);
 const {data,result}=f.stage(proof);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.clips.length,2);assert.equal(f.top.clips.length,1);
 assert.deepEqual([nativeSnapshot(f.a),nativeSnapshot(f.b)],before);
 const replacement=result.cues[0],params=f.top.clips[0].components[0].properties;
 assert.equal(params.find(p=>p.displayName==='Position').keys.length,2);assert.equal(params.find(p=>p.displayName==='Scale').keys[0].value,331.22640625/512*100);
 const verifyData={...data,cues:[{...data.cues[0],clipNodeId:replacement.clipNodeId,projectItemId:replacement.projectItemId,mediaPath:replacement.path}]};f.files.set('/verify.json',JSON.stringify(verifyData));
 assert.equal(JSON.parse(f.host.verifyCaptionConsolidation('/verify.json')).complete,false);
 f.a.remove();f.b.remove();assert.equal(JSON.parse(f.host.verifyCaptionConsolidation('/verify.json')).complete,true);assert.equal(f.top.clips.length,1);
});

test('legacy conversion rejects changed geometry, animation, reuse, effects and explicit cuts before staging',()=>{
 for(const reason of ['changed','animated','shared','effect','split','trim']){
  const f=consolidationFixture(),proof=f.plan();
  if(reason==='changed')f.pa.position.value=[.1,.2];
  if(reason==='animated')f.pa.width.keys=[{time:0,value:100}];
  if(reason==='shared')f.addClip(f.a.projectItem,3,4);
  if(reason==='effect')f.a.components.push({matchName:'Custom Blur',properties:collection([])});
  if(reason==='split')f.legacy[0].manualSplit=true;
  if(reason==='trim')f.a.inPoint=new Time(.1);
  const result=f.stage(proof).result;assert.ok(result.error,reason);assert.equal(f.top.clips.length,0,reason);assert.equal(f.overwrites.length,0,reason);assert.ok(f.clips.includes(f.a)&&f.clips.includes(f.b),reason);
 }
});

test('failed hold readback removes only the staged replacement and retains legacy clips and values',()=>{
 const f=consolidationFixture(),before=[nativeSnapshot(f.a),nativeSnapshot(f.b)],overwrite=f.top.overwriteClip;
 f.top.overwriteClip=function(...args){const clip=overwrite.apply(this,args);for(const p of clip.components[0].properties)p.setInterpolationTypeAtKey=()=>0;return clip;};
 const result=f.stage().result;assert.match(result.error,/hold geometry/);assert.equal(result.rolledBack,true);assert.equal(f.top.clips.length,0);assert.deepEqual([nativeSnapshot(f.a),nativeSnapshot(f.b)],before);
});
function nativeSnapshot(clip){return {node:clip.nodeId,start:clip.start.ticks,end:clip.end.ticks,in:clip.inPoint.ticks,out:clip.outPoint.ticks,keys:clip.components[0].properties.map(param=>({name:param.displayName,value:structuredClone(param.value),keys:structuredClone(param.keys),mode:param.mode}))};}
test('a Razor bundle samples each fragment on its source clock and fingerprints every slice without merging cuts',()=>{
 const f=razorFixture(),before=[nativeSnapshot(f.first),nativeSnapshot(f.second)],result=JSON.parse(f.host.readCaptionMotion(f.readFile()));
 assert.equal(result.ok,true);const cue=result.cues[0];assert.equal(cue.clipNodeId,f.first.nodeId);assert.equal(cue.bundleFragments.length,2);assert.equal(cue.motionProfile.samples.length,90);
 assert.ok(Math.abs(cue.motionProfile.samples[30].scaleX-1.305)<1e-9);assert.ok(Math.abs(cue.motionProfile.samples[30].time-60.5/FPS)<1e-9);assert.ok(f.b.width.sampled.some(time=>Math.abs(time-30.5/FPS)<1e-9));
 const geometry=JSON.parse(f.host.readCaptionGeometry(f.readFile()));assert.equal(geometry.ok,true);assert.equal(geometry.cues[0].watchSignature,cue.motionProfile.watchSignature);
 f.b.width.keys[1].value=160;const changed=JSON.parse(f.host.readCaptionMotion(f.readFile()));assert.notEqual(changed.cues[0].motionProfile.signature,cue.motionProfile.signature);assert.notEqual(changed.cues[0].motionProfile.watchSignature,cue.motionProfile.watchSignature);
 f.b.width.keys[1].value=190;assert.deepEqual([nativeSnapshot(f.first),nativeSnapshot(f.second)],before);assert.equal(f.overwrites.length,0);assert.equal(f.imports.length,0);
});
test('Apply relinks a Razor bundle once while preserving both cuts, source clocks, identities and native key curves',()=>{
 const f=razorFixture(),before=[nativeSnapshot(f.first),nativeSnapshot(f.second)],profile=JSON.parse(f.host.readCaptionMotion(f.readFile())).cues[0].motionProfile;
 let relinks=0;const change=f.media.changeMediaPath;f.media.changeMediaPath=function(path){relinks++;return change.call(this,path);};
 const result=JSON.parse(f.host.apply(automaticPayload(f,[{...f.caption,motionProfile:profile}])));
 assert.equal(result.ok,true);assert.equal(relinks,1);assert.equal(result.cues.length,1);assert.equal(result.cues[0].clipNodeId,f.first.nodeId);assert.equal(result.cues[0].bundleFragments.length,2);assert.equal(result.cues[0].start,f.first.start.seconds);assert.equal(result.cues[0].end,f.second.end.seconds);
 assert.deepEqual([nativeSnapshot(f.first),nativeSnapshot(f.second)],before);assert.equal(f.media.media,'/render/bundle.mov');assert.equal(f.clips.length,2);assert.equal(f.overwrites.length,0);assert.equal(f.imports.length,0);assert.equal(result.cues[0].motionProfile.samples.length,90);
});
test('a Razor bundle refuses stale Motion in another fragment before relinking its shared source',()=>{
 const f=razorFixture(),profile=JSON.parse(f.host.readCaptionMotion(f.readFile())).cues[0].motionProfile;
 f.b.width.keys[1].value=175;
 const result=JSON.parse(f.host.apply(automaticPayload(f,[{...f.caption,motionProfile:profile}])));
 assert.match(result.error,/changed during rendering/);assert.equal(f.media.media,'/caption-bundle-old.mov');assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);assert.equal(f.b.width.keys[1].value,175);
});

test('Apply rediscovers global bundle references after relink instead of trusting captured fragments',()=>{
 for(const change of ['copy','cut']){
  const f=razorFixture(),before=[nativeSnapshot(f.first),nativeSnapshot(f.second)],original=f.media.changeMediaPath;
  f.media.changeMediaPath=function(path){const status=original.call(this,path);if(path==='/render/bundle.mov'){
   if(change==='copy')f.project.sequences.push({sequenceID:'other',videoTracks:collection([{clips:collection([{projectItem:f.media}])}],'numTracks'),audioTracks:collection([],'numTracks')});
   else {const part=f.addClip(f.media,90/FPS,120/FPS);part.inPoint=frameTimeForTest(60);part.outPoint=frameTimeForTest(90);attachNativeMotion(part);f.second.end=frameTimeForTest(90);f.second.outPoint=frameTimeForTest(60);}
  }return status;};
  const result=JSON.parse(f.host.apply(automaticPayload(f,[f.caption])));
  assert.match(result.error,/outside|splits or references changed/);assert.equal(result.rolledBack,true);assert.equal(f.media.media,'/caption-bundle-old.mov');
  assert.deepEqual([nativeSnapshot(f.first),nativeSnapshot(f.second)],before);assert.equal(f.overwrites.length,0);
 }
});
test('a failed Razor geometry migration restores all fragment Motion and source timing without recreating clips',()=>{
 const f=razorFixture(),before=[nativeSnapshot(f.first),nativeSnapshot(f.second)];f.b.anchor.ignoreNext=true;
 const result=JSON.parse(f.host.apply(automaticPayload(f,[{...f.caption,renderBounds:bounds(300,550,800,480)}])));
 assert.match(result.error,/did not keep/);assert.equal(result.rolledBack,true);assert.equal(f.media.media,'/caption-bundle-old.mov');assert.deepEqual([nativeSnapshot(f.first),nativeSnapshot(f.second)],before);assert.equal(f.clips.length,2);assert.equal(f.overwrites.length,0);assert.equal(f.imports.length,0);
});
test('native splits require the explicit bundle marker and never permit copied, reordered, trimmed or moved media',()=>{
 for(const invalid of ['unmarked','external','audio-copy','duplicated-source','source-gap','timeline-gap','moved-track','speed','trimmed-start','changed-range','fractional-cut']){
  const f=razorFixture(),caption={...f.caption};
  if(invalid==='unmarked')delete caption.captionBundle;
  if(invalid==='external')f.project.sequences.push({sequenceID:'other',videoTracks:collection([{clips:collection([{projectItem:f.media}])}],'numTracks'),audioTracks:collection([],'numTracks')});
  if(invalid==='audio-copy')f.sequence.audioTracks.push({clips:collection([{projectItem:f.media}])});
  if(invalid==='duplicated-source'){f.second.inPoint=frameTimeForTest(0);f.second.outPoint=frameTimeForTest(60);}
  if(invalid==='source-gap'){f.second.inPoint=frameTimeForTest(31);f.second.outPoint=frameTimeForTest(91);}
  if(invalid==='timeline-gap'){f.second.start=frameTimeForTest(61);f.second.end=frameTimeForTest(121);}
  if(invalid==='moved-track'){f.clips.splice(f.clips.indexOf(f.second),1);addVideoTrack(f).clips.push(f.second);}
  if(invalid==='speed')f.second.getSpeed=()=>2;
  if(invalid==='trimmed-start'){f.first.inPoint=frameTimeForTest(1);f.first.outPoint=frameTimeForTest(31);}
  if(invalid==='changed-range')caption.endFrame=121;
  if(invalid==='fractional-cut'){f.first.end=frameTimeForTest(60.5);f.first.outPoint=frameTimeForTest(30.5);f.second.start=frameTimeForTest(60.5);f.second.inPoint=frameTimeForTest(30.5);}
  const result=JSON.parse(f.host.apply(automaticPayload(f,[caption])));assert.ok(result.error,invalid);assert.equal(f.media.media,'/caption-bundle-old.mov',invalid);assert.equal(f.imports.length,0,invalid);assert.equal(f.overwrites.length,0,invalid);assert.equal(f.a.position.writes.length,0,invalid);assert.equal(f.b.width.writes.length,0,invalid);
 }
});
test('native Razor selection follows the logical bundle while native text-area controls resolve the exact selected fragment',()=>{
 const f=razorFixture();f.second.selected=true;f.sequence.playhead=frameTimeForTest(80);
 let result=JSON.parse(f.host.readCaptionSelection(f.readFile()));assert.equal(result.ok,true);assert.equal(result.captionId,'caption');assert.equal(result.clipNodeId,f.first.nodeId);assert.equal(result.nativeClipNodeId,f.second.nodeId);
 result=JSON.parse(f.host.readCaptionAreaDescriptor(f.readFile()));assert.equal(result.ok,true);assert.equal(result.clipNodeId,f.second.nodeId);assert.equal(result.inTicks,String(30*TPF));assert.equal(result.bundleSourceContiguous,true);assert.equal(result.bundleFragments.length,2);
 result=JSON.parse(f.host.selectCaptionClip(f.readFile()));assert.equal(result.ok,true);assert.equal(result.clipNodeId,f.second.nodeId);assert.equal(result.time,80/FPS);assert.equal(f.second.selected,true);assert.equal(f.first.selected,false);
 result=JSON.parse(f.host.readTimeline(f.readFile()));assert.equal(result.ok,true);assert.equal(result.cues[0].start,f.first.start.seconds);assert.equal(result.cues[0].end,f.second.end.seconds);assert.equal(result.cues[0].bundleFragments.length,2);assert.equal(f.overwrites.length,0);assert.equal(f.imports.length,0);
});
test('native Razor discovery and automatic key sampling have aggregate safety bounds',()=>{
 const f=razorFixture();for(let i=0;i<2000;i++)f.addClip(f.item('/unrelated-'+i+'.mov'),10+i,11+i);
 let result=JSON.parse(f.host.readCaptionGeometry(f.readFile()));assert.match(result.error,/too large/);assert.equal(f.a.position.sampled.length,0);assert.equal(f.b.width.sampled.length,0);
 const g=razorFixture();g.a.width.keys=Array.from({length:130},(_,i)=>({time:i/FPS,value:100+i/10}));g.b.width.keys=Array.from({length:130},(_,i)=>({time:i/FPS,value:100+i/10}));
 result=JSON.parse(g.host.readCaptionGeometry(g.readFile()));assert.match(result.error,/too many Motion keys/);assert.ok(g.b.width.sampled.length===0);assert.equal(g.overwrites.length,0);
});

test('host refuses an unrelated collision before import or overwrite', () => {
  const f = hostFixture(), existing = f.addClip(f.item('/original.mov'), 0, 1);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('caption')])));
  assert.match(result.error, /contains another clip/); assert.equal(f.imports.length, 0); assert.equal(f.overwrites.length, 0); assert.equal(f.clips[0], existing);
});
test('host places one clip per phrase on exact sequence frames and reads back links', () => {
  const f = hostFixture(), result = JSON.parse(f.host.apply(f.payload([f.cue('a', 1, 30), f.cue('b', 30, 61)])));
  assert.equal(result.ok, true); assert.equal(f.clips.length, 2); assert.equal(result.cues.length, 2);
  assert.equal(f.clips[0].start.ticks, String(TPF)); assert.equal(f.clips[1].start.ticks, f.clips[0].end.ticks);
  assert.equal(f.clips[1].end.ticks, String(61 * TPF));
});
test('relink updates the original clip while preserving manual Motion and keyframe values', () => {
  const f = hostFixture(), media = f.item('/old.mov'), clip = f.addClip(media, 1, 2), motion = structuredClone(clip.motion);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('updated', 31, 65, { clipNodeId: clip.nodeId, projectItemId: media.nodeId, previousPath: media.media })])));
  assert.equal(result.ok, true); assert.equal(f.clips[0], clip); assert.equal(f.overwrites.length, 0); assert.deepEqual(clip.motion, motion); assert.equal(media.media, '/render/updated.mov');
});
test('host refuses relinking media reused by another sequence', () => {
  const f = hostFixture(), media = f.item('/old.mov'), clip = f.addClip(media, 1, 2);
  f.project.sequences.push({ videoTracks: collection([{ clips: collection([{ projectItem: media }]) }], 'numTracks'), audioTracks: collection([], 'numTracks') });
  const result = JSON.parse(f.host.apply(f.payload([f.cue('updated', 31, 65, { clipNodeId: clip.nodeId, projectItemId: media.nodeId, previousPath: media.media })])));
  assert.match(result.error, /used by another/); assert.equal(media.media, '/old.mov'); assert.equal(f.imports.length, 0);
});
test('host restores already updated clips when a later relink fails', () => {
  const f = hostFixture(), firstMedia = f.item('/first-old.mov'), secondMedia = f.item('/second-old.mov');
  const first = f.addClip(firstMedia, 0, 1), second = f.addClip(secondMedia, 2, 3), before = { start: first.start.ticks, end: first.end.ticks, motion: structuredClone(first.motion) };
  secondMedia.failNext = true;
  const result = JSON.parse(f.host.apply(f.payload([f.cue('first', 0, 35, { clipNodeId: first.nodeId, projectItemId: firstMedia.nodeId, previousPath: firstMedia.media }), f.cue('second', 62, 96, { clipNodeId: second.nodeId, projectItemId: secondMedia.nodeId, previousPath: secondMedia.media })])));
  assert.match(result.error, /Simulated/); assert.equal(result.rolledBack, true); assert.equal(firstMedia.media, '/first-old.mov'); assert.equal(secondMedia.media, '/second-old.mov'); assert.equal(first.start.ticks, before.start); assert.equal(first.end.ticks, before.end); assert.deepEqual(first.motion, before.motion);
});
test('host rejects captured sequence/project changes before mutation', () => {
  const f = hostFixture(), file = f.payload([f.cue('a')]); f.project.path = '/other/project.prproj';
  const result = JSON.parse(f.host.apply(file)); assert.match(result.error, /project changed/); assert.equal(f.imports.length, 0);
});
test('an unexpectedly placed new clip is removed during rollback', () => {
  const f = hostFixture(), insert = f.track.overwriteClip;
  f.track.overwriteClip = (item, seconds) => insert(item, seconds + 10);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('misplaced')])));
  assert.match(result.error, /expected timeline position/); assert.equal(result.rolledBack, true); assert.equal(result.attemptedCreated, 1); assert.equal(f.clips.length, 0);
});
test('host JSON works without another extension polyfill and preserves escaped caption text', () => {
  const f = hostFixture(), text = 'Quoted "word" \\ line\nCafé — 字';
  const result = JSON.parse(f.host.apply(f.payload([f.cue('unicode', 0, 24, { text })])));
  assert.equal(result.ok, true); assert.equal(f.clips[0].name, 'Better Captions | ' + text);
});
test('host rejects executable file text and prototype keys without evaluating either', () => {
  const f = hostFixture(); f.files.set('/job.json', '{"sequenceId":"seq-a","attack":(function(){throw new Error("executed")})()}');
  assert.match(JSON.parse(f.host.apply('/job.json')).error, /Invalid caption job JSON/);
  f.files.set('/job.json', '{"__proto__":{"polluted":true}}');
  assert.match(JSON.parse(f.host.apply('/job.json')).error, /Invalid caption job JSON/); assert.equal(f.imports.length, 0);
});

test('native caption selection seeks a spoken frame and exclusively selects the exact linked video clip', () => {
  const f=hostFixture(),source=f.addClip(f.item('/source.mp4'),0,5),caption=f.addClip(f.item('/managed/caption.mov'),1,2),audio=collection();
  const dialogue=f.addClip(f.item('/source.wav'),0,5,audio);f.sequence.audioTracks.push({clips:audio});source.selected=true;dialogue.selected=true;
  const motion=structuredClone(caption.motion),result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(caption)));
  assert.equal(result.ok,true);assert.equal(result.clipNodeId,caption.nodeId);assert.equal(result.projectItemId,caption.projectItem.nodeId);assert.equal(result.path,'/managed/caption.mov');assert.equal(result.track,0);
  assert.equal(caption.selected,true);assert.equal(source.selected,false);assert.equal(dialogue.selected,false);
  const expectedFrame=Math.floor(1.3*FPS+1e-7);assert.equal(f.sequence.playhead.ticks,String(expectedFrame*TPF));assert.equal(result.time,expectedFrame/FPS);
  assert.deepEqual(caption.motion,motion);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);
});

test('native selection rejects stale sequence, project, clip, media or item identities before UI changes', () => {
  const f=hostFixture(),caption=f.addClip(f.item('/managed/caption.mov'),1,2),source=f.addClip(f.item('/source.mp4'),0,5);source.selected=true;f.sequence.playhead.seconds=4;
  for(const [patch,context] of [[{}, {sequenceId:'other'}],[{}, {projectPath:'/other.prproj'}],[{clipNodeId:'missing'},{}],[{projectItemId:'other'},{}],[{mediaPath:'/other.mov'},{}],[{clipNodeId:undefined},{}]]){
    const result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(caption,patch,context)));assert.ok(result.error);assert.equal(source.selected,true);assert.equal(caption.selected,false);assert.equal(f.sequence.playhead.seconds,4);
  }
});

test('pending caption timing cannot seek selection outside the real linked clip', () => {
  const f=hostFixture(),caption=f.addClip(f.item('/managed/caption.mov'),1,2);
  const result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(caption,{words:[{text:'edited',startTime:10,endTime:11}]})));
  assert.equal(result.ok,true);assert.ok(result.time>=1&&result.time<2);assert.ok(Math.abs(result.time-1.5)<1/FPS);
});

test('selection failures restore prior clip selections and playhead without changing any media', () => {
  const f=hostFixture(),source=f.addClip(f.item('/source.mp4'),0,5),caption=f.addClip(f.item('/managed/caption.mov'),1,2);source.selected=true;f.sequence.playhead.seconds=4;caption.failSelection=true;
  const result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(caption)));
  assert.match(result.error,/selection/);assert.equal(result.selectionRestored,true);assert.equal(source.selected,true);assert.equal(caption.selected,false);assert.equal(f.sequence.playhead.seconds,4);assert.equal(caption.projectItem.media,'/managed/caption.mov');
});

test('locked or hidden caption tracks stop direct manipulation without toggling track state', () => {
  for(const condition of ['locked','muted']){
    const f=hostFixture(),caption=f.addClip(f.item('/managed/caption.mov'),1,2);f.track.isLocked=()=>condition==='locked';f.track.isMuted=()=>condition==='muted';
    const result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(caption)));assert.match(result.error,/Unlock|Enable video track/);assert.equal(caption.selected,false);assert.equal(f.sequence.playhead.seconds,0);
  }
});

test('native seek failures and ignored seeks cannot report a successful Program Monitor refresh', () => {
  for(const condition of ['refuseSeek','ignoreSeek']){
    const f=hostFixture();f.sequence[condition]=true;
    assert.match(JSON.parse(f.host.seek(f.sequence.sequenceID,1,f.project.path)).error,/could not seek/);
  }
  const f=hostFixture(),result=JSON.parse(f.host.seek(f.sequence.sequenceID,1.5,f.project.path));assert.equal(result.ok,true);assert.equal(result.time,1.5);
});

test('caption box profiles distinguish uniform and independent native width/height scales',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),300/FPS,302/FPS),params=attachNativeMotion(clip,{height:{value:125},width:{value:200}});
  const uniform=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip)));assert.equal(uniform.ok,true);const first=uniform.cues[0].motionProfile;
  assert.equal(first.samples.length,2);assert.ok(first.samples.every(sample=>sample.scaleX===1.25&&sample.scaleY===1.25));assert.equal(first.samples[0].time,300.5/FPS);
  params.uniform.value=false;const independent=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  assert.ok(independent.samples.every(sample=>sample.scaleX===2&&sample.scaleY===1.25));assert.notEqual(independent.signature,first.signature);
});

test('animated box samples use source-in plus frame elapsed and retain interpolation in their rendered signature',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),300/FPS,302/FPS);clip.inPoint.seconds=1.25;
  const params=attachNativeMotion(clip,{height:{keys:[{time:1.25,value:100},{time:1.25+2/FPS,value:200}]},width:{value:300},uniform:{value:false}});
  const before=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  assert.ok(Math.abs(params.height.sampled[0]-(1.25+.5/FPS))<1e-9);assert.ok(Math.abs(before.samples[0].scaleY-1.25)<1e-8);assert.ok(Math.abs(before.samples[1].scaleY-1.75)<1e-8);assert.equal(before.samples[0].scaleX,3);
  params.height.mode='hold';const held=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  assert.equal(held.samples[0].scaleY,1);assert.notEqual(held.signature,before.signature,'interpolation change affects sampled output even with identical key times/values');
});

test('width signatures ignore playhead, Position, Rotation, Anchor and absolute sequence placement',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),300/FPS,302/FPS),params=attachNativeMotion(clip,{width:{value:150},uniform:{value:false}});
  const original=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  f.sequence.playhead.seconds=9;params.position.value=[.1,.9];params.rotation.value=40;params.anchor.value=[.3,.2];
  const moved=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{startTime:600/FPS,endTime:602/FPS}))).cues[0].motionProfile;
  assert.equal(moved.signature,original.signature);assert.equal(moved.samples[0].time,600.5/FPS);assert.equal(f.sequence.playhead.seconds,9);
});

test('width signatures include the entire keyed width curve even while uniform scale currently masks it',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,2/FPS),params=attachNativeMotion(clip,{width:{keys:[{time:0,value:100},{time:1,value:200}]}});
  const first=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  params.width.keys[1].value=300;const next=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  assert.deepEqual(next.samples,first.samples);assert.notEqual(next.signature,first.signature);
});

test('motion reads refuse stale links, invalid scales, changed speed and unbounded frame batches without mutation',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1),params=attachNativeMotion(clip);clip.selected=true;f.sequence.playhead.seconds=5;
  assert.match(JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{projectItemId:'other'}))).error,/link changed/);
  params.height.value=0;assert.match(JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).error,/between 1%/);params.height.value=100;
  clip.getSpeed=()=>2;assert.match(JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).error,/original playback speed/);clip.getSpeed=()=>1;
  assert.match(JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{endTime:100001/FPS}))).error,/smaller batches/);
  assert.equal(clip.selected,true);assert.equal(f.sequence.playhead.seconds,5);assert.equal(clip.projectItem.media,'/managed/caption.mov');
});

test('Program Monitor selection keeps a visible current frame when editing a box keyframe',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),1,2);f.sequence.playhead.ticks=String(40*TPF);f.sequence.refuseSeek=true;
  const result=JSON.parse(f.host.selectCaptionClip(f.selectPayload(clip)));
  assert.equal(result.ok,true);assert.equal(result.time,40/FPS);assert.equal(f.sequence.playhead.ticks,String(40*TPF));assert.equal(clip.selected,true);
});

test('native selection following recognizes one exact caption without selecting, seeking, or following ambiguous clips',()=>{
  const f=hostFixture(),a=f.addClip(f.item('/managed/a.mov'),0,1),b=f.addClip(f.item('/managed/b.mov'),1,2),footage=f.addClip(f.item('/footage.mp4'),0,4),audio=collection();
  const dialogue=f.addClip(f.item('/dialogue.wav'),0,4,audio);f.sequence.audioTracks.push({clips:audio});dialogue.selected=true;f.sequence.playhead.seconds=1.4;
  function read(patch={}){f.files.set('/selection.json',JSON.stringify({sequenceId:'seq-a',projectPath:f.project.path,cues:[a,b].map((c,i)=>({id:['a','b'][i],clipNodeId:c.nodeId,projectItemId:c.projectItem.nodeId,mediaPath:c.projectItem.media,...patch}))}));return JSON.parse(f.host.readCaptionSelection('/selection.json'));}
  b.selected=true;const selected=read();assert.equal(selected.ok,true);assert.equal(selected.captionId,'b');assert.equal(selected.clipNodeId,b.nodeId);assert.equal(selected.time,1.4);
  a.selected=true;assert.equal(read().captionId,null);a.selected=false;footage.selected=true;assert.equal(read().captionId,null);footage.selected=false;
  assert.equal(read({mediaPath:'/stale.mov'}).captionId,null);b.selected=false;assert.equal(read().captionId,null);
  assert.equal(dialogue.selected,true);assert.equal(f.sequence.playhead.seconds,1.4);assert.equal(f.imports.length,0);
});

test('new cropped caption clips use the actual text area for independent native width and height handles',()=>{
  const f=hostFixture(),insert=f.track.overwriteClip;let params;
  f.track.overwriteClip=(item,seconds)=>{const clip=insert(item,seconds);params=attachNativeMotion(clip);return clip;};
  const box=bounds(-120,700,960,380),result=JSON.parse(f.host.apply(f.payload([f.cue('caption',0,30,{renderBounds:box})])));
  assert.equal(result.ok,true);assert.deepEqual(result.cues[0].renderBounds,box);assert.deepEqual(params.position.value,[(box.x+box.width/2)/1920,(box.y+box.height/2)/1080]);
  assert.deepEqual(params.anchor.value,[.5,.5]);assert.equal(params.uniform.value,false);assert.equal(params.height.value,100);assert.equal(params.width.value,100);
  assert.ok(result.cues[0].motionProfile.samples.every(sample=>sample.scaleX===1&&sample.scaleY===1));
  closePoint(worldPoint([650,810],box,currentMotion(params)),[650,810]);
});

test('legacy static caption migration preserves on-screen geometry with custom anchor, rotation and independent scale',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{position:{value:[.6,.7]},anchor:{value:[.4,.6]},height:{value:120},width:{value:175},uniform:{value:false},rotation:{value:31}});
  const logical=[1030,820],before=worldPoint(logical,null,currentMotion(params)),box=bounds(420,560,1120,432);
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box)])));
  assert.equal(result.ok,true);assert.deepEqual(params.anchor.value,[.5,.5]);assert.equal(params.height.value,120);assert.equal(params.width.value,175);assert.equal(params.rotation.value,31);
  closePoint(worldPoint(logical,box,currentMotion(params)),before);assert.equal(f.clips[0],clip);assert.equal(f.overwrites.length,0);
});

test('static uniform-scale migration unlocks aspect ratio while retaining effective width and height',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{height:{value:143},width:{value:62},uniform:{value:true}});
  const logical=[1100,760],before=worldPoint(logical,null,currentMotion(params)),box=bounds();
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box)])));
  assert.equal(result.ok,true);assert.equal(params.uniform.value,false);assert.equal(params.width.value,143);assert.equal(params.height.value,143);
  closePoint(worldPoint(logical,box,currentMotion(params)),before);
});

test('animated caption crop migration preserves native Position, Rotation and width/height key curves exactly',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{position:{keys:[{time:0,value:[.4,.6],interpolation:'bezier'},{time:1,value:[.7,.8],interpolation:'hold'}]},rotation:{keys:[{time:0,value:-14},{time:1,value:26}]},height:{keys:[{time:0,value:100},{time:1,value:140}]},width:{keys:[{time:0,value:120},{time:1,value:170}]},uniform:{value:false}});
  const keys=Object.fromEntries(['position','rotation','height','width'].map(name=>[name,structuredClone(params[name].keys)])),logical=[1020,810],times=[0,.25,.65,.99],before=times.map(t=>worldPoint(logical,null,currentMotion(params,t))),box=bounds(500,600,900,432);
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box)])));
  assert.equal(result.ok,true);for(const name of Object.keys(keys)){assert.deepEqual(params[name].keys,keys[name]);assert.equal(params[name].writes.length,0,`${name} key interpolation must be left native`);}
  closePoint(params.anchor.value,[(960-box.x)/box.width,(540-box.y)/box.height]);times.forEach((t,i)=>closePoint(worldPoint(logical,box,currentMotion(params,t)),before[i]));
});

test('animated Anchor Point migration is rejected rather than risking its native spatial Bezier path',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{anchor:{keys:[{time:0,value:[.3,.4],interpolation:'bezier'},{time:1,value:[.6,.7],interpolation:'hold'}]},uniform:{value:false}}),before=structuredClone(params.anchor.keys);
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip)])));
  assert.match(result.error,/animated Anchor Point geometry/);assert.deepEqual(params.anchor.keys,before);assert.equal(clip.projectItem.media,'/old.mov');assert.equal(f.imports.length,0);assert.equal(params.anchor.writes.length,0);
});

test('an unchanged paragraph box preserves animated Anchor Point keys and interpolation exactly',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{anchor:{keys:[{time:0,value:[.3,.4],interpolation:'bezier'},{time:1,value:[.6,.7],interpolation:'hold'}]},uniform:{value:false}}),box=bounds(),before=structuredClone(params.anchor.keys);
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box,{previousRenderBounds:box})])));
  assert.equal(result.ok,true);assert.deepEqual(params.anchor.keys,before);assert.equal(params.anchor.writes.length,0);assert.equal(params.position.writes.length,0);
});

test('only Position-keyed captions can unlock a static uniform scale without rewriting Position keys',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{position:{keys:[{time:0,value:[.4,.6]},{time:1,value:[.7,.8]}]},height:{value:160},width:{value:80}}),before=structuredClone(params.position.keys);
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip)])));
  assert.equal(result.ok,true);assert.equal(params.uniform.value,false);assert.equal(params.width.value,160);assert.deepEqual(params.position.keys,before);assert.equal(params.position.writes.length,0);
});

test('caption box reapply keeps an existing custom anchor and placement when the stored source bounds are unchanged',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{position:{value:[.1,.9]},anchor:{value:[.1,.2]},uniform:{value:false}}),box=bounds();
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box,{previousRenderBounds:box})])));
  assert.equal(result.ok,true);assert.deepEqual(params.position.value,[.1,.9]);assert.deepEqual(params.anchor.value,[.1,.2]);assert.equal(params.position.writes.length,0);assert.equal(params.anchor.writes.length,0);
});

test('unsafe trimmed animations and uniform-locked animated scales are rejected before imports or relinks',()=>{
  for(const mode of ['trimmed','height','width','uniform']){
    const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip);
    if(mode==='trimmed'){clip.inPoint.seconds=.5;params.position.keys=[{time:.5,value:[.5,.5]},{time:1.5,value:[.7,.6]}];}
    else if(mode==='uniform')params.uniform.keys=[{time:0,value:true},{time:1,value:false}];
    else params[mode].keys=[{time:0,value:100},{time:1,value:150}];
    const result=JSON.parse(f.host.apply(f.payload([f.cue('new',60,90,{renderBounds:bounds()}),geometryCue(f,clip)])));
    assert.match(result.error,/trimmed source|independent width and height keyframes/);assert.equal(f.imports.length,0);assert.equal(f.overwrites.length,0);assert.equal(clip.projectItem.media,'/old.mov');
  }
});

test('invalid source geometry and stale box-animation signatures fail before any mutation',()=>{
  for(const mode of ['bounds','coordinate','signature']){
    const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{uniform:{value:false}});const extra={};let box=bounds();
    if(mode==='bounds')box={...box,width:1921};
    if(mode==='coordinate')params.anchor.value=[.5,NaN];
    if(mode==='signature'){extra.motionProfile=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{startTime:0,endTime:30/FPS}))).cues[0].motionProfile;params.width.value=130;}
    const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip,box,extra)])));
    assert.match(result.error,/text box|coordinate|changed during rendering/);assert.equal(clip.projectItem.media,'/old.mov');assert.equal(f.imports.length,0);assert.equal(params.position.writes.length,0);
  }
});

test('a later relink failure restores earlier crop geometry, effective scale, source timing and media',()=>{
  const f=hostFixture(),a=f.addClip(f.item('/a-old.mov'),0,1),b=f.addClip(f.item('/b-old.mov'),2,3),params=attachNativeMotion(a,{position:{value:[.6,.7]},height:{value:132},width:{value:77}}),before=currentMotion(params);
  attachNativeMotion(b);b.projectItem.failNext=true;
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,a),geometryCue(f,b,bounds(),{id:'second',startFrame:60,endFrame:90})])));
  assert.match(result.error,/Simulated relink failure/);assert.equal(result.rolledBack,true);assert.deepEqual(currentMotion(params),before);assert.equal(a.projectItem.media,'/a-old.mov');assert.equal(a.start.seconds,0);assert.equal(a.end.seconds,1);
});

test('an ignored Motion write cannot report success and restores all earlier changes',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip,{anchor:{value:[.3,.4]},height:{value:150},width:{value:75}}),before=currentMotion(params);params.anchor.ignoreNext=true;
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip)])));
  assert.match(result.error,/did not keep.*anchor/);assert.equal(result.rolledBack,true);assert.deepEqual(currentMotion(params),before);assert.equal(clip.projectItem.media,'/old.mov');
});

test('Motion diagnostics expose bounded native metadata without refreshing, evaluating, selecting or seeking',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1);attachNativeMotion(clip);f.sequence.playhead.seconds=4;clip.selected=true;
  const project='<xmp:VideoInfo>576 x 512</xmp:VideoInfo>'+"quoted \\\" <script>throw Error('must remain text')</script> "+'字'.repeat(9000),xmp='<xmpDM:videoFrameSize stDim:w="576" stDim:h="512"/>';
  clip.projectItem.getProjectMetadata=()=>project;clip.projectItem.getXMPMetadata=()=>xmp;
  const result=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{}, {includeDiagnostics:true})));
  assert.equal(result.ok,true);const info=result.cues[0].motionInfo;
  assert.equal(info.projectMetadata,project.slice(0,8000));assert.equal(info.projectMetadata.length,8000);assert.equal(info.projectMetadataTruncated,true);assert.equal(info.xmpMetadata,xmp);assert.equal(info.xmpMetadataTruncated,false);
  assert.equal(f.sequence.playhead.seconds,4);assert.equal(clip.selected,true);assert.equal(clip.projectItem.refreshes,undefined);assert.equal(f.imports.length,0);
});

test('unavailable or malformed metadata is a bounded diagnostic error without breaking a valid Motion profile',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1);attachNativeMotion(clip);
  clip.projectItem.getProjectMetadata=()=>{throw new Error('native metadata failure '+ 'x'.repeat(5000));};clip.projectItem.getXMPMetadata=()=>({unexpected:'not XML text'});
  const result=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{}, {includeDiagnostics:true})));
  assert.equal(result.ok,true);const info=result.cues[0].motionInfo;
  assert.match(info.projectMetadataError,/native metadata failure/);assert.ok(info.projectMetadataError.length<=300);assert.match(info.xmpMetadataError,/did not return metadata text/);assert.equal(info.projectMetadata,undefined);assert.ok(result.cues[0].motionProfile.samples.length>0);
});

test('geometry-changing relinks refresh the exact source before writing any Motion value',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip),events=[],media=clip.projectItem,oldChange=media.changeMediaPath;
  media.changeMediaPath=function(path){events.push(['relink',path]);return oldChange.call(this,path);};
  media.refreshMedia=function(){events.push(['refresh',this.media]);this.representation=this.media;return 0;};
  for(const [name,param]of Object.entries(params)){const set=param.setValue;param.setValue=function(value){assert.equal(media.representation,media.media,'native source geometry must be current before Motion writes');events.push(['motion',name]);return set.call(this,value);};}
  const cue=geometryCue(f,clip),result=JSON.parse(f.host.apply(f.payload([cue])));
  assert.equal(result.ok,true);assert.deepEqual(events.slice(0,2),[['relink',cue.path],['refresh',cue.path]]);assert.ok(events.slice(2).some(([event])=>event==='motion'));assert.equal(events.filter(([event])=>event==='refresh').length,1);
});

test('CEP refresh accepts numeric zero and legacy nonboolean results without a truthiness failure',()=>{
  for(const status of [0,true,undefined,'legacy-native-result',[]]){
    const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1);attachNativeMotion(clip);let called=0;
    clip.projectItem.refreshMedia=()=>{called++;return status;};
    const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,clip)])));
    assert.equal(result.ok,true,`refresh return ${String(status)} must not be treated as false`);assert.equal(called,1);
  }
});

test('refresh failures stop before Motion edits and refresh the original source during rollback',()=>{
  for(const failure of ['false','throw','offline','path']){
    const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1),params=attachNativeMotion(clip),media=clip.projectItem,refreshed=[];let offline=false;
    media.isOffline=()=>offline;
    media.refreshMedia=function(){refreshed.push(this.media);if(refreshed.length===1){if(failure==='false')return false;if(failure==='throw')throw new Error('Simulated refresh failure');if(failure==='offline')offline=true;if(failure==='path')this.media='/unexpected.mov';}else offline=false;return 0;};
    const cue=geometryCue(f,clip),result=JSON.parse(f.host.apply(f.payload([cue])));
    assert.match(result.error,/refresh/);assert.equal(result.rolledBack,true);assert.deepEqual(refreshed,[cue.path,'/old.mov']);assert.equal(media.media,'/old.mov');assert.ok(Object.values(params).every(param=>param.writes.length===0));assert.equal(clip.start.seconds,0);assert.equal(clip.end.seconds,1);
  }
});

test('rollback refreshes restored source geometry before restoring earlier Motion changes',()=>{
  const f=hostFixture(),a=f.addClip(f.item('/a-old.mov'),0,1),b=f.addClip(f.item('/b-old.mov'),2,3),params=attachNativeMotion(a),media=a.projectItem,events=[],change=media.changeMediaPath;
  attachNativeMotion(b);b.projectItem.failNext=true;
  media.changeMediaPath=function(path){events.push(['relink',path]);return change.call(this,path);};media.refreshMedia=function(){events.push(['refresh',this.media]);this.representation=this.media;return undefined;};
  for(const param of Object.values(params)){const set=param.setValue;param.setValue=function(value){assert.equal(media.representation,media.media);events.push(['motion',media.media]);return set.call(this,value);};}
  const result=JSON.parse(f.host.apply(f.payload([geometryCue(f,a),geometryCue(f,b,bounds(),{id:'second',startFrame:60,endFrame:90})])));
  assert.match(result.error,/Simulated relink/);assert.equal(result.rolledBack,true);const restore=events.findIndex(([event,path])=>event==='relink'&&path==='/a-old.mov');assert.ok(restore>1);assert.deepEqual(events[restore+1],['refresh','/a-old.mov']);assert.ok(events.slice(restore+2).every(([event])=>event==='motion'));
});

test('missing native refresh support refuses source geometry migration before importing or relinking',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/old.mov'),0,1);attachNativeMotion(clip);delete clip.projectItem.refreshMedia;
  const result=JSON.parse(f.host.apply(f.payload([f.cue('new',60,90,{renderBounds:bounds()}),geometryCue(f,clip)])));
  assert.match(result.error,/cannot refresh/);assert.equal(f.imports.length,0);assert.equal(clip.projectItem.media,'/old.mov');
});

function countMotionReads(params){
  const calls={isTimeVarying:0,getValue:0,getKeys:0,getValueAtKey:0,getValueAtTime:0};
  for(const param of Object.values(params))for(const method of Object.keys(calls)){const original=param[method];param[method]=function(...args){calls[method]++;return original.apply(this,args);};}
  return calls;
}

test('static long-caption geometry polling performs constant native work with no Time allocations or diagnostics',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1000000/FPS),params=attachNativeMotion(clip),calls=countMotionReads(params);
  for(const name of ['anchor','rotation'])for(const method of ['getValue','getKeys','getValueAtTime','isTimeVarying'])params[name][method]=()=>{throw new Error('Unrelated Motion control must not be polled');};
  clip.projectItem.getProjectMetadata=clip.projectItem.getXMPMetadata=()=>{throw new Error('Metadata must not be polled');};
  const result=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.equal(result.ok,true);assert.match(result.cues[0].watchSignature,/^geometry-v1-/);assert.equal(result.cues[0].clipNodeId,clip.nodeId);assert.equal(result.cues[0].path,clip.projectItem.media);
  assert.deepEqual(calls,{isTimeVarying:4,getValue:4,getKeys:0,getValueAtKey:0,getValueAtTime:0});assert.equal(f.nativeCalls.timeObjects,0);assert.equal(result.cues[0].samples,undefined);assert.equal(result.cues[0].motionInfo,undefined);
});

test('animated geometry fingerprint bounds native key and interpolation reads independently of cue length',()=>{
  const f=hostFixture(),duration=1000000/FPS,clip=f.addClip(f.item('/managed/caption.mov'),0,duration);
  const keys=Array.from({length:128},(_,i)=>({time:i*duration/127,value:100+i/2})),params=attachNativeMotion(clip,{height:{keys:structuredClone(keys)},width:{keys:structuredClone(keys)},uniform:{value:false}}),calls=countMotionReads(params);
  const first=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.equal(first.ok,true);assert.equal(calls.getKeys,2);assert.equal(calls.getValueAtKey,256);assert.ok(calls.getValueAtTime>0&&calls.getValueAtTime<=48);assert.equal(f.nativeCalls.timeObjects,calls.getValueAtTime);
  params.width.keys[37].value+=10;const changed=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.equal(changed.ok,true);assert.notEqual(changed.cues[0].watchSignature,first.cues[0].watchSignature,'every bounded key value participates even between interpolation probes');
});

test('cheap geometry and full render profiles share a watch signature that detects interpolation changes',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS),params=attachNativeMotion(clip,{height:{keys:[{time:0,value:100},{time:30/FPS,value:150}]},uniform:{value:false}});
  const cheap=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip))).cues[0],full=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile;
  assert.equal(cheap.watchSignature,full.watchSignature);assert.ok(full.samples.length===30&&full.signature.startsWith('motion-v1-'));
  params.height.mode='hold';const held=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip))).cues[0];
  assert.notEqual(held.watchSignature,cheap.watchSignature);assert.equal(held.watchSignature,JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip))).cues[0].motionProfile.watchSignature);
});

test('excessive watch keys fail before native value reads while full manual render profiles remain available',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS),params=attachNativeMotion(clip,{height:{keys:Array.from({length:257},(_,i)=>({time:i/100,value:100+i/10}))},uniform:{value:false}}),calls=countMotionReads(params);
  const cheap=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.match(cheap.error,/automatic reflow.*manually/);assert.equal(calls.getValueAtKey,0);assert.equal(calls.getValueAtTime,0);
  const full=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip)));
  assert.equal(full.ok,true);assert.equal(full.cues[0].motionProfile.samples.length,30);assert.equal(full.cues[0].motionProfile.watchSignature,undefined);assert.match(full.cues[0].motionProfile.watchError,/automatic reflow/);
});

test('default full Motion reads omit diagnostics and do not allocate frame Time objects for static values',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS),params=attachNativeMotion(clip);
  for(const name of ['position','anchor'])params[name].isTimeVarying=()=>{throw new Error('Diagnostic control was queried');};
  clip.projectItem.getProjectMetadata=clip.projectItem.getXMPMetadata=()=>{throw new Error('Diagnostic metadata was queried');};
  for(const option of [{},{includeDiagnostics:'true'}]){
    const result=JSON.parse(f.host.readCaptionMotion(motionPayload(f,clip,{},option)));
    assert.equal(result.ok,true);assert.equal(result.cues[0].motionInfo,undefined);assert.ok(result.cues[0].motionProfile.watchSignature);assert.equal(f.nativeCalls.timeObjects,0);
  }
});

test('geometry fingerprints ignore playback and Position changes while retaining source clock and width state',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS),params=attachNativeMotion(clip,{uniform:{value:false}});
  const before=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip))).cues[0].watchSignature;
  f.sequence.playhead.seconds=10;params.position.value=[.1,.9];params.anchor.value=[.2,.3];params.rotation.value=30;
  const moved=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip,{startTime:300/FPS,endTime:330/FPS}))).cues[0].watchSignature;assert.equal(moved,before);
  params.width.value=160;assert.notEqual(JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip))).cues[0].watchSignature,before);
});

test('native selection snapshots avoid every timeline clip scan and ignore linked audio',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1),audio=f.addClip(f.item('/source.wav'),0,1),other=f.addClip(f.item('/other.mp4'),0,1);clip.mediaType='Video';audio.mediaType='Audio';other.mediaType='Video';let snapshots=0;
  f.sequence.getSelection=()=>{snapshots++;return [clip,audio];};
  for(const candidate of f.clips)candidate.isSelected=()=>{throw new Error('Timeline scan must not run when native selection is available');};
  const result=JSON.parse(f.host.readCaptionSelection(f.selectPayload(clip)));
  assert.equal(result.ok,true);assert.equal(result.captionId,'caption');assert.equal(snapshots,1);f.sequence.getSelection=()=>[clip,other,audio];assert.equal(JSON.parse(f.host.readCaptionSelection(f.selectPayload(clip))).captionId,null);
});

test('selection fallback exits after two selected clips without scanning unrelated footage',()=>{
  const f=hostFixture(),a=f.addClip(f.item('/a.mov'),0,1),b=f.addClip(f.item('/b.mov'),1,2),c=f.addClip(f.item('/c.mov'),2,3);let scans=0;
  a.isSelected=b.isSelected=()=>{scans++;return true;};c.isSelected=()=>{throw new Error('An ambiguous selection must not scan further');};
  f.sequence.getSelection=()=>{throw new Error('Native selection snapshot unavailable');};
  const result=JSON.parse(f.host.readCaptionSelection(f.selectPayload(a)));
  assert.equal(result.ok,true);assert.equal(result.captionId,null);assert.equal(scans,2);
});

test('older-host selection fallback has a hard scan budget and reports a clear manual-selection boundary',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,1);let scans=0;f.clips.length=0;
  for(let i=0;i<2001;i++)f.clips.push({nodeId:'unrelated-'+i,isSelected(){scans++;return false;}});
  const result=JSON.parse(f.host.readCaptionSelection(f.selectPayload(clip)));
  assert.match(result.error,/too large for automatic caption selection/);assert.equal(scans,2000);assert.equal(f.sequence.playhead.seconds,0);
});

test('geometry lookup uses the native selected clip without walking large timeline collections',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS);attachNativeMotion(clip);clip.mediaType='Video';let snapshots=0;
  f.sequence.getSelection=()=>{snapshots++;return [clip];};
  Object.defineProperty(f.sequence,'videoTracks',{get(){throw new Error('Geometry polling must not scan a timeline when its exact selected clip is available');}});
  const result=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.equal(result.ok,true);assert.equal(result.cues[0].clipNodeId,clip.nodeId);assert.equal(snapshots,1);
});

test('older-host geometry lookup refuses an unbounded timeline scan',()=>{
  const f=hostFixture(),clip=f.addClip(f.item('/managed/caption.mov'),0,30/FPS);attachNativeMotion(clip);f.clips.length=0;let inspected=0;
  for(let i=0;i<2001;i++)f.clips.push({get nodeId(){inspected++;return 'unrelated-'+i;}});
  const result=JSON.parse(f.host.readCaptionGeometry(motionPayload(f,clip)));
  assert.match(result.error,/too large for automatic caption geometry lookup/);assert.equal(inspected,2000);assert.equal(f.nativeCalls.timeObjects,0);
});

function keyPatchPayload(f, clip, updates, descriptor) {
  const link = { id: 'caption', clipNodeId: clip.nodeId, projectItemId: clip.projectItem.nodeId, mediaPath: clip.projectItem.media, renderBounds: bounds() };
  descriptor ??= JSON.parse(f.host.readCaptionAreaDescriptor(motionPayload(f, clip, { renderBounds: bounds() })));
  f.files.set('/key-patch.json', JSON.stringify({ sequenceId: f.sequence.sequenceID, projectPath: f.project.path, cues: [link], patch: { version: 1, descriptor, updates } }));
  return '/key-patch.json';
}
const keyUpdate = (property, seconds, expectedValue, value) => ({ property, ticks: new Time(seconds).ticks, expectedValue, value });
function assertNoKeyRebuild(params) {
  for (const parameter of Object.values(params)) for (const method of ['addKey', 'removeKey', 'removeKeyRange', 'setInterpolationTypeAtKey', 'setTimeVarying']) parameter[method] = () => assert.fail('In-place patch cannot call ' + method);
}
test('existing Position and sizing key values update in place without replacing native easing or key objects', () => {
  const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, {
    position: { keys: [{ time: 0, value: [.5, .5], customHandles: { incoming: [.1, .2] } }, { time: 1, value: [.6, .6] }] },
    width: { keys: [{ time: 0, value: 100, customHandles: { outgoing: [.8, .9] } }, { time: 1, value: 120 }] },
    height: { keys: [{ time: 0, value: 99 }, { time: 1, value: 105 }] }, uniform: { value: false }
  });
  assertNoKeyRebuild(params); const position = params.position.keys[0], width = params.width.keys[0], before = currentMotion(params), heightKeys = structuredClone(params.height.keys);
  const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, [keyUpdate('position', 0, [.5, .5], [.3, .7]), keyUpdate('width', 0, 100, 65)])));
  assert.equal(result.ok, true); assert.equal(params.position.keys[0], position); assert.equal(params.width.keys[0], width);
  assert.deepEqual(position.customHandles, { incoming: [.1, .2] }); assert.deepEqual(width.customHandles, { outgoing: [.8, .9] });
  assert.deepEqual(position.value, [.3, .7]); assert.equal(width.value, 65); assert.deepEqual(params.height.keys, heightKeys);
  assert.equal(result.descriptor.nativeMotion.width.keys[0].value, 65); assert.equal(result.descriptor.outTicks, clip.outPoint.ticks);
  assert.equal(f.imports.length, 0); assert.equal(f.overwrites.length, 0); assert.equal(clip.projectItem.media, '/caption.mov');
  const undo = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, result.updates.map(update => ({ property: update.property, ticks: update.ticks, expectedValue: update.value, value: update.previous })), result.descriptor)));
  assert.equal(undo.ok, true); assert.deepEqual(currentMotion(params), before); assert.equal(params.position.keys[0], position);
});
test('all stale clip identities, source clocks, bounds and untouched native curves reject before key writes', () => {
  for (const field of ['sequenceId', 'projectPath', 'clipNodeId', 'projectItemId', 'path', 'track', 'startTicks', 'endTicks', 'inTicks', 'outTicks', 'ticksPerFrame', 'frameWidth', 'frameHeight', 'bounds', 'motionBinding', 'nativeMotion']) {
    const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { position: { keys: [{ time: 0, value: [.5, .5] }] } });
    const descriptor = JSON.parse(f.host.readCaptionAreaDescriptor(motionPayload(f, clip, { renderBounds: bounds() })));
    if (field === 'bounds') descriptor.bounds.width++;
    else if (field === 'motionBinding') descriptor.motionBinding.parameterCount++;
    else if (field === 'nativeMotion') descriptor.nativeMotion.rotation.value = 20;
    else descriptor[field] = typeof descriptor[field] === 'number' ? descriptor[field] + 1 : descriptor[field] + '-stale';
    const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, [keyUpdate('position', 0, [.5, .5], [.3, .7])], descriptor)));
    assert.match(result.error, /changed before the key edit/, field); assert.ok(Object.values(params).every(param => param.writes.length === 0), field);
  }
});
test('key patches reject unknown actions, missing keys, duplicate updates and invalid values without any native edits', () => {
  for (const updates of [[], Array.from({ length: 33 }, () => keyUpdate('width', 0, 100, 65)),
    [keyUpdate('anchor', 0, [.5, .5], [.2, .2])], [keyUpdate('width', 0, 99, 65)], [keyUpdate('width', 1, 100, 65)],
    [keyUpdate('width', 0, 100, 65), keyUpdate('width', 0, 100, 66)], [keyUpdate('width', 0, 100, 0)],
    [keyUpdate('width', 0, 100, '65')], [keyUpdate('position', 0, [.5, .5], [4, .5])],
    [{ ...keyUpdate('width', 0, 100, 65), command: 'removeKey' }]]) {
    const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { width: { keys: [{ time: 0, value: 100 }] }, position: { keys: [{ time: 0, value: [.5, .5] }] } });
    const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, updates)));
    assert.ok(result.error, JSON.stringify(updates)); assert.ok(Object.values(params).every(param => param.writes.length === 0));
  }
});
test('full Motion key counts, times and values are checked even on untouched controls', () => {
  for (const change of ['count', 'time', 'value']) {
    const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { position: { keys: [{ time: 0, value: [.5, .5] }] }, anchor: { keys: [{ time: 0, value: [.5, .5] }] } });
    const descriptor = JSON.parse(f.host.readCaptionAreaDescriptor(motionPayload(f, clip, { renderBounds: bounds() })));
    if (change === 'count') params.anchor.keys.push({ time: 1, value: [.5, .5] });
    if (change === 'time') params.anchor.keys[0].time = .5;
    if (change === 'value') params.anchor.keys[0].value = [.4, .4];
    const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, [keyUpdate('position', 0, [.5, .5], [.3, .7])], descriptor)));
    assert.match(result.error, /changed before the key edit/); assert.equal(params.position.writes.length, 0);
  }
});
test('an ignored or later failing key value write rolls earlier edits back through the same keys', () => {
  for (const failure of ['ignored', 'throw']) {
    const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { width: { keys: [{ time: 0, value: 100 }] }, height: { keys: [{ time: 0, value: 99 }] } });
    const before = currentMotion(params), key = params.width.keys[0], original = params.height.setValueAtKey; let writes = 0;
    params.height.setValueAtKey = function (...args) { if (++writes === 1) { if (failure === 'throw') throw new Error('native write failed'); return 0; } return original.apply(this, args); };
    const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, [keyUpdate('width', 0, 100, 65), keyUpdate('height', 0, 99, 80)])));
    assert.ok(result.error); assert.equal(result.rolledBack, true); assert.deepEqual(currentMotion(params), before); assert.equal(params.width.keys[0], key);
    assertNoKeyRebuild(params);
  }
});
test('rollback failures report retained recovery details rather than false success', () => {
  const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { width: { keys: [{ time: 0, value: 100 }] }, height: { keys: [{ time: 0, value: 99 }] } });
  params.height.setValueAtKey = () => { throw new Error('native disk/state refusal'); };
  const result = JSON.parse(f.host.patchCaptionKeyValues(keyPatchPayload(f, clip, [keyUpdate('width', 0, 100, 65), keyUpdate('height', 0, 99, 80)])));
  assert.equal(result.rolledBack, false); assert.ok(result.rollbackErrors.length); assert.equal(result.recoveryJob, '/key-patch.json');
});
test('control revisions change for native Position and width edits while size-only watch signatures ignore Position', () => {
  const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 2), params = attachNativeMotion(clip, { uniform: { value: false } });
  const read = () => JSON.parse(f.host.readCaptionGeometry(motionPayload(f, clip))).cues[0];
  const before = read(); assert.match(before.controlRevision, /^controls-v1-/);
  params.position.value = [.3, .7]; const moved = read();
  assert.equal(moved.watchSignature, before.watchSignature); assert.notEqual(moved.controlRevision, before.controlRevision);
  f.sequence.playhead.seconds = 1; assert.equal(read().controlRevision, moved.controlRevision);
  params.width.value = 65; const resized = read(); assert.notEqual(resized.watchSignature, moved.watchSignature); assert.notEqual(resized.controlRevision, moved.controlRevision);
});
test('animated Position controls have bounded key and interpolation sampling independent of cue duration', () => {
  const f = hostFixture(), clip = f.addClip(f.item('/caption.mov'), 0, 1000000/FPS), params = attachNativeMotion(clip, { position: { keys: Array.from({ length: 256 }, (_, index) => ({ time: index / 10, value: [.5 + index / 1000, .5] })) } });
  const counts = countMotionReads(params), result = JSON.parse(f.host.readCaptionGeometry(motionPayload(f, clip)));
  assert.equal(result.ok, true); assert.equal(counts.getValueAtKey, 256); assert.ok(counts.getValueAtTime <= 24); assert.equal(f.nativeCalls.timeObjects, counts.getValueAtTime);
});
