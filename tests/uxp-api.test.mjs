import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  let active='one',projectPath='/projects/edit.prproj',counter=0;
  const writes=[],requests=[];
  const sequences=['one','two'].map(id=>({guid:{toString:()=>id},name:id,getSettings:async()=>({getVideoFrameRect:async()=>({width:720,height:1280})}),getTimebase:async()=>10584000000,getEndTime:async()=>({seconds:10}),getVideoTrackCount:async()=>0}));
  const project={get path(){return projectPath;},getSequences:async()=>sequences,getActiveSequence:async()=>sequences.find(s=>s.name===active)};
  const folders=new Map();
  function folder(path) {
    if(folders.has(path))return folders.get(path);
    const entries=new Map(),value={nativePath:path,getEntry:async name=>{if(!entries.has(name))throw new Error('Entry not found');return entries.get(name);},entries};
    folders.set(path,value);return value;
  }
  const storage={
    randomId:()=>String(++counter).padStart(32,'0'),ensureFolder:async path=>folder(path),privateRoot:async scope=>folder('/private/'+scope),readJSON:async file=>file.data,
    writeJSON:async (parent,name,value)=>{
      writes.push({path:parent.nativePath,name,value});
      if(parent.nativePath==='/private/service/requests'){
        requests.push(value);
        // The real worker can claim a file before getEntry resolves: no input
        // remains, but its matching response is already available.
        folder('/private/service/responses').entries.set(name,{data:{version:1,id:value.id,sequenceId:value.sequenceId,projectPath:value.projectPath,result:['Arial','Georgia']},delete:async()=>{}});
      }else parent.entries.set(name,{data:value,delete:async()=>{}});
    },
  };
  const native={fetchTranscript:async sequence=>sequence.name,transcribe:async sequence=>sequence.name};
  const module={exports:{}};
  const context={module,exports:module.exports,setTimeout,Map,require:name=>{
    if(name==='premierepro')return {Project:{getActiveProject:async()=>project},Constants:{TrackItemType:{CLIP:1}}};
    if(name==='uxp')return {storage:{localFileSystem:{}}};
    if(name==='./storage.js')return storage;
    if(name==='./transcript.js')return native;
    throw new Error('Unexpected import '+name);
  }};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/api.js',import.meta.url),'utf8'),context);
  return {api:module.exports.createHostAPI(),writes,requests,select:id=>{active=id;},relocate:path=>{projectPath=path;}};
}

test('direct native requests and slow saves retain the captured sequence after selection changes',async()=>{
  const h=harness();await h.api.getActiveSequenceInfo();h.select('two');await h.api.getActiveSequenceInfo();
  assert.equal(await h.api.fetchTranscriptJSON('one'),'one');
  await h.api.saveSession({sequenceId:'one',captions:[{text:'original'}]});
  assert.equal(h.writes.at(-1).path,'/projects/Better Captions/one');
  assert.equal(h.writes.at(-1).value.sequenceId,'one');
});

test('font loading initializes native context and accepts a renderer that claims immediately',async()=>{
  const h=harness();const fonts=await h.api.getFonts();
  assert.deepEqual(Array.from(fonts),['Arial','Georgia']);
  assert.equal(h.requests[0].sequenceId,'one');assert.equal(h.requests[0].action,'getFonts');
  assert.equal(h.requests[0].projectPath,'/projects/edit.prproj');
});

test('a changed project location cannot redirect a pending caption save or render request',async()=>{
  const h=harness();await h.api.getActiveSequenceInfo();h.relocate('/other/edit.prproj');
  await assert.rejects(h.api.saveSession({sequenceId:'one'}),/project location changed/);
  await assert.rejects(h.api.beginCaption('caption-one','one'),/project location changed/);
  assert.equal(h.writes.length,0);
});
