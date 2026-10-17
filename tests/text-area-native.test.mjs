import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{readArea,editArea}=require('../uxp/text-area.js');
const TICKS=254016000000,TPF=TICKS/24;
const time=ticks=>({ticks:typeof ticks==='string'?ticks:String(Math.round(Number(ticks))),seconds:Number(ticks)/TICKS});
const clone=structuredClone;
function harness({sourceIn=0,uniform=true,pointKeys=false,float32Native=false}={}){
 const m={LINEAR:0,HOLD:4,BEZIER:5},ppro={Constants:{InterpolationMode:m,TrackItemType:{CLIP:1}},TickTime:{createWithTicks:time},PointF:class{constructor(x,y){this.x=x;this.y=y;}},ClipProjectItem:{cast:x=>x}};
 let prepared=0,lockDepth=0,transactionDepth=0;
 const createdActions=[];
 const stored=value=>float32Native?(Array.isArray(value)?value.map(Math.fround):typeof value==='number'?Math.fround(value):clone(value)):clone(value);
 const action=(kind,run)=>{assert.ok(lockDepth>0&&transactionDepth>0,kind+' must be created inside the synchronous lock and transaction');createdActions.push(kind);return run;};
 function param(displayName,value){
   const p={displayName,value,animated:false,keys:[],evaluated:[],isTimeVarying(){return this.animated;},areKeyframesSupported:async()=>true,
     getStartValue:async()=>({value:{value:clone(p.value)}}),getKeyframeListAsTickTimes:()=>p.keys.map(k=>time(k.ticks)),
     getKeyframePtr:t=>({value:{value:clone(p.keys.find(k=>k.ticks===t.ticks).value)},...(!pointKeys||displayName!=='Position'?{getTemporalInterpolationMode:async()=>p.keys.find(k=>k.ticks===t.ticks).mode}:{})}),
     getValueAtTime:async t=>{p.evaluated.push(t.ticks);let value=p.value;if(p.animated&&p.keys.length){const a=[...p.keys].reverse().find(k=>Number(k.ticks)<=Number(t.ticks))??p.keys[0],b=p.keys.find(k=>Number(k.ticks)>Number(t.ticks))??a;let f=a===b||a.mode===m.HOLD?0:Math.max(0,(Number(t.ticks)-Number(a.ticks))/(Number(b.ticks)-Number(a.ticks)));if(a.mode===m.BEZIER)f=f*f*(3-2*f);value=Array.isArray(a.value)?a.value.map((v,i)=>v+(b.value[i]-v)*f):a.value+(b.value-a.value)*f;}return {value:clone(value)};},
     createKeyframe:v=>{if(pointKeys&&displayName==='Position')assert.ok(lockDepth>0&&transactionDepth>0,'PointKeyframe must be constructed in the synchronous locked transaction');prepared++;return {value:v instanceof ppro.PointF?[v.x,v.y]:clone(v),position:time(0),mode:m.LINEAR,...(!pointKeys||displayName!=='Position'?{async setTemporalInterpolationMode(mode){this.mode=mode;return true;},async getTemporalInterpolationMode(){return this.mode;}}:{})};},
     createSetTimeVaryingAction:v=>action('timeVarying',()=>{p.animated=v;if(!v)p.keys=[];}),
     createSetValueAction:k=>action('setValue',()=>{p.value=stored(k.value);}),
     createRemoveKeyframeAction:t=>action('removeKey',()=>{p.keys=p.keys.filter(k=>k.ticks!==t.ticks);}),
     createAddKeyframeAction:k=>action('addKey',()=>{p.keys=p.keys.filter(old=>old.ticks!==k.position.ticks);p.keys.push({ticks:k.position.ticks,value:stored(k.value),mode:k.mode});p.keys.sort((a,b)=>Number(a.ticks)-Number(b.ticks));}),
     createSetInterpolationAtKeyframeAction:(t,mode)=>action('interpolation',()=>{const key=p.keys.find(k=>k.ticks===t.ticks);key.mode=mode;if(pointKeys&&displayName==='Position')key.value=[0,0];})
   };return p;
 }
 const params={position:param('Position',[.5,.5]),height:param('Scale',100),width:param('Scale Width',75),uniform:param('Uniform Scale',uniform),rotation:param('Rotation',0),anchor:param('Anchor Point',[.5,.5])};
 let activeParams=params;
 const descriptor={ok:true,sequenceId:'seq-'+Math.random(),projectPath:'/project/test.prproj',clipNodeId:'clip',projectItemId:'item',path:'/project/caption.mov',track:0,startTicks:String(TICKS*10),endTicks:String(TICKS*12),inTicks:String(TICKS*sourceIn),outTicks:String(TICKS*(sourceIn+2)),ticksPerFrame:TPF,frameWidth:1920,frameHeight:1080,bounds:{width:1200,height:400}};
 const freshDescriptor=clone(descriptor);
 const clip={getStartTime:async()=>time(descriptor.startTicks),getEndTime:async()=>time(descriptor.endTicks),getInPoint:async()=>time(descriptor.inTicks),getProjectItem:async()=>({getMediaFilePath:async()=>descriptor.path}),getComponentChain:async()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({getMatchName:async()=> 'AE.ADBE Motion',getParamCount:()=>Object.keys(activeParams).length,getParam:i=>Object.values(activeParams)[i]})})};
 const sequence={getVideoTrack:async()=>({getTrackItems:async()=>[clip]})};
 let transactions=0,reject=false,revalidations=0,revalidator=async()=>clone(freshDescriptor);
 const nativeMotion=()=>Object.fromEntries(Object.entries(activeParams).filter(([name])=>['position','width','height','uniform','rotation','anchor'].includes(name)).map(([name,p])=>[name,{animated:p.animated,value:p.animated?null:clone(p.value),keys:p.keys.map(k=>({ticks:k.ticks,value:clone(k.value)}))}]));
 const revalidate=async()=>{revalidations++;return {...await revalidator(),nativeMotion:nativeMotion()};};
 const patches=[];
 let patcher=async patch=>{
   patches.push(clone(patch));
   assert.deepEqual(patch.descriptor.nativeMotion,nativeMotion(),'CEP must receive the complete expected raw Motion state');
   for(const update of patch.updates){const p=activeParams[update.property],key=p.keys.find(k=>k.ticks===update.ticks);assert.ok(p.animated&&key);assert.deepEqual(key.value,update.expectedValue);key.value=stored(update.value);}
   return {ok:true,descriptor:await revalidate(),updates:clone(patch.updates)};
 };
 const applyPatch=patcher,patchKeyValues=patch=>patcher(patch);
 const project={afterCommit:null,lockedAccess:cb=>{lockDepth++;try{const value=cb();assert.ok(!value||typeof value.then!=='function','lockedAccess callback must remain synchronous');return value;}finally{lockDepth--;}} ,executeTransaction:cb=>{assert.ok(lockDepth>0);const actions=[];transactionDepth++;try{const value=cb({addAction:a=>{actions.push(a);return true;}});assert.ok(!value||typeof value.then!=='function','transaction callback must remain synchronous');}finally{transactionDepth--;}transactions++;if(reject)return false;for(const action of actions)action();project.afterCommit?.();return true;}};
 return {ppro,project,sequence,descriptor,freshDescriptor,params,clip,param,revalidate,createdActions,patches,patchKeyValues,applyPatch,nativeMotion,
   get transactions(){return transactions;},get prepared(){return prepared;},get revalidations(){return revalidations;},
   reject:()=>{reject=true;},useParams:next=>{activeParams=next;},setRevalidator:fn=>{revalidator=fn;},setPatcher:fn=>{patcher=fn;},relink:path=>{descriptor.path=path;freshDescriptor.path=path;},
   read:frame=>readArea(ppro,sequence,descriptor,frame,revalidate),
   edit:async(state,operation,extra={})=>editArea(ppro,project,sequence,descriptor,{signature:state.signature,frame:state.frame,operation,...extra},revalidate,{patchKeyValues})};
}
test('native Position uses source time, shares X/Y keys and reads back interpolation',async()=>{
 const h=harness();let s=await h.read(0);assert.deepEqual(s.tracks.position.value,[960,540]);
 s=await h.edit(s,'toggle',{track:'position'});assert.equal(h.params.position.keys[0].ticks,'0');
 s=await h.read(24);s=await h.edit(s,'set',{track:'position',value:[1200,700]});s=await h.edit(s,'set',{track:'position',value:[1300,700]});assert.equal(h.params.position.keys.length,2);
 s=await h.read(12);assert.ok(Math.abs(s.tracks.position.value[0]-1130)<1e-6);assert.equal(s.tracks.position.value[1],620);
 s=await h.read(0);s=await h.edit(s,'interpolation',{track:'position',interpolation:'hold'});s=await h.read(12);assert.deepEqual(s.tracks.position.value,[960,540]);
 assert.equal(h.transactions,3);assert.equal(h.patches.length,1,'editing an existing key uses the native in-place setter');
});
test('width unlocks uniform scale without changing height and Undo restores its original native state',async()=>{
 const h=harness();let s=await h.read(0);assert.deepEqual(s.tracks.width.value,[1200]);
 s=await h.edit(s,'set',{track:'width',value:[900]});assert.deepEqual(s.tracks.width.value,[900]);assert.deepEqual(s.tracks.height.value,[400]);assert.equal(h.params.uniform.value,false);
 s=await h.edit(s,'undo');assert.equal(h.params.uniform.value,true);assert.equal(h.params.width.value,75);assert.deepEqual(s.tracks.width.value,[1200]);assert.equal(s.canUndo,false);
});
test('disabling or removing the last key holds the evaluated value and remains undoable',async()=>{
 const h=harness();let s=await h.read(0);s=await h.edit(s,'toggle',{track:'height'});s=await h.read(24);s=await h.edit(s,'set',{track:'height',value:[800]});s=await h.read(12);
 s=await h.edit(s,'toggle',{track:'height'});assert.equal(s.tracks.height.animated,false);assert.deepEqual(s.tracks.height.value,[600]);
 s=await h.edit(s,'undo');assert.equal(s.tracks.height.keys.length,2);
 s=await h.read(0);s=await h.edit(s,'key',{track:'height'});s=await h.read(24);s=await h.edit(s,'key',{track:'height'});assert.equal(s.tracks.height.animated,false);assert.deepEqual(s.tracks.height.value,[800]);
});
test('stale Motion, invalid dimensions and changed links cannot start a transaction',async()=>{
 const h=harness();const s=await h.read(0);h.params.position.value=[.2,.5];await assert.rejects(h.edit(s,'set',{track:'position',value:[1,2]}),/Motion changed/);
 const fresh=await h.read(0);for(const value of [[NaN],[0],[-2]])await assert.rejects(h.edit(fresh,'set',{track:'width',value}),/Invalid/);
 h.clip.getProjectItem=async()=>({getMediaFilePath:async()=>'/unrelated.mov'});await assert.rejects(h.read(0),/clip changed/);assert.equal(h.transactions,0);
});
test('transaction rejection leaves all tracks intact, and unrelated keyframes are never rebuilt',async()=>{
 const h=harness();let s=await h.read(0);s=await h.edit(s,'toggle',{track:'position'});s=await h.read(24);s=await h.edit(s,'set',{track:'position',value:[1200,700]});
 const first=h.params.position.keys[0];first.customHandles='native handles';
 s=await h.read(24);s=await h.edit(s,'interpolation',{track:'position',interpolation:'hold'});assert.equal(h.params.position.keys[0],first);assert.equal(first.customHandles,'native handles');
 const before=clone(h.params.position.keys);h.reject();await assert.rejects(h.edit(s,'set',{track:'width',value:[900]}),/did not commit/);assert.deepEqual(h.params.position.keys,before);assert.equal(h.params.uniform.value,true);assert.equal(h.params.width.value,75);
});
test('silent native refusal is reported instead of confirming an edit',async()=>{
 const h=harness(),s=await h.read(0);h.params.position.createSetValueAction=()=>()=>{};
 await assert.rejects(h.edit(s,'set',{track:'position',value:[400,500]}),/did not confirm every Motion change/);
 assert.equal((await h.read(0)).canUndo,false);
});
test('clip identity is checked again after asynchronous action preparation',async()=>{
 const h=harness(),s=await h.read(0),original=h.params.position.getValueAtTime;
 h.params.position.getValueAtTime=async at=>{h.clip.getStartTime=async()=>time(15*TICKS);return original(at);};
 await assert.rejects(h.edit(s,'set',{track:'position',value:[400,500]}),/clip changed/);assert.equal(h.transactions,0);
});

