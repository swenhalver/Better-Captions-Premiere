import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function commonJS(file) {
  const module = {exports:{}};
  vm.runInThisContext('(function(module, exports){' + fs.readFileSync(new URL(file, import.meta.url),'utf8') + '\n})', {filename:file})(module,module.exports);
  return module.exports;
}
const core = commonJS('../uxp/transcript-core.js');
const w = (text,start,duration) => ({text,start,duration,type:'word',confidence:1,eos:false,tags:[]});
const punctuation = text => ({text,type:'punctuation',start:0,duration:0});
const native = words => ({language:'en-us',segments:[{start:0,duration:100,language:'en-us',speaker:'speaker-a',words}]});
const close = (actual,expected) => assert.ok(Math.abs(actual-expected)<1e-9,`${actual} differs from ${expected}`);

test('a trimmed source clip maps clipped speech into the actual timeline interval',()=>{
  const original=native([w('before',0,1),w('first',1,1),w('middle',2,.5),w('last',2.5,1),w('after',3.5,1)]),snapshot=structuredClone(original);
  const result=core.mapTranscript(original,{start:10,end:12,in:1.5,out:3.5});
  assert.deepEqual(result[0].words.map(word=>[word.text,word.start,word.duration]),[['first',10,.5],['middle',10.5,.5],['last',11,1]]);
  assert.equal(result[0].start,10);assert.equal(result[0].duration,2);assert.equal(result[0].speaker,'speaker-a');
  assert.deepEqual(original,snapshot,'mapping never alters the reusable source transcript');
});

test('constant speed mapping uses source and timeline durations, including fractional clip edges',()=>{
  const json=native([w('spoken',4.2,.6)]);
  const fast=core.mapTranscript(JSON.stringify(json),{start:20,end:22,in:4,out:8})[0].words[0];
  close(fast.start,20.1);close(fast.duration,.3);
  const slow=core.mapTranscript(json,{start:5,end:13,in:4,out:8})[0].words[0];
  close(slow.start,5.4);close(slow.duration,1.2);
  const clipped=core.mapTranscript(native([w('clip',1,1)]),{start:7.3,end:7.8,in:1.25,out:1.75})[0].words[0];
  close(clipped.start,7.3);close(clipped.duration,.5);
});

test('speech ending at clip-in or starting at clip-out does not leak onto the timeline',()=>{
  const result=core.mapTranscript(native([w('before',0,1),w('inside',1,1),w('after',2,1)]),{start:10,end:11,in:1,out:2});
  assert.deepEqual(result[0].words.map(word=>word.text),['inside']);
  assert.deepEqual(core.mapTranscript(native([w('outside',3,1)]),{start:10,end:11,in:1,out:2}),[]);
});

test('cut mapping retains included quotation marks but drops punctuation belonging to excluded speech',()=>{
  const json=native([w('before',0,.5),punctuation(','),punctuation('“'),w('kept',2.1,.3),punctuation('”'),punctuation(','),w('outside',4,.5),punctuation('!')]);
  const segment=core.mapTranscript(json,{start:10,end:11,in:2,out:3})[0];
  assert.deepEqual(segment.words.map(word=>word.text),['“','kept','”',',']);
  close(segment.start,10.1);close(segment.duration,.3);
  assert.ok(segment.words.every(word=>word.start>=10&&word.start<=11),'punctuation timestamps also use sequence coordinates');
});

test('native timing regions reject reversed, nonfinite, negative and empty intervals',()=>{
  const json=native([w('valid',0,1)]),valid={start:0,end:1,in:0,out:1};
  for(const region of [null,{...valid,start:-1},{...valid,in:-1},{...valid,end:NaN},{...valid,in:Infinity},{...valid,start:1},{...valid,out:0},{...valid,end:'1'},{start:0,end:1,in:0,out:Number.MIN_VALUE}])assert.throws(()=>core.mapTranscript(json,region),/invalid audio timing/);
});

test('native transcript validation rejects malformed shape and invalid word timing instead of claiming speech exists',()=>{
  for(const value of [null,[],{},'not JSON',{segments:{}},{segments:[{}]},{segments:[{words:[null]}]},native([w('bad',-1,.5)]),native([w('bad',0,'1')]),native([w('bad',NaN,1)]),native([w('bad',0,0)]),native([w('bad',Number.MAX_VALUE,Number.MAX_VALUE)]),native([{...w('bad',0,1),text:{html:'not text'}}])]){
    assert.equal(core.hasWords(value),false);assert.throws(()=>core.parseNativeTranscript(value),/invalid native transcript/);
  }
  assert.equal(core.hasWords({segments:[]}),false);
  assert.equal(core.hasWords(native([punctuation('.')])),false);
  assert.equal(core.hasWords(native([w('valid',0,.5)])),true);
});

