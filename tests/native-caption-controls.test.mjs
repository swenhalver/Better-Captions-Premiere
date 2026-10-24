import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {editControl} from './native-write-commit.mjs';
const require=createRequire(import.meta.url),acorn=require('../webview-ui/node_modules/acorn');
const source=fs.readFileSync(new URL('../cep/host/bridge.jsx',import.meta.url),'utf8');
const T=254016000000n, ticks=s=>String(BigInt(s)*T);
const collection=(a,key='numItems')=>Object.defineProperty(a,key,{get:()=>a.length,configurable:true});
const rollControls=[['rollUp','Roll-up enabled',0],['rollUpLines','Visible lines',2],['rollUpDuration','Scroll duration',.18],['rollUpFade','Soft fade boundary',1],['rollUpFadePosition','Boundary position',0],['rollUpFadeThickness','Transition thickness',.35],['rollUpFadeAmount','Fade amount',1],['rollUpFadeCurve','Transition curve',2],['rollUpDirection','Scroll direction',1],['rollUpSpeed','Scroll speed',1],['rollUpWait','Wait for line to finish',1],['rollUpTransition','Line transition',1],['rollUpCurrentLine','Current line position',1],['rollUpBlankLineSeconds','Pause Line Length',0]];

function fixture(){
 const files=new Map(),writes=[],seeks=[];let at=ticks(12),locked=false,now=Date.now();
 function parameter(name,value){
  return {displayName:name,value,animated:false,keys:[],isTimeVarying(){return this.animated;},areKeyframesSupported:()=>true,getValue(){this.onRead?.();return this.value;},getKeys(){return this.keys.map(k=>({ticks:k.ticks}));},
   getValueAtKey(t){return this.keys.find(k=>k.ticks===t.ticks).value;},getValueAtTime(t){this.lastSample=t.ticks;return this.keys.find(k=>k.ticks===t.ticks)?.value??this.keys[0].value;},
   setValue(v){writes.push([name,'set',v]);if(!this.ignore)this.value=v;},addKey(t){writes.push([name,'add',t.ticks]);this.keys.push({ticks:t.ticks,value:this.getValueAtTime(t),interpolation:'default'});},
   setValueAtKey(t,v){writes.push([name,'key',t.ticks,v]);if(!this.ignore)this.keys.find(k=>k.ticks===t.ticks).value=v;},};
 }
 const position=parameter('Position',[.5,.9]),width=parameter('Width',1536),height=parameter('Height',150),groups=parameter('Groups per page',1),alignment=parameter('Text alignment',2),fontSize=parameter('Global font size (64 = 1x)',64),doc=parameter('Caption document (experimental)','BCDOC1:424341500200000000000000');
 const rollParams=Object.fromEntries(rollControls.map(([key,label,value])=>[key,parameter(label,value)]));
 const clip={nodeId:'clip',projectItem:{nodeId:'item',getMediaPath:()=>''},start:{ticks:ticks(10)},end:{ticks:ticks(15)},inPoint:{ticks:ticks(30)},outPoint:{ticks:ticks(35)},isAdjustmentLayer:()=>true,isSelected:()=>true,getSpeed:()=>1,isSpeedReversed:()=>false,
  components:collection([{matchName:'AE.com.swen.bettercaptions.native.experimental',properties:collection([position,width,height,doc,groups,fontSize,...Object.values(rollParams),alignment])}])};
 const track={clips:collection([clip]),isLocked:()=>locked};
 const seq={sequenceID:'seq-a',frameSizeHorizontal:1920,frameSizeVertical:1080,videoTracks:collection([track],'numTracks'),audioTracks:collection([],'numTracks'),getPlayerPosition:()=>({ticks:at}),setPlayerPosition(t){seeks.push(t);if(!this.ignoreSeek)at=t;this.onSeek?.();}};
 const project={path:'/project/edit.prproj',activeSequence:seq};
 const context={Date:class extends Date{getTime(){return now;}},app:{project},Time:function(){this.ticks='0';},File:function(p){this.length=(files.get(p)??'').length;this.open=()=>files.has(p);this.read=()=>files.get(p);this.close=()=>{};}};
 vm.createContext(context);vm.runInContext(source,context);
 function call(method,data){files.set('/req.json',JSON.stringify({projectPath:project.path,sequenceId:'seq-a',...data}));return JSON.parse(context.BetterCaptionsHost[method]('/req.json'));}
 const entry=call('readCaptionConnections',{includeDocuments:true,knownLinks:[],generatedRoot:'/project/Better Captions/seq-a'}).native[0];
 const snapshot={locator:entry.locator,revision:entry.revision};
 const read=(data={})=>call('readNativeCaptionControls',{snapshot,...data});
 const edit=(receipt,patch={})=>editControl(call,()=>clip.components[0].properties,{snapshot,request:{revision:receipt.revision,parameter:'width',operation:'set',value:600,atTicks:receipt.timelineTicks,...patch}});
 const seek=(receipt,patch={})=>call('seekNativeCaptionKeyframe',{snapshot,request:{revision:receipt.revision,parameter:'width',direction:'next',atTicks:receipt.timelineTicks,...patch}});
 return {parameter,read,edit,seek,seeks,snapshot,reloadHost:()=>vm.runInContext(source,context),clearGuides:()=>JSON.parse(context.BetterCaptionsHost.clearExpiredNativeCaptionGuides()),get now(){return now;},set now(value){now=value;},position,width,height,groups,alignment,fontSize,rollParams,connections:(includeDocuments=true)=>call('readCaptionConnections',{includeDocuments,knownLinks:[],generatedRoot:'/project/Better Captions/seq-a'}),doc,clip,seq,project,writes,set at(v){at=v;},set locked(v){locked=v;}};
}