function animate(param,values,mode=0,sourceIn=0){
 param.animated=true;
 param.keys=values.map((value,index)=>({ticks:String((sourceIn+index)*TICKS),value,mode}));
}

test('trimmed clips read the source clock but cannot acquire animation that reflow will refuse',async()=>{
 const h=harness({sourceIn:2});
 const state=await h.read(24);
 assert.equal(state.startTime,10);
 assert.ok(h.params.position.evaluated.every(ticks=>ticks===String(3*TICKS)));
 for(const track of ['position','width','height']){
   await assert.rejects(h.edit(state,'toggle',{track}),/trimmed source/);
 }
 assert.equal(h.prepared,0,'unsupported edits must fail before preparing any native actions');
 assert.equal(h.transactions,0);
 assert.equal(h.params.uniform.value,true);
 assert.deepEqual(h.params.position.value,[.5,.5]);
 assert.equal(h.params.width.value,75);
});

test('trimmed static dimensions still edit independently without introducing animation',async()=>{
 const h=harness({sourceIn:2});
 let state=await h.read(24);
 state=await h.edit(state,'set',{track:'width',value:[900]});
 assert.deepEqual(state.tracks.width.value,[900]);
 assert.deepEqual(state.tracks.height.value,[400]);
 assert.equal(h.params.uniform.value,false);
 assert.equal(h.params.width.animated,false);
 assert.equal(h.transactions,1);
});

