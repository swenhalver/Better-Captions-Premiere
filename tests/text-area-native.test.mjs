import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{readArea,editArea}=require('../uxp/text-area.js');
const TICKS=254016000000,TPF=TICKS/24;
const time=ticks=>({ticks:String(Math.round(Number(ticks))),seconds:Number(ticks)/TICKS});
const clone=structuredClone;
function harness({sourceIn=0,uniform=true}={}){
 const m={LINEAR:0,HOLD:4,BEZIER:5},ppro={Constants:{InterpolationMode:m,TrackItemType:{CLIP:1}},TickTime:{createWithTicks:time},PointF:class{constructor(x,y){this.x=x;this.y=y;}},ClipProjectItem:{cast:x=>x}};
 let prepared=0;
 function param(displayName,value){
   const p={displayName,value,animated:false,keys:[],evaluated:[],isTimeVarying(){return this.animated;},areKeyframesSupported:async()=>true,
     getStartValue:async()=>({value:{value:clone(p.value)}}),getKeyframeListAsTickTimes:()=>p.keys.map(k=>time(k.ticks)),
     getKeyframePtr:t=>({value:{value:clone(p.keys.find(k=>k.ticks===t.ticks).value)},getTemporalInterpolationMode:async()=>p.keys.find(k=>k.ticks===t.ticks).mode}),
     getValueAtTime:async t=>{p.evaluated.push(t.ticks);let value=p.value;if(p.animated&&p.keys.length){const a=[...p.keys].reverse().find(k=>Number(k.ticks)<=Number(t.ticks))??p.keys[0],b=p.keys.find(k=>Number(k.ticks)>Number(t.ticks))??a;let f=a===b||a.mode===m.HOLD?0:Math.max(0,(Number(t.ticks)-Number(a.ticks))/(Number(b.ticks)-Number(a.ticks)));if(a.mode===m.BEZIER)f=f*f*(3-2*f);value=Array.isArray(a.value)?a.value.map((v,i)=>v+(b.value[i]-v)*f):a.value+(b.value-a.value)*f;}return {value:clone(value)};},
     createKeyframe:v=>{prepared++;return {value:v instanceof ppro.PointF?[v.x,v.y]:clone(v),position:time(0),mode:m.LINEAR,async setTemporalInterpolationMode(mode){this.mode=mode;return true;}};},
     createSetTimeVaryingAction:v=>()=>{p.animated=v;if(!v)p.keys=[];},
     createSetValueAction:k=>()=>{p.value=clone(k.value);},
     createRemoveKeyframeAction:t=>()=>{p.keys=p.keys.filter(k=>k.ticks!==t.ticks);},
     createAddKeyframeAction:k=>()=>{p.keys=p.keys.filter(old=>old.ticks!==k.position.ticks);p.keys.push({ticks:k.position.ticks,value:clone(k.value),mode:k.mode});p.keys.sort((a,b)=>Number(a.ticks)-Number(b.ticks));},
     createSetInterpolationAtKeyframeAction:(t,mode)=>()=>{p.keys.find(k=>k.ticks===t.ticks).mode=mode;}
   };return p;
 }
 const params={position:param('Position',[.5,.5]),height:param('Scale',100),width:param('Scale Width',75),uniform:param('Uniform Scale',uniform),rotation:param('Rotation',0),anchor:param('Anchor Point',[.5,.5])};
 let activeParams=params;
 const descriptor={ok:true,sequenceId:'seq-'+Math.random(),projectPath:'/project/test.prproj',clipNodeId:'clip',projectItemId:'item',path:'/project/caption.mov',track:0,startTicks:String(TICKS*10),endTicks:String(TICKS*12),inTicks:String(TICKS*sourceIn),ticksPerFrame:TPF,frameWidth:1920,frameHeight:1080,bounds:{width:1200,height:400}};
 const freshDescriptor=clone(descriptor);
 const clip={getStartTime:async()=>time(descriptor.startTicks),getEndTime:async()=>time(descriptor.endTicks),getInPoint:async()=>time(descriptor.inTicks),getProjectItem:async()=>({getMediaFilePath:async()=>'/project/caption.mov'}),getComponentChain:async()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({getMatchName:async()=> 'AE.ADBE Motion',getParamCount:()=>Object.keys(activeParams).length,getParam:i=>Object.values(activeParams)[i]})})};
 const sequence={getVideoTrack:async()=>({getTrackItems:async()=>[clip]})};
 let transactions=0,reject=false,revalidations=0,revalidator=async()=>clone(freshDescriptor);
 const revalidate=async()=>{revalidations++;return revalidator();};
 const project={afterCommit:null,lockedAccess:cb=>cb(),executeTransaction:cb=>{const actions=[];cb({addAction:a=>{actions.push(a);return true;}});transactions++;if(reject)return false;for(const action of actions)action();project.afterCommit?.();return true;}};
 return {ppro,project,sequence,descriptor,freshDescriptor,params,clip,param,revalidate,
   get transactions(){return transactions;},get prepared(){return prepared;},get revalidations(){return revalidations;},
   reject:()=>{reject=true;},useParams:next=>{activeParams=next;},setRevalidator:fn=>{revalidator=fn;},
   read:frame=>readArea(ppro,sequence,descriptor,frame,revalidate),
   edit:async(state,operation,extra={})=>editArea(ppro,project,sequence,descriptor,{signature:state.signature,frame:state.frame,operation,...extra},revalidate)};
}
test('native Position uses source time, shares X/Y keys and reads back interpolation',async()=>{
 const h=harness();let s=await h.read(0);assert.deepEqual(s.tracks.position.value,[960,540]);
 s=await h.edit(s,'toggle',{track:'position'});assert.equal(h.params.position.keys[0].ticks,'0');
 s=await h.read(24);s=await h.edit(s,'set',{track:'position',value:[1200,700]});s=await h.edit(s,'set',{track:'position',value:[1300,700]});assert.equal(h.params.position.keys.length,2);
 s=await h.read(12);assert.ok(Math.abs(s.tracks.position.value[0]-1130)<1e-6);assert.equal(s.tracks.position.value[1],620);
 s=await h.read(0);s=await h.edit(s,'interpolation',{track:'position',interpolation:'hold'});s=await h.read(12);assert.deepEqual(s.tracks.position.value,[960,540]);
 assert.equal(h.transactions,4);
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
 s=await h.read(24);s=await h.edit(s,'interpolation',{track:'position',interpolation:'bezier'});assert.equal(h.params.position.keys[0],first);assert.equal(first.customHandles,'native handles');
 const before=clone(h.params.position.keys);h.reject();await assert.rejects(h.edit(s,'set',{track:'width',value:[900]}),/did not commit/);assert.deepEqual(h.params.position.keys,before);assert.equal(h.params.uniform.value,true);assert.equal(h.params.width.value,75);
});
test('silent native refusal is reported instead of confirming an edit',async()=>{
 const h=harness(),s=await h.read(0);h.params.position.createSetValueAction=()=>()=>{};
 await assert.rejects(h.edit(s,'set',{track:'position',value:[400,500]}),/did not confirm every Motion change/);
 assert.equal((await h.read(0)).canUndo,false);
});
test('clip identity is checked again after asynchronous action preparation',async()=>{
 const h=harness(),s=await h.read(0),original=h.params.position.createKeyframe;
 h.params.position.createKeyframe=value=>{h.clip.getStartTime=async()=>time(15*TICKS);return original(value);};
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
 await assert.rejects(h.edit(state,'undo'),/Uniform Scale/);
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

test('changing an existing Bezier key value refuses to discard its unknown easing handles',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 const first=h.params.position.keys[0];first.customHandles={outgoing:[.9,.1]};
 await assert.rejects(h.edit(await h.read(0),'set',{track:'position',value:[700,500]}),/custom interpolation/);
 assert.equal(h.params.position.keys[0],first);
 assert.deepEqual(first.customHandles,{outgoing:[.9,.1]});
 assert.equal(h.transactions,0);
});

test('panel Undo cannot claim to restore the hidden handles of a deleted Bezier key',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 const state=await h.edit(await h.read(0),'key',{track:'position'}),remaining=h.params.position.keys[0];
 await assert.rejects(h.edit(state,'undo'),/custom interpolation/);
 assert.equal(h.params.position.keys.length,1);
 assert.equal(h.params.position.keys[0],remaining);
 assert.equal(h.transactions,1);
});

