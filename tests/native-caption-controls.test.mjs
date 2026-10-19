import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),acorn=require('../webview-ui/node_modules/acorn');
const source=fs.readFileSync(new URL('../cep/host/bridge.jsx',import.meta.url),'utf8');
const T=254016000000n, ticks=s=>String(BigInt(s)*T);
const collection=(a,key='numItems')=>Object.defineProperty(a,key,{get:()=>a.length,configurable:true});
const rollControls=[['rollUp','Roll-up enabled',0],['rollUpLines','Visible lines',2],['rollUpDuration','Scroll duration',.18],['rollUpFade','Soft fade boundary',1],['rollUpFadePosition','Boundary position',0],['rollUpFadeThickness','Transition thickness',.35],['rollUpFadeAmount','Fade amount',1],['rollUpFadeCurve','Transition curve',2],['rollUpDirection','Scroll direction',1],['rollUpSpeed','Scroll speed',1],['rollUpWait','Wait for line to finish',1],['rollUpTransition','Line transition',1]];

function fixture(){
 const files=new Map(),writes=[],seeks=[];let at=ticks(12),locked=false;
 function parameter(name,value){
  return {displayName:name,value,animated:false,keys:[],isTimeVarying(){return this.animated;},areKeyframesSupported:()=>true,getValue(){this.onRead?.();return this.value;},getKeys(){return this.keys.map(k=>({ticks:k.ticks}));},
   getValueAtKey(t){return this.keys.find(k=>k.ticks===t.ticks).value;},getValueAtTime(t){this.lastSample=t.ticks;return this.keys.find(k=>k.ticks===t.ticks)?.value??this.keys[0].value;},
   setValue(v){writes.push([name,'set',v]);if(!this.ignore)this.value=v;},addKey(t){writes.push([name,'add',t.ticks]);this.keys.push({ticks:t.ticks,value:this.getValueAtTime(t),interpolation:'default'});},
   setValueAtKey(t,v){writes.push([name,'key',t.ticks,v]);if(!this.ignore)this.keys.find(k=>k.ticks===t.ticks).value=v;},};
 }
 const position=parameter('Position',[.5,.9]),width=parameter('Width',1536),height=parameter('Height',150),groups=parameter('Groups per page',1),smartFit=parameter('Smart line fit',0),alignment=parameter('Text alignment',2),fontSize=parameter('Global font size (64 = 1x)',64),doc=parameter('Caption document (experimental)','BCDOC1:424341500200000000000000');
 const rollParams=Object.fromEntries(rollControls.map(([key,label,value])=>[key,parameter(label,value)]));
 const clip={nodeId:'clip',projectItem:{nodeId:'item',getMediaPath:()=>''},start:{ticks:ticks(10)},end:{ticks:ticks(15)},inPoint:{ticks:ticks(30)},outPoint:{ticks:ticks(35)},isAdjustmentLayer:()=>true,isSelected:()=>true,getSpeed:()=>1,isSpeedReversed:()=>false,
  components:collection([{matchName:'AE.com.swen.bettercaptions.native.experimental',properties:collection([position,width,height,doc,groups,fontSize,smartFit,...Object.values(rollParams),alignment])}])};
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
 return {parameter,read,edit,seek,seeks,snapshot,position,width,height,groups,smartFit,alignment,fontSize,rollParams,connections:()=>call('readCaptionConnections',{includeDocuments:true,knownLinks:[],generatedRoot:'/project/Better Captions/seq-a'}),doc,clip,seq,project,writes,set at(v){at=v;},set locked(v){locked=v;}};
}

