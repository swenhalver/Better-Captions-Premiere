import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleCaptionContainers } from '../webview-ui/src/lib/export/containers.ts';
import { captionSegmentRange, replaceCaptionSegment } from '../webview-ui/src/lib/transcript/segments.ts';
import { replaceText, retime, validateCaptions } from '../webview-ui/src/lib/transcript/edit.ts';
import { refreshCaptionGroups } from '../webview-ui/src/lib/transcript/parser.ts';
import { validateCaptionPatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { captionLinks, confirmCaptionGeometry } from '../webview-ui/src/lib/program-monitor.ts';

const words = text => text.split(' ').map((text, index) => ({ text, startTime: index * .3, endTime: index * .3 + .2, isActive: false }));
function bundle() {
  const input = words('one two three four five six');
  return bundleCaptionContainers([{ id:'original',text:input.map(word=>word.text).join(' '),words:input,startTime:0,endTime:1.8 }], 9)[0];
}
const view = (container, segment) => ({ ...container, ...segment, id:container.id, endTime:Math.min(container.endTime,segment.endTime) });

test('sentence text edits splice into the full transcript without losing words from neighboring sentences', () => {
  const original = bundle(), segment = original.renderSegments[1], before = structuredClone(original);
  const updated = replaceCaptionSegment(original, segment, replaceText(view(original,segment), 'updated'));
  const [refreshed] = refreshCaptionGroups([updated]);
  assert.equal(refreshed.text, 'one two updated four five six');
  assert.deepEqual(refreshed.words.slice(0,2),original.words.slice(0,2));
  assert.deepEqual(refreshed.words.slice(3),original.words.slice(3));
  assert.equal(refreshed.id,original.id); assert.equal(refreshed.captionBundle,true);
  assert.equal(refreshed.startTime,original.startTime); assert.equal(refreshed.endTime,original.endTime);
  assert.deepEqual(original,before); validateCaptions([refreshed]);
});

test('inserting words into one sentence preserves the rest of a caption bundle', () => {
  const original = bundle(), segment = original.renderSegments[1];
  const updated = replaceCaptionSegment(original,segment,replaceText(view(original,segment),'brand new words'));
  assert.equal(updated.words.length,original.words.length+2); assert.equal(updated.text,'one two brand new words four five six');
  assert.deepEqual(updated.words.slice(-3),original.words.slice(-3)); validateCaptions([updated]);
});

test('sentence timing edits keep native clip timing and reject overlaps or out-of-container speech', () => {
  const original = { ...bundle(),clipNodeId:'native',motionProfile:{signature:'keep-keys'} }, segment=original.renderSegments[1];
  const updated = replaceCaptionSegment(original,segment,retime(view(original,segment),.65,.88));
  assert.equal(updated.startTime,0); assert.equal(updated.endTime,1.8); assert.equal(updated.clipNodeId,'native');
  assert.equal(updated.motionProfile.signature,'keep-keys'); assert.equal(updated.words[2].startTime,.65);
  assert.throws(()=>replaceCaptionSegment(original,segment,retime(view(original,segment),.4,.95)),/overlap/);
  assert.throws(()=>replaceCaptionSegment(original,segment,retime(view(original,segment),2,2.5)),/inside its caption clip/);
});

test('a legacy sentence crossing a native cut cannot replace words in the wrong clip', () => {
  const original = bundle(), segment=original.renderSegments[0], fragment={...original,words:original.words.slice(1)};
  assert.equal(captionSegmentRange(fragment,segment),null);
  assert.throws(()=>replaceCaptionSegment(fragment,segment,view(original,segment)),/sentence changed/);
});

test('whole-transcript agent edits support more than the old per-caption 300-word limit and preserve bundle identity', () => {
  const input=Array.from({length:400},(_,index)=>({text:'word'+index,startTime:index*.2,endTime:index*.2+.1,isActive:false}));
  const [original]=bundleCaptionContainers([{id:'long',words:input,text:input.map(word=>word.text).join(' '),startTime:0,endTime:80}],56);
  original.clipNodeId='native';original.projectItemId='item';original.mediaPath='/managed/caption.mov';
  const patch=structuredClone(original);patch.position={x:.4,y:.8};patch.captionBundle=false;
  const [updated]=validateCaptionPatch([patch],[original]);
  assert.equal(updated.words.length,400);assert.equal(updated.captionBundle,true);assert.equal(updated.clipNodeId,'native');
  assert.ok(updated.renderSegments.length>1);assert.deepEqual(updated.position,{x:.4,y:.8});
});

test('whole-transcript word and text budgets remain bounded across containers', () => {
  const input=Array.from({length:25001},(_,index)=>({text:'a',startTime:index*.2,endTime:index*.2+.1,isActive:false}));
  const source={id:'a',words:input,text:'a',startTime:0,endTime:6000};
  assert.throws(()=>validateCaptionPatch([source,{...source,id:'b'}],[]),/at most 50000 words/);
  const longWords=Array.from({length:501},(_,index)=>({text:'a'.repeat(500),startTime:index*.2,endTime:index*.2+.1,isActive:false}));
  assert.throws(()=>validateCaptionPatch([{...source,words:longWords}],[]),/250000 characters/);
});

test('bundle identity survives native selection links and cannot change during geometry readback', () => {
  const original={...bundle(),clipNodeId:'native',projectItemId:'item',mediaPath:'/caption.mov'};
  assert.equal(captionLinks([original])[0].captionBundle,true);
  assert.throws(()=>confirmCaptionGeometry(original,{...original,captionBundle:false},{id:original.id,clipNodeId:'native',projectItemId:'item',path:'/caption.mov',watchSignature:'geometry'}),/link changed/);
});
