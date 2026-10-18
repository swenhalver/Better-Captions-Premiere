import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {validateAreaRead,validateAreaEdit} from '../webview-ui/src/lib/agent-bridge.ts';

const require=createRequire(new URL('../webview-ui/package.json',import.meta.url));
const ts=require('typescript');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports={};
vm.runInNewContext(transpile(readFileSync(new URL('../webview-ui/src/lib/program-monitor.ts',import.meta.url),'utf8')),{exports,setTimeout,clearTimeout,Date});
const {confirmCaptionGeometry,captionLinks,startProgramMonitorWatcher}=exports;
const caption=()=>({id:'caption',clipNodeId:'clip',projectItemId:'item',mediaPath:'/caption.mov',startTime:2,endTime:4,
  renderBounds:{x:100,y:200,width:800,height:400,frameWidth:1920,frameHeight:1080}});
const cue=()=>({id:'caption',clipNodeId:'clip',projectItemId:'item',path:'/caption.mov',watchSignature:'size-unchanged',controlRevision:'controls-new-position'});

test('control revisions accept the exact link and keep size and Position changes separate',()=>{
  const result=confirmCaptionGeometry(caption(),caption(),cue());
  assert.equal(result.watchSignature,'size-unchanged');
  assert.equal(result.controlRevision,'controls-new-position');
});
test('stale link, timing or bounds never confirm controls for a replacement caption',()=>{
  for(const patch of [{id:'other'},{clipNodeId:'other'},{projectItemId:'other'},{mediaPath:'/new.mov'},{startTime:3},{endTime:5},{renderBounds:{...caption().renderBounds,width:700}}]){
    assert.throws(()=>confirmCaptionGeometry(caption(),{...caption(),...patch},cue()),/link changed/);
  }
  for(const patch of [{id:'other'},{clipNodeId:'other'},{projectItemId:'other'},{path:'/new.mov'}]){
    assert.throws(()=>confirmCaptionGeometry(caption(),caption(),{...cue(),...patch}),/did not confirm/);
  }
});
test('invalid control revisions are bounded and older renderers remain readable',()=>{
  for(const controlRevision of ['',null,22,'x'.repeat(4097)]) assert.throws(()=>confirmCaptionGeometry(caption(),caption(),{...cue(),controlRevision}),/invalid/);
  const old=cue();delete old.controlRevision;
  assert.equal(confirmCaptionGeometry(caption(),caption(),old).controlRevision,null);
});

// Exercise the installed editor's actual asynchronous receipt handler.
const main=readFileSync(new URL('../webview-ui/src/main-webview.svelte',import.meta.url),'utf8');
const readSource=main.slice(main.indexOf('  async function readMotionSignature('),main.indexOf('  async function reflowCaption('));
assert.ok(readSource.includes('confirmCaptionGeometry'),'Test the production revision acceptance path');
function harness(){
  let current=caption(),response=cue(),pending=null;
  const context={sequenceId:'sequence',captionId:'caption',clipNodeId:'clip'};
  const scope={plain:structuredClone,captionLinks,confirmCaptionGeometry,areaControlRevision:'old',
    watchedCaption(){if(current.id!==context.captionId)throw new Error('The selected caption changed.');return current;},
    api:{async readCaptionGeometry(){return pending?await pending:{ok:true,cues:[response]};}}};
  vm.createContext(scope);vm.runInContext(transpile(readSource),scope);
  return {scope,context,set current(value){current=value;},set response(value){response=value;},set pending(value){pending=value;}};
}
test('a same-frame Position drag refreshes plugin controls without requesting a render',async()=>{
  const h=harness();let renders=0;
  const watcher=startProgramMonitorWatcher({autoStart:false,current:()=>({...h.context,savedSignature:'size-unchanged'}),
    readSignature:context=>h.scope.readMotionSignature(context),apply:async()=>{renders++;},onStatus(){}});
  await watcher.tick();assert.match(h.scope.areaControlRevision,/controls-new-position/);assert.equal(renders,0);
  h.response={...cue(),controlRevision:'controls-another-position'};
  await watcher.tick();assert.match(h.scope.areaControlRevision,/controls-another-position/);assert.equal(renders,0);
  watcher.stop();
});
test('a late geometry response cannot refresh controls after a media replacement',async()=>{
  const h=harness();let resolve;
  h.pending=new Promise(yes=>{resolve=yes;});
  const read=h.scope.readMotionSignature(h.context);
  h.current={...caption(),mediaPath:'/replacement.mov'};resolve({ok:true,cues:[cue()]});
  await assert.rejects(read,/link changed/);assert.equal(h.scope.areaControlRevision,'old');
});
test('a late geometry response cannot refresh controls after selection changes',async()=>{
  const h=harness();let resolve;
  h.pending=new Promise(yes=>{resolve=yes;});
  const read=h.scope.readMotionSignature(h.context);
  h.current={...caption(),id:'other'};resolve({ok:true,cues:[cue()]});
  await assert.rejects(read,/selected caption changed/);assert.equal(h.scope.areaControlRevision,'old');
});

const busySource=main.slice(main.indexOf('  function setTimelineBusy('),main.indexOf('  function selectFirst('));
const agentSource=main.slice(main.indexOf('  function agentAreaCaption('),main.indexOf('  const agent: AgentHandler'));
function areaAgentHarness(){
  const reads=[],scope={plain:structuredClone,validateAreaRead,validateAreaEdit,
    timelineBusy:false,exportBusy:false,areaBusy:false,agentAreaBusy:false,isRefreshing:false,isSyncing:false,automaticReflow:false,motionWatcher:null,
    sessionManager:{current:{sequenceId:'sequence',frameRate:24,captions:[caption()]},setCurrentTime(){}},
    api:{isDemo:false,async getActiveSequenceInfo(){return {id:'sequence',playhead:3};},async readCaptionArea(_caption,_sequence,frame){reads.push(frame);return {frame,count:48,startTime:2.5,frameRate:24};}}};
  vm.createContext(scope);vm.runInContext(transpile(busySource+agentSource),scope);return {scope,reads};
}
test('agent area work keeps its own busy gate when the component finishes a read',async()=>{
  const h=areaAgentHarness();let resolve;
  h.scope.api.getActiveSequenceInfo=()=>new Promise(yes=>{resolve=yes;});
  const pending=h.scope.runAgentArea({captionId:'caption'},false);
  assert.equal(h.scope.agentAreaBusy,true);assert.equal(h.scope.timelineBusy,true);
  h.scope.setAreaBusy(false);assert.equal(h.scope.timelineBusy,true);
  await assert.rejects(h.scope.runAgentArea({captionId:'caption'},false),/current caption operation/);
  resolve({id:'sequence',playhead:3});await pending;
  assert.equal(h.scope.agentAreaBusy,false);assert.equal(h.scope.timelineBusy,false);
  assert.match(main,/disabled=\{exportBusy\|\|agentAreaBusy\|\|isRefreshing/);
});
test('default agent area read corrects pending caption timing from the native receipt',async()=>{
  const h=areaAgentHarness(),result=await h.scope.runAgentArea({captionId:'caption'},false);
  assert.deepEqual(h.reads,[24,12]);assert.equal(result.frame,12);
});
test('an explicit agent area frame stays exact regardless of pending caption timing',async()=>{
  const h=areaAgentHarness(),result=await h.scope.runAgentArea({captionId:'caption',frame:7},false);
  assert.deepEqual(h.reads,[7]);assert.equal(result.frame,7);
});