test('native control bridge remains ExtendScript ES3 compatible',()=>{acorn.parse(source,{ecmaVersion:3});});
test('production-sized native controls use one property/name bridge pass per independently checked context',()=>{
 const f=fixture();f.smartFit.value=1;smartWordStates(f);
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
 // Before, immediate preflight, and independent post-setter verification all
 // rescan. No cross-context metadata cache is allowed to mask outside edits.
 assert.equal(labels,3*properties.length);assert.equal(indexReads,3*properties.length);assert.equal(countReads,3);
 assert.deepEqual(f.writes,[['Width','set',600]]);assert.equal(after.smartFit.value,1);
});
test('one-pass lookup still detects parameter label replacement between preflight and mutation',()=>{
 const f=fixture(),r=f.read();let reads=0;
 f.width.onRead=()=>{if(++reads===1)f.clip.components[0].properties.push(f.width);};
 const after=f.edit(r);assert.match(after.error,/Ambiguous/);assert.deepEqual(f.writes,[]);
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


test('Smart line fit edits only its scalar and exposes geometry metadata without rewriting document or character count',()=>{
 const f=fixture(),r=f.read(),doc=f.doc.value,initial=f.connections().native[0];
 assert.equal(r.smartFit.value,0);assert.equal(r.smartFit.defaultValue,0);assert.equal(initial.smartLineFit,false);assert.equal(initial.lineFitWidth,undefined);assert.equal(initial.lineFitFontScale,undefined);
 const changed=f.edit(r,{parameter:'smartFit',value:1});assert.equal(changed.readbackVerified,true);assert.equal(changed.smartFit.value,1);assert.equal(f.doc.value,doc);
 assert.deepEqual(changed.position,r.position);assert.deepEqual(changed.width,r.width);assert.deepEqual(changed.height,r.height);assert.deepEqual(changed.groups,r.groups);
 const enabled=f.connections().native[0];assert.equal(enabled.smartLineFit,true);assert.equal(enabled.lineFitWidth,1536);assert.equal(enabled.lineFitFontScale,1);assert.notEqual(enabled.connectionRevision,initial.connectionRevision);assert.equal(enabled.revision,initial.revision);
 const reset=f.edit(changed,{parameter:'smartFit',operation:'reset',value:undefined});assert.equal(reset.smartFit.value,0);assert.deepEqual(f.writes,[['Smart line fit','set',1],['Smart line fit','set',0]]);assert.equal(f.fontSize.value,64);assert.equal(f.doc.value,doc);
});

test('Smart line fit accepts native boolean or interpolated reads but exact numeric zero/one setters only',()=>{
 for(const [value,expected] of [[false,0],[true,1],[.49,0],[.5,1],[1,1]]){const f=fixture();f.smartFit.value=value;const r=f.read();assert.equal(r.smartFit.value,expected);assert.equal(f.connections().native[0].smartLineFit,!!expected);}
 for(const value of [false,true,.5,-1,2,NaN,'1']){const f=fixture(),r=f.read();assert.ok(f.edit(r,{parameter:'smartFit',value}).error);assert.deepEqual(f.writes,[]);}
 for(const value of [-1,2,'1']){const f=fixture();f.smartFit.value=value;assert.ok(f.read().error);assert.deepEqual(f.writes,[]);}
});

test('smart grouping metadata samples animated fit, width and font size in the exact clip-source clock',()=>{
 const f=fixture();f.smartFit.animated=true;f.smartFit.keys=[{ticks:ticks(30),value:0},{ticks:ticks(32),value:.75}];
 f.width.animated=true;f.width.keys=[{ticks:ticks(30),value:800},{ticks:ticks(32),value:640}];
 f.fontSize.animated=true;f.fontSize.keys=[{ticks:ticks(30),value:64},{ticks:ticks(32),value:96}];
 const before=structuredClone({fit:f.smartFit.keys,width:f.width.keys,font:f.fontSize.keys}),record=f.connections().native[0];
 assert.equal(record.smartLineFit,true);assert.equal(record.lineFitWidth,640);assert.equal(record.lineFitFontScale,1.5);assert.equal(f.smartFit.lastSample,ticks(32));assert.equal(f.width.lastSample,ticks(32));assert.equal(f.fontSize.lastSample,ticks(32));
 const revision=JSON.parse(record.connectionRevision);assert.equal(revision.smartLineFit,true);assert.equal(revision.lineFitWidth,640);assert.equal(revision.lineFitFontScale,1.5);
 f.width.keys[1].value=600;const narrower=f.connections().native[0];assert.notEqual(narrower.connectionRevision,record.connectionRevision);assert.equal(narrower.revision,record.revision);f.width.keys[1].value=640;
 assert.deepEqual({fit:f.smartFit.keys,width:f.width.keys,font:f.fontSize.keys},before);assert.deepEqual(f.writes,[]);
});

test('old native binaries expose Smart line fit off without making its missing control writable',()=>{
 const f=fixture(),properties=f.clip.components[0].properties;properties.splice(properties.indexOf(f.smartFit),1);
 const r=f.read();assert.equal(r.ok,true);assert.equal(r.smartFit,undefined);const record=f.connections().native[0];assert.equal(record.smartLineFit,false);assert.equal(record.lineFitWidth,undefined);
 assert.match(f.edit(r,{parameter:'smartFit',value:1}).error,/Update the native caption effect/);assert.deepEqual(f.writes,[]);
});

test('smart grouping discovery rejects ambiguous controls or a playhead change while sampling',()=>{
 const f=fixture();f.clip.components[0].properties.push(f.smartFit);assert.ok(f.connections().warnings.length);assert.equal(f.connections().native.length,0);
 const h=fixture();h.smartFit.value=1;h.width.onRead=()=>{h.at=ticks(13);};assert.match(h.read().error,/playhead moved/);assert.deepEqual(h.writes,[]);
});


test('native scrolling controls expose exact defaults and isolated set/reset preserves document, geometry and other settings',()=>{
 const f=fixture(),document=f.doc.value,originalTiming=structuredClone([f.clip.start,f.clip.end,f.clip.inPoint,f.clip.outPoint]);let r=f.read();
 for(const [key,,value] of rollControls){assert.equal(r[key].value,value,key);assert.equal(r[key].defaultValue,value,key);}
 const values=[1,3,.3,0,.2,.5,.7,4,3,2,0,4];
 for(let index=0;index<rollControls.length;index++){
  const [key,label,defaultValue]=rollControls[index],before=structuredClone(r),after=f.edit(r,{parameter:key,value:values[index]});
  assert.equal(after.readbackVerified,true,key);assert.equal(after[key].value,values[index],key);
  for(const other of ['position','width','height','groups','smartFit',...rollControls.map(row=>row[0])])if(other!==key)assert.deepEqual(after[other],before[other],other);
  r=f.edit(after,{parameter:key,operation:'reset',value:undefined});assert.equal(r[key].value,defaultValue,key);assert.equal(f.doc.value,document);
  assert.deepEqual(f.writes.slice(-2),[[label,'set',values[index]],[label,'set',defaultValue]]);
 }
 assert.deepEqual([f.clip.start,f.clip.end,f.clip.inPoint,f.clip.outPoint],originalTiming);
});

test('native scrolling reads interpolate on the clip-source clock while line and curve values quantize',()=>{
 const f=fixture(),values=[.75,2.7,.24,false,.2,.4,.6,2.7,3.6,1.2,.2,3.6];
 for(let index=0;index<rollControls.length;index++){
  const [key,,value]=rollControls[index],p=f.rollParams[key];p.animated=true;p.keys=[{ticks:ticks(30),value,interpolation:'hold'},{ticks:ticks(32),value:values[index],interpolation:'bezier'}];
 }
 const before=structuredClone(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys]))),r=f.read();
 const expected=[1,3,.24,0,.2,.4,.6,3,4,1.2,0,4];
 for(let index=0;index<rollControls.length;index++){const [key]=rollControls[index];assert.equal(r[key].value,expected[index],key);assert.equal(r[key].animated,true);assert.equal(r[key].hasKey,true);assert.equal(f.rollParams[key].lastSample,ticks(32));}
 assert.deepEqual(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys])),before);assert.deepEqual(f.writes,[]);
 const after=f.edit(r,{parameter:'rollUpFadeThickness',value:.55});assert.equal(after.readbackVerified,true);before.rollUpFadeThickness[1].value=.55;assert.deepEqual(Object.fromEntries(Object.entries(f.rollParams).map(([key,p])=>[key,p.keys])),before);assert.deepEqual(f.writes,[['Transition thickness','key',ticks(32),.55]]);
});

