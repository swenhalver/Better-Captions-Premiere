import test from 'node:test';
import assert from 'node:assert/strict';
import {MIN_WORD_FRAMES,moveWord,moveWordEdge,wordEdgeLimits} from '../webview-ui/src/lib/transcript/timing.ts';
import {validateCaptions} from '../webview-ui/src/lib/transcript/edit.ts';
const cue=()=>({id:'one',text:'one two three',startTime:1,endTime:4,words:[{text:'one',startTime:1,endTime:2},{text:'two',startTime:2,endTime:3},{text:'three',startTime:3,endTime:4}]});
test('independent word edges clamp to three frames without changing neighbors at fractional frame rates',()=>{
  assert.equal(MIN_WORD_FRAMES,3);
  for(const fps of [24,25,30000/1001,60]){
    let c=cue();for(let i=0;i<3000;i++){
      const index=i%3,edge=i%2?'startTime':'endTime',target=Math.sin(i*17)*100;
      const previous=c;c=moveWordEdge(c,index,edge,target,fps);validateCaptions([c]);
      for(let j=0;j<c.words.length;j++)if(j!==index)assert.deepEqual(c.words[j],previous.words[j]);
      for(const w of c.words)assert.ok((w.endTime-w.startTime)*fps>=3-1e-7);
      assert.ok(Math.abs(c.words[index][edge]*fps-Math.round(c.words[index][edge]*fps))<1e-7);
    }
  }
});
test('disconnected gaps stay bounded without moving a neighbour and invalid times never mutate',()=>{
  const original=cue();original.words[1].startTime=2.25;
  const moved=moveWordEdge(original,1,'startTime',-100,24);assert.equal(moved.words[0].endTime,2);assert.equal(moved.words[1].startTime,2);
  assert.equal(original.words[1].startTime,2.25);
  for(const time of [NaN,Infinity])assert.throws(()=>moveWordEdge(original,1,'endTime',time,24));
});
const framed=(fps,ranges,bounds=[0,100])=>({id:'timed',text:ranges.map((_,index)=>'word'+index).join(' '),startTime:bounds[0]/fps,endTime:bounds[1]/fps,
  words:ranges.map(([start,end],index)=>({text:'word'+index,startTime:start/fps,endTime:end/fps,isActive:false}))});