test('native control bridge remains ExtendScript ES3 compatible',()=>{acorn.parse(source,{ecmaVersion:3});});
test('production-sized native controls use one property/name bridge pass per independently checked context',()=>{
 const f=fixture();lineFitWordStates(f);
 const properties=f.clip.components[0].properties;
 // Include irrelevant/native topic fields and object-special names. Indexing
 // these must not invent controls or collapse repeated word-state labels.
 for(const label of ['__proto__','constructor','toString',...Array.from({length:22},(_,i)=>`Other ${i}`)])properties.push(f.parameter(label,0));
 let labels=0,indexReads=0,countReads=0;
 for(let i=0;i<properties.length;i++){
  const parameter=properties[i],label=parameter.displayName;
  Object.defineProperty(parameter,'displayName',{get(){labels++;return label;}});
  Object.defineProperty(properties,i,{get(){indexReads++;return parameter;},configurable:true});
 }
 Object.defineProperty(properties,'numItems',{get(){countReads++;return properties.length;},configurable:true});
 const r=f.read();assert.equal(r.ok,true,r.error);assert.equal(labels,properties.length);assert.equal(indexReads,properties.length);assert.equal(countReads,1);
 labels=0;indexReads=0;countReads=0;
 const after=f.edit(r);assert.equal(after.readbackVerified,true,after.error);
 // Prepare and post-commit verification each rescan the bridge once. No
 // cross-context metadata cache may mask outside edits. The simulated UXP
 // commit lists the names once more and fetches the one written parameter.
 assert.equal(labels,3*properties.length);assert.equal(indexReads,3*properties.length+1);assert.equal(countReads,2);
 assert.deepEqual(f.writes,[['Width','set',600]]);
});
test('one-pass lookup still detects parameter label replacement between preflight and mutation',()=>{
 const f=fixture(),r=f.read();let reads=0;
 f.width.onRead=()=>{if(++reads===1)f.clip.components[0].properties.push(f.width);};
 const after=f.edit(r);assert.match(after.error,/changed/);assert.deepEqual(f.writes,[]);
});
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
 assert.equal(after.readbackVerified,true);assert.equal(after.height.animated,true);before[1].value=972;assert.deepEqual(f.height.keys,before);assert.deepEqual(f.writes,[['Height','key',ticks(32),972]]);
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


test('line fit metadata is always exposed and a Width edit changes only the connection revision',()=>{
 const f=fixture(),r=f.read(),doc=f.doc.value,initial=f.connections().native[0],defaults={sizeScale:1,bubbleMode:1,paddingScale:1};
 assert.equal(r.smartFit,undefined);assert.equal(Object.hasOwn(initial,'smartLineFit'),false);
 assert.equal(initial.lineFitWidth,1536);assert.equal(initial.lineFitFontScale,1);assert.deepEqual(initial.lineFitStates,{upcoming:defaults,current:defaults,spoken:defaults});
 const initialRevision=JSON.parse(initial.connectionRevision);assert.equal(Object.hasOwn(initialRevision,'smartLineFit'),false);assert.equal(initialRevision.lineFitWidth,1536);assert.equal(initialRevision.lineFitFontScale,1);assert.deepEqual(initialRevision.lineFitStates,initial.lineFitStates);
 assert.ok(f.edit(r,{parameter:'smartFit',value:1}).error);assert.deepEqual(f.writes,[]);
 const changed=f.edit(r);assert.equal(changed.readbackVerified,true,changed.error);
 const narrower=f.connections().native[0];assert.equal(narrower.lineFitWidth,600);assert.notEqual(narrower.connectionRevision,initial.connectionRevision);assert.equal(narrower.revision,initial.revision);assert.equal(f.doc.value,doc);
 f.fontSize.value=96;const larger=f.connections().native[0];assert.equal(larger.lineFitFontScale,1.5);assert.notEqual(larger.connectionRevision,narrower.connectionRevision);assert.equal(larger.revision,initial.revision);
});

test('line fit metadata samples animated width and font size in the exact clip-source clock',()=>{
 const f=fixture();
 f.width.animated=true;f.width.keys=[{ticks:ticks(30),value:800},{ticks:ticks(32),value:640}];
 f.fontSize.animated=true;f.fontSize.keys=[{ticks:ticks(30),value:64},{ticks:ticks(32),value:96}];
 const before=structuredClone({width:f.width.keys,font:f.fontSize.keys}),record=f.connections().native[0];
 assert.equal(record.lineFitWidth,640);assert.equal(record.lineFitFontScale,1.5);assert.equal(f.width.lastSample,ticks(32));assert.equal(f.fontSize.lastSample,ticks(32));
 const revision=JSON.parse(record.connectionRevision);assert.equal(revision.lineFitWidth,640);assert.equal(revision.lineFitFontScale,1.5);
 f.width.keys[1].value=600;const narrower=f.connections().native[0];assert.notEqual(narrower.connectionRevision,record.connectionRevision);assert.equal(narrower.revision,record.revision);f.width.keys[1].value=640;
 assert.deepEqual({width:f.width.keys,font:f.fontSize.keys},before);assert.deepEqual(f.writes,[]);
});

