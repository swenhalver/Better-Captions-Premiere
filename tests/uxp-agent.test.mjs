import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import {validateStylePatch,validateCaptionPatch} from '../webview-ui/src/lib/agent-bridge.ts';
import {DEFAULT_STYLE,DEFAULT_ANIMATION} from '../webview-ui/src/lib/types.ts';

const ROOT='/Users/test/Library/Application Support/Better Captions/agent';
const clone=value=>structuredClone(value);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve();}assert.fail('Async operation did not reach the expected boundary.');}

async function fixture(){
  const entries=new Map(),timers=new Map(),errors=[],calls=[],required=[];
  let clock=1000000,nonce=0,timerId=0;
  const randomUUID=()=>`00000000-0000-4000-8000-${String(++nonce).padStart(12,'0')}`;
  function addFolder(nativePath){
    if(entries.has(nativePath))return entries.get(nativePath);
    const parent=nativePath==='/'?null:addFolder(path.posix.dirname(nativePath));
    const folder={nativePath,name:path.posix.basename(nativePath),isFolder:true,isFile:false,children:new Map(),
      async getEntry(name){const entry=this.children.get(name);if(!entry)throw new Error('Entry not found');return entry;},
      async getEntries(){return [...this.children.values()];},
      async createFolder(name){if(this.children.has(name))throw new Error('Entry exists');return addFolder(this.nativePath+'/'+name);},
      async createFile(name,{overwrite=false}={}){if(this.children.has(name)&&!overwrite)throw new Error('File exists');return addFile(this,name,'');},
    };
    entries.set(nativePath,folder);if(parent)parent.children.set(folder.name,folder);return folder;
  }
  function addFile(folder,name,text){
    const file={nativePath:folder.nativePath+'/'+name,name,isFile:true,isFolder:false,text,parent:folder,
      async read(){return this.text;},async write(value){this.text=value;},
      async getMetadata(){return {size:this.sizeOverride??Buffer.byteLength(this.text)};},
      async delete(){this.parent.children.delete(this.name);entries.delete(this.nativePath);},
      async moveTo(destination,{newName=this.name,overwrite=false}={}){
        if(destination.children.has(newName)&&!overwrite)throw new Error('Destination exists');
        this.parent.children.delete(this.name);entries.delete(this.nativePath);
        this.parent=destination;this.name=newName;this.nativePath=destination.nativePath+'/'+newName;
        destination.children.set(newName,this);entries.set(this.nativePath,this);
      },
    };
    folder.children.set(name,file);entries.set(file.nativePath,file);return file;
  }
  const data=addFolder('/Users/test/Library/Application Support/Adobe/UXP/PluginsStorage/caption/data');
  const filesystem={async getDataFolder(){return data;},async getEntryWithUrl(url){const entry=entries.get(url.replace(/^file:/,''));if(!entry)throw new Error('Entry not found');return entry;}};
  const storageModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/storage.js',import.meta.url),'utf8'),{module:storageModule,exports:storageModule.exports,require(name){if(name==='./paths.js')return require('../uxp/paths.js');assert.equal(name,'uxp');return {storage:{localFileSystem:filesystem}};},crypto:{randomUUID}}, {filename:'uxp/storage.js'});
  const storage=storageModule.exports,state={sequenceId:'sequence-a',sequenceName:'Dialogue',style:clone(DEFAULT_STYLE),animation:clone(DEFAULT_ANIMATION),captions:[{id:'cue-1',text:'Hello',startTime:0,endTime:1,words:[{text:'Hello',startTime:0,endTime:.9,isActive:false}],clipNodeId:'timeline-clip',projectItemId:'project-item',mediaPath:'/managed/caption.mov'}]};
  const handler={
    async getState(){await Promise.resolve();return clone(state);},
    async patchStyle(patch){calls.push(['patchStyle',clone(patch)]);const safe=validateStylePatch(patch);await Promise.resolve();state.style={...state.style,...safe};},
    async patchAnimation(patch){calls.push(['patchAnimation',clone(patch)]);await Promise.resolve();state.animation={...state.animation,...patch};},
    async setCaptions(captions){calls.push(['setCaptions',clone(captions)]);state.captions=validateCaptionPatch(captions,state.captions);await Promise.resolve();},
    async refresh(){calls.push(['refresh']);await Promise.resolve();state.refreshed=true;},
    async apply(){calls.push(['apply']);await Promise.resolve();state.applied=true;},
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/agent.js',import.meta.url),'utf8'),{module,exports:module.exports,require(name){required.push(name);assert.equal(name,'./storage.js');return storage;},Date:{now:()=>clock},console:{error:error=>errors.push(error)},setInterval(callback,ms){const id=++timerId;timers.set(id,{callback,ms});return id;},clearInterval(id){timers.delete(id);}}, {filename:'uxp/agent.js'});
  const stop=await module.exports.startAgentBridge(handler),instances=entries.get(ROOT+'/instances'),requests=entries.get(ROOT+'/requests'),responses=entries.get(ROOT+'/responses');
  const instance=JSON.parse((await instances.getEntries())[0].text),instanceId=instance.instanceId;
  return {state,handler,calls,required,errors,entries,timers,storage,instanceId,instances,requests,responses,stop,
    async tick(ms){const timer=[...timers.values()].find(timer=>timer.ms===ms);if(timer)await timer.callback();},
    async request(action,payload={},patch={}){const id=patch.fileId||randomUUID(),name=id+'.json',request={version:1,id,instanceId,sequenceId:state.sequenceId,createdAt:clock,action,payload,...patch};delete request.fileId;await storage.writeJSON(requests,name,request);return {id,name,request};},
    async response(id){return storage.readJSON(await responses.getEntry(id+'.json'));},
    advance(ms){clock+=ms;},
  };
}

test('UXP agent discovers the same private CLI root and publishes resolved async state on its heartbeat',async t=>{
  const f=await fixture();t.after(f.stop);
  assert.deepEqual(f.required,['./storage.js']);assert.ok(f.entries.has(ROOT+'/requests'));assert.ok(f.entries.has(ROOT+'/responses'));
  const initial=JSON.parse((await f.instances.getEntries())[0].text);
  assert.equal(initial.version,1);assert.match(initial.instanceId,/^[a-f0-9]{32}$/);assert.equal(initial.sequenceId,'sequence-a');assert.equal(initial.busy,false);
  assert.deepEqual(initial.capabilities,['get_state','patch_style','patch_animation','set_captions','set_position','refresh','apply']);
  f.state.sequenceName='New name';f.advance(5000);await f.tick(5000);
  const latest=JSON.parse((await f.instances.getEntries())[0].text);assert.equal(latest.sequenceName,'New name');assert.equal(latest.updatedAt,initial.updatedAt+5000);assert.equal(f.errors.length,0);
});

test('bounded agent actions await UI changes and return their persisted state',async t=>{
  const f=await fixture();t.after(f.stop);
  const style=await f.request('patch_style',{activeWord:{bubble:true,sizeScale:1.5},spokenWord:{color:'#888888'}});await f.tick(500);
  const response=await f.response(style.id);assert.equal(response.ok,true);assert.equal(response.state.style.activeWord.sizeScale,1.5);assert.equal(response.state.style.spokenWord.color,'#888888');assert.equal(response.id,style.id);
  for(const [action,payload] of [['patch_animation',{preset:'bounce'}],['refresh',{}],['apply',{}]]){const request=await f.request(action,payload);await f.tick(500);assert.equal((await f.response(request.id)).ok,true);}
  assert.equal(f.state.animation.preset,'bounce');assert.equal(f.state.refreshed,true);assert.equal(f.state.applied,true);assert.equal((await f.requests.getEntries()).length,0);
});

test('global and per-caption locations use trusted validators and keep timeline links',async t=>{
  const f=await fixture();t.after(f.stop);
  const global=await f.request('set_position',{x:.2,y:.8});await f.tick(500);assert.equal((await f.response(global.id)).ok,true);assert.equal(f.state.style.positionX,.2);assert.equal(f.state.style.positionY,.8);
  const caption=await f.request('set_position',{captionId:'cue-1',x:.4,y:.6});await f.tick(500);assert.equal((await f.response(caption.id)).ok,true);assert.deepEqual(f.state.captions[0].position,{x:.4,y:.6});assert.equal(f.state.captions[0].clipNodeId,'timeline-clip');
  const replacement={...f.state.captions[0],mediaPath:'/unrelated.mov',clipNodeId:'wrong',words:[{text:'Changed',startTime:0,endTime:.9,isActive:false}]};
  const words=await f.request('set_captions',{captions:[replacement]});await f.tick(500);assert.equal((await f.response(words.id)).ok,true);assert.equal(f.state.captions[0].text,'Changed');assert.equal(f.state.captions[0].mediaPath,'/managed/caption.mov');assert.equal(f.state.captions[0].clipNodeId,'timeline-clip');
  const invalid=await f.request('set_position',{captionId:'cue-1',x:2,y:.6});await f.tick(500);assert.equal((await f.response(invalid.id)).ok,false);assert.deepEqual(f.state.captions[0].position,{x:.4,y:.6});
});

test('requests are bound to instance, sequence, finite expiry and allowlisted action before any mutation',async t=>{
  const f=await fixture();t.after(f.stop);
  const other=await f.request('patch_style',{fontSize:88},{instanceId:'b'.repeat(32)});await f.tick(500);assert.ok(await f.requests.getEntry(other.name));assert.equal((await f.responses.getEntries()).length,0);
  for(const patch of [{sequenceId:'other'},{createdAt:null},{createdAt:'1000000'},{createdAt:undefined},{createdAt:0},{createdAt:1120001},{version:2},{action:'exec'}]){
    const request=await f.request('patch_style',{fontSize:88},patch);await f.tick(500);const response=await f.response(request.id);assert.equal(response.ok,false);assert.match(response.error,/sequence changed|Invalid, expired or unsupported/);
  }
  const mismatched=await f.request('apply',{}, {id:'a'.repeat(32)});await f.tick(500);assert.equal((await f.response(mismatched.id)).ok,false);
  assert.equal(f.calls.length,0);assert.equal(f.state.style.fontSize,DEFAULT_STYLE.fontSize);assert.equal((await f.requests.getEntries()).length,1,'another live panel retains its request');
});

test('agent claims a request before UI work and never executes a completed nonce twice',async t=>{
  const f=await fixture();t.after(f.stop);
  const original=f.handler.patchStyle;let request;
  f.handler.patchStyle=async patch=>{assert.equal(await f.requests.getEntries().then(entries=>entries.some(entry=>entry.name===request.name)),false,'request is removed before mutation');await original(patch);};
  request=await f.request('patch_style',{fontSize:88});await f.tick(500);assert.equal((await f.response(request.id)).ok,true);
  await f.storage.writeJSON(f.requests,request.name,request.request);await f.tick(500);
  assert.equal(f.calls.filter(([name])=>name==='patchStyle').length,1);assert.equal((await f.requests.getEntries()).length,0);
});

test('busy polling serializes a long apply while the heartbeat remains responsive',async t=>{
  const f=await fixture();t.after(f.stop);const gate=deferred();
  f.handler.apply=async()=>{f.calls.push(['apply']);await gate.promise;f.state.applied=true;};
  const request=await f.request('apply'),running=f.tick(500);await until(()=>f.calls.some(([name])=>name==='apply'));
  await f.tick(500);await f.tick(5000);assert.equal(f.calls.filter(([name])=>name==='apply').length,1);
  const instance=JSON.parse((await f.instances.getEntries())[0].text);assert.equal(instance.busy,true);
  gate.resolve();await running;assert.equal((await f.response(request.id)).ok,true);assert.equal(f.state.applied,true);
});

test('UI validation failures return a bounded error without corrupting the current styles',async t=>{
  const f=await fixture();t.after(f.stop);const before=clone(f.state.style);
  const request=await f.request('patch_style',{fontSize:Infinity,exec:'no'});await f.tick(500);const response=await f.response(request.id);
  assert.equal(response.ok,false);assert.match(response.error,/finite number|caption style/);assert.deepEqual(f.state.style,before);assert.equal((await f.requests.getEntries()).length,0);
});

test('the 5MB request and response bounds count UTF-8 bytes even if metadata underreports size',async t=>{
  const f=await fixture();t.after(f.stop);const text='é'.repeat(2500100);
  const request=await f.request('patch_style',{fontFamily:text});(await f.requests.getEntry(request.name)).sizeOverride=0;await f.tick(500);
  assert.equal((await f.response(request.id)).ok,false);assert.match((await f.response(request.id)).error,/too large/);assert.equal(f.calls.length,0);
  f.state.extra=text;const state=await f.request('get_state');await f.tick(500);const response=await f.response(state.id);assert.equal(response.ok,false);assert.match(response.error,/too large/);assert.ok(Buffer.byteLength(JSON.stringify(response))<5000000);
});

test('stop removes only this instance and timers, including a heartbeat already awaiting async state',async()=>{
  const f=await fixture(),gate=deferred(),other=await f.instances.createFile('other-instance.json');await other.write('{"preserve":true}');
  f.handler.getState=async()=>{await gate.promise;return clone(f.state);};
  const heartbeat=f.tick(5000),stopping=f.stop();gate.resolve();await heartbeat;await stopping;
  assert.equal(f.timers.size,0);assert.deepEqual((await f.instances.getEntries()).map(entry=>entry.name),['other-instance.json']);
  await f.tick(500);assert.equal(f.calls.length,0);
});
