import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGeometryController,nativeGeometryLayer} from '../webview-ui/src/lib/native-effect/geometry-controller.ts';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function receipt(revision='r0',width=600){const d=value=>({value,defaultValue:value,animated:false,keyframesSupported:true,hasKey:false,keys:[]});return{ok:true,revision,clipNodeId:'clip',timelineTicks:'254016000000',sourceTicks:'254016000000',insideClip:true,clock:'clip-source',startTicks:'0',endTicks:'900000000000',inTicks:'0',outTicks:'900000000000',position:d([.5,.9]),width:d(width),height:d(150)};}
function fixture(edit){let context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'document'},visible:true,disabled:false};const states=[],errors=[];let reads=0;const c=createNativeGeometryController({current:()=>context,read:async()=>{reads++;return receipt();},edit,state:s=>states.push(s),error:e=>errors.push(e)});return{c,states,errors,get reads(){return reads;},set context(v){context={...context,...v};}};}
test('native geometry drag serializes host writes and coalesces to the latest value using confirmed revisions',async()=>{
 const calls=[],wait=deferred();let active=0,maxActive=0;const f=fixture(async(s,r)=>{calls.push(r);active++;maxActive=Math.max(maxActive,active);if(calls.length===1)await wait.promise;active--;return{...receipt('r'+calls.length,r.value),readbackVerified:true};});
 await f.c.read();f.c.setDragging(true);await tick();f.c.queue('width',610);f.c.queue('width',620);f.c.queue('width',630);await f.c.read();assert.equal(f.reads,2);
 wait.resolve();await tick();await tick();assert.equal(maxActive,1);assert.deepEqual(calls.map(r=>r.value),[610,630]);assert.deepEqual(calls.map(r=>r.revision),['r0','r1']);assert.equal(f.states.at(-1).width.value,630);f.c.dispose();
});
test('stale geometry replies cannot replace a new caption and reset sends no invented value',async()=>{
 const pending=deferred(),calls=[];const f=fixture(async(s,r)=>{calls.push(r);return pending.promise;});await f.c.read();f.c.queue('height');assert.equal(calls[0].operation,'reset');assert.equal(Object.hasOwn(calls[0],'value'),false);
 f.context={key:'new'};await f.c.read();pending.resolve({...receipt('old',555),readbackVerified:true});await tick();assert.equal(f.states.at(-1),null);await f.c.read();assert.equal(f.states.at(-1).revision,'r0');f.c.dispose();
});
test('unconfirmed geometry mutations stop queued changes without retrying; hidden or outside clips cannot edit',async()=>{
 let writes=0;const f=fixture(async()=>{writes++;throw Object.assign(new Error('uncertain'),{code:'BC_OUTPUT_UNCONFIRMED'});});await f.c.read();f.c.queue('width',500);f.c.queue('width',400);await tick();f.c.queue('width',300);await tick();assert.equal(writes,1);assert.match(f.errors.at(-1),/could not confirm/);
 f.context={key:'new',visible:false};await f.c.read();f.c.queue('width',200);assert.equal(writes,1);f.c.dispose();
});
test('previous/next availability uses exact timeline ticks and ignores trimmed-away source keys',async()=>{
 const {canSeekGeometryKeyframe}=await import('../webview-ui/src/lib/native-effect/geometry-controller.ts');
 const r=receipt();Object.assign(r,{startTicks:'90071992547409930',endTicks:'90071992547410030',inTicks:'90071992547410130',timelineTicks:'90071992547409980'});
 Object.assign(r.width,{animated:true,keys:[{ticks:'90071992547410129',value:1},{ticks:'90071992547410180',value:2},{ticks:'90071992547410230',value:3}]});
 assert.equal(canSeekGeometryKeyframe(r,'width','previous'),false);assert.equal(canSeekGeometryKeyframe(r,'width','next'),false);
 r.width.keys.push({ticks:'90071992547410140',value:4},{ticks:'90071992547410220',value:5});assert.equal(canSeekGeometryKeyframe(r,'width','previous'),true);assert.equal(canSeekGeometryKeyframe(r,'width','next'),true);
 assert.equal(canSeekGeometryKeyframe(r,'position','next'),false);
});

