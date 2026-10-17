import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{readArea,editArea}=require('../uxp/text-area.js');
const TICKS=254016000000,TPF=TICKS/24;
const time=ticks=>({ticks:String(Math.round(Number(ticks))),seconds:Number(ticks)/TICKS});
const clone=structuredClone;
function harness(){
 const m={LINEAR:0,HOLD:4,BEZIER:5},ppro={Constants:{InterpolationMode:m,TrackItemType:{CLIP:1}},TickTime:{createWithTicks:time},PointF:class{constructor(x,y){this.x=x;this.y=y;}},ClipProjectItem:{cast:x=>x}};
 function param(displayName,value){
   const p={displayName,value,animated:false,keys:[],isTimeVarying(){return this.animated;},areKeyframesSupported:async()=>true,
     getStartValue:async()=>({value:{value:clone(p.value)}}),getKeyframeListAsTickTimes:()=>p.keys.map(k=>time(k.ticks)),
     getKeyframePtr:t=>({value:{value:clone(p.keys.find(k=>k.ticks===t.ticks).value)},getTemporalInterpolationMode:async()=>p.keys.find(k=>k.ticks===t.ticks).mode}),
     getValueAtTime:async t=>{let value=p.value;if(p.animated&&p.keys.length){const a=[...p.keys].reverse().find(k=>Number(k.ticks)<=Number(t.ticks))??p.keys[0],b=p.keys.find(k=>Number(k.ticks)>Number(t.ticks))??a;let f=a===b||a.mode===m.HOLD?0:Math.max(0,(Number(t.ticks)-Number(a.ticks))/(Number(b.ticks)-Number(a.ticks)));if(a.mode===m.BEZIER)f=f*f*(3-2*f);value=Array.isArray(a.value)?a.value.map((v,i)=>v+(b.value[i]-v)*f):a.value+(b.value-a.value)*f;}return {value:clone(value)};},
     createKeyframe:v=>({value:v instanceof ppro.PointF?[v.x,v.y]:clone(v),position:time(0),mode:m.LINEAR,async setTemporalInterpolationMode(mode){this.mode=mode;return true;}}),
     createSetTimeVaryingAction:v=>()=>{p.animated=v;if(!v)p.keys=[];},
     createSetValueAction:k=>()=>{p.value=clone(k.value);},
     createRemoveKeyframeAction:t=>()=>{p.keys=p.keys.filter(k=>k.ticks!==t.ticks);},
     createAddKeyframeAction:k=>()=>{p.keys=p.keys.filter(old=>old.ticks!==k.position.ticks);p.keys.push({ticks:k.position.ticks,value:clone(k.value),mode:k.mode});p.keys.sort((a,b)=>Number(a.ticks)-Number(b.ticks));},
     createSetInterpolationAtKeyframeAction:(t,mode)=>()=>{p.keys.find(k=>k.ticks===t.ticks).mode=mode;}
   };return p;
 }
 const params={position:param('Position',[.5,.5]),height:param('Scale',100),width:param('Scale Width',75),uniform:param('Uniform Scale',true)};
 const descriptor={sequenceId:'seq-'+Math.random(),projectPath:'/project/test.prproj',clipNodeId:'clip',projectItemId:'item',path:'/project/caption.mov',track:0,startTicks:String(TICKS*10),endTicks:String(TICKS*12),inTicks:String(TICKS*2),ticksPerFrame:TPF,frameWidth:1920,frameHeight:1080,bounds:{width:1200,height:400}};
 const clip={getStartTime:async()=>time(descriptor.startTicks),getEndTime:async()=>time(descriptor.endTicks),getInPoint:async()=>time(descriptor.inTicks),getProjectItem:async()=>({getMediaFilePath:async()=>'/project/caption.mov'}),getComponentChain:async()=>({getComponentCount:()=>1,getComponentAtIndex:()=>({getMatchName:async()=> 'AE.ADBE Motion',getParamCount:()=>4,getParam:i=>Object.values(params)[i]})})};
 const sequence={getVideoTrack:async()=>({getTrackItems:async()=>[clip]})};
 let transactions=0,reject=false;
 const project={lockedAccess:cb=>cb(),executeTransaction:cb=>{const actions=[];cb({addAction:a=>{actions.push(a);return true;}});transactions++;if(reject)return false;for(const action of actions)action();return true;}};
 return {ppro,project,sequence,descriptor,params,clip,get transactions(){return transactions;},reject:()=>{reject=true;},read:frame=>readArea(ppro,sequence,descriptor,frame),edit:async(state,operation,extra={})=>editArea(ppro,project,sequence,descriptor,{signature:state.signature,frame:state.frame,operation,...extra})};
}
test('native Position uses source time, shares X/Y keys and reads back interpolation',async()=>{
 const h=harness();let s=await h.read(0);assert.deepEqual(s.tracks.position.value,[960,540]);
 s=await h.edit(s,'toggle',{track:'position'});assert.equal(h.params.position.keys[0].ticks,String(2*TICKS));
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
 const before=clone(h.params.position.keys);h.reject();await assert.rejects(h.edit(s,'set',{track:'position',value:[1700,500]}),/did not commit/);assert.deepEqual(h.params.position.keys,before);
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