test('existing trimmed animation can be removed incrementally, then static editing resumes',async()=>{
 const h=harness({sourceIn:2,uniform:false});
 animate(h.params.position,[[.5,.5],[.75,.7]],0,2);
 animate(h.params.width,[100,150],0,2);
 let state=await h.read(0);
 state=await h.edit(state,'key',{track:'position'});
 assert.equal(h.params.position.keys.length,1);
 assert.equal(h.params.width.keys.length,2);
 state=await h.edit(state,'toggle',{track:'position'});
 assert.equal(h.params.position.animated,false);
 state=await h.edit(state,'toggle',{track:'width'});
 assert.equal(h.params.width.animated,false);
 state=await h.edit(state,'set',{track:'height',value:[600]});
 assert.deepEqual(state.tracks.height.value,[600]);
 assert.equal(h.transactions,4);
});

test('changing trimmed keys or their interpolation is rejected without changing surviving native keys',async()=>{
 const h=harness({sourceIn:2,uniform:false});
 animate(h.params.width,[100,150],0,2);
 const state=await h.read(0),before=clone(h.params.width.keys);
 await assert.rejects(h.edit(state,'set',{track:'width',value:[1600]}),/trimmed source/);
 await assert.rejects(h.edit(state,'interpolation',{track:'width',interpolation:'hold'}),/trimmed source/);
 assert.deepEqual(h.params.width.keys,before);
 assert.equal(h.prepared,0);
 assert.equal(h.transactions,0);
});

test('trimmed clips with external Anchor or Rotation animation obey the same renderer boundary',async()=>{
 for(const track of ['anchor','rotation']){
   const h=harness({sourceIn:2,uniform:false});
   animate(h.params[track],track==='anchor'?[[.5,.5],[.4,.5]]:[0,25],0,2);
   await assert.rejects(h.edit(await h.read(0),'set',{track:'position',value:[600,400]}),/trimmed source/);
   assert.equal(h.transactions,0);
   assert.equal(h.prepared,0);
 }
});

test('Uniform Scale animation is not reconstructed from Bezier endpoints',async()=>{
 const h=harness();
 animate(h.params.height,[100,150],h.ppro.Constants.InterpolationMode.BEZIER);
 h.params.height.keys[0].customHandles={incoming:[.13,.91],outgoing:[.78,.04]};
 const state=await h.read(0),before=clone(h.params.height.keys),first=h.params.height.keys[0];
 for(const [operation,extra]of [['set',{track:'width',value:[1300]}],['toggle',{track:'width'}],['set',{track:'position',value:[800,500]}]]){
   await assert.rejects(h.edit(state,operation,extra),/Uniform Scale/);
 }
 assert.equal(h.params.height.keys[0],first,'custom native key objects remain untouched');
 assert.deepEqual(h.params.height.keys,before);
 assert.equal(h.params.width.value,75);
 assert.deepEqual(h.params.width.keys,[]);
 assert.equal(h.params.uniform.value,true);
 assert.equal(h.prepared,0);
 assert.equal(h.transactions,0);
});

test('unsupported uniform animation can be disabled without copying its unknown curve to Width',async()=>{
 const h=harness();
 animate(h.params.height,[100,150],h.ppro.Constants.InterpolationMode.BEZIER);
 let state=await h.read(12);
 state=await h.edit(state,'toggle',{track:'height'});
 assert.equal(h.params.height.animated,false);
 assert.equal(h.params.height.value,125);
 assert.deepEqual(state.tracks.height.value,[500]);
 assert.deepEqual(state.tracks.width.value,[1500]);
 assert.equal(h.params.uniform.value,true);
 assert.equal(h.params.width.value,75);
 assert.deepEqual(h.params.width.keys,[]);
 assert.equal(state.canUndo,false);assert.equal(state.canRedo,false);
 await assert.rejects(h.edit(state,'undo'),/No matching plugin Undo/);
 assert.equal(h.transactions,1,'panel Undo must not recreate unsupported uniform curves');
});

test('removing one uniform animated key preserves every remaining custom handle',async()=>{
 const h=harness();
 animate(h.params.height,[100,150],h.ppro.Constants.InterpolationMode.BEZIER);
 const last=h.params.height.keys[1];last.customHandles={outgoing:[.7,.08]};
 await h.edit(await h.read(0),'key',{track:'height'});
 assert.equal(h.params.height.keys.length,1);
 assert.equal(h.params.height.keys[0],last);
 assert.equal(h.params.uniform.value,true);
 assert.deepEqual(last.customHandles,{outgoing:[.7,.08]});
});

test('changing an existing Bezier key uses only the in-place setter and preserves native key objects and handles',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 const first=h.params.position.keys[0];first.customHandles={outgoing:[.9,.1]};
 let state=await h.edit(await h.read(0),'set',{track:'position',value:[700,500]});
 assert.deepEqual(state.tracks.position.value,[700,500]);
 assert.equal(h.patches.length,1);
 state=await h.edit(state,'undo');assert.deepEqual(state.tracks.position.value,[960,540]);
 state=await h.edit(state,'redo');assert.deepEqual(state.tracks.position.value,[700,500]);
 assert.equal(h.params.position.keys[0],first);
 assert.deepEqual(first.customHandles,{outgoing:[.9,.1]});
 assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);
});

test('deleting a Bezier key refuses before mutation when exact Undo and Redo cannot restore its handles',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 const first=h.params.position.keys[0],state=await h.read(0);
 for(const operation of ['key','remove-key','move-key','toggle']) await assert.rejects(h.edit(state,operation,{track:'position',keyTicks:'0',targetFrame:12}),/custom interpolation/);
 assert.equal(h.params.position.keys.length,2);
 assert.equal(h.params.position.keys[0],first);
 assert.equal(h.transactions,0);assert.equal(h.prepared,0);assert.deepEqual(h.createdActions,[]);
});

test('destructive custom interpolation changes refuse before mutation instead of promising false Undo',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 let state=await h.read(0);
 await assert.rejects(h.edit(state,'interpolation',{track:'position',interpolation:'linear'}),/custom interpolation/);
 state=await h.edit(state,'interpolation',{track:'position',interpolation:'bezier'});
 assert.equal(state.tracks.position.keys[0].interpolation,'bezier');
 assert.equal(h.transactions,0);assert.equal(h.prepared,0);assert.deepEqual(h.createdActions,[]);
});

