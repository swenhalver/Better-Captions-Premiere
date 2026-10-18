import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {buildCepNativeReadScript} from '../webview-ui/src/lib/native-effect/cep-operations.ts';

const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript'),acorn=require('../webview-ui/node_modules/acorn');
const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const hostSource=source('cep/host/bridge.jsx'),TICKS=254016000000,MATCH='com.swen.bettercaptions.native.experimental';
const collection=(values,key='numItems')=>Object.defineProperty(values,key,{get:()=>values.length});
const time=seconds=>({ticks:String(Math.round(seconds*TICKS)),seconds});
function fixture(options={}){
 const files=new Map(),writes=[],sideEffects=[],counts={documents:0},projectPath=options.projectPath??'/project/edit.prproj';
 const clip=(id,path,start=0,end=2)=>({nodeId:id,projectItem:{nodeId:'item-'+id,getMediaPath:()=>path},start:time(start),end:time(end),inPoint:time(0),outPoint:time(end-start),selected:false,
  isSelected(){return this.selected;},setSelected(){sideEffects.push('select');throw new Error('Discovery must never select.');},remove(){sideEffects.push('remove');throw new Error('Discovery must never remove.');},components:collection([])});
 const clips=collection([]),track={clips,isLocked:()=>false,overwriteClip(){sideEffects.push('overwrite');throw new Error('Discovery must never insert.');}};
 const sequence={sequenceID:options.sequenceId??'seq-a',videoTracks:collection([track],'numTracks'),audioTracks:collection([],'numTracks'),getPlayerPosition:()=>time(1.25),setPlayerPosition(){sideEffects.push('seek');throw new Error('Discovery must never seek.');}};
 const project={path:projectPath,activeSequence:sequence,importFiles(){sideEffects.push('import');throw new Error('Discovery must never import.');}};
 const context={app:{project},File:function(file){this.length=(files.get(file)??'').length;this.open=mode=>{assert.equal(mode,'r');return files.has(file);};this.read=()=>files.get(file);this.close=()=>{};},JSON:undefined};
 vm.createContext(context);vm.runInContext(hostSource,context);
 function native(id='native',match=MATCH){
  const value=clip(id,'');let documentText='BCDOC1:424341500200000000000000';
  const param={displayName:'Caption document (experimental)',isTimeVarying:()=>false,getValue(){counts.documents++;if(param.readFailure)throw new Error('Native getter failed.');return documentText;},setValue(value,refresh){writes.push({value,refresh});if(param.ignore)return 0;documentText=value;param.onSet?.();if(param.throwAfterWrite)throw new Error('Uncertain native setter');return 0;}};
  value.isAdjustmentLayer=()=>true;value.components=collection([{matchName:'AE.ADBE Motion',properties:collection([])},{matchName:match,properties:collection([{displayName:'Position'},param])}]);clips.push(value);
  return {clip:value,param,get document(){return documentText;},set document(value){documentText=value;}};
 }
 function job(data){files.set('/read.json',JSON.stringify(data));return '/read.json';}
 function read(patch={}){return JSON.parse(context.BetterCaptionsHost.readCaptionConnections(job({sequenceId:sequence.sequenceID,projectPath,generatedRoot:'/project/Better Captions/seq-a',knownLinks:[],includeDocuments:true,...patch})));}
 function write(snapshot,documentText='BCDOC1:424341500200000001000000',patch={}){return JSON.parse(context.BetterCaptionsHost.writeNativeCaptionDocument(job({sequenceId:sequence.sequenceID,projectPath,snapshot,documentText,...patch})));}
 return {context,sequence,project,track,clips,clip,native,read,write,writes,sideEffects,counts,job,files};
}
const snapshot=entry=>({locator:entry.locator,revision:entry.revision});

