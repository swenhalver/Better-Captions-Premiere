import test from 'node:test';
import assert from 'node:assert/strict';
// The validator module uses a browser type only; Node does not start the bridge.
import {validateStylePatch,validateCaptionPatch} from '../webview-ui/src/lib/agent-bridge.ts';

test('agent styles allow independent word appearances and reject unknown capabilities',()=>{
  const patch={activeWord:{bubble:true,bubbleColor:'#FFD84D',sizeScale:1.5},spokenWord:{color:'#888888',opacity:.6},positionY:.8};
  assert.deepEqual(validateStylePatch(patch),patch);
  for(const p of [{exec:'anything'},{activeWord:{fontSize:1201}},{fontSize:Infinity},{positionX:2},{spokenWord:{color:'javascript:code'}}])assert.throws(()=>validateStylePatch(p));
  assert.throws(()=>validateStylePatch(JSON.parse('{"__proto__":{"bad":true}}')));
});
test('agent caption edits retain timeline identity and never accept replacement media paths',()=>{
  const current=[{id:'cue-1',text:'Hello',startTime:0,endTime:1,words:[{text:'Hello',startTime:0,endTime:.9,isActive:false}],clipNodeId:'premiere-node',projectItemId:'item',mediaPath:'/managed/caption.mov'}];
  const next=validateCaptionPatch([{...current[0],text:'World',words:[{...current[0].words[0],text:'World'}],clipNodeId:'other-node',mediaPath:'/unrelated/media.mov'}],current);
  assert.equal(next[0].clipNodeId,'premiere-node');assert.equal(next[0].mediaPath,'/managed/caption.mov');assert.equal(next[0].text,'World');
  assert.throws(()=>validateCaptionPatch([],current),/linked timeline/);
});
