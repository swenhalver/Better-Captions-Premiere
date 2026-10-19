import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('../webview-ui/node_modules/acorn');
const source=fs.readFileSync(new URL('../cep/host/bridge.jsx',import.meta.url),'utf8');
const T=254016000000n, ticks=s=>String(BigInt(s)*T);
const collection=(a,key='numItems')=>Object.defineProperty(a,key,{get:()=>a.length});
function fixture(){
 const files=new Map(),writes=[],seeks=[];let at=ticks(12),locked=false;
 function parameter(name,value){
  return {displayName:name,value,animated:false,keys:[],isTimeVarying(){return this.animated;},areKeyframesSupported:()=>true,getValue(){this.onRead?.();return this.value;},getKeys(){return this.keys.map(k=>({ticks:k.ticks}));},
   getValueAtKey(t){return this.keys.find(k=>k.ticks===t.ticks).value;},getValueAtTime(t){this.lastSample=t.ticks;return this.keys.find(k=>k.ticks===t.ticks)?.value??this.keys[0].value;},
   setValue(v){writes.push([name,'set',v]);if(!this.ignore)this.value=v;},addKey(t){writes.push([name,'add',t.ticks]);this.keys.push({ticks:t.ticks,value:this.getValueAtTime(t),interpolation:'default'});},
   setValueAtKey(t,v){writes.push([name,'key',t.ticks,v]);if(!this.ignore)this.keys.find(k=>k.ticks===t.ticks).value=v;},};
 }
 const position=parameter('Position',[.5,.9]),width=parameter('Width',1536),height=parameter('Height',150),groups=parameter('Groups per page',1),doc=parameter('Caption document (experimental)','BCDOC1:424341500200000000000000');
 const clip={nodeId:'clip',projectItem:{nodeId:'item',getMediaPath:()=>''},start:{ticks:ticks(10)},end:{ticks:ticks(15)},inPoint:{ticks:ticks(30)},outPoint:{ticks:ticks(35)},isAdjustmentLayer:()=>true,isSelected:()=>true,getSpeed:()=>1,isSpeedReversed:()=>false,
  components:collection([{matchName:'AE.com.swen.bettercaptions.native.experimental',properties:collection([position,width,height,doc,groups])}])};
 const track={clips:collection([clip]),isLocked:()=>locked};
 const seq={sequenceID:'seq-a',videoTracks:collection([track],'numTracks'),audioTracks:collection([],'numTracks'),getPlayerPosition:()=>({ticks:at}),setPlayerPosition(t){seeks.push(t);if(!this.ignoreSeek)at=t;this.onSeek?.();}};
 const project={path:'/project/edit.prproj',activeSequence:seq};
 const context={app:{project},Time:function(){this.ticks='0';},File:function(p){this.length=(files.get(p)??'').length;this.open=()=>files.has(p);this.read=()=>files.get(p);this.close=()=>{};}};
 vm.createContext(context);vm.runInContext(source,context);
 function call(method,data){files.set('/req.json',JSON.stringify({projectPath:project.path,sequenceId:'seq-a',...data}));return JSON.parse(context.BetterCaptionsHost[method]('/req.json'));}
 const entry=call('readCaptionConnections',{includeDocuments:true,knownLinks:[],generatedRoot:'/project/Better Captions/seq-a'}).native[0];
 const snapshot={locator:entry.locator,revision:entry.revision};
 const read=(data={})=>call('readNativeCaptionControls',{snapshot,...data});
 const edit=(receipt,patch={})=>call('editNativeCaptionControl',{snapshot,request:{revision:receipt.revision,parameter:'width',operation:'set',value:600,atTicks:receipt.timelineTicks,...patch}});
 const seek=(receipt,patch={})=>call('seekNativeCaptionKeyframe',{snapshot,request:{revision:receipt.revision,parameter:'width',direction:'next',atTicks:receipt.timelineTicks,...patch}});
 return {read,edit,seek,seeks,snapshot,position,width,height,groups,doc,clip,seq,project,writes,set at(v){at=v;},set locked(v){locked=v;}};
}