test('native discovery has exact identities and byte-identical existing adapter revisions without any timeline mutation',()=>{
 const f=fixture(),n=f.native('native','AE.'+MATCH),footage=f.clip('footage','/media/source.mov');footage.selected=true;f.clips.unshift(footage);n.clip.selected=true;
 Object.defineProperty(n.clip,'name',{get(){assert.fail('Clip names must never identify captions.');}});
 const result=f.read();assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.equal(result.sequenceId,'seq-a');assert.equal(result.projectPath,'/project/edit.prproj');assert.equal(result.playhead,1.25);
 assert.deepEqual(result.selectedClipNodeIds,['footage','native']);assert.equal(result.native.length,1);assert.equal(result.legacy.length,0);
 const entry=result.native[0];assert.deepEqual(entry.locator,{projectPath:'/project/edit.prproj',sequenceId:'seq-a',clipNodeId:'native',trackIndex:0,clipIndex:1,componentIndex:1,documentParamIndex:1});
 f.context.JSON=JSON;const existing=JSON.parse(vm.runInContext(buildCepNativeReadScript(entry.locator),f.context));
 assert.equal(existing.ok,true);assert.equal(entry.documentText,existing.documentText);assert.equal(entry.revision,existing.revision);
 assert.deepEqual(f.sideEffects,[]);assert.deepEqual(f.writes,[]);
});
test('summary discovery never fetches document data and its revision changes for timing and selection',()=>{
 const f=fixture(),n=f.native();n.param.readFailure=true;
 const first=f.read({includeDocuments:false});assert.equal(first.native.length,1);assert.equal(first.native[0].documentText,undefined);assert.equal(first.native[0].revision,undefined);assert.equal(f.counts.documents,0);
 n.clip.selected=true;const selected=f.read({includeDocuments:false});assert.notEqual(selected.native[0].connectionRevision,first.native[0].connectionRevision);
 n.clip.start=time(.25);const moved=f.read({includeDocuments:false});assert.notEqual(moved.native[0].connectionRevision,selected.native[0].connectionRevision);assert.equal(f.counts.documents,0);
 assert.deepEqual(f.sideEffects,[]);assert.deepEqual(f.writes,[]);
});
test('native discovery rejects fake prefixes, wrong layers, duplicate effect/parameter instances and invalid carriers',()=>{
 for(const kind of ['prefix','case','footage','duplicate-effect','duplicate-param','animated','invalid-carrier','oversized']){
  const f=fixture(),n=f.native();
  if(kind==='prefix')n.clip.components[1].matchName='arbitrary.'+MATCH;
  if(kind==='case')n.clip.components[1].matchName=MATCH.toUpperCase();
  if(kind==='footage')n.clip.isAdjustmentLayer=()=>false;
  if(kind==='duplicate-effect')n.clip.components.push(n.clip.components[1]);
  if(kind==='duplicate-param')n.clip.components[1].properties.push(n.param);
  if(kind==='animated')n.param.isTimeVarying=()=>true;
  if(kind==='invalid-carrier')n.document='BCDOC1:ab;app.project.closeDocument()';
  if(kind==='oversized')n.document='BCDOC1:'+'ab'.repeat(4194301);
  const result=f.read();assert.equal(result.ok,true,kind);assert.equal(result.native.length,0,kind);
  if(kind!=='prefix'&&kind!=='case')assert.equal(result.warnings.length,1,kind);
  assert.equal(f.writes.length,0);assert.equal(f.sideEffects.length,0);
 }
});
test('legacy discovery recognizes exact generated paths and exact saved media after Save As while returning every duplicate',()=>{
 const f=fixture();f.clips.push(f.clip('owned','/project/Better Captions/seq-a/caption-owned-abcd/ caption.mov'.replace('/ caption.mov','/caption.mov')));
 const moved=f.clip('moved','/older/project/assets/movie-renamed.mov',2,4);moved.projectItem.nodeId='saved-item';f.clips.push(moved);
 const copy=f.clip('copy','/older/project/assets/movie-renamed.mov',4,6);copy.projectItem.nodeId='saved-item';f.clips.push(copy);
 f.clips.push(f.clip('name-only','/media/caption.mov'),f.clip('sibling','/project/Better Captions/seq-a-other/caption-test/ caption.mov'.replace('/ caption.mov','/caption.mov')));
 const result=f.read({knownLinks:[{id:'saved',clipNodeId:'stale-node',projectItemId:'saved-item',mediaPath:moved.projectItem.getMediaPath()}]});
 assert.deepEqual(result.legacy.map(value=>value.clipNodeId),['owned','moved','copy']);assert.equal(result.legacy[1].startTime,2);assert.equal(result.legacy[1].endTime,4);
 assert.equal(result.legacy[1].path,moved.projectItem.getMediaPath());assert.deepEqual(f.writes,[]);assert.deepEqual(f.sideEffects,[]);
});
test('legacy partial identities, unsafe local paths and ambiguous saved ownership fail closed',()=>{
 for(const kind of ['item-only','path-only','traversal','network','duplicate-id','conflicting-owner']){
  const f=fixture(),clip=f.clip('caption','/old/caption.mov');f.clips.push(clip);
  let links=[{id:'saved',projectItemId:clip.projectItem.nodeId,mediaPath:clip.projectItem.getMediaPath()}];
  if(kind==='item-only')links[0].mediaPath='/different.mov';
  if(kind==='path-only')links[0].projectItemId='different-item';
  if(kind==='traversal')links[0].mediaPath='/old/../caption.mov';
  if(kind==='network')links[0].mediaPath='//server/caption.mov';
  if(kind==='duplicate-id')links.push({...links[0]});
  if(kind==='conflicting-owner')links.push({...links[0],id:'another',projectItemId:'another-item'});
  assert.ok(f.read({knownLinks:links}).error,kind);assert.equal(f.writes.length,0);assert.equal(f.sideEffects.length,0);
 }
});
test('Windows saved-media matching preserves exact returned path while normalizing drive casing and slashes',()=>{
 const f=fixture({projectPath:'C:\\Project\\edit.prproj'}),path='D:\\Old Project\\Caption.mov',clip=f.clip('saved',path);f.clips.push(clip);
 const result=f.read({generatedRoot:'C:\\Project\\Better Captions\\seq-a',knownLinks:[{id:'saved',projectItemId:clip.projectItem.nodeId,mediaPath:'d:/old project/caption.mov'}]});
 assert.equal(result.ok,true);assert.equal(result.legacy[0].path,path);
});
test('discovery echoes a GUID-equivalent requested identity while native locators retain exact CEP identity',()=>{
 const actual='{A1234567-B123-C123-D123-E123456789AB}',requested='a1234567-b123-c123-d123-e123456789ab',f=fixture({sequenceId:actual});f.native();
 const result=f.read({sequenceId:requested});assert.equal(result.ok,true);assert.equal(result.sequenceId,requested);assert.equal(result.nativeSequenceId,actual);assert.equal(result.native[0].locator.sequenceId,actual);
 assert.equal(JSON.parse(f.context.BetterCaptionsHost.context(requested)).id,requested);
 assert.ok(f.read({sequenceId:'other'}).error);assert.ok(f.read({projectPath:'/other.prproj'}).error);
 const ordinary=fixture();assert.ok(ordinary.read({sequenceId:'SEQ-A'}).error,'non-GUID identifiers stay exact');
});
test('discovery bounds malformed and oversized collections and never reports an unreadable timeline as empty',()=>{
 for(const kind of ['tracks','clips','components','missing-node','bad-timing','bad-selection']){
  const f=fixture(),n=f.native();
  if(kind==='tracks')f.sequence.videoTracks={numTracks:257};
  if(kind==='clips')f.track.clips={numItems:2001};
  if(kind==='components')n.clip.components={numItems:129};
  if(kind==='missing-node')n.clip.nodeId=null;
  if(kind==='bad-timing'){n.clip.end=time(0);}
  if(kind==='bad-selection')f.sequence.getPlayerPosition=()=>({ticks:'NaN'});
  const result=f.read();if(kind==='bad-timing')assert.equal(result.warnings.length,1);else assert.ok(result.error,kind);
  assert.equal(f.writes.length,0);assert.equal(f.sideEffects.length,0);
 }
});
test('one guarded document setter accepts numeric-zero acknowledgement and preserves every non-document value',()=>{
 const f=fixture(),n=f.native();const connection=f.read().native[0],before=JSON.stringify({start:n.clip.start,end:n.clip.end,other:n.clip.components[1].properties[0]});
 const result=f.write(snapshot(connection));assert.equal(result.ok,true);assert.equal(result.readbackVerified,true);assert.equal(result.acknowledgement,0);assert.equal(result.retry,'never');assert.notEqual(result.revision,connection.revision);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].refresh,1);assert.equal(JSON.stringify({start:n.clip.start,end:n.clip.end,other:n.clip.components[1].properties[0]}),before);assert.deepEqual(f.sideEffects,[]);
});
test('stale document, context, indices, timing, component or parameter identity rejects before any setter',()=>{
 for(const kind of ['document','project','sequence','clip','component','parameter','timing','locked','duplicate','non-layer','bad-carrier']){
  const f=fixture(),n=f.native(),snap=snapshot(f.read().native[0]);let text='BCDOC1:ab';
  if(kind==='document')n.document='BCDOC1:cd';
  if(kind==='project')snap.locator.projectPath='/other.prproj';
  if(kind==='sequence')snap.locator.sequenceId='other';
  if(kind==='clip')snap.locator.clipNodeId='other';
  if(kind==='component')snap.locator.componentIndex=0;
  if(kind==='parameter')snap.locator.documentParamIndex=0;
  if(kind==='timing')n.clip.inPoint=time(.25);
  if(kind==='locked')f.track.isLocked=()=>true;
  if(kind==='duplicate')n.clip.components.push(n.clip.components[1]);
  if(kind==='non-layer')n.clip.isAdjustmentLayer=()=>false;
  if(kind==='bad-carrier')text='BCDOC1:ABCDEF';
  assert.ok(f.write(snap,text).error,kind);assert.equal(f.writes.length,0,kind);assert.deepEqual(f.sideEffects,[]);
 }
});
test('ignored, throwing or identity-changing setters are uncertain and never retried or silently undone',()=>{
 for(const kind of ['ignored','throws-after-write','replaced-clip','retimed','readback-failure']){
  const f=fixture(),n=f.native(),snap=snapshot(f.read().native[0]);
  if(kind==='ignored')n.param.ignore=true;
  if(kind==='throws-after-write')n.param.throwAfterWrite=true;
  if(kind==='replaced-clip')n.param.onSet=()=>{f.clips[0]=f.clip('another','');};
  if(kind==='retimed')n.param.onSet=()=>{n.clip.end=time(3);};
  if(kind==='readback-failure')n.param.onSet=()=>{n.param.readFailure=true;};
  const result=f.write(snap);assert.equal(result.code,'BC_OUTPUT_UNCONFIRMED',kind);assert.equal(result.recoverable,false);assert.equal(result.retry,'never');assert.equal(typeof result.outputApplied,'boolean');assert.equal(f.writes.length,1,kind);assert.deepEqual(f.sideEffects,[]);
 }
});
test('new fixed host methods retain ExtendScript ES3 parsing and no nested conditional expressions',()=>{
 const tree=acorn.parse(hostSource,{ecmaVersion:3});const nested=[];
 function visit(node){if(!node||typeof node!=='object')return;if(node.type==='ConditionalExpression'&&(node.consequent.type==='ConditionalExpression'||node.alternate.type==='ConditionalExpression'))nested.push(node.start);for(const [name,value]of Object.entries(node)){if(name==='loc')continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
 visit(tree);assert.deepEqual(nested,[]);
});
