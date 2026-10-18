import test from 'node:test';
import assert from 'node:assert/strict';
// The validator module uses a browser type only; Node does not start the bridge.
import {validateStylePatch,validateCaptionPatch,validateAreaRead,validateAreaEdit} from '../webview-ui/src/lib/agent-bridge.ts';

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

test('area hooks choose applied captions and bounded exact-key operations without accepting native paths or code',()=>{
  const captions=[{id:'cue-1',clipNodeId:'clip',projectItemId:'item',mediaPath:'/managed/caption.mov'}];
  assert.deepEqual(validateAreaRead({captionId:'cue-1',frame:12},captions),{captionId:'cue-1',frame:12});
  const payload={captionId:'cue-1',edit:{operation:'set-key',track:'width',signature:'confirmed',frame:12,keyTicks:'127008000000',value:[640]}};
  assert.deepEqual(validateAreaEdit(payload,captions),payload);
  for(const value of [{captionId:'missing'},{captionId:'cue-1',frame:-1},{captionId:'cue-1',frame:1.5},{captionId:'cue-1',mediaPath:'/unrelated.mov'}])assert.throws(()=>validateAreaRead(value,captions));
  for(const edit of [{operation:'exec'},{signature:''},{signature:'x'.repeat(300001)},{keyTicks:'code()'},{keyTicks:undefined},{value:[Infinity]},{value:[1,2]},{targetFrame:1.5},{track:'rotation'},{interpolation:'custom-code'},{path:'/unrelated.mov'}]){
    assert.throws(()=>validateAreaEdit({...payload,edit:{...payload.edit,...edit}},captions));
  }
  assert.throws(()=>validateAreaEdit({...payload,edit:JSON.parse('{"__proto__":{},"operation":"undo","frame":0,"signature":"ok"}')},captions));
  assert.throws(()=>validateAreaRead({captionId:'cue-1'},[{id:'cue-1'}]),/applied/);
});