test('line fit discovery rejects missing or ambiguous width and font controls or a playhead change while sampling',()=>{
 const missing=fixture(),properties=missing.clip.components[0].properties;properties.splice(properties.indexOf(missing.fontSize),1);assert.ok(missing.connections().warnings.length);assert.equal(missing.connections().native.length,0);
 const f=fixture();f.clip.components[0].properties.push(f.parameter('Width',900));assert.ok(f.connections().warnings.length);assert.equal(f.connections().native.length,0);
 const h=fixture();h.width.onRead=()=>{h.at=ticks(13);};assert.match(h.read().error,/playhead moved/);assert.deepEqual(h.writes,[]);
});


test('native scrolling controls expose exact defaults and isolated set/reset preserves document, geometry and other settings',()=>{
 const f=fixture(),document=f.doc.value,originalTiming=structuredClone([f.clip.start,f.clip.end,f.clip.inPoint,f.clip.outPoint]);let r=f.read();
 for(const [key,,value] of rollControls){assert.equal(r[key].value,value,key);assert.equal(r[key].defaultValue,value,key);}
 const values=[1,3,.3,0,.2,.5,.7,4,3,2,0,4,2,2.5];
 for(let index=0;index<rollControls.length;index++){
  const [key,label,defaultValue]=rollControls[index],before=structuredClone(r),after=f.edit(r,{parameter:key,value:values[index]});
  assert.equal(after.readbackVerified,true,key);assert.equal(after[key].value,values[index],key);
  for(const other of ['position','width','height','groups',...rollControls.map(row=>row[0])])if(other!==key)assert.deepEqual(after[other],before[other],other);
  r=f.edit(after,{parameter:key,operation:'reset',value:undefined});assert.equal(r[key].value,defaultValue,key);assert.equal(f.doc.value,document);
  assert.deepEqual(f.writes.slice(-2),[[label,'set',values[index]],[label,'set',defaultValue]]);
 }
 assert.deepEqual([f.clip.start,f.clip.end,f.clip.inPoint,f.clip.outPoint],originalTiming);
});

test('native scrolling reads interpolate on the clip-source clock while line and curve values quantize',()=>{
 const f=fixture(),values=[.75,2.7,.24,false,.2,.4,.6,2.7,3.6,1.2,.2,3.6,1.7,2.5];
 for(let index=0;index<rollControls.length;index++){
  const [key,,value]=rollControls[index],p=f.rollParams[key];p.animated=true;p.keys=[{ticks:ticks(30),value,interpolation:'hold'},{ticks:ticks(32),value:values[index],interpolation:'bezier'}];
 }
 const before=structuredClone(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys]))),r=f.read();
 const expected=[1,3,.24,0,.2,.4,.6,3,4,1.2,0,4,2,2.5];
 for(let index=0;index<rollControls.length;index++){const [key]=rollControls[index];assert.equal(r[key].value,expected[index],key);assert.equal(r[key].animated,true);assert.equal(r[key].hasKey,true);assert.equal(f.rollParams[key].lastSample,ticks(32));}
 assert.deepEqual(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys])),before);assert.deepEqual(f.writes,[]);
 const after=f.edit(r,{parameter:'rollUpFadeThickness',value:.55});assert.equal(after.readbackVerified,true);before.rollUpFadeThickness[1].value=.55;assert.deepEqual(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys])),before);assert.deepEqual(f.writes,[['Transition thickness','key',ticks(32),.55]]);
});

test('scroll settings enforce boolean, integer, fraction, seconds and speed limits before writes',()=>{
 const invalid={rollUp:[true,.5,2],rollUpLines:[0,9,1.5],rollUpCurrentLine:[0,9,1.5],rollUpBlankLineSeconds:[-.1,30.1,NaN,Infinity,'2'],rollUpDuration:[-.01,2.1],rollUpFade:[false,.5,2],rollUpFadePosition:[-.1,1.1],rollUpFadeThickness:[-.1,1.1],rollUpFadeAmount:[-.1,1.1],rollUpFadeCurve:[0,5,2.5],rollUpDirection:[0,5,2.5],rollUpSpeed:[0,.09,10.1],rollUpWait:[true,.5,2],rollUpTransition:[0,5,2.5]};
 for(const [parameter,values] of Object.entries(invalid))for(const value of [...values,Infinity,'1']){const f=fixture(),r=f.read();assert.ok(f.edit(r,{parameter,value}).error,`${parameter}:${value}`);assert.deepEqual(f.writes,[]);}
});

test('older native binaries keep existing controls usable and refuse missing scrolling setters',()=>{
 const f=fixture(),properties=f.clip.components[0].properties;for(const p of Object.values(f.rollParams))properties.splice(properties.indexOf(p),1);
 const r=f.read();assert.equal(r.ok,true);for(const [key] of rollControls)assert.equal(r[key],undefined);assert.equal(f.edit(r).width.value,600);
 assert.match(f.edit(f.read(),{parameter:'rollUp',value:1}).error,/Update the native caption effect/);assert.deepEqual(f.writes,[['Width','set',600]]);
});

test('scroll parameter key navigation follows the source clock without changing mode or stored keys',()=>{
 const f=fixture(),p=f.rollParams.rollUpSpeed;p.animated=true;p.keys=[{ticks:ticks(31),value:.5,interpolation:'hold'},{ticks:ticks(34),value:2,interpolation:'bezier'}];
 const before=structuredClone(p.keys),document=f.doc.value,r=f.read();const next=f.seek(r,{parameter:'rollUpSpeed'});
 assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,ticks(14));assert.equal(next.sourceTicks,ticks(34));assert.equal(next.rollUpSpeed.value,2);assert.equal(next.rollUp.value,0);assert.deepEqual(p.keys,before);assert.equal(f.doc.value,document);assert.deepEqual(f.writes,[]);
});