test('scroll settings enforce boolean, integer, fraction, seconds and speed limits before writes',()=>{
 const invalid={rollUp:[true,.5,2],rollUpLines:[0,9,1.5],rollUpDuration:[-.01,2.1],rollUpFade:[false,.5,2],rollUpFadePosition:[-.1,1.1],rollUpFadeThickness:[-.1,1.1],rollUpFadeAmount:[-.1,1.1],rollUpFadeCurve:[0,5,2.5],rollUpDirection:[0,5,2.5],rollUpSpeed:[0,.09,10.1],rollUpWait:[true,.5,2],rollUpTransition:[0,5,2.5]};
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


function smartWordStates(f,topics=true,order=['current','spoken','upcoming']){
 const names={current:'Current word',spoken:'Previously spoken words',upcoming:'Upcoming words'},settings={current:[150,1,200],spoken:[80,2,50],upcoming:[110,0,125]},states={};
 for(const name of order){
  const [size,bubble,padding]=settings[name];states[name]={size:f.parameter('Size, %',size),bubble:f.parameter('Word bubble',bubble),padding:f.parameter('Bubble padding, %',padding)};
  if(topics)f.clip.components[0].properties.push(f.parameter(names[name],0));
  f.clip.components[0].properties.push(...Object.values(states[name]));
 }
 return states;
}

test('smart grouping mirrors per-state size, popup modes and padding with topic labels or legacy flat control order',()=>{
 const expected={upcoming:{sizeScale:1.1,bubbleMode:1,paddingScale:1.25},current:{sizeScale:1.5,bubbleMode:2,paddingScale:2},spoken:{sizeScale:.8,bubbleMode:3,paddingScale:.5}};
 for(const topics of [true,false]){
  const f=fixture();f.smartFit.value=1;smartWordStates(f,topics);const oldDoc=f.doc.value,record=f.connections().native[0];
  assert.deepEqual(record.lineFitStates,expected);assert.deepEqual(JSON.parse(record.connectionRevision).lineFitStates,expected);assert.equal(f.doc.value,oldDoc);assert.deepEqual(f.writes,[]);
 }
 const f=fixture();f.smartFit.value=1;smartWordStates(f,true,['upcoming','current','spoken']);assert.deepEqual(f.connections().native[0].lineFitStates,expected,'topic names determine identity when headers exist');
});

test('per-state line-fit metadata uses the same exact animated source clock and changes only connection revision',()=>{
 const f=fixture();f.smartFit.value=1;const states=smartWordStates(f),document=f.doc.value;
 for(const s of Object.values(states))for(const [key,p] of Object.entries(s)){p.animated=true;let value=120;if(key==='bubble')value=1;if(key==='padding')value=60;p.keys=[{ticks:ticks(30),value:p.value},{ticks:ticks(32),value,interpolation:'bezier'}];}
 const keys=structuredClone(Object.fromEntries(Object.entries(states).map(([name,s])=>[name,Object.fromEntries(Object.entries(s).map(([key,p])=>[key,p.keys]))]))),before=f.connections().native[0];
 for(const state of Object.values(before.lineFitStates))assert.deepEqual(state,{sizeScale:1.2,bubbleMode:2,paddingScale:.6});
 for(const s of Object.values(states))for(const p of Object.values(s))assert.equal(p.lastSample,ticks(32));
 states.current.size.keys[1].value=180;const changed=f.connections().native[0];assert.equal(changed.lineFitStates.current.sizeScale,1.8);assert.notEqual(changed.connectionRevision,before.connectionRevision);assert.equal(changed.revision,before.revision);states.current.size.keys[1].value=120;
 assert.deepEqual(Object.fromEntries(Object.entries(states).map(([name,s])=>[name,Object.fromEntries(Object.entries(s).map(([key,p])=>[key,p.keys]))])),keys);assert.equal(f.doc.value,document);assert.deepEqual(f.writes,[]);
});

test('missing old state controls project document defaults while partial, ambiguous or invalid state controls are rejected',()=>{
 const f=fixture();f.smartFit.value=1;const defaults={sizeScale:1,bubbleMode:1,paddingScale:1};assert.deepEqual(f.connections().native[0].lineFitStates,{upcoming:defaults,current:defaults,spoken:defaults});
 const partial=fixture();partial.smartFit.value=1;partial.clip.components[0].properties.push(partial.parameter('Size, %',100));assert.match(partial.read().error,/complete native smart word-state/);assert.deepEqual(partial.writes,[]);
 for(const corrupt of [states=>{states.current.size.value=0;},states=>{states.spoken.padding.value=401;},states=>{states.upcoming.bubble.value=3;},states=>{states.upcoming.bubble.value=.5;}]){
  const h=fixture();h.smartFit.value=1;const states=smartWordStates(h);corrupt(states);assert.ok(h.read().error);assert.deepEqual(h.writes,[]);
 }
 const duplicate=fixture();duplicate.smartFit.value=1;const states=smartWordStates(duplicate);duplicate.clip.components[0].properties.push(states.upcoming.padding);assert.match(duplicate.read().error,/Ambiguous|complete/);assert.deepEqual(duplicate.writes,[]);
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
 for(const key of ['position','width','height','groups','smartFit',...rollControls.map(row=>row[0])])assert.deepEqual(center[key],r[key],key);
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