const wordFrames=(caption,index,fps)=>[Math.round(caption.words[index].startTime*fps),Math.round(caption.words[index].endTime*fps)];
function frameInvariant(caption,fps){
  validateCaptions([caption]);
  for(const word of caption.words){assert.ok(word.startTime>=caption.startTime-1e-10);assert.ok(word.endTime<=caption.endTime+1e-10);assert.ok((word.endTime-word.startTime)*fps>=1-1e-7);}
  for(let i=1;i<caption.words.length;i++)assert.ok(caption.words[i].startTime>=caption.words[i-1].endTime-1e-10);
}
test('whole-word moves snap both ends and preserve frame duration in both directions at integer and fractional rates',()=>{
  for(const fps of [24,25,24000/1001,30000/1001,60000/1001,60,240])for(const startFrame of [21.4,42.6]){
    const original=framed(fps,[[5,10],[30,45],[70,80]]),moved=moveWord(original,1,startFrame/fps,fps),first=Math.round(startFrame);
    assert.deepEqual(wordFrames(moved,1,fps),[first,first+15]);assert.equal(moved.words[1].startTime,first/fps);assert.equal(moved.words[1].endTime,(first+15)/fps);
    assert.deepEqual(moved.words[0],original.words[0]);assert.deepEqual(moved.words[2],original.words[2]);frameInvariant(moved,fps);
    assert.deepEqual(wordFrames(original,1,fps),[30,45]);
  }
});
test('whole-word movement shrinks at touching neighbors to three frames without rippling either neighbor',()=>{
  for(const fps of [24,30000/1001,60000/1001]){
    const original=framed(fps,[[10,30],[30,45],[45,80]]);
    for(const [target,expected] of [[-100,[30,33]],[100,[42,45]]]){
      const moved=moveWord(original,1,target,fps);assert.deepEqual(wordFrames(moved,1,fps),expected);
      assert.deepEqual(moved.words[0],original.words[0]);assert.deepEqual(moved.words[2],original.words[2]);frameInvariant(moved,fps);
    }
  }
});
test('disconnected gaps retain exact neighbor timing while collision shrinks the moved word',()=>{
  const fps=30000/1001,original=framed(fps,[[2,10],[30,45],[70,90]]);
  for(const [target,expected] of [[-100,[10,13]],[100,[67,70]],[35.25/fps,[35,50]]]){
    const moved=moveWord(original,1,target,fps);assert.deepEqual(wordFrames(moved,1,fps),expected);
    assert.deepEqual(moved.words[0],original.words[0]);assert.deepEqual(moved.words[2],original.words[2]);frameInvariant(moved,fps);
  }
  const touching=moveWord(original,1,10/fps,fps);assert.equal(touching.words[0].endTime,original.words[0].endTime,'reaching a gap edge does not resize that neighbor in the same edit');
});
test('collision pins the contacted edge, lets the other edge continue, and reversing restores the original duration',()=>{
  for(const fps of [24,25,24000/1001,30000/1001,60000/1001,60,240]){
    const original=framed(fps,[[0,30],[35,55],[60,90]]);
    const moves=[[40,[40,60]],[45,[45,60]],[50,[50,60]],[57,[57,60]],[25,[30,45]],[20,[30,40]],[35,[35,55]],[-100,[30,33]],[100,[57,60]],[35,[35,55]]];
    for(const [requested,expected] of moves){
      const moved=moveWord(original,1,requested/fps,fps);assert.deepEqual(wordFrames(moved,1,fps),expected);
      assert.deepEqual(moved.words[0],original.words[0]);assert.deepEqual(moved.words[2],original.words[2]);frameInvariant(moved,fps);
    }
    assert.deepEqual(wordFrames(original,1,fps),[35,55]);
  }
});
test('a touching neighbor remains fixed when a whole word moves into the available gap on its other side',()=>{
  for(const fps of [25,60000/1001]){
    const leftConnected=framed(fps,[[2,30],[30,45],[70,90]]),left=moveWord(leftConnected,1,40/fps,fps);
    assert.deepEqual(left.words[0],leftConnected.words[0]);assert.deepEqual(left.words[2],leftConnected.words[2]);assert.deepEqual(wordFrames(left,1,fps),[40,55]);frameInvariant(left,fps);
    const rightConnected=framed(fps,[[2,10],[30,45],[45,90]]),right=moveWord(rightConnected,1,20/fps,fps);
    assert.deepEqual(right.words[0],rightConnected.words[0]);assert.deepEqual(right.words[2],rightConnected.words[2]);assert.deepEqual(wordFrames(right,1,fps),[20,35]);frameInvariant(right,fps);
  }
});
test('first, last and single-word collision shrinks against fixed caption bounds',()=>{
  const fps=24,original=framed(fps,[[10,30],[40,60]],[5,80]);
  const first=moveWord(original,0,-100,fps);assert.deepEqual(wordFrames(first,0,fps),[5,8]);assert.deepEqual(first.words[1],original.words[1]);
  const last=moveWord(original,1,100,fps);assert.deepEqual(wordFrames(last,1,fps),[77,80]);assert.deepEqual(last.words[0],original.words[0]);
  const single=framed(fps,[[20,45]],[5,80]);
  assert.deepEqual(wordFrames(moveWord(single,0,-100,fps),0,fps),[5,8]);assert.deepEqual(wordFrames(moveWord(single,0,100,fps),0,fps),[77,80]);
  for(const moved of [first,last]){assert.equal(moved.startTime,original.startTime);assert.equal(moved.endTime,original.endTime);frameInvariant(moved,fps);}
});
test('nonaligned caption bounds stay respected when duration must shrink to an available frame slot',()=>{
  const fps=24,original=framed(fps,[[15.4,30.6]],[5.25,40.75]);
  const left=moveWord(original,0,-100,fps),right=moveWord(original,0,100,fps);
  assert.deepEqual(wordFrames(left,0,fps),[6,9]);assert.deepEqual(wordFrames(right,0,fps),[37,40]);frameInvariant(left,fps);frameInvariant(right,fps);
  const rounded=moveWord(framed(fps,[[10.4,25.6]],[0,50]),0,20/fps,fps);
  assert.deepEqual(wordFrames(rounded,0,fps),[20,35],'duration is rounded once, rather than rounding two unrelated original endpoints');
  const constrained=moveWord(framed(fps,[[10.25,22.25]],[10.25,22.25]),0,10.25/fps,fps);
  assert.deepEqual(wordFrames(constrained,0,fps),[11,22],'a valid shorter slot shrinks the word instead of requiring its full rounded duration');frameInvariant(constrained,fps);
});
test('whole-word moves preserve text, flags, caption and native/grouping metadata without mutating a frozen input',()=>{
  const fps=24,original={...framed(fps,[[0,15],[20,40],[50,70]]),clipNodeId:'clip',projectItemId:'item',mediaPath:'/project/caption.mov',captionBundle:true,manualSplit:true,groupingMaxChars:30,speaker:'speaker',position:{x:.5,y:.8},renderBounds:{x:0,y:0,width:576,height:512,frameWidth:720,frameHeight:1280},motionProfile:{signature:'native-curves',samples:[]},timingEstimated:true};
  original.words[1].endOfSentence=false;original.words[2].endOfSentence=true;original.renderSegments=[{id:'sentence',text:original.text,words:original.words,startTime:original.startTime,endTime:original.endTime}];
  const before=structuredClone(original),freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const item of Object.values(value))if(item&&!Object.isFrozen(item))freeze(item);}};freeze(original);
  for(const target of [25/fps,100,-100]){
    const moved=moveWord(original,1,target,fps);assert.deepEqual(original,before);assert.notEqual(moved,original);assert.notEqual(moved.words,original.words);
    const {words:oldWords,timingEstimated:oldEstimated,...oldMetadata}=original,{words:newWords,timingEstimated:newEstimated,...newMetadata}=moved;
    assert.deepEqual(newMetadata,oldMetadata);assert.equal(newEstimated,false);assert.equal(oldEstimated,true);
    for(let i=0;i<oldWords.length;i++){const {startTime:oldStart,endTime:oldEnd,...oldData}=oldWords[i],{startTime:newStart,endTime:newEnd,...newData}=newWords[i];assert.deepEqual(newData,oldData);assert.notEqual(oldWords[i],newWords[i]);}
    frameInvariant(moved,fps);
  }
});
test('invalid times, frame rates, indices and malformed caption timings reject without mutation',()=>{
  const original=cue(),before=structuredClone(original);
  for(const start of [NaN,Infinity,-Infinity,'2',null])assert.throws(()=>moveWord(original,1,start,24));
  for(const fps of [0,-24,NaN,Infinity,'24'])assert.throws(()=>moveWord(original,1,2,fps));
  for(const index of [-1,3,1.5,NaN,'1'])assert.throws(()=>moveWord(original,index,2,24));
  for(const malformed of [
    {...original,startTime:NaN},{...original,endTime:0},
    {...original,words:original.words.map((word,i)=>i===1?{...word,startTime:1.5}:word)},
    {...original,words:original.words.map((word,i)=>i===1?{...word,endTime:NaN}:word)},
  ])assert.throws(()=>moveWord(malformed,1,2,24));
  assert.throws(()=>moveWord(framed(24,[[.25,.75]],[.25,.75]),0,0,24),/3 frames/);
  assert.throws(()=>moveWord(framed(24,[[10.25,13.25]],[10.25,13.25]),0,0,24),/3 frames/);
  assert.deepEqual(original,before);
});
test('repeated original drag snapshots never drift restored duration, overlap or move neighboring words',()=>{
  for(const fps of [24,30000/1001,60000/1001]){
    const original=framed(fps,[[0,15],[25,42],[55,100]]),duration=17,neighbors=[structuredClone(original.words[0]),structuredClone(original.words[2])];
    for(let i=0;i<1000;i++){
      const caption=moveWord(original,1,i%5===0?25/fps:Math.sin(i*17)*100/fps,fps),[start,end]=wordFrames(caption,1,fps);
      assert.ok(end-start>=3&&end-start<=duration);if(i%5===0)assert.deepEqual([start,end],[25,42]);
      assert.equal(caption.words[1].startTime,start/fps);assert.equal(caption.words[1].endTime,end/fps);frameInvariant(caption,fps);
      assert.deepEqual(caption.words[0],neighbors[0]);assert.deepEqual(caption.words[2],neighbors[1]);
    }
  }
});
test('adjusting the start or end of touching words creates a real gap while keeping all other endpoints fixed',()=>{
  for(const fps of [24,30000/1001,60000/1001]){
    const original=framed(fps,[[0,20],[20,40],[40,70]]);
    const laterStart=moveWordEdge(original,1,'startTime',25/fps,fps);
    assert.deepEqual(wordFrames(laterStart,0,fps),[0,20]);assert.deepEqual(wordFrames(laterStart,1,fps),[25,40]);assert.deepEqual(laterStart.words[2],original.words[2]);
    const earlierEnd=moveWordEdge(original,1,'endTime',35/fps,fps);
    assert.deepEqual(earlierEnd.words[0],original.words[0]);assert.deepEqual(wordFrames(earlierEnd,1,fps),[20,35]);assert.deepEqual(wordFrames(earlierEnd,2,fps),[40,70]);
    const startClamp=moveWordEdge(original,1,'startTime',-100,fps),endClamp=moveWordEdge(original,1,'endTime',100,fps);
    assert.deepEqual(startClamp.words,original.words);assert.deepEqual(endClamp.words,original.words);
    assert.deepEqual(wordFrames(moveWordEdge(original,1,'startTime',100,fps),1,fps),[37,40]);
    assert.deepEqual(wordFrames(moveWordEdge(original,1,'endTime',-100,fps),1,fps),[20,23]);
    frameInvariant(laterStart,fps);frameInvariant(earlierEnd,fps);
  }
});
test('preexisting short words are never automatically stretched and explicit edge extensions need three available frames',()=>{
  for(const fps of [24,30000/1001,60000/1001]){
    for(const duration of [.5,2,2.9]){
      const original=framed(fps,[[20,20+duration]]),before=structuredClone(original);
      for(const target of [-100,20/fps,100])assert.throws(()=>moveWord(original,0,target,fps),/3 frames/);
      assert.throws(()=>moveWordEdge(original,0,'startTime',20/fps,fps),/3 frames/);
      assert.throws(()=>moveWordEdge(original,0,'endTime',(20+duration)/fps,fps),/3 frames/);
      assert.deepEqual(original,before);
    }
    const short=framed(fps,[[20,22]]);
    assert.deepEqual(wordFrames(moveWordEdge(short,0,'endTime',23/fps,fps),0,fps),[20,23]);
    assert.deepEqual(wordFrames(moveWordEdge(short,0,'startTime',19/fps,fps),0,fps),[19,22]);
    const blocked=framed(fps,[[0,20],[20,22],[22,50]]),before=structuredClone(blocked);
    assert.ok(wordEdgeLimits(blocked,1,'startTime',fps).min>wordEdgeLimits(blocked,1,'startTime',fps).max);
    for(const edge of ['startTime','endTime'])for(const target of [-100,100])assert.throws(()=>moveWordEdge(blocked,1,edge,target,fps),/3 frames/);
    assert.deepEqual(blocked,before);
  }
});