test('native control bridge remains ExtendScript ES3 compatible',()=>{acorn.parse(source,{ecmaVersion:3});});
test('reads geometry from exact owned effect; static scalar and 2D reset preserve document and unrelated properties',()=>{
 const f=fixture(),r=f.read();assert.equal(r.ok,true);assert.equal(r.timelineTicks,ticks(12));assert.equal(r.sourceTicks,ticks(32));assert.equal(r.width.value,1536);assert.equal(r.position.animated,false);
 const doc=f.doc.value,changed=f.edit(r);assert.equal(changed.readbackVerified,true);assert.equal(changed.width.value,600);assert.equal(f.doc.value,doc);assert.deepEqual(f.writes,[['Width','set',600]]);
 const moved=f.edit(changed,{parameter:'position',value:[.25,.7]});assert.deepEqual(moved.position.value,[.25,.7]);
 const reset=f.edit(moved,{parameter:'position',operation:'reset',value:undefined});assert.deepEqual(reset.position.value,[.5,.9]);assert.equal(reset.height.value,150);
});
test('animated edit uses source time, preserves other keys and their interpolation, and does not toggle animation',()=>{
 const f=fixture();f.width.animated=true;f.width.keys=[{ticks:ticks(30),value:800,interpolation:'bezier',easing:[12,35]},{ticks:ticks(32),value:900,interpolation:'hold',easing:[8,15]},{ticks:ticks(34),value:1000,interpolation:'bezier',easing:[10,20]}];
 const old=structuredClone(f.width.keys),r=f.read();assert.equal(r.width.animated,true);assert.equal(f.width.lastSample,ticks(32));
 const after=f.edit(r);assert.equal(after.readbackVerified,true);assert.deepEqual(f.writes,[['Width','key',ticks(32),600]]);old[1].value=600;assert.deepEqual(f.width.keys,old);
 f.at=ticks(13);const at33=f.read(),added=f.edit(at33,{value:700});assert.equal(added.readbackVerified,true);assert.equal(f.width.keys.length,4);assert.deepEqual(f.width.keys.slice(0,3),old);assert.equal(f.width.animated,true);
});
test('source clock calculation retains exact ticks above IEEE safe integer range',()=>{
 const f=fixture();f.clip.start.ticks='9007199254740993';f.clip.end.ticks='9007199254741993';f.clip.inPoint.ticks='9007199254742993';f.clip.outPoint.ticks='9007199254743993';f.at='9007199254741000';
 const entrySnapshot=f.snapshot; // Document revision must be refreshed after legitimate clip timing edits.
 const revision=JSON.parse(entrySnapshot.revision);revision.start=f.clip.start.ticks;revision.end=f.clip.end.ticks;revision.inPoint=f.clip.inPoint.ticks;revision.outPoint=f.clip.outPoint.ticks;entrySnapshot.revision=JSON.stringify(revision);
 const r=f.read();assert.equal(r.ok,true);assert.equal(r.sourceTicks,'9007199254743000');
});
test('rejects stale playhead, controls, document and locator; locked or outside clips; invalid values and retiming before writes',()=>{
 for(const mutate of [f=>{f.at=ticks(13);},f=>{f.width.value=850;},f=>{f.doc.value='BCDOC1:424341500200000001000000';},f=>{f.snapshot.locator.clipIndex=2;},f=>{f.locked=true;},f=>{f.clip.getSpeed=()=>2;},f=>{f.clip.isAdjustmentLayer=()=>false;}]){
  const f=fixture(),r=f.read();mutate(f);assert.match(f.edit(r).error,/changed|Unlock|speed|require|identity|source/i);assert.equal(f.writes.length,0);
 }
 for(const value of [0,8193,Infinity,'600',[.5]]){const f=fixture(),r=f.read();assert.ok(f.edit(r,{value}).error);assert.equal(f.writes.length,0);}
 const f=fixture();f.at=ticks(16);const outside=f.read();assert.equal(outside.insideClip,false);assert.equal(outside.sourceTicks,null);assert.match(f.edit(outside).error,/inside/);assert.equal(f.writes.length,0);
});
test('ambiguous effects or parameter labels are refused and ignored setters return nonrecoverable no-retry receipts',()=>{
 const f=fixture();f.clip.components[0].properties.push(f.width);assert.match(f.read().error,/Ambiguous/);assert.equal(f.writes.length,0);
 const h=fixture();h.width.ignore=true;const unconfirmed=h.edit(h.read());assert.equal(unconfirmed.code,'BC_OUTPUT_UNCONFIRMED');assert.equal(unconfirmed.retry,'never');assert.equal(unconfirmed.recoverable,false);assert.equal(h.writes.length,1);
 const n=fixture();n.clip.components.push(n.clip.components[0]);assert.match(n.read().error,/Ambiguous/);
});
test('reset on an animated property changes only current source key to native default',()=>{
 const f=fixture();f.height.animated=true;f.height.keys=[{ticks:ticks(30),value:400,interpolation:'bezier'},{ticks:ticks(32),value:450,interpolation:'hold'}];
 const before=structuredClone(f.height.keys),after=f.edit(f.read(),{parameter:'height',operation:'reset',value:undefined});
 assert.equal(after.readbackVerified,true);assert.equal(after.height.animated,true);before[1].value=150;assert.deepEqual(f.height.keys,before);assert.deepEqual(f.writes,[['Height','key',ticks(32),150]]);
});