test('fresh private CEP identities are checked after asynchronous action preparation, including same-media replacements',async()=>{
 const changed={clipNodeId:'replacement-clip',projectItemId:'replacement-item',projectPath:'/other/project.prproj',sequenceId:'other-sequence',track:1,path:'/other/caption.mov',frameWidth:1280,ticksPerFrame:TPF*2};
 for(const [field,value]of Object.entries(changed)){
   const h=harness(),state=await h.read(0),original=h.params.position.getValueAtTime;
   h.params.position.getValueAtTime=async at=>{h.freshDescriptor[field]=value;return original(at);};
   await assert.rejects(h.edit(state,'set',{track:'position',value:[800,400]}),/timeline link changed/,field);
   assert.equal(h.transactions,0,field+' must reject before the transaction');
   assert.deepEqual(h.params.position.value,[.5,.5]);
 }
});

test('a failed final CEP check cannot commit even when the UXP clip still looks identical',async()=>{
 const h=harness(),state=await h.read(0);
 h.setRevalidator(async()=>{throw new Error('The exact linked clip was removed.');});
 await assert.rejects(h.edit(state,'set',{track:'position',value:[800,400]}),/exact linked clip was removed/);
 assert.equal(h.transactions,0);
 await assert.rejects(editArea(h.ppro,h.project,h.sequence,h.descriptor,{signature:state.signature,frame:0,operation:'set',track:'position',value:[800,400]}),/fresh Premiere timeline identity check/);
 assert.equal(h.transactions,0);
});

test('readback resolves fresh native parameter handles instead of trusting edited stale objects',async()=>{
 const h=harness(),state=await h.read(0);
 const replacement={...h.params,position:h.param('Position',[.2,.3])};
 h.project.afterCommit=()=>h.useParams(replacement);
 await assert.rejects(h.edit(state,'set',{track:'position',value:[800,400]}),/did not confirm every Motion change/);
 assert.deepEqual(h.params.position.value,[800/1920,400/1080],'old objects alone would have falsely confirmed the edit');
 assert.deepEqual((await h.read(0)).tracks.position.value,[384,324]);
 assert.equal((await h.read(0)).canUndo,false);
 assert.equal(h.transactions,1);
});

test('a link change after commit is reported as unverified with no false panel Undo result',async()=>{
 const h=harness(),state=await h.read(0);
 h.project.afterCommit=()=>{h.freshDescriptor.clipNodeId='replaced-after-commit';};
 await assert.rejects(h.edit(state,'set',{track:'position',value:[800,400]}),/could not be verified after its transaction.*Use Premiere Undo/);
 assert.equal(h.transactions,1);
 assert.deepEqual(h.params.position.value,[800/1920,400/1080]);
 h.freshDescriptor.clipNodeId=h.descriptor.clipNodeId;
 assert.equal((await h.read(0)).canUndo,false);
});

function apiHarness(t,h){
 const entries=new Map(),requests=[];
 const folder=nativePath=>({nativePath,getEntry:async name=>{const entry=entries.get(nativePath+'/'+name);if(!entry)throw new Error('Missing file');return entry;}});
 const storage={privateRoot:async()=>folder('/private/service'),ensureFolder:async path=>folder(path),randomId:()=>String(requests.length+1).padStart(32,'0'),readJSON:async file=>file.data,
   writeJSON:async(parent,name,data)=>{
     requests.push(clone(data));
     const path='/private/service/responses/'+name;
     const result=data.action==='patchCaptionKeyValues'?await h.patchKeyValues(data.args[1]):await h.revalidate();
     entries.set(path,{data:{version:1,id:data.id,sequenceId:data.sequenceId,projectPath:data.projectPath,result:clone(result)},delete:async()=>entries.delete(path)});
   }};
 entries.set('/private/service/service.json',{data:{version:1,instanceId:'a'.repeat(24),updatedAt:Date.now(),actions:['readCaptionAreaDescriptor','patchCaptionKeyValues']}});
 Object.assign(h.sequence,{guid:{toString:()=>h.descriptor.sequenceId},name:'Native area test',getSettings:async()=>({getVideoFrameRect:async()=>({width:1920,height:1080})}),getTimebase:async()=>TPF,getEndTime:async()=>time(12*TICKS),getPlayerPosition:async()=>time(10*TICKS),getVideoTrackCount:async()=>0});
 Object.assign(h.project,{path:h.descriptor.projectPath,getActiveSequence:async()=>h.sequence,getSequences:async()=>[h.sequence]});
 h.ppro.Project={getActiveProject:async()=>h.project};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../uxp/api.js',import.meta.url),'utf8'),{module,exports:module.exports,setTimeout,clearTimeout,Date,require:name=>{
   if(name==='premierepro')return h.ppro;
   if(name==='uxp')return {storage:{localFileSystem:{}}};
   if(name==='./storage.js')return storage;
   if(name==='./transcript.js')return {};
   if(name==='./paths.js')return require('../uxp/paths.js');
   if(name==='./text-area.js')return {readArea,editArea};
   throw new Error('Unexpected import '+name);
 }});
 const api=module.exports.createHostAPI({readTimeoutMs:1000});t.after(()=>api.dispose());
 return {api,requests};
}

test('actual API lane revalidates private descriptors without recursion and retains the captured caption link', {timeout:3000},async t=>{
 const h=harness(),a=apiHarness(t,h);
 const sequence=await a.api.getActiveSequenceInfo();
 const caption={id:'cue',clipNodeId:'clip',projectItemId:'item',mediaPath:h.descriptor.path,renderBounds:{width:1200,height:400},words:[{text:'private transcript'}]};
 const state=await a.api.readCaptionArea(caption,sequence.id,0);
 assert.equal(a.requests.length,2,'both initial resolution and post-read link checks use the private backend');
 const original=h.params.position.createKeyframe;
 h.params.position.createKeyframe=value=>{caption.projectItemId='mutated-in-UI';caption.renderBounds.width=300;return original(value);};
 const result=await a.api.editCaptionArea(caption,sequence.id,{signature:state.signature,frame:0,operation:'set',track:'position',value:[700,500]});
 assert.deepEqual(result.tracks.position.value,[700,500]);
 assert.equal(a.requests.length,6,'an edit rechecks the link before commit, before resolving readback handles, and after readback');
 assert.ok(a.requests.every(request=>request.action==='readCaptionAreaDescriptor'));
 assert.ok(a.requests.every(request=>request.args[0].projectItemId==='item'&&request.args[0].renderBounds.width===1200));
 assert.ok(a.requests.every(request=>!Object.hasOwn(request.args[0],'words')),'transcript text is not copied into identity probes');
 assert.equal(h.transactions,1);
});