function lineFitWordStates(f,topics=true,order=['current','spoken','upcoming']){
 const names={current:'Current word',spoken:'Previously spoken words',upcoming:'Upcoming words'},settings={current:[150,1,200],spoken:[80,2,50],upcoming:[110,0,125]},states={};
 for(const name of order){
  const [size,bubble,padding]=settings[name];states[name]={size:f.parameter('Size, %',size),bubble:f.parameter('Word bubble',bubble),padding:f.parameter('Bubble padding, %',padding)};
  if(topics)f.clip.components[0].properties.push(f.parameter(names[name],0));
  f.clip.components[0].properties.push(...Object.values(states[name]));
 }
 return states;
}

test('line fit mirrors per-state size, popup modes and padding with topic labels or legacy flat control order',()=>{
 const expected={upcoming:{sizeScale:1.1,bubbleMode:1,paddingScale:1.25},current:{sizeScale:1.5,bubbleMode:2,paddingScale:2},spoken:{sizeScale:.8,bubbleMode:3,paddingScale:.5}};
 for(const topics of [true,false]){
  const f=fixture();lineFitWordStates(f,topics);const oldDoc=f.doc.value,record=f.connections().native[0];
  assert.deepEqual(record.lineFitStates,expected);assert.deepEqual(JSON.parse(record.connectionRevision).lineFitStates,expected);assert.equal(f.doc.value,oldDoc);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();lineFitWordStates(f,true,['upcoming','current','spoken']);assert.deepEqual(f.connections().native[0].lineFitStates,expected,'topic names determine identity when headers exist');
});

test('per-state line-fit metadata uses the same exact animated source clock and changes only connection revision',()=>{
 const f=fixture();const states=lineFitWordStates(f),document=f.doc.value;
 for(const s of Object.values(states))for(const [key,p] of Object.entries(s)){p.animated=true;let value=120;if(key==='bubble')value=1;if(key==='padding')value=60;p.keys=[{ticks:ticks(30),value:p.value},{ticks:ticks(32),value,interpolation:'bezier'}];}
 const keys=structuredClone(Object.fromEntries(Object.entries(states).map(([name,s])=>[name,Object.fromEntries(Object.entries(s).map(([key,p])=>[key,p.keys]))]))),before=f.connections().native[0];
 for(const state of Object.values(before.lineFitStates))assert.deepEqual(state,{sizeScale:1.2,bubbleMode:2,paddingScale:.6});
 for(const s of Object.values(states))for(const p of Object.values(s))assert.equal(p.lastSample,ticks(32));
 states.current.size.keys[1].value=180;const changed=f.connections().native[0];assert.equal(changed.lineFitStates.current.sizeScale,1.8);assert.notEqual(changed.connectionRevision,before.connectionRevision);assert.equal(changed.revision,before.revision);states.current.size.keys[1].value=120;
 assert.deepEqual(Object.fromEntries(Object.entries(states).map(([name,s])=>[name,Object.fromEntries(Object.entries(s).map(([key,p])=>[key,p.keys]))])),keys);assert.equal(f.doc.value,document);assert.deepEqual(f.writes,[]);
});

test('missing old state controls project document defaults while partial, ambiguous or invalid state controls are rejected',()=>{
 const f=fixture();const defaults={sizeScale:1,bubbleMode:1,paddingScale:1};assert.deepEqual(f.connections().native[0].lineFitStates,{upcoming:defaults,current:defaults,spoken:defaults});
 const partial=fixture();partial.clip.components[0].properties.push(partial.parameter('Size, %',100));assert.match(partial.read().error,/complete native line fit word-state/);assert.deepEqual(partial.writes,[]);
 for(const corrupt of [states=>{states.current.size.value=0;},states=>{states.spoken.padding.value=401;},states=>{states.upcoming.bubble.value=3;},states=>{states.upcoming.bubble.value=.5;}]){
  const h=fixture();const states=lineFitWordStates(h);corrupt(states);assert.ok(h.read().error);assert.deepEqual(h.writes,[]);
 }
 const duplicate=fixture();const states=lineFitWordStates(duplicate);duplicate.clip.components[0].properties.push(states.upcoming.padding);assert.match(duplicate.read().error,/Ambiguous|complete/);assert.deepEqual(duplicate.writes,[]);
});


test('creative line transition modes reset to Scroll and retain the default wait-until-finished setting',()=>{
 const f=fixture(),document=f.doc.value;let r=f.read();assert.equal(r.rollUpTransition.value,1);assert.equal(r.rollUpWait.value,1);
 for(const value of [2,3,4]){r=f.edit(r,{parameter:'rollUpTransition',value});assert.equal(r.readbackVerified,true);assert.equal(r.rollUpTransition.value,value);assert.equal(r.rollUpWait.value,1);assert.equal(f.doc.value,document);}
 const after=f.edit(r,{parameter:'rollUpTransition',operation:'reset',value:undefined});assert.equal(after.rollUpTransition.value,1);assert.equal(after.rollUpWait.value,1);assert.deepEqual(f.writes,[['Line transition','set',2],['Line transition','set',3],['Line transition','set',4],['Line transition','set',1]]);
});


test('native text alignment reads Center, switches Left/Right and resets Center without changing transcript or layout controls',()=>{
 const f=fixture(),document=f.doc.value,r=f.read();assert.equal(r.alignment.value,2);assert.equal(r.alignment.defaultValue,2);
 const left=f.edit(r,{parameter:'alignment',value:1}),right=f.edit(left,{parameter:'alignment',value:3}),center=f.edit(right,{parameter:'alignment',operation:'reset',value:undefined});
 assert.equal(left.readbackVerified,true);assert.equal(left.alignment.value,1);assert.equal(right.alignment.value,3);assert.equal(center.alignment.value,2);
 for(const key of ['position','width','height','groups',...rollControls.map(row=>row[0])])assert.deepEqual(center[key],r[key],key);
 assert.equal(f.doc.value,document);assert.deepEqual(f.writes,[['Text alignment','set',1],['Text alignment','set',3],['Text alignment','set',2]]);
});

test('animated alignment uses the native source clock and preserves other keys and interpolation',()=>{
 const f=fixture(),p=f.alignment;p.animated=true;p.keys=[{ticks:ticks(30),value:1,interpolation:'hold'},{ticks:ticks(32),value:2,interpolation:'bezier'},{ticks:ticks(34),value:3,interpolation:'hold'}];
 const expected=structuredClone(p.keys),r=f.read();assert.equal(p.lastSample,ticks(32));const after=f.edit(r,{parameter:'alignment',value:1});expected[1].value=1;
 assert.equal(after.readbackVerified,true);assert.equal(after.alignment.animated,true);assert.deepEqual(p.keys,expected);assert.deepEqual(f.writes,[['Text alignment','key',ticks(32),1]]);
 const next=f.seek(after,{parameter:'alignment'});assert.equal(next.timelineTicks,ticks(14));assert.equal(next.alignment.value,3);assert.deepEqual(p.keys,expected);
});

test('alignment validates integer modes, quantizes native samples, and stays optional for older effect binaries',()=>{
 for(const value of [0,4,1.5,true,'1',Infinity]){const f=fixture();assert.ok(f.edit(f.read(),{parameter:'alignment',value}).error);assert.deepEqual(f.writes,[]);}
 const sampled=fixture();sampled.alignment.value=1.7;assert.equal(sampled.read().alignment.value,2);
 const old=fixture(),properties=old.clip.components[0].properties;properties.splice(properties.indexOf(old.alignment),1);const r=old.read();assert.equal(r.ok,true);assert.equal(r.alignment,undefined);assert.match(old.edit(r,{parameter:'alignment',value:1}).error,/Update the native caption effect/);assert.deepEqual(old.writes,[]);
});

 test('dimension resets use ninety percent of current sequence dimensions without changing the other axis',()=>{
 const f=fixture(),r=f.read();assert.equal(r.width.defaultValue,1728);assert.equal(r.height.defaultValue,972);
 const w=f.edit(r,{parameter:'width',operation:'reset',value:undefined});assert.equal(w.width.value,1728);assert.equal(w.height.value,150);
 const h=f.edit(w,{parameter:'height',operation:'reset',value:undefined});assert.equal(h.height.value,972);assert.equal(h.width.value,1728);
 });


test('layout editing guide is a hidden static lease; document/control revisions and unrelated edits are preserved',()=>{
 const f=fixture(),guide=f.parameter('Layout editing guide',0);f.clip.components[0].properties.push(guide);
 const snapshot=f.snapshot.revision,r=f.read(),after=f.edit(r),lease=guide.value;
 assert.equal(after.readbackVerified,true);assert.equal(after.layoutGuide.active,true);
 assert.equal(lease,(f.now+1500)/1000);assert.equal(f.snapshot.revision,snapshot);
 assert.equal(f.read().revision,after.revision);assert.deepEqual(f.writes,[['Width','set',600],['Layout editing guide','set',lease]]);
 const afterStyle=f.edit(after,{parameter:'groups',value:2});assert.equal(afterStyle.layoutGuide,undefined);assert.equal(guide.value,lease);
 assert.equal(f.clearGuides().cleared,0);f.now+=801;assert.equal(f.clearGuides().cleared,1);assert.equal(guide.value,0);
 assert.equal(f.clearGuides().pending,0);assert.equal(f.width.value,600);assert.equal(f.groups.value,2);
});
test('guide watchdog clears only its latest exact lease and re-resolves a reordered clip',()=>{
 const f=fixture(),guide=f.parameter('Layout editing guide',0);f.clip.components[0].properties.push(guide);
 let after=f.edit(f.read());const first=guide.value;f.now+=500;after=f.edit(after,{value:610});const latest=guide.value;assert.notEqual(first,latest);
 f.now+=400;assert.equal(f.clearGuides().cleared,0);assert.equal(guide.value,latest);
 f.seq.videoTracks[0].clips.unshift({nodeId:'other'});f.now+=401;assert.equal(f.clearGuides().cleared,1);assert.equal(guide.value,0);
});
test('guide cleanup refuses another project, outside lease changes and animated fields',()=>{
 for(const kind of ['project','value','nearby-lease','animated']){
  const f=fixture(),guide=f.parameter('Layout editing guide',0);f.clip.components[0].properties.push(guide);f.edit(f.read());f.now+=900;
  if(kind==='project')f.project.path='/other.prproj';if(kind==='value')guide.value=123;if(kind==='nearby-lease')guide.value+=1;if(kind==='animated')guide.animated=true;
  const before=guide.value;assert.equal(f.clearGuides().cleared,0);assert.equal(guide.value,before);
  if(kind==='project'){f.project.path='/project/edit.prproj';assert.equal(f.clearGuides().cleared,1);}
 }
});

test('reloading the CEP host retains only guide lease identities for cache cleanup',()=>{
 const f=fixture(),guide=f.parameter('Layout editing guide',0);f.clip.components[0].properties.push(guide);f.edit(f.read());
 assert.ok(guide.value>0);f.reloadHost();f.now+=801;assert.equal(f.clearGuides().cleared,1);assert.equal(guide.value,0);
});

function dimensionDisplays(f){
 const displays={width:f.parameter('Width, px',648),height:f.parameter('Height, px',1152)};
 for(const display of Object.values(displays))display.areKeyframesSupported=()=>false;
 f.clip.components[0].properties.push(displays.height,displays.width); // Match by unique names, not positions.
 return displays;
}
test('native dimension edits mirror visible UI-only controls after verified saved-stream writes',()=>{
 for(const parameter of ['width','height']){
  const f=fixture(),displays=dimensionDisplays(f),other=parameter==='width'?'height':'width';
  const after=f.edit(f.read(),{parameter,value:777});assert.equal(after.readbackVerified,true,after.error);
  assert.equal(f[parameter].value,777);assert.equal(displays[parameter].value,777);
  assert.deepEqual(f.writes,[[parameter==='width'?'Width':'Height','set',777],[parameter==='width'?'Width, px':'Height, px','set',777]]);
  assert.equal(displays[other].value,other==='width'?648:1152);
 }
});
test('animated dimension edits mirror only the sampled display and preserve existing keyframes',()=>{
 const f=fixture(),displays=dimensionDisplays(f);f.width.animated=true;f.width.keys=[{ticks:ticks(30),value:700,interpolation:'bezier'},{ticks:ticks(32),value:900,interpolation:'hold'}];
 const before=structuredClone(f.width.keys),after=f.edit(f.read(),{value:777});assert.equal(after.readbackVerified,true,after.error);
 before[1].value=777;assert.deepEqual(f.width.keys,before);assert.equal(displays.width.value,777);assert.deepEqual(f.writes,[['Width','key',ticks(32),777],['Width, px','set',777]]);assert.equal(displays.width.animated,false);
});
test('ambiguous or animated native dimension displays refuse before saved-stream mutation',()=>{
 for(const invalid of ['duplicate','animated','keyed']){
  const f=fixture(),displays=dimensionDisplays(f);
  if(invalid==='duplicate')f.clip.components[0].properties.push(displays.width);
  if(invalid==='animated')displays.width.animated=true;
  if(invalid==='keyed')displays.width.keys=[{ticks:ticks(30),value:648,interpolation:'hold'}];
  const result=f.edit(f.read());assert.match(result.error,/Ambiguous|non-animated/i);assert.deepEqual(f.writes,[]);assert.equal(f.width.value,1536);
 }
});
test('ignored cosmetic dimension setters cannot return a successful edit receipt',()=>{
 const f=fixture(),displays=dimensionDisplays(f);displays.width.ignore=true;
 const result=f.edit(f.read(),{value:777});assert.equal(result.code,'BC_OUTPUT_UNCONFIRMED');assert.equal(result.retry,'never');assert.equal(f.width.value,777);assert.equal(displays.width.value,648);
});
test('reading native dimensions never writes cosmetic displays; an ignored dimension setter is unconfirmed',()=>{
 const f=fixture(),displays=dimensionDisplays(f);const before=f.read();assert.equal(before.ok,true);assert.deepEqual(f.writes,[]);
 f.width.ignore=true;const result=f.edit(before);assert.equal(result.code,'BC_OUTPUT_UNCONFIRMED');assert.deepEqual(f.writes,[['Width','set',600],['Width, px','set',600]]);
});

test('native dimension proxy accepts Premiere keyframe capability without actual keys',()=>{
 const f=fixture(),displays=dimensionDisplays(f);displays.width.areKeyframesSupported=()=>true;displays.width.getKeys=()=>undefined;
 const after=f.edit(f.read(),{value:777});assert.equal(after.readbackVerified,true,after.error);assert.equal(f.width.value,777);assert.equal(displays.width.value,777);assert.deepEqual(f.writes,[['Width','set',777],['Width, px','set',777]]);
});

function addBoundaryControls(f) {
 const mode=f.parameter('Boundary mode',0),edges={};
 f.clip.components[0].properties.push(f.parameter('Boundaries',0),mode);
 for(const side of ['Top','Bottom','Left','Right']) {
  f.clip.components[0].properties.push(f.parameter(side,0));
  for(const [suffix,label,value] of [['Inset','Inset, %',0],['Fade','Fade enabled',1],['Width','Fade width, %',20],['Amount','Fade amount, %',100],['Curve','Fade curve',1]]) {
   const key=`boundary${side}${suffix}`,parameter=f.parameter(label,value);edges[key]=parameter;f.clip.components[0].properties.push(parameter);
  }
  f.clip.components[0].properties.push(f.parameter('End edge',0));
 }
 return {mode,edges};
}
test('independent boundaries discover repeated edge labels inside their named groups and normalize CEP popups',()=>{
 const f=fixture(),{mode,edges}=addBoundaryControls(f),r=f.read();assert.equal(r.ok,true,r.error);assert.equal(r.boundaryMode.value,1);assert.equal(r.boundaryMode.defaultValue,1);
 for(const side of ['Top','Bottom','Left','Right']) {
  assert.equal(r[`boundary${side}Inset`].value,0);assert.equal(r[`boundary${side}Fade`].value,1);assert.equal(r[`boundary${side}Width`].value,20);assert.equal(r[`boundary${side}Amount`].value,100);assert.equal(r[`boundary${side}Curve`].value,2);
 }
 const document=f.doc.value,position=structuredClone(f.position.value),width=f.width.value,height=f.height.value,roll=structuredClone(Object.fromEntries(Object.entries(f.rollParams).map(([k,p])=>[k,p.value])));
 let next=f.edit(r,{parameter:'boundaryMode',value:2});assert.equal(next.readbackVerified,true,next.error);assert.equal(mode.value,1);assert.equal(next.boundaryMode.value,2);
 for(const [key,p] of Object.entries(edges)) {
  const value=key.endsWith('Inset')?12.5:key.endsWith('Fade')?0:key.endsWith('Width')?30:key.endsWith('Amount')?45:4;
  next=f.edit(next,{parameter:key,value});assert.equal(next.readbackVerified,true,`${key}: ${next.error}`);assert.equal(next[key].value,value);assert.equal(p.value,key.endsWith('Curve')?value-1:value);
 }
 assert.equal(f.doc.value,document);assert.deepEqual(f.position.value,position);assert.equal(f.width.value,width);assert.equal(f.height.value,height);assert.deepEqual(Object.fromEntries(Object.entries(f.rollParams).map(([k,p])=>[k,p.value])),roll);
 next=f.edit(next,{parameter:'boundaryTopCurve',operation:'reset',value:undefined});assert.equal(next.boundaryTopCurve.value,2);assert.equal(edges.boundaryTopCurve.value,1);
 assert.equal(next.boundaryBottomCurve.value,4);assert.equal(next.boundaryMode.value,2);
});
test('edge values validate percent, toggle and popup ranges before any setter',()=>{
 const invalid={boundaryMode:[0,3,1.5,'2'],boundaryTopInset:[-.1,100.1,Infinity,'25'],boundaryBottomFade:[true,.5,2],boundaryLeftWidth:[-.1,101],boundaryRightAmount:[-.1,101],boundaryRightCurve:[0,5,2.5]};
 for(const [parameter,values] of Object.entries(invalid))for(const value of values) {
  const f=fixture();addBoundaryControls(f);const result=f.edit(f.read(),{parameter,value});assert.ok(result.error,`${parameter} ${value}`);assert.deepEqual(f.writes,[]);
 }
});
test('boundary animation edits and seeks use normalized popup values and preserve every unrelated edge',()=>{
 const f=fixture(),{edges}=addBoundaryControls(f),p=edges.boundaryLeftCurve;p.animated=true;p.keys=[{ticks:ticks(31),value:0,interpolation:'bezier'},{ticks:ticks(32),value:1,interpolation:'hold'},{ticks:ticks(34),value:3,interpolation:'bezier'}];
 const before=structuredClone(p.keys);let r=f.read();assert.deepEqual(r.boundaryLeftCurve.keys.map(k=>k.value),[1,2,4]);
 r=f.edit(r,{parameter:'boundaryLeftCurve',value:3});assert.equal(r.readbackVerified,true,r.error);before[1].value=2;assert.deepEqual(p.keys,before);
 const writes=structuredClone(f.writes);r=f.seek(r,{parameter:'boundaryLeftCurve',direction:'next'});assert.equal(r.readbackVerified,true,r.error);assert.equal(r.boundaryLeftCurve.value,4);assert.equal(r.timelineTicks,ticks(14));assert.deepEqual(f.writes,writes);
});
test('ambiguous or malformed edge metadata fails closed; missing boundaries leave old geometry usable',()=>{
 const old=fixture();assert.equal(old.read().ok,true);assert.ok(old.edit(old.read(),{parameter:'boundaryTopInset',value:20}).error);assert.deepEqual(old.writes,[]);
 const duplicate=fixture();addBoundaryControls(duplicate);duplicate.clip.components[0].properties.push(duplicate.parameter('Top',0));assert.match(duplicate.read().error,/Ambiguous/);
 const malformed=fixture(),{edges}=addBoundaryControls(malformed);edges.boundaryTopWidth.displayName='Other value';assert.match(malformed.read().error,/edge controls changed/);assert.deepEqual(malformed.writes,[]);
 const stale=fixture(),b=addBoundaryControls(stale),r=stale.read();b.edges.boundaryRightAmount.value=42;assert.match(stale.edit(r,{parameter:'boundaryTopInset',value:10}).error,/changed/);assert.deepEqual(stale.writes,[]);
});

test('native boundary checkbox boolean reads normalize without accepting boolean mutation requests',()=>{
 const f=fixture(),{edges}=addBoundaryControls(f);edges.boundaryTopFade.value=true;edges.boundaryBottomFade.value=false;const r=f.read();assert.equal(r.boundaryTopFade.value,1);assert.equal(r.boundaryBottomFade.value,0);
 const next=f.edit(r,{parameter:'boundaryTopFade',value:0});assert.equal(next.readbackVerified,true,next.error);assert.equal(edges.boundaryTopFade.value,0);assert.equal(next.boundaryBottomFade.value,0);
});

test('Premiere empty checkbox display names resolve only within verified native edge metadata',()=>{
 const f=fixture(),{edges}=addBoundaryControls(f);for(const side of ['Top','Bottom','Left','Right']){edges[`boundary${side}Fade`].displayName='';edges[`boundary${side}Fade`].value=true;}
 let r=f.read();assert.equal(r.ok,true,r.error);assert.equal(r.boundaryRightFade.value,1);r=f.edit(r,{parameter:'boundaryRightFade',value:0});assert.equal(r.readbackVerified,true,r.error);assert.equal(edges.boundaryRightFade.value,0);assert.equal(r.boundaryLeftFade.value,1);
 edges.boundaryTopAmount.displayName='';assert.match(f.read().error,/edge controls changed/);
});

test('unconfirmed native edits retain the bounded readback failure reason without retrying',()=>{
 const f=fixture(),before=f.read();f.groups.ignore=true;
 const result=f.edit(before,{parameter:'groups',value:2});
 assert.equal(result.code,'BC_OUTPUT_UNCONFIRMED');assert.equal(result.retry,'never');
 assert.match(result.error,/Native caption value readback failed/);
 assert.deepEqual(f.writes,[['Groups per page','set',2]]);
});

test('Visible lines 3 to 1 writes and reads the same native stream while preserving Groups per page',()=>{
 const f=fixture();f.groups.value=1;f.rollParams.rollUpLines.value=3;
 const before=f.read();assert.equal(before.rollUpLines.value,3);assert.equal(before.groups.value,1);
 const edited=f.edit(before,{parameter:'rollUpLines',value:1});assert.equal(edited.readbackVerified,true,edited.error);assert.equal(edited.rollUpLines.value,1);assert.equal(f.rollParams.rollUpLines.value,1);assert.equal(f.groups.value,1);
 assert.deepEqual(f.writes,[['Visible lines','set',1]]);
 f.rollParams.rollUpLines.value=3;assert.equal(f.read().rollUpLines.value,3);assert.equal(f.writes.length,1);
});

test('the lightweight connection revision fingerprints the document so a Premiere Undo of a text edit is noticed on the next poll',()=>{
 const f=fixture(),before=f.connections().native[0],original=f.doc.value;
 assert.match(JSON.parse(before.connectionRevision).documentFingerprint,/^\d+:[0-9a-f]+$/);
 f.doc.value='BCDOC1:424341500200000001000000';
 const changed=f.connections().native[0];assert.ok(changed,'the alternate document still connects');assert.notEqual(changed.connectionRevision,before.connectionRevision);
 f.doc.value=original;assert.equal(f.connections().native[0].connectionRevision,before.connectionRevision);
 const light=f.connections(false).native[0];
 assert.equal(light.documentText,undefined);assert.equal(JSON.parse(light.connectionRevision).documentFingerprint,JSON.parse(before.connectionRevision).documentFingerprint,'the lightweight poll carries the same fingerprint');
});


test('current line position remains optional on a binary that has the other scrolling controls',()=>{
 const f=fixture(),properties=f.clip.components[0].properties;
 properties.splice(properties.indexOf(f.rollParams.rollUpCurrentLine),1);
 const r=f.read();assert.equal(r.ok,true);assert.equal(r.rollUpCurrentLine,undefined);assert.equal(r.rollUpLines.value,2);
 assert.match(f.edit(r,{parameter:'rollUpCurrentLine',value:2}).error,/Update the native caption effect/);
 assert.deepEqual(f.writes,[]);assert.equal(f.edit(r,{parameter:'rollUpLines',value:3}).rollUpLines.value,3);
});

test('current line position key edits and navigation preserve visible lines and neighboring controls',()=>{
 const f=fixture(),p=f.rollParams.rollUpCurrentLine;p.animated=true;
 p.keys=[{ticks:ticks(31),value:1,interpolation:'hold'},{ticks:ticks(32),value:2,interpolation:'bezier'},{ticks:ticks(34),value:3,interpolation:'hold'}];
 const before=structuredClone(p.keys),document=f.doc.value,r=f.read();
 const edited=f.edit(r,{parameter:'rollUpCurrentLine',value:3});assert.equal(edited.readbackVerified,true);assert.equal(edited.rollUpCurrentLine.value,3);assert.equal(edited.rollUpLines.value,2);
 before[1].value=3;assert.deepEqual(p.keys,before);assert.deepEqual(f.writes,[['Current line position','key',ticks(32),3]]);
 const next=f.seek(edited,{parameter:'rollUpCurrentLine'});assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,ticks(14));assert.equal(next.rollUpCurrentLine.value,3);assert.equal(f.doc.value,document);assert.deepEqual(p.keys,before);
});


