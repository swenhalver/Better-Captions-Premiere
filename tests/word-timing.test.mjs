import test from 'node:test';
import assert from 'node:assert/strict';
import {moveWordEdge} from '../webview-ui/src/lib/transcript/timing.ts';
import {validateCaptions} from '../webview-ui/src/lib/transcript/edit.ts';
const cue=()=>({id:'one',text:'one two three',startTime:1,endTime:4,words:[{text:'one',startTime:1,endTime:2},{text:'two',startTime:2,endTime:3},{text:'three',startTime:3,endTime:4}]});
test('connected word edges move together and clamp to one frame at fractional frame rates',()=>{
  for(const fps of [24,25,30000/1001,60]){
    let c=cue();for(let i=0;i<3000;i++){
      const index=i%3,edge=i%2?'startTime':'endTime',target=Math.sin(i*17)*100;
      c=moveWordEdge(c,index,edge,target,fps);validateCaptions([c]);
      for(const w of c.words)assert.ok((w.endTime-w.startTime)*fps>=1-1e-7);
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