test('Motion resolver accepts promise-backed SDK wrappers and harmless English label formatting',async()=>{
 const h=harness({uniform:false}),names=['  position  ','Scale (HEIGHT)','Scale_Width','UNIFORM\u00a0SCALE','Rotation','Anchor Point'];
 Object.values(h.params).forEach((param,index)=>{param.displayName=Promise.resolve(names[index]);});
 let counts=0;
 const motion={getMatchName:async()=> 'AE.ADBE Motion',getParamCount:async()=>{counts++;return names.length;},getParam:async index=>Object.values(h.params)[index]};
 h.clip.getComponentChain=async()=>({getComponentCount:async()=>1,getComponentAtIndex:async()=>motion});
 let state=await h.read(0);
 assert.deepEqual(state.tracks.position.value,[960,540]);
 assert.deepEqual(state.tracks.width.value,[900]);
 assert.equal(counts,1,'parameter count is read once for each resolution');
 state=await h.edit(state,'set',{track:'width',value:[720]});
 assert.deepEqual(state.tracks.width.value,[720]);
 assert.deepEqual(state.tracks.height.value,[400]);
});

test('unresolved or ambiguous Motion controls report bounded indexed native names and never guess indices',async()=>{
 const h=harness();
 h.params.width.displayName='Unexpected width label';
 await assert.rejects(h.read(0),error=>{
   assert.match(error.message,/Missing: width/);
   assert.match(error.message,/2: Unexpected width label/);
   assert.match(error.message,/0: Position/);
   return true;
 });
 h.params.width.displayName='Scale Width';h.params.rotation.displayName='Scale (Height)';
 await assert.rejects(h.read(0),/Ambiguous: height/);
 h.params.rotation.displayName='\n'+ 'x'.repeat(10000);
 h.params.width.displayName='constructor';
 await assert.rejects(h.read(0),error=>{assert.match(error.message,/Missing: width/);assert.ok(error.message.length<1600);assert.ok(!error.message.includes('\n'));return true;});
 assert.deepEqual(h.createdActions,[]);
 assert.equal(h.transactions,0);
});

test('invalid native parameter counts stop before unbounded enumeration',async()=>{
 for(const count of [-1,65,Infinity,2.5,'6']){
   const h=harness();let parameterReads=0;
   h.clip.getComponentChain=async()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({getMatchName:async()=> 'AE.ADBE Motion',getParamCount:()=>count,getParam:()=>{parameterReads++;throw new Error('must not enumerate');}})});
   await assert.rejects(h.read(0),/invalid Motion parameter count/);
   assert.equal(parameterReads,0);
   assert.equal(h.transactions,0);
 }
});

test('all native Action factories run inside one synchronous locked transaction after identity revalidation',async()=>{
 const h=harness({uniform:false});
 let state=await h.read(0);
 h.setRevalidator(async()=>{if(!h.transactions)assert.deepEqual(h.createdActions,[],'no native Actions before the last asynchronous identity check');return clone(h.freshDescriptor);});
 state=await h.edit(state,'toggle',{track:'width'});
 assert.deepEqual(h.createdActions,['timeVarying','addKey']);
 assert.equal(h.transactions,1);
 h.setRevalidator(async()=>clone(h.freshDescriptor));
 state=await h.read(24);state=await h.edit(state,'set',{track:'width',value:[1200]});
 state=await h.edit(state,'interpolation',{track:'width',interpolation:'hold'});
 state=await h.edit(state,'key',{track:'width'});
 state=await h.edit(state,'toggle',{track:'width'});
 assert.ok(h.createdActions.includes('interpolation'));
 assert.ok(h.createdActions.includes('removeKey'));
 assert.ok(h.createdActions.includes('setValue'));
 assert.equal(h.transactions,5);
});

test('documented PointKeyframe shape supports Position animation without scalar interpolation methods',async()=>{
 const h=harness({pointKeys:true,uniform:false});
 let state=await h.edit(await h.read(0),'toggle',{track:'position'});
 assert.equal(state.tracks.position.animated,true);
 assert.equal(state.tracks.position.keys[0].interpolation,'native','unreadable native easing must remain unknown');
 state=await h.read(24);state=await h.edit(state,'set',{track:'position',value:[1200,700]});
 assert.equal(h.params.position.keys.length,2);
 assert.deepEqual(state.tracks.position.value,[1200,700]);
 assert.ok(state.tracks.position.keys.every(key=>key.interpolation==='native'));
 assert.equal(h.createdActions.filter(kind=>kind==='interpolation').length,0,'PointKeyframe insertion must never emit scalar interpolation Actions');
 const first=h.params.position.keys[0],last=h.params.position.keys[1],transactions=h.transactions;
 state=await h.edit(state,'set-key',{track:'position',keyTicks:last.ticks,value:[1300,700]});
 assert.deepEqual(state.tracks.position.value,[1300,700]);assert.equal(h.patches.length,1);
 await assert.rejects(h.edit(state,'interpolation',{track:'position',interpolation:'hold'}),/interpolation for readback/);
 assert.equal(h.params.position.keys[0],first);assert.equal(h.params.position.keys[1],last);
 assert.equal(h.transactions,transactions);
 state=await h.read(12);assert.ok(Math.abs(state.tracks.position.value[0]-1130)<1e-8);assert.equal(state.tracks.position.value[1],620);
 await assert.rejects(h.edit(state,'toggle',{track:'position'}),/custom interpolation/);
 assert.equal(state.tracks.position.animated,true);
});

test('bounded value unwrapping accepts raw and nested native PointF/scalar wrappers without changing units',async()=>{
 const h=harness({uniform:false});
 h.params.position.getValueAtTime=async()=>({value:{value:new h.ppro.PointF(.25,.75)}});
 h.params.height.getStartValue=async()=>({value:{value:{value:120}}});
 h.params.height.getValueAtTime=async()=>({value:{value:120}});
 h.params.width.getValueAtTime=async()=>75;
 const state=await h.read(0);
 assert.deepEqual(state.tracks.position.value,[480,810]);
 assert.deepEqual(state.tracks.height.value,[480]);
 assert.deepEqual(state.tracks.width.value,[900]);
 assert.equal(h.transactions,0);
});

function proveUnnamedUniform(h){
 h.params.uniform.displayName='';
 const binding={version:1,componentMatchName:'AE.ADBE Motion',parameterCount:6,widthIndex:2,uniformIndex:3,rotationIndex:4,uniform:{animated:false,value:!!h.params.uniform.value}};
 h.descriptor.motionBinding=clone(binding);h.freshDescriptor.motionBinding=clone(binding);
 h.setRevalidator(async()=>{const fresh=clone(h.freshDescriptor);fresh.motionBinding.uniform.value=!!h.params.uniform.value;return fresh;});
}

test('unnamed Uniform Scale is bound by CEP proof, checkbox type and native named neighbors, never literal index3',async()=>{
 const h=harness({uniform:false});proveUnnamedUniform(h);
 h.useParams({extra:h.param('Unrelated control',5),...h.params});
 for(const descriptor of [h.descriptor,h.freshDescriptor])Object.assign(descriptor.motionBinding,{parameterCount:7,widthIndex:3,uniformIndex:4,rotationIndex:5});
 const state=await h.read(0);
 assert.deepEqual(state.tracks.width.value,[900]);
 assert.deepEqual(state.tracks.height.value,[400]);
 const next=await h.edit(state,'set',{track:'height',value:[600]});
 assert.deepEqual(next.tracks.height.value,[600]);
 assert.deepEqual(next.tracks.width.value,[900]);
 assert.equal(h.params.uniform.value,false);
 assert.equal(h.transactions,1);
});