test('keyframe click during an active polling read waits once and executes the latest navigation',async()=>{
 const wait=deferred(),calls=[],states=[],errors=[];let reads=0;
 const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():wait.promise,edit:async()=>{throw new Error('unexpected edit');},seek:async(s,r)=>{calls.push(r);return{...receipt('after'),timelineTicks:'508032000000',readbackVerified:true};},state:r=>states.push(r),error:e=>errors.push(e)});
 await c.read();const polling=c.read();const superseded=c.seek('width','previous'),latest=c.seek('width','next');
 assert.equal(await superseded,null);assert.deepEqual(calls,[]);wait.resolve(receipt());await polling;
 const result=await latest;assert.equal(result.timelineTicks,'508032000000');assert.equal(calls.length,1);assert.equal(calls[0].direction,'next');assert.equal(calls[0].revision,'r0');assert.equal(calls[0].atTicks,'254016000000');assert.equal(reads,2);assert.equal(states.at(-1),result);c.dispose();
});

test('queued navigation cancels when polling discovers another playhead or controls revision',async()=>{
 for(const replacement of [{...receipt(),timelineTicks:'508032000000'},receipt('new-controls')]){
  const wait=deferred(),calls=[],errors=[];let reads=0;const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
  const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():wait.promise,edit:async()=>{},seek:async(s,r)=>{calls.push(r);return{...receipt(),readbackVerified:true};},state:()=>{},error:e=>errors.push(e)});
  await c.read();const polling=c.read(),navigation=c.seek('width','previous');wait.resolve(replacement);await polling;
  assert.equal(await navigation,null);assert.deepEqual(calls,[]);assert.match(errors.at(-1),/playhead or caption controls changed/);c.dispose();
 }
});

test('a new clip/document or a manual mutation cancels queued navigation behind a read',async()=>{
 for(const action of ['switch','document','edit','dispose']){
  const wait=deferred(),seeks=[],edits=[];let reads=0,context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
  const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():wait.promise,edit:async(s,r)=>{edits.push(r);return{...receipt('edited',r.value),readbackVerified:true};},seek:async(s,r)=>{seeks.push(r);return{...receipt(),readbackVerified:true};},state:()=>{},error:()=>{}});
  await c.read();const polling=c.read(),navigation=c.seek('width','next');
  if(action==='switch')context={...context,key:'other'};
  if(action==='document')context={...context,snapshot:{...context.snapshot,revision:'other-document'}};
  if(action==='edit')c.queue('width',700);
  if(action==='dispose')c.dispose();
  wait.resolve(receipt());await polling;assert.equal(await navigation,null);await tick();assert.deepEqual(seeks,[]);assert.equal(edits.length,action==='edit'?1:0);c.dispose();
 }
});

test('failed polling read cancels queued navigation without seek retries',async()=>{
 const wait=deferred(),calls=[];let reads=0;const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():wait.promise,edit:async()=>{},seek:async(s,r)=>{calls.push(r);throw new Error('seek failed');},state:()=>{},error:()=>{}});
 await c.read();const polling=c.read(),navigation=c.seek('width','previous');wait.reject(new Error('read failed'));await polling;assert.equal(await navigation,null);assert.deepEqual(calls,[]);
 assert.equal(await c.seek('width','next'),null);assert.equal(calls.length,1);await tick();assert.equal(calls.length,1);c.dispose();
});

test('a pointer gesture refreshes the timeline clock before streaming its first coalesced edit',async()=>{
 const refresh=deferred(),calls=[];let reads=0;const initial=receipt(),fresh={...receipt('fresh'),timelineTicks:'508032000000',sourceTicks:'508032000000'};
 const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?initial:refresh.promise,edit:async(s,r)=>{calls.push(r);return{...fresh,readbackVerified:true};},state:()=>{},error:()=>{}});
 await c.read();c.setDragging(true);c.queue('width',610);c.queue('width',650);assert.deepEqual(calls,[]);refresh.resolve(fresh);await tick();await tick();assert.equal(reads,2);assert.equal(calls.length,1);assert.equal(calls[0].value,650);assert.equal(calls[0].revision,'fresh');assert.equal(calls[0].atTicks,'508032000000');c.dispose();
});
test('failed pre-gesture refresh drops queued values instead of writing with an obsolete receipt',async()=>{
 const refresh=deferred(),writes=[];let reads=0;const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():refresh.promise,edit:async(s,r)=>{writes.push(r);return{...receipt(),readbackVerified:true};},state:()=>{},error:()=>{}});
 await c.read();c.setDragging(true);c.queue('width',500);refresh.reject(new Error('playhead moved'));await tick();await tick();assert.deepEqual(writes,[]);c.dispose();
});
test('position-axis edits compose against the latest confirmed other axis, including values queued behind a fresh read',async()=>{
 const refresh=deferred(),first=deferred(),calls=[];let reads=0;
 const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const fresh=receipt('fresh');fresh.position.value=[.7,.8];
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():refresh.promise,edit:async(s,r)=>{calls.push(r);if(calls.length===1)await first.promise;const next=receipt('edit'+calls.length);next.position.value=r.value;return{...next,readbackVerified:true};},state:()=>{},error:()=>{}});
 await c.read();c.setDragging(true);c.queuePositionAxis(1,.4);refresh.resolve(fresh);await tick();assert.deepEqual(calls[0].value,[.7,.4]);c.queuePositionAxis(0,.9);first.resolve();await tick();await tick();assert.deepEqual(calls[1].value,[.9,.4]);c.dispose();
});
test('typed geometry edits older than 250ms refresh once before mutation without replaying a setter',async()=>{
 let clock=1000,reads=0;const refresh=deferred(),calls=[];const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,now:()=>clock,read:async()=>++reads===1?receipt():refresh.promise,edit:async(s,r)=>{calls.push(r);return{...receipt('after'),readbackVerified:true};},state:()=>{},error:()=>{}});
 await c.read();clock=1500;c.queue('height',180);assert.deepEqual(calls,[]);refresh.resolve(receipt('fresh'));await tick();await tick();assert.equal(reads,2);assert.equal(calls.length,1);assert.equal(calls[0].revision,'fresh');c.dispose();
});