function source(name,json=null,after=json) {
  return {name,json,after,success:true,async isSequence(){return false;},async getMediaFilePath(){return '/media/'+name;}};
}
function clip(item,start,end,clipIn=0,clipOut=end-start,extra={}) {
  return {async getProjectItem(){return item;},async isDisabled(){return false;},async isSpeedReversed(){return false;},async getStartTime(){return {seconds:start};},async getEndTime(){return {seconds:end};},async getInPoint(){return {seconds:clipIn};},async getOutPoint(){return {seconds:clipOut};},...extra};
}
function track(clips,muted=false) { return {async isMuted(){return muted;},async getTrackItems(){return clips;}}; }
function bridgeFixture(tracks,sequenceJSON=null) {
  const transcribed=[],exported=[],required=[],sequenceItem={name:'sequence',json:sequenceJSON},module={exports:{}};
  const sequence={async getProjectItem(){return sequenceItem;},async getAudioTrackCount(){return tracks.length;},async getAudioTrack(index){return tracks[index];}};
  const ppro={ClipProjectItem:{cast:item=>item},Constants:{TrackItemType:{CLIP:1}},Project:{async getActiveProject(){return null;}},Transcript:{async exportToJSON(item){exported.push(item.name);if(item.exportError)throw new Error('export failed');return item.json;},async transcribeClipProjectItem(item){transcribed.push(item.name);if(item.success){item.json=item.after;if(item.failExportAfter)item.exportError=true;}return item.success;}}};
  const sandbox={module,exports:module.exports,require(name){required.push(name);if(name==='premierepro')return ppro;if(name==='./transcript-core.js')return core;throw new Error(name);}};
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/transcript.js',import.meta.url),'utf8'),sandbox,{filename:'uxp/transcript.js'});
  const service=module.exports;
  return {transcript:shouldTranscribe=>shouldTranscribe?service.transcribe(sequence):service.fetchTranscript(sequence),service,transcribed,exported,required};
}

test('the direct native service transcribes a reused source once and maps each edit independently',async()=>{
  const item=source('dialogue.mp4',null,native([w('hello',1.5,.5)]));
  const f=bridgeFixture([track([clip(item,0,2,1,3),clip(item,10,11,1,3)])]);
  const result=JSON.parse(await f.transcript(true));
  assert.deepEqual(f.transcribed,['dialogue.mp4']);
  assert.deepEqual(result.segments.map(segment=>segment.words.map(word=>[word.text,word.start,word.duration])),[[['hello',.5,.5]],[['hello',10.25,.25]]]);
  assert.equal(result.timing,'sequence');assert.equal(result.source,'Premiere Pro Speech to Text');
});

test('the direct native service keeps speech while reporting successful no-speech music separately',async()=>{
  const dialogue=source('dialogue.mp4',native([w('hello',0,.5)])),music=source('music.wav',null,{segments:[]});
  const f=bridgeFixture([track([clip(dialogue,0,1)]),track([clip(music,0,1)])]),result=JSON.parse(await f.transcript(true));
  assert.equal(result.segments.length,1);assert.deepEqual(f.transcribed,['music.wav']);
  assert.equal(result.skippedAudioClips.length,1);assert.equal(result.skippedAudioClips[0].name,'music.wav');assert.match(result.skippedAudioClips[0].reason,/no spoken words/);
  const refreshed=JSON.parse(await f.transcript(false));assert.equal(refreshed.segments.length,1);assert.equal(refreshed.skippedAudioClips[0].name,'music.wav');assert.deepEqual(f.transcribed,['music.wav'],'fetch does not transcribe music again');
});

test('an untranscribed source prevents an incomplete fetch, while confirmed no-speech output has a clear outcome',async()=>{
  const good=source('good.mp4',native([w('hello',0,.5)])),missing=source('missing.mp4');
  await assert.rejects(bridgeFixture([track([clip(good,0,1),clip(missing,2,3)])]).transcript(false),/Some enabled audio clips have no native transcript/);
  assert.equal(await bridgeFixture([track([clip(missing,0,1)])]).transcript(false),null);
  await assert.rejects(bridgeFixture([track([clip(source('music.wav',null,{segments:[]}),0,1)])]).transcript(true),/detected no spoken words/);
  await assert.rejects(bridgeFixture([]).transcript(true),/no enabled audio clips/);
});

test('transcription failures, failed exports and malformed completed results do not become silent skipped audio',async()=>{
  const good=source('good.mp4',native([w('hello',0,.5)]));
  const failed=source('failed.mp4');failed.success=false;
  const exportFailed=source('export.mp4',null,native([w('hello',0,.5)]));exportFailed.failExportAfter=true;
  const malformed=source('malformed.mp4',null,native([w('bad',-1,.5)]));
  for(const [bad,pattern] of [[failed,/could not transcribe/],[exportFailed,/could not export/],[malformed,/invalid native transcript/]])await assert.rejects(bridgeFixture([track([clip(good,0,1),clip(bad,2,3)])]).transcript(true),pattern);
});