test('unnamed Uniform Scale refuses internally valid CEP layouts whose count or ordinals differ from UXP',async()=>{
 for(const mismatch of ['count','ordinals']){
   const h=harness({uniform:false});proveUnnamedUniform(h);
   if(mismatch==='count')h.descriptor.motionBinding.parameterCount=7;
   else Object.assign(h.descriptor.motionBinding,{widthIndex:0,uniformIndex:1,rotationIndex:2});
   let checkboxReads=0;
   h.params.uniform.getStartValue=async()=>{checkboxReads++;return {value:{value:false}};};
   await assert.rejects(h.read(0),/different Motion parameter counts or control ordinals/,mismatch);
   assert.equal(checkboxReads,0,'mismatched layouts cannot reach candidate value reads');
   assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);
 }
});

test('unnamed Uniform Scale refreshes its proof after independent-scale conversion and panel Undo',async()=>{
 const h=harness();proveUnnamedUniform(h);
 let state=await h.edit(await h.read(0),'set',{track:'width',value:[900]});
 assert.equal(h.params.uniform.value,false);
 assert.deepEqual(state.tracks.width.value,[900]);
 assert.deepEqual(state.tracks.height.value,[400]);
 // The actual API captures a new private CEP descriptor for each edit.
 h.descriptor.motionBinding.uniform.value=false;
 state=await h.edit(state,'undo');
 assert.equal(h.params.uniform.value,true);
 assert.deepEqual(state.tracks.width.value,[1200]);
 assert.equal(h.transactions,2);
});

test('numeric checkbox fallback accepts only strict0/1 non-keyframable controls matching CEP',async()=>{
 const h=harness({uniform:false});h.params.uniform.value=0;proveUnnamedUniform(h);
 h.params.uniform.areKeyframesSupported=async()=>false;
 assert.deepEqual((await h.read(0)).tracks.width.value,[900]);
 h.params.uniform.areKeyframesSupported=async()=>true;
 await assert.rejects(h.read(0),/failed checkbox verification/);
 h.params.uniform.areKeyframesSupported=async()=>false;h.params.uniform.value=2;
 await assert.rejects(h.read(0),/failed checkbox verification/);
 assert.equal(h.transactions,0);
});

test('blank controls with absent, stale or ambiguous proof cannot be used as Uniform Scale',async()=>{
 for(const failure of ['absent','wrongBoolean','wrongComponent','badCEPNeighbors','badNativeNeighbors','animated','numericSlider']){
   const h=harness({uniform:false});proveUnnamedUniform(h);
   if(failure==='absent')delete h.descriptor.motionBinding;
   if(failure==='wrongBoolean')h.descriptor.motionBinding.uniform.value=true;
   if(failure==='wrongComponent')h.descriptor.motionBinding.componentMatchName='AE.ADBE Opacity';
   if(failure==='badCEPNeighbors')h.descriptor.motionBinding.uniformIndex=5;
   if(failure==='badNativeNeighbors')h.useParams({position:h.params.position,height:h.params.height,width:h.params.width,other:h.param('',false),uniform:h.params.uniform,rotation:h.params.rotation,anchor:h.params.anchor});
   if(failure==='animated')h.params.uniform.animated=true;
   if(failure==='numericSlider')h.params.uniform.value=0;
   await assert.rejects(h.read(0),/Missing: uniform/,failure);
   assert.equal(h.transactions,0,failure);assert.deepEqual(h.createdActions,[],failure);
 }
});

test('CEP binding structure or checkbox changes during preparation cannot reach the native transaction',async()=>{
 for(const change of ['structure','checkbox']){
   const h=harness({uniform:false});proveUnnamedUniform(h);
   const state=await h.read(0),read=h.params.position.getValueAtTime;
   h.params.position.getValueAtTime=async at=>{
     h.setRevalidator(async()=>{const fresh=clone(h.freshDescriptor);if(change==='structure')fresh.motionBinding.parameterCount=7;else fresh.motionBinding.uniform.value=true;return fresh;});
     return read(at);
   };
   await assert.rejects(h.edit(state,'set',{track:'position',value:[800,500]}),/timeline link changed|Uniform Scale changed/);
   assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);
 }
});

test('exact source ticks edit the selected unknown Point key while the playhead remains at a different key',async()=>{
 const h=harness({uniform:false,pointKeys:true});
 animate(h.params.position,[[.5,.5],[.75,.75]],h.ppro.Constants.InterpolationMode.BEZIER);
 const first=h.params.position.keys[0],last=h.params.position.keys[1];
 first.customHandles={incoming:[.13,.9],outgoing:[.87,.05]};
 let state=await h.read(24);
 assert.equal(state.tracks.position.keys[0].ticks,'0');
 assert.equal(state.tracks.position.keys[0].interpolation,'native');
 state=await h.edit(state,'set-key',{track:'position',keyTicks:'0',value:[600,300]});
 assert.equal(state.frame,24);assert.deepEqual(state.tracks.position.value,[1440,810]);
 assert.deepEqual(first.value,[600/1920,300/1080]);assert.equal(h.params.position.keys[0],first);assert.equal(h.params.position.keys[1],last);
 assert.deepEqual(first.customHandles,{incoming:[.13,.9],outgoing:[.87,.05]});
 assert.equal(h.patches[0].updates[0].ticks,'0');
 state=await h.edit(state,'undo');assert.deepEqual(first.value,[.5,.5]);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');assert.deepEqual(first.value,[600/1920,300/1080]);
 assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);
});

test('independent scalar key retiming, interpolation and deletion support complete bounded Undo and Redo',async()=>{
 const h=harness({uniform:false});
 animate(h.params.width,[100,150],h.ppro.Constants.InterpolationMode.HOLD);
 let state=await h.read(24);
 state=await h.edit(state,'move-key',{track:'width',keyTicks:'0',targetFrame:12});
 assert.deepEqual(state.tracks.width.keys.map(k=>[k.ticks,k.frame,k.interpolation]),[[String(12*TPF),12,'hold'],[String(TICKS),24,'hold']]);
 state=await h.edit(state,'undo');assert.deepEqual(state.tracks.width.keys.map(k=>k.ticks),['0',String(TICKS)]);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');
 state=await h.edit(state,'interpolation',{track:'width',keyTicks:String(12*TPF),interpolation:'linear'});
 assert.equal(state.tracks.width.keys[0].interpolation,'linear');assert.equal(state.tracks.width.keys[1].interpolation,'hold');
 state=await h.edit(state,'remove-key',{track:'width',keyTicks:String(12*TPF)});
 assert.deepEqual(state.tracks.width.keys.map(k=>k.ticks),[String(TICKS)]);
 state=await h.edit(state,'undo');assert.equal(state.tracks.width.keys.length,2);assert.equal(state.tracks.width.keys[0].interpolation,'linear');
 state=await h.edit(state,'undo');assert.equal(state.tracks.width.keys[0].interpolation,'hold');
 state=await h.edit(state,'undo');assert.equal(state.tracks.width.keys[0].ticks,'0');assert.equal(state.canUndo,false);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');state=await h.edit(state,'redo');state=await h.edit(state,'redo');
 assert.deepEqual(state.tracks.width.keys.map(k=>k.ticks),[String(TICKS)]);assert.equal(state.canRedo,false);
 assert.equal(h.patches.length,0,'structural edits use the native action transaction, not in-place value setters');
});

