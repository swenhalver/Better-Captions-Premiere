import test from 'node:test';
import assert from 'node:assert/strict';
import {createArea,valueAt,putKey,setAreaValue,toggleAnimation,toggleKey,remapArea} from './geometry.mjs';
test('position interpolation shares one key for X and Y and replaces duplicates',()=>{
  const a=createArea(),t=a.tracks.position;
  putKey(t,0,[100,200],0,24);putKey(t,20,[300,400],0,24);
  assert.deepEqual(valueAt(t,10),[200,300]);
  setAreaValue(a,'position',0,225,10,0,24);setAreaValue(a,'position',1,350,10,0,24);
  assert.equal(t.keys.length,3);assert.deepEqual(valueAt(t,10),[225,350]);
});
test('hold, eased values, and out-of-range times stay bounded',()=>{
  const t=createArea().tracks.width;
  putKey(t,-10,[100],0,24,'hold');putKey(t,999,[500],0,24);
  assert.deepEqual(t.keys.map(k=>k.frame),[0,23]);
  assert.deepEqual(valueAt(t,10),[100]);assert.deepEqual(valueAt(t,24),[500]);
  t.keys[0].interpolation='ease';
  assert.ok(valueAt(t,5)[0]>100&&valueAt(t,5)[0]<500);
});
test('dimension edits cannot become zero or NaN and do not alter other tracks',()=>{
  const a=createArea();
  assert.equal(setAreaValue(a,'width',0,0,3,0,24).value,96);
  const before=structuredClone(a);assert.equal(setAreaValue(a,'height',0,'',3,0,24).invalid,true);assert.deepEqual(a,before);
  assert.deepEqual(a.tracks.position.value,[960,918]);assert.deepEqual(a.tracks.height.value,[216]);
});
test('disabling and removing the final key retain the current value',()=>{
  const t=createArea().tracks.height;
  putKey(t,0,[200],0,24);putKey(t,20,[400],0,24);toggleAnimation(t,10,0,24);
  assert.equal(t.enabled,false);assert.deepEqual(t.value,[300]);
  toggleAnimation(t,10,0,24);toggleKey(t,10,0,24);
  assert.equal(t.enabled,false);assert.deepEqual(t.value,[300]);
});
test('splitting and merging preserve geometry at every frame',()=>{
  const a={start:0,end:24,area:createArea()},b={start:24,end:48,area:createArea()};
  putKey(a.area.tracks.width,0,[400],0,24,'ease');putKey(a.area.tracks.width,23,[1000],0,24);
  b.area.tracks.width.value=[900];
  const split=remapArea([a],10,24),merged=remapArea([a,b],0,48);
  for(let i=0;i<48;i++)assert.deepEqual(valueAt(merged.tracks.width,i),valueAt((i<24?a:b).area.tracks.width,i));
  for(let i=10;i<24;i++)assert.deepEqual(valueAt(split.tracks.width,i),valueAt(a.area.tracks.width,i));
});