test('the direct native service ignores muted and disabled clips and refuses nested or reversed speech',async()=>{
  const item=source('dialogue.mp4',native([w('hello',0,.5)])),f=bridgeFixture([track([clip(item,0,1)]),track([clip(source('muted.wav'),0,1)],true),track([clip(source('disabled.wav'),0,1,0,1,{async isDisabled(){return true;}})])]);
  assert.equal(JSON.parse(await f.transcript(true)).segments.length,1);assert.deepEqual(f.transcribed,[]);
  const nested=source('nested');nested.isSequence=async()=>true;
  await assert.rejects(bridgeFixture([track([clip(nested,0,1)])]).transcript(true),/nested audio/);
  await assert.rejects(bridgeFixture([track([clip(item,0,1,0,1,{async isSpeedReversed(){return true;}})])]).transcript(true),/Reversed audio/);
});

test('static sequence transcripts retain sequence-relative timing and need no source transcription',async()=>{
  const value=native([w('already mapped',25,.5)]),f=bridgeFixture([],value),result=JSON.parse(await f.transcript(true));
  assert.equal(result.segments[0].words[0].start,25);assert.deepEqual(f.transcribed,[]);assert.deepEqual(f.exported,['sequence']);
});

test('the direct UXP service loads without filesystem, polling, document or automatic native calls',()=>{
  const f=bridgeFixture([]);
  assert.deepEqual(f.required,['premierepro','./transcript-core.js']);assert.deepEqual(f.transcribed,[]);assert.deepEqual(f.exported,[]);
  assert.equal(typeof f.service.fetchTranscript,'function');assert.equal(typeof f.service.transcribe,'function');
});

test('direct native operations require an explicit sequence',async()=>{
  const f=bridgeFixture([]);
  await assert.rejects(f.service.fetchTranscript(null),/Open a sequence in Premiere/);
  await assert.rejects(f.service.transcribe(undefined),/Open a sequence in Premiere/);
  assert.deepEqual(f.exported,[]);assert.deepEqual(f.transcribed,[]);
});

test('fetching an available reused source reads native JSON once and never starts transcription',async()=>{
  const item=source('dialogue.mp4',JSON.stringify(native([w('hello',0,.5)]))),f=bridgeFixture([track([clip(item,0,1),clip(item,3,4)])]);
  const result=JSON.parse(await f.service.fetchTranscript({async getProjectItem(){return {json:null,name:'sequence'};},async getAudioTrackCount(){return 1;},async getAudioTrack(){return track([clip(item,0,1),clip(item,3,4)]);}}));
  assert.deepEqual(result.segments.map(segment=>segment.words[0].start),[0,3]);
  assert.deepEqual(f.transcribed,[]);assert.equal(f.exported.filter(name=>name==='dialogue.mp4').length,1);
});

test('sources without media paths retain isolated native transcripts',async()=>{
  const first=source('first',native([w('first',0,.5)])),second=source('second',native([w('second',0,.5)]));first.getMediaFilePath=second.getMediaFilePath=async()=>'';
  const f=bridgeFixture([track([clip(first,0,1),clip(second,2,3)])]),result=JSON.parse(await f.transcript(false));
  assert.deepEqual(result.segments.map(segment=>segment.words[0].text),['first','second']);assert.deepEqual(f.transcribed,[]);
});

test('an invalid saved native transcript is regenerated and the completed native result is validated',async()=>{
  const item=source('dialogue.mp4',native([w('bad',-1,.5)]),JSON.stringify(native([w('recovered',0,.5)]))),f=bridgeFixture([track([clip(item,4,5)])]);
  const result=JSON.parse(await f.transcript(true));assert.deepEqual(f.transcribed,['dialogue.mp4']);assert.equal(result.segments[0].words[0].text,'recovered');assert.equal(result.segments[0].words[0].start,4);
});

test('a source transcript with no words inside an edit is reported without dropping other dialogue',async()=>{
  const good=source('good.mp4',native([w('hello',0,.5)])),trimmed=source('trimmed.mp4',native([w('outside',10,.5)]));
  const f=bridgeFixture([track([clip(good,0,1),clip(trimmed,2,3)])]),result=JSON.parse(await f.transcript(false));
  assert.equal(result.segments.length,1);assert.equal(result.skippedAudioClips.length,1);assert.equal(result.skippedAudioClips[0].name,'trimmed.mp4');assert.match(result.skippedAudioClips[0].reason,/timeline range/);assert.deepEqual(f.transcribed,[]);
});