test('blank line length supports decimal edits, Auto reset, missing binaries and key navigation',()=>{
 const f=fixture(),p=f.rollParams.rollUpBlankLineSeconds;
 let r=f.read();assert.equal(r.rollUpBlankLineSeconds.value,0);assert.equal(r.rollUpBlankLineSeconds.defaultValue,0);
 r=f.edit(r,{parameter:'rollUpBlankLineSeconds',value:2.5});assert.equal(r.readbackVerified,true);assert.equal(r.rollUpBlankLineSeconds.value,2.5);
 r=f.edit(r,{parameter:'rollUpBlankLineSeconds',operation:'reset',value:undefined});assert.equal(r.rollUpBlankLineSeconds.value,0);
 p.animated=true;p.keys=[{ticks:ticks(31),value:0,interpolation:'hold'},{ticks:ticks(32),value:2,interpolation:'bezier'},{ticks:ticks(34),value:4,interpolation:'hold'}];
 const document=f.doc.value,before=structuredClone(p.keys);r=f.read();r=f.edit(r,{parameter:'rollUpBlankLineSeconds',value:2.5});before[1].value=2.5;assert.deepEqual(p.keys,before);
 const next=f.seek(r,{parameter:'rollUpBlankLineSeconds'});assert.equal(next.readbackVerified,true);assert.equal(next.timelineTicks,ticks(14));assert.equal(next.rollUpBlankLineSeconds.value,4);assert.equal(f.doc.value,document);
 const properties=f.clip.components[0].properties;properties.splice(properties.indexOf(p),1);r=f.read();assert.equal(r.ok,true);assert.equal(r.rollUpBlankLineSeconds,undefined);
 assert.match(f.edit(r,{parameter:'rollUpBlankLineSeconds',value:2}).error,/Update the native caption effect/);
});
