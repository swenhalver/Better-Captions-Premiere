import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGeometryController} from '../webview-ui/src/lib/native-effect/geometry-controller.ts';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function receipt(revision='r0',width=600){const d=value=>({value,defaultValue:value,animated:false,keyframesSupported:true,hasKey:false,keys:[]});return{ok:true,revision,clipNodeId:'clip',timelineTicks:'254016000000',sourceTicks:'254016000000',insideClip:true,clock:'clip-source',startTicks:'0',endTicks:'900000000000',inTicks:'0',outTicks:'900000000000',position:d([.5,.9]),width:d(width),height:d(150)};}
function fixture(edit){let context={key:'one',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'document'},visible:true,disabled:false};const states=[],errors=[];let reads=0;const c=createNativeGeometryController({current:()=>context,read:async()=>{reads++;return receipt();},edit,state:s=>states.push(s),error:e=>errors.push(e)});return{c,states,errors,get reads(){return reads;},set context(v){context={...context,...v};}};}
test('native geometry drag serializes host writes and coalesces to the latest value using confirmed revisions',async()=>{
 const calls=[],wait=deferred();let active=0,maxActive=0;const f=fixture(async(s,r)=>{calls.push(r);active++;maxActive=Math.max(maxActive,active);if(calls.length===1)await wait.promise;active--;return{...receipt('r'+calls.length,r.value),readbackVerified:true};});
 await f.c.read();f.c.setDragging(true);f.c.queue('width',610);f.c.queue('width',620);f.c.queue('width',630);await f.c.read();assert.equal(f.reads,1);
 wait.resolve();await tick();await tick();assert.equal(maxActive,1);assert.deepEqual(calls.map(r=>r.value),[610,630]);assert.deepEqual(calls.map(r=>r.revision),['r0','r1']);assert.equal(f.states.at(-1).width.value,630);f.c.dispose();
});
test('stale geometry replies cannot replace a new caption and reset sends no invented value',async()=>{
 const pending=deferred(),calls=[];const f=fixture(async(s,r)=>{calls.push(r);return pending.promise;});await f.c.read();f.c.queue('height');assert.equal(calls[0].operation,'reset');assert.equal(Object.hasOwn(calls[0],'value'),false);
 f.context={key:'new'};await f.c.read();pending.resolve({...receipt('old',555),readbackVerified:true});await tick();assert.equal(f.states.at(-1),null);await f.c.read();assert.equal(f.states.at(-1).revision,'r0');f.c.dispose();
});
test('unconfirmed geometry mutations stop queued changes without retrying; hidden or outside clips cannot edit',async()=>{
 let writes=0;const f=fixture(async()=>{writes++;throw Object.assign(new Error('uncertain'),{code:'BC_OUTPUT_UNCONFIRMED'});});await f.c.read();f.c.queue('width',500);f.c.queue('width',400);await tick();await f.c.read();f.c.queue('width',300);await tick();assert.equal(writes,1);assert.match(f.errors.at(-1),/could not confirm/);
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