test('keyframe navigation uses exact source-to-timeline mapping, point keys and skips keys outside the clip',()=>{
 const f=fixture();f.position.animated=true;f.position.keys=[{ticks:ticks(29),value:[.1,.2],interpolation:'bezier'},{ticks:ticks(31),value:[.3,.4],interpolation:'hold'},{ticks:ticks(33),value:[.5,.6],interpolation:'bezier'},{ticks:ticks(35),value:[.7,.8],interpolation:'bezier'}];
 const keys=structuredClone(f.position.keys),document=f.doc.value;
 const next=f.seek(f.read(),{parameter:'position'});assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,ticks(13));assert.equal(next.sourceTicks,ticks(33));assert.deepEqual(next.position.value,[.5,.6]);assert.deepEqual(f.seeks,[ticks(13)]);
 assert.match(f.seek(next,{parameter:'position'}).error,/no next keyframe/);assert.equal(f.seeks.length,1);
 const prev=f.seek(next,{parameter:'position',direction:'previous'});assert.equal(prev.timelineTicks,ticks(11));assert.equal(prev.sourceTicks,ticks(31));assert.deepEqual(f.seeks,[ticks(13),ticks(11)]);
 assert.match(f.seek(prev,{parameter:'position',direction:'previous'}).error,/no previous keyframe/);assert.deepEqual(f.position.keys,keys);assert.equal(f.doc.value,document);assert.deepEqual(f.writes,[]);
});
test('keyframe seek preserves decimal ticks beyond safe integers without passing through Number',()=>{
 const f=fixture();f.clip.start.ticks='9007199254740993';f.clip.end.ticks='9007199254741993';f.clip.inPoint.ticks='9007199254742993';f.clip.outPoint.ticks='9007199254743993';f.at='9007199254741000';
 const revision=JSON.parse(f.snapshot.revision);revision.start=f.clip.start.ticks;revision.end=f.clip.end.ticks;revision.inPoint=f.clip.inPoint.ticks;revision.outPoint=f.clip.outPoint.ticks;f.snapshot.revision=JSON.stringify(revision);
 f.width.animated=true;f.width.keys=[{ticks:'9007199254743001',value:600},{ticks:'9007199254743003',value:700}];
 const next=f.seek(f.read());assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,'9007199254741001');assert.equal(next.sourceTicks,'9007199254743001');assert.deepEqual(f.seeks,['9007199254741001']);assert.deepEqual(f.writes,[]);
});
test('keyframe seek rejects stale context, unsupported or reverse source clocks and refuses navigation with no setters',()=>{
 for(const mutate of [f=>{f.at=ticks(13);},f=>{f.width.keys[0].value=600;},f=>{f.clip.isSpeedReversed=()=>true;},f=>{f.clip.getSpeed=()=>.5;},f=>{f.width.animated=false;}]){
  const f=fixture();f.width.animated=true;f.width.keys=[{ticks:ticks(31),value:800},{ticks:ticks(34),value:900}];const r=f.read();mutate(f);assert.ok(f.seek(r).error);assert.deepEqual(f.seeks,[]);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();assert.match(f.seek(f.read()).error,/Enable animation/);assert.deepEqual(f.seeks,[]);
});
test('unconfirmed seek is attempted once, and post-seek document/control changes are not silently accepted',()=>{
 for(const change of [f=>{f.seq.ignoreSeek=true;},f=>{f.seq.onSeek=()=>{f.doc.value='BCDOC1:424341500200000001000000';};},f=>{f.seq.onSeek=()=>{f.width.keys[0].value=200;};}]){
  const f=fixture();f.width.animated=true;f.width.keys=[{ticks:ticks(31),value:800},{ticks:ticks(34),value:900}];change(f);const result=f.seek(f.read());assert.equal(result.code,'BC_OUTPUT_UNCONFIRMED');assert.equal(result.retry,'never');assert.equal(f.seeks.length,1);assert.deepEqual(f.writes,[]);
 }
});

test('sampling refuses a receipt when the timeline playhead moves during evaluation',()=>{
 const f=fixture();f.width.onRead=()=>{f.at=ticks(13);};assert.match(f.read().error,/playhead moved/);assert.deepEqual(f.writes,[]);assert.deepEqual(f.seeks,[]);
});


test('Groups per page edits an appended integer control, resets to one and preserves geometry, keys and document',()=>{
 const f=fixture();f.width.animated=true;f.width.keys=[{ticks:ticks(30),value:900,interpolation:'bezier'},{ticks:ticks(32),value:600,interpolation:'hold'}];
 const oldKeys=structuredClone(f.width.keys),oldDoc=f.doc.value,r=f.read();
 assert.equal(r.groups.value,1);assert.equal(r.groups.defaultValue,1);assert.equal(r.groups.animated,false);
 const after=f.edit(r,{parameter:'groups',value:3});assert.equal(after.readbackVerified,true);assert.equal(after.groups.value,3);
 assert.deepEqual(after.position,r.position);assert.deepEqual(after.width,r.width);assert.deepEqual(after.height,r.height);assert.deepEqual(f.width.keys,oldKeys);assert.equal(f.doc.value,oldDoc);
 const reset=f.edit(after,{parameter:'groups',operation:'reset',value:undefined});assert.equal(reset.groups.value,1);assert.deepEqual(f.writes,[['Groups per page','set',3],['Groups per page','set',1]]);
});

test('Groups per page validates integer bounds and refuses stale count before any setter',()=>{
 for(const value of [0,101,1.5,Infinity,'3',[3]]){const f=fixture();const r=f.read();assert.ok(f.edit(r,{parameter:'groups',value}).error);assert.deepEqual(f.writes,[]);}
 const f=fixture(),r=f.read();f.groups.value=3;assert.match(f.edit(r,{parameter:'groups',value:4}).error,/changed/);assert.deepEqual(f.writes,[]);
 const duplicate=fixture();duplicate.clip.components[0].properties.push(duplicate.groups);assert.match(duplicate.read().error,/Ambiguous/);assert.deepEqual(duplicate.writes,[]);
});

test('older native effects keep geometry usable without inventing a Groups per page control',()=>{
 const f=fixture(),properties=f.clip.components[0].properties;properties.splice(properties.indexOf(f.groups),1);
 const r=f.read();assert.equal(r.ok,true);assert.equal(r.groups,undefined);assert.equal(f.edit(r).width.value,600);
 const after=f.read();assert.match(f.edit(after,{parameter:'groups',value:3}).error,/Update the native caption effect/);assert.deepEqual(f.writes,[['Width','set',600]]);
});

test('animated group counts use existing source keys and preserve every other key',()=>{
 const f=fixture();f.groups.animated=true;f.groups.keys=[{ticks:ticks(30),value:1,interpolation:'hold'},{ticks:ticks(32),value:2,interpolation:'hold'},{ticks:ticks(34),value:3,interpolation:'hold'}];
 const expected=structuredClone(f.groups.keys),r=f.read();const after=f.edit(r,{parameter:'groups',value:4});expected[1].value=4;
 assert.equal(after.groups.animated,true);assert.equal(after.groups.hasKey,true);assert.deepEqual(f.groups.keys,expected);assert.deepEqual(f.writes,[['Groups per page','key',ticks(32),4]]);
 const next=f.seek(after,{parameter:'groups'});assert.equal(next.timelineTicks,ticks(14));assert.equal(next.groups.value,3);assert.deepEqual(f.groups.keys,expected);
});


test('explicit plugin edits select the owned caption once before updating values without selecting during reads',()=>{
 const f=fixture();let selected=false;const selections=[];f.clip.isSelected=()=>selected;f.clip.setSelected=(state,updateUI)=>{selections.push([state,updateUI]);selected=!!state;};
 const r=f.read();assert.deepEqual(selections,[]);const changed=f.edit(r,{parameter:'groups',value:3});assert.equal(changed.readbackVerified,true);assert.deepEqual(selections,[[1,true]]);
 const reset=f.edit(changed,{parameter:'groups',operation:'reset',value:undefined});assert.equal(reset.readbackVerified,true);assert.deepEqual(selections,[[1,true]]);assert.deepEqual(f.writes,[['Groups per page','set',3],['Groups per page','set',1]]);
});

test('selection cannot bypass stale playhead or document guards and failed selection never writes a parameter',()=>{
 for(const update of [f=>{f.clip.setSelected=()=>{};},f=>{f.clip.setSelected=()=>{f.at=ticks(13);};},f=>{f.clip.setSelected=()=>{f.doc.value='BCDOC1:424341500200000001000000';};}]){
  const f=fixture();f.clip.isSelected=()=>false;update(f);const result=f.edit(f.read());assert.ok(result.error);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();let selected=false;f.clip.isSelected=()=>selected;f.clip.setSelected=()=>{selected=true;f.at=ticks(13);};assert.match(f.edit(f.read()).error,/changed/);assert.deepEqual(f.writes,[]);
});

test('previous-key navigation includes the clip/source zero key with explicit host branches',()=>{
 const f=fixture();f.clip.start.ticks='0';f.clip.end.ticks=ticks(5);f.clip.inPoint.ticks='0';f.clip.outPoint.ticks=ticks(5);f.at=ticks(1);
 const revision=JSON.parse(f.snapshot.revision);revision.start='0';revision.end=ticks(5);revision.inPoint='0';revision.outPoint=ticks(5);f.snapshot.revision=JSON.stringify(revision);
 f.width.animated=true;f.width.keys=[{ticks:'0',value:674},{ticks:ticks(2),value:774}];
 const result=f.seek(f.read(),{parameter:'width',direction:'previous'});assert.equal(result.ok,true,result.error);assert.equal(result.timelineTicks,'0');assert.equal(result.width.value,674);assert.deepEqual(f.seeks,['0']);
 assert.doesNotMatch(source,/if \(request\.direction === 'previous' && side < 0/,'Premiere mis-evaluated the former combined directional OR condition at source zero; keep direction branches explicit');
});