test('explicit native Bezier interpolation remains available, but panel Undo cannot invent the prior custom curve',async()=>{
 const h=harness({uniform:false});
 animate(h.params.position,[[.5,.5],[.7,.7]],h.ppro.Constants.InterpolationMode.BEZIER);
 let state=await h.edit(await h.read(0),'interpolation',{track:'position',interpolation:'linear'});
 await assert.rejects(h.edit(state,'undo'),/custom interpolation/);
 state=await h.edit(state,'interpolation',{track:'position',interpolation:'bezier'});
 assert.equal(state.tracks.position.keys[0].interpolation,'bezier');
 assert.equal(h.transactions,2);
});

test('fresh private CEP identities are checked after asynchronous action preparation, including same-media replacements',async()=>{
 const changed={clipNodeId:'replacement-clip',projectItemId:'replacement-item',projectPath:'/other/project.prproj',sequenceId:'other-sequence',track:1,path:'/other/caption.mov',frameWidth:1280,ticksPerFrame:TPF*2};
 for(const [field,value]of Object.entries(changed)){
   const h=harness(),state=await h.read(0),original=h.params.position.createKeyframe;
   h.params.position.createKeyframe=valueToWrite=>{h.freshDescriptor[field]=value;return original(valueToWrite);};
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
     entries.set(path,{data:{version:1,id:data.id,sequenceId:data.sequenceId,projectPath:data.projectPath,result:clone(h.freshDescriptor)},delete:async()=>entries.delete(path)});
   }};
 entries.set('/private/service/service.json',{data:{version:1,instanceId:'a'.repeat(24),updatedAt:Date.now(),actions:['readCaptionAreaDescriptor']}});
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
 assert.equal(a.requests.length,5,'an edit rechecks the link before and after the native transaction');
 assert.ok(a.requests.every(request=>request.action==='readCaptionAreaDescriptor'));
 assert.ok(a.requests.every(request=>request.args[0].projectItemId==='item'&&request.args[0].renderBounds.width===1200));
 assert.ok(a.requests.every(request=>!Object.hasOwn(request.args[0],'words')),'transcript text is not copied into identity probes');
 assert.equal(h.transactions,1);
});