test('interaction priority stays active through the final coalesced write after pointer release',async()=>{
 const final=deferred(),phases=[],calls=[];let context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>receipt(),edit:async(s,r)=>{calls.push(r);if(calls.length===1)await final.promise;return{...receipt('done'+calls.length,r.value),readbackVerified:true};},state:()=>{},error:()=>{},interacting:active=>phases.push(active)});
 await c.read();assert.deepEqual(phases,[]);c.setDragging(true);await tick();c.queue('width',610);c.queue('width',650);c.setDragging(false);assert.deepEqual(phases,[true]);
 final.resolve();await tick();await tick();assert.deepEqual(calls.map(r=>r.value),[610,650]);assert.deepEqual(phases,[true,false]);c.dispose();
});

test('polling automatically adopts actual Premiere state after an unconfirmed groups write without replaying it',async()=>{
 const calls=[],states=[],errors=[];let reads=0;
 const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const actual={...receipt('actual'),groups:{...receipt().width,value:2},rollUpLines:{...receipt().width,value:3}};
 const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():actual,edit:async(s,r)=>{calls.push(r);if(calls.length===1)throw Object.assign(new Error('Native caption value readback failed.'),{code:'BC_OUTPUT_UNCONFIRMED'});return{...actual,readbackVerified:true};},state:s=>states.push(s),error:e=>errors.push(e)});
 await c.read();c.queue('groups',2);c.queue('groups',4);await tick();
 assert.match(errors.at(-1),/Native caption value readback failed/);assert.match(errors.at(-1),/Syncing/);
 c.queue('groups',5);assert.equal(calls.length,1);
 await c.read();assert.equal(states.at(-1).groups.value,2);assert.equal(states.at(-1).rollUpLines.value,3);assert.equal(errors.at(-1),'');assert.equal(calls.length,1);
 c.queue('groups',3);await tick();assert.equal(calls.length,2);assert.equal(calls[1].revision,'actual');assert.equal(calls[1].value,3);c.dispose();
});

test('failed reconciliation reads keep writes blocked until a later polling read succeeds',async()=>{
 let reads=0,writes=0;const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const errors=[];const c=createNativeGeometryController({current:()=>context,read:async()=>{if(++reads===2)throw new Error('Premiere is busy');return receipt('r'+reads);},edit:async()=>{writes++;throw Object.assign(new Error('ignored setter'),{code:'BC_OUTPUT_UNCONFIRMED'});},state:()=>{},error:e=>errors.push(e)});
 await c.read();c.queue('groups',2);await tick();await c.read();assert.equal(errors.at(-1),'Premiere is busy');c.queue('groups',3);assert.equal(writes,1);assert.equal(reads,2);
 await c.read();assert.equal(errors.at(-1),'');assert.equal(writes,1);assert.equal(reads,3);c.dispose();
});

test('reconciliation cannot publish another clip or obsolete document and never drains old writes',async()=>{
 for(const changed of ['clip','document','dispose']){
  const wait=deferred(),states=[];let reads=0,writes=0,context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
  const c=createNativeGeometryController({current:()=>context,read:async()=>++reads===1?receipt():wait.promise,edit:async()=>{writes++;throw Object.assign(new Error('uncertain'),{code:'BC_OUTPUT_UNCONFIRMED'});},state:s=>states.push(s),error:()=>{}});
  await c.read();c.queue('groups',2);c.queue('groups',3);await tick();const polling=c.read();c.queue('groups',4);
  if(changed==='document')context={...context,key:'new-document'};if(changed==='dispose')c.dispose();
  wait.resolve({...receipt('reconciled'),...(changed==='clip'?{clipNodeId:'wrong'}:{})});await polling;await tick();
  assert.equal(states.at(-1).revision,'r0');assert.equal(writes,1);c.dispose();
 }
});