test('missing, off-clip, occupied and stale exact key targets fail before native Actions or setters',async()=>{
 const h=harness({uniform:false});animate(h.params.height,[100,150]);
 const state=await h.read(24),keys=clone(h.params.height.keys);
 for(const [operation,extra]of [
   ['set-key',{keyTicks:String(TPF),value:[600]}],['set-key',{keyTicks:String(2*TICKS),value:[600]}],
   ['remove-key',{keyTicks:'-1'}],['remove-key',{keyTicks:'1e2'}],
   ['move-key',{keyTicks:'0',targetFrame:24}],['move-key',{keyTicks:'0',targetFrame:48}],
   ['move-key',{keyTicks:'0',targetFrame:-1}],['move-key',{keyTicks:'0',targetFrame:2.5}],
 ])await assert.rejects(h.edit(state,operation,{track:'height',...extra}),/keyframe|frame|text-area/i);
 assert.deepEqual(h.params.height.keys,keys);assert.equal(h.transactions,0);assert.equal(h.prepared,0);assert.equal(h.patches.length,0);
 h.params.height.keys[0].value=110;
 await assert.rejects(h.edit(state,'set-key',{track:'height',keyTicks:'0',value:[600]}),/Motion changed/);
 assert.equal(h.patches.length,0);assert.deepEqual(h.createdActions,[]);
});

test('value Undo and Redo survive a verified caption media relink, while old request signatures remain invalid',async()=>{
 const h=harness({uniform:false,pointKeys:true});animate(h.params.position,[[.5,.5],[.7,.7]],5);animate(h.params.height,[100,150],5);
 const point=h.params.position.keys[0],size=h.params.height.keys[0];point.customHandles={outgoing:[.9,.1]};size.customHandles={incoming:[.2,.8]};
 let state=await h.edit(await h.read(0),'set-key',{track:'position',keyTicks:'0',value:[700,400]});
 state=await h.edit(state,'set-key',{track:'height',keyTicks:'0',value:[600]});
 const stale=state;
 h.relink('/project/reflow-0002.mov');
 await assert.rejects(h.edit(stale,'undo'),/Motion changed/);
 state=await h.read(0);assert.equal(state.canUndo,true);
 state=await h.edit(state,'undo');assert.equal(size.value,100);assert.deepEqual(point.value,[700/1920,400/1080]);
 state=await h.edit(state,'undo');assert.deepEqual(point.value,[.5,.5]);assert.equal(state.canUndo,false);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');state=await h.edit(state,'redo');assert.equal(size.value,150);
 assert.equal(h.params.position.keys[0],point);assert.equal(h.params.height.keys[0],size);
 assert.deepEqual(point.customHandles,{outgoing:[.9,.1]});assert.deepEqual(size.customHandles,{incoming:[.2,.8]});
 assert.ok(h.patches.slice(2).every(p=>p.descriptor.path==='/project/reflow-0002.mov'),'inverse patches always use the current strict media identity');
 assert.equal(h.transactions,0);
 h.descriptor.bounds.width=1000;h.freshDescriptor.bounds.width=1000;
 assert.equal((await h.read(0)).canUndo,false,'a changed text-box geometry is a different history context');
});

test('external Motion changes invalidate both history stacks and a new edit discards its Redo branch',async()=>{
 const h=harness({uniform:false});let state=await h.read(0);
 state=await h.edit(state,'set',{track:'height',value:[500]});state=await h.edit(state,'set',{track:'height',value:[600]});
 state=await h.edit(state,'undo');assert.equal(state.canUndo,true);assert.equal(state.canRedo,true);
 state=await h.edit(state,'set',{track:'height',value:[550]});assert.equal(state.canRedo,false);
 h.params.rotation.value=12;state=await h.read(0);assert.equal(state.canUndo,false);assert.equal(state.canRedo,false);
 await assert.rejects(h.edit(state,'undo'),/No matching plugin Undo/);
});

test('plugin history retains at most 32 native edits per caption and replays them in order',async()=>{
 const h=harness({uniform:false});let state=await h.read(0);
 for(let value=401;value<=435;value++)state=await h.edit(state,'set',{track:'height',value:[value]});
 for(let i=0;i<32;i++){assert.equal(state.canUndo,true);state=await h.edit(state,'undo');}
 assert.deepEqual(state.tracks.height.value,[403]);assert.equal(state.canUndo,false);
 for(let i=0;i<32;i++){assert.equal(state.canRedo,true);state=await h.edit(state,'redo');}
 assert.ok(Math.abs(state.tracks.height.value[0]-435)<1e-8);assert.equal(state.canRedo,false);
});

test('existing-key edits require the bounded CEP callback and verify all untouched native Motion controls',async()=>{
 const h=harness({uniform:false});animate(h.params.height,[100,150],5);
 const state=await h.read(0);
 await assert.rejects(editArea(h.ppro,h.project,h.sequence,h.descriptor,{signature:state.signature,frame:0,operation:'set-key',track:'height',keyTicks:'0',value:[600]},h.revalidate),/in-place Premiere keyframe service/);
 assert.equal(h.transactions,0);assert.equal(h.patches.length,0);assert.equal(h.prepared,0);
 h.setPatcher(async patch=>{const receipt=await h.applyPatch(patch);h.params.rotation.value=22;return receipt;});
 await assert.rejects(h.edit(state,'set-key',{track:'height',keyTicks:'0',value:[600]}),/did not confirm every Motion change/);
 assert.equal((await h.read(0)).canUndo,false);assert.equal((await h.read(0)).canRedo,false);
 assert.equal(h.transactions,0);
});

