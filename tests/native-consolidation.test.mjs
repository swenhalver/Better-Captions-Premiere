import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {removeLegacyClips}=createRequire(import.meta.url)('../uxp/consolidation.js');
function harness(options={}){
 const plan={version:1,projectPath:'/project/edit.prproj',sequenceId:'seq',clips:[0,1].map(i=>({clipNodeId:'old-'+i,track:0,path:'/project/'+i+'.mov',startTicks:String(i*100),endTicks:String((i+1)*100),inTicks:'0',outTicks:'100'}))};
 const clips=plan.clips.map(d=>({getStartTime:async()=>({ticks:d.startTicks}),getEndTime:async()=>({ticks:d.endTicks}),getInPoint:async()=>({ticks:d.inTicks}),getOutPoint:async()=>({ticks:d.outTicks}),getProjectItem:async()=>({getMediaFilePath:async()=>d.path})}));
 const unrelated={name:'footage'},items=[...clips],events=[];let depth=0;
 const sequence={guid:'seq',getVideoTrack:async()=>({getTrackItems:async()=>items})};
 const project={path:plan.projectPath,getActiveSequence:async()=>sequence,lockedAccess:callback=>{depth++;try{return callback();}finally{depth--; }},executeTransaction:callback=>{assert.equal(depth,1);const actions=[];callback({addAction:action=>{actions.push(action);return true;}});events.push('transaction');if(options.reject)return false;actions.forEach(action=>action());return true;}};
 const ppro={Project:{getActiveProject:async()=>project},ClipProjectItem:{cast:x=>x},Constants:{TrackItemType:{CLIP:1},MediaType:{VIDEO:1}},SequenceEditor:{getEditor:async()=>({createRemoveItemsAction(selection,ripple,type,shift){assert.equal(depth,1);assert.equal(ripple,false);assert.equal(shift,false);assert.equal(type,1);return()=>{for(const clip of selection.items)items.splice(items.indexOf(clip),1);};}})},TrackItemSelection:{createEmptySelection(callback){assert.equal(depth,1);const selection={items:[],addItem(clip){this.items.push(clip);return true;}};callback(selection);return true;}}};
 const verify=async()=>{events.push('verify');return {ok:true,complete:items.length===0,clips:options.stale?[]:structuredClone(plan.clips)};};
 return {plan,ppro,project,sequence,verify,items,events,unrelated};
}
test('legacy removals share one locked non-ripple transaction after fresh exact proof',async()=>{
 const h=harness();await removeLegacyClips(h.ppro,h.project,h.sequence,h.plan,h.verify);
 assert.deepEqual(h.events,['verify','transaction','verify']);assert.equal(h.items.length,0);assert.equal(h.unrelated.name,'footage');
});

test('legacy Windows media identity tolerates native path casing without relaxing Mac identity',async()=>{
 const h=harness();for(let i=0;i<h.plan.clips.length;i++){h.plan.clips[i].path='D:/Project/'+i+'.mov';h.items[i].getProjectItem=async()=>({getMediaFilePath:async()=>'d:\\project\\'+i+'.mov'});}
 await removeLegacyClips(h.ppro,h.project,h.sequence,h.plan,h.verify);assert.equal(h.items.length,0);
 const mac=harness();mac.items[0].getProjectItem=async()=>({getMediaFilePath:async()=>'/PROJECT/0.mov'});
 await assert.rejects(removeLegacyClips(mac.ppro,mac.project,mac.sequence,mac.plan,mac.verify),/changed/);assert.equal(mac.items.length,2);
});
test('legacy conversion normalizes host drive prefixes while preserving exact project guards',async()=>{
 const h=harness();h.plan.projectPath='D:\\Project\\Edit.prproj';h.project.path='\\\\?\\'+h.plan.projectPath;
 await removeLegacyClips(h.ppro,h.project,h.sequence,h.plan,h.verify);assert.equal(h.items.length,0);
 for(const changed of ['D:\\Other\\Edit.prproj','D:\\Project\\edit.prproj']){
  const f=harness();f.plan.projectPath='D:\\Project\\Edit.prproj';f.project.path='\\\\?\\'+changed;
  await assert.rejects(removeLegacyClips(f.ppro,f.project,f.sequence,f.plan,f.verify),/project or sequence changed/);
  assert.equal(f.items.length,2);assert.deepEqual(f.events,[]);
 }
});

test('changed receipts and native timings cannot remove any legacy clips',async()=>{
 for(const option of ['stale','timing','project']){
  const h=harness({[option]:true});if(option==='timing')h.items[0].getOutPoint=async()=>({ticks:'90'});if(option==='project')h.project.path='/other/project.prproj';
  await assert.rejects(removeLegacyClips(h.ppro,h.project,h.sequence,h.plan,h.verify));assert.equal(h.items.length,2);assert.ok(!h.events.includes('transaction'));
 }
});
test('a rejected atomic conversion leaves originals available for safe replacement cleanup',async()=>{
 const h=harness({reject:true});await assert.rejects(removeLegacyClips(h.ppro,h.project,h.sequence,h.plan,h.verify),/did not commit/);assert.equal(h.items.length,2);
});