test('Effect Controls changes to Visible lines stay synced by the existing periodic reads',async()=>{
 let actual={...receipt(),rollUpLines:{...receipt().width,value:2}};const states=[];
 const context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false};
 const c=createNativeGeometryController({current:()=>context,read:async()=>actual,edit:async()=>{throw Error('No writes expected');},state:s=>states.push(s),error:()=>{}});
 await c.read();actual={...actual,revision:'effect-controls',rollUpLines:{...actual.rollUpLines,value:3}};await c.read();assert.equal(states.at(-1).rollUpLines.value,3);c.dispose();
});

function layered(options={}){
 const at=(revision,clipNodeId='clip',sequenceId='sequence',projectPath='/p.prproj')=>{const snapshot={locator:{projectPath,sequenceId,clipNodeId},revision};return{key:JSON.stringify([sequenceId,snapshot.locator,revision]),layer:nativeGeometryLayer(sequenceId,snapshot),sequenceId,snapshot,visible:true,disabled:false};};
 const f={context:at('doc1'),at,states:[],errors:[],reads:[],edits:[],seeks:[],get since(){return f.states.slice(f.mark);},mark:0};
 f.c=createNativeGeometryController({current:()=>f.context,read:async s=>{f.reads.push(s.revision);return options.read?options.read(s,f):receipt('controls-'+s.revision);},edit:async(s,r)=>{f.edits.push({doc:s.revision,...r});return options.edit?options.edit(s,r,f):{...receipt('edited',r.value),readbackVerified:true};},seek:async(s,r)=>{f.seeks.push(r);return{...receipt(),readbackVerified:true};},state:s=>f.states.push(s),error:e=>f.errors.push(e)});
 return f;
}
test('a new document revision of the same layer keeps the confirmed controls on screen and refreshes them itself',async()=>{
 const wait=deferred();const f=layered({read:(s,f)=>f.reads.length===1?receipt('controls-doc1'):wait.promise});
 await f.c.read();f.mark=f.states.length;assert.equal(f.states.at(-1).revision,'controls-doc1');
 f.context=f.at('doc2');const reread=f.c.read();
 assert.deepEqual(f.since,[]);assert.deepEqual(f.reads,['doc1','doc2']);
 wait.resolve({...receipt('controls-doc2'),width:{...receipt().width,value:640}});await reread;
 assert.equal(f.since.length,1);assert.equal(f.since[0].revision,'controls-doc2');assert.equal(f.since[0].width.value,640);f.c.dispose();
});
test('an edit queued across a revision change never writes with the old revision or clock and then uses the fresh receipt',async()=>{
 const wait=deferred();const f=layered({read:(s,f)=>f.reads.length===1?receipt('controls-doc1'):wait.promise});
 await f.c.read();f.mark=f.states.length;f.context=f.at('doc2');f.c.queue('width',700);await tick();
 assert.deepEqual(f.edits,[]);assert.deepEqual(f.reads,['doc1','doc2']);assert.deepEqual(f.since,[]);
 wait.resolve({...receipt('controls-doc2'),timelineTicks:'508032000000'});await tick();await tick();
 assert.equal(f.edits.length,1);assert.equal(f.edits[0].doc,'doc2');assert.equal(f.edits[0].revision,'controls-doc2');assert.equal(f.edits[0].atTicks,'508032000000');assert.equal(f.edits[0].value,700);
 assert.equal(f.since.includes(null),false);assert.equal(f.since.at(-1).width.value,700);f.c.dispose();
});
test('late replies from the old revision are ignored and the controller rereads the new one once idle',async()=>{
 for(const kind of ['read','edit']){
  const old=deferred();const f=layered({read:(s,f)=>kind==='read'&&f.reads.length===2?old.promise:receipt('controls-'+s.revision),edit:()=>old.promise});
  await f.c.read();if(kind==='read')void f.c.read();else f.c.queue('width',650);
  await tick();f.mark=f.states.length;f.context=f.at('doc2');
  void f.c.read();assert.deepEqual(f.since,[]);
  old.resolve({...receipt('controls-old',111),readbackVerified:true});await tick();await tick();
  assert.equal(f.since.some(s=>s?.revision==='controls-old'),false);assert.equal(f.reads.at(-1),'doc2');assert.equal(f.since.length,1);assert.equal(f.since[0].revision,'controls-doc2');assert.equal(f.edits.filter(e=>e.doc==='doc2').length,0);f.c.dispose();
 }
});
test('keyframe steps queued across a revision change are cancelled, not run on the old receipt',async()=>{
 const wait=deferred();const f=layered({read:(s,f)=>f.reads.length===1?receipt('controls-doc1'):wait.promise});
 await f.c.read();const polling=f.c.read();const step=f.c.seek('width','next');f.context=f.at('doc2');f.c.queue('width',600);
 assert.equal(await step,null);wait.resolve(receipt('controls-doc1'));await polling;await tick();await tick();assert.deepEqual(f.seeks,[]);f.c.dispose();
});
test('switching clip, sequence or project clears the controls and drops queued edits',async()=>{
 for(const next of [['doc2','other-clip'],['doc2','clip','other-sequence'],['doc2','clip','sequence','/other.prproj']]){
  const wait=deferred();const f=layered({read:(s,f)=>f.reads.length===1?receipt('controls-doc1'):wait.promise.then(r=>({...r,clipNodeId:s.locator.clipNodeId})),edit:(s,r)=>wait.promise.then(()=>({...receipt('stale-edit',r.value),readbackVerified:true}))});
  await f.c.read();f.c.queue('width',700);assert.equal(f.edits.length,1);f.mark=f.states.length;f.context=f.at(...next);
  void f.c.read();assert.deepEqual(f.since,[null]);
  wait.resolve(receipt('controls-new'));await tick();await tick();assert.deepEqual(f.since,[null]);
  await f.c.read();assert.equal(f.edits.length,1);assert.equal(f.since.at(-1).revision,'controls-new');f.c.dispose();
 }
});
test('across a revision change a sent setter is never replayed; only the unsent latest value writes, after a fresh same-layer read',async()=>{
 for(const outcome of ['confirmed','unconfirmed','failed']){
  const sent=deferred(),fresh=deferred();const f=layered({read:(s,f)=>f.reads.length===1?receipt('controls-doc1'):fresh.promise,edit:(s,r,f)=>f.edits.length===1?sent.promise:{...receipt('edited',r.value),readbackVerified:true}});
  await f.c.read();f.c.queue('width',700);f.c.queue('width',710);assert.deepEqual(f.edits.map(e=>e.value),[700]);
  f.context=f.at('doc2');f.c.read();
  if(outcome==='confirmed')sent.resolve({...receipt('controls-old',700),readbackVerified:true});
  else sent.reject(outcome==='unconfirmed'?Object.assign(new Error('uncertain'),{code:'BC_OUTPUT_UNCONFIRMED'}):new Error('setter failed'));
  await tick();await tick();assert.deepEqual(f.edits.map(e=>e.value),[700]);assert.deepEqual(f.reads,['doc1','doc2']);assert.deepEqual(f.errors.filter(Boolean),[]);
  fresh.resolve(receipt('controls-doc2'));await tick();await tick();await tick();
  assert.deepEqual(f.edits.map(e=>e.value),[700,710]);assert.equal(f.edits[1].doc,'doc2');assert.equal(f.edits[1].revision,'controls-doc2');
  await tick();await tick();assert.equal(f.edits.length,2);f.c.dispose();
 }
});
test('a revision change on a hidden or disabled panel waits without a read loop and drops queued values',async()=>{
 for(const off of [{visible:false},{disabled:true}]){
  const sent=deferred();const f=layered({edit:(s,r,f)=>f.edits.length===1?sent.promise:{...receipt('edited',r.value),readbackVerified:true}});
  await f.c.read();f.c.queue('width',700);f.c.queue('width',710);f.context={...f.at('doc2'),...off};f.c.read();
  sent.resolve({...receipt('controls-old',700),readbackVerified:true});for(let i=0;i<6;i++)await tick();
  assert.deepEqual(f.reads,['doc1']);assert.equal(f.edits.length,1);
  f.context=f.at('doc2');await f.c.read();await tick();assert.deepEqual(f.reads,['doc1','doc2']);assert.equal(f.edits.length,1);f.c.dispose();
 }
});
test('a failing fresh read after a revision change does not retry in a loop or let the queued value write',async()=>{
 const f=layered({read:(s,f)=>{if(f.reads.length===1)return receipt('controls-doc1');throw new Error('Premiere is busy');}});
 await f.c.read();f.context=f.at('doc2');f.c.queue('width',700);for(let i=0;i<6;i++)await tick();
 assert.deepEqual(f.reads,['doc1','doc2']);assert.deepEqual(f.edits,[]);assert.equal(f.errors.at(-1),'Premiere is busy');f.c.dispose();
});