test('source tick strings and frame destinations remain exact above JavaScript integer precision',async()=>{
 const h=harness({uniform:false}),tpf=10000000001,frame=990001,exact=(BigInt(tpf)*BigInt(frame)).toString(),end=(BigInt(tpf)*1000000n).toString();
 assert.equal(Number.isSafeInteger(Number(exact)),false);
 for(const d of [h.descriptor,h.freshDescriptor])Object.assign(d,{startTicks:'0',endTicks:end,inTicks:'0',outTicks:end,ticksPerFrame:tpf});
 h.params.height.animated=true;h.params.height.keys=[{ticks:'0',value:50,mode:4},{ticks:exact,value:100,mode:4}];
 const key=h.params.height.keys[1];
 let state=await h.read(frame);assert.equal(h.params.height.evaluated.at(-1),exact);
 state=await h.edit(state,'set-key',{track:'height',keyTicks:exact,value:[600]});
 assert.equal(h.patches[0].updates[0].ticks,exact);assert.equal(h.params.height.keys[1],key);assert.equal(key.ticks,exact);
 state=await h.edit(state,'move-key',{track:'height',keyTicks:exact,targetFrame:frame+1});
 assert.equal(state.tracks.height.keys[1].ticks,(BigInt(tpf)*BigInt(frame+1)).toString());
 state=await h.edit(state,'undo');assert.equal(state.tracks.height.keys[1].ticks,exact);
});

test('the real API routes unknown scalar key edits through CEP and keeps verified relink Undo in the same lane',async t=>{
 const h=harness({uniform:false});animate(h.params.height,[100,150],5);
 const nativeKey=h.params.height.keys[0];nativeKey.customHandles={incoming:[.1,.9],outgoing:[.8,.3]};
 const a=apiHarness(t,h);await a.api.getActiveSequenceInfo();
 const caption={id:'cue',clipNodeId:'clip',projectItemId:'item',mediaPath:h.descriptor.path,renderBounds:clone(h.descriptor.bounds)};
 let state=await a.api.readCaptionArea(caption,h.descriptor.sequenceId,24);
 state=await a.api.editCaptionArea(caption,h.descriptor.sequenceId,{signature:state.signature,frame:24,operation:'set-key',track:'height',keyTicks:'0',value:[600]});
 assert.equal(nativeKey.value,150);assert.equal(state.canUndo,true);
 h.relink('/project/caption-reflow.mov');caption.mediaPath=h.descriptor.path;
 state=await a.api.readCaptionArea(caption,h.descriptor.sequenceId,24);assert.equal(state.canUndo,true);
 state=await a.api.editCaptionArea(caption,h.descriptor.sequenceId,{signature:state.signature,frame:24,operation:'undo'});
 assert.equal(nativeKey.value,100);assert.equal(state.canRedo,true);
 const edits=a.requests.filter(r=>r.action==='patchCaptionKeyValues');assert.equal(edits.length,2);
 assert.equal(edits[0].args[0].mediaPath,'/project/caption.mov');assert.equal(edits[1].args[0].mediaPath,'/project/caption-reflow.mov');
 assert.equal(h.params.height.keys[0],nativeKey);assert.deepEqual(nativeKey.customHandles,{incoming:[.1,.9],outgoing:[.8,.3]});
 assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);
});

test('native Float32 key storage confirms 480px in a 576px text box and preserves structural Undo and Redo',async()=>{
 const h=harness({uniform:false,float32Native:true});
 for(const d of [h.descriptor,h.freshDescriptor])d.bounds.width=576;
 h.params.width.value=100;
 let state=await h.edit(await h.read(0),'toggle',{track:'width'});
 state=await h.read(24);
 state=await h.edit(state,'set',{track:'width',value:[480]});
 const rounded=Math.fround(480/576*100);
 assert.equal(rounded,83.33333587646484,'matches the real Premiere acceptance readback');
 assert.equal(h.params.width.keys[1].ticks,String(TICKS));assert.equal(h.params.width.keys[1].value,rounded);
 assert.notEqual(state.tracks.width.value[0],480);assert.ok(Math.abs(state.tracks.width.value[0]-480)<0.0001);
 assert.equal(state.canUndo,true);
 state=await h.edit(state,'undo');assert.equal(state.tracks.width.keys.length,1);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');assert.equal(state.tracks.width.keys.length,2);assert.equal(h.params.width.keys[1].value,rounded);assert.equal(state.canUndo,true);
 h.relink('/project/float32-reflow.mov');state=await h.read(24);assert.equal(state.canUndo,true);
});

test('in-place CEP Float32 scalar and Point values keep exact native keys and reversible history',async()=>{
 const h=harness({uniform:false,pointKeys:true,float32Native:true});
 for(const d of [h.descriptor,h.freshDescriptor])d.bounds.width=576;
 animate(h.params.width,[100,120],5);animate(h.params.position,[[.5,.5],[.75,.75]],5);
 const width=h.params.width.keys[1],position=h.params.position.keys[0];width.customHandles={outgoing:[.9,.1]};position.customHandles={incoming:[.1,.9]};
 let state=await h.edit(await h.read(24),'set-key',{track:'width',keyTicks:String(TICKS),value:[480]});
 const roundedWidth=Math.fround(480/576*100);
 assert.equal(width.value,roundedWidth);assert.equal(state.canUndo,true);
 state=await h.edit(state,'set-key',{track:'position',keyTicks:'0',value:[700.25,401.33]});
 const roundedPosition=[Math.fround(700.25/1920),Math.fround(401.33/1080)];
 assert.deepEqual(position.value,roundedPosition);assert.equal(state.canUndo,true);
 state=await h.edit(state,'undo');assert.deepEqual(position.value,[.5,.5]);
 state=await h.edit(state,'undo');assert.equal(width.value,120);assert.equal(state.canRedo,true);
 state=await h.edit(state,'redo');state=await h.edit(state,'redo');
 assert.equal(width.value,roundedWidth);assert.deepEqual(position.value,roundedPosition);
 assert.equal(h.params.width.keys[1],width);assert.equal(h.params.position.keys[0],position);
 assert.deepEqual(width.customHandles,{outgoing:[.9,.1]});assert.deepEqual(position.customHandles,{incoming:[.1,.9]});
 assert.equal(h.transactions,0);assert.deepEqual(h.createdActions,[]);assert.equal(h.patches.length,6);
});

test('Float32 rounding allowance still rejects wrong native add-key and CEP post-read values',async()=>{
 for(const path of ['native-add','cep-patch']){
   const h=harness({uniform:false,float32Native:true});for(const d of [h.descriptor,h.freshDescriptor])d.bounds.width=576;
   animate(h.params.width,path==='native-add'?[100]:[100,120]);
   const state=await h.read(24);
   if(path==='native-add')h.project.afterCommit=()=>{h.params.width.keys[1].value+=0.001;};
   else h.setPatcher(async patch=>{const receipt=await h.applyPatch(patch);h.params.width.keys[1].value+=0.001;return receipt;});
   await assert.rejects(h.edit(state,path==='native-add'?'set':'set-key',{track:'width',keyTicks:String(TICKS),value:[480]}),/did not confirm every Motion change/,path);
   assert.equal((await h.read(24)).canUndo,false,path);assert.equal((await h.read(24)).canRedo,false,path);
 }
});
