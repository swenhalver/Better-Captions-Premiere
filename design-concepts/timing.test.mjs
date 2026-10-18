import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveEdge,validCaption} from './timing.mjs';
const phrase=()=>({start:0,end:72,words:[{text:'Every',start:0,end:24},{text:'word',start:24,end:48},{text:'matters',start:48,end:72}]});
test('a shared boundary moves both edges without overlapping',()=>{const c=phrase();moveEdge(c,1,'start',30);assert.equal(c.words[0].end,30);assert.equal(c.words[1].start,30);assert.ok(validCaption(c));});
test('extreme edits preserve a frame for both adjacent words',()=>{const c=phrase();assert.ok(moveEdge(c,1,'end',10000).limited);assert.equal(c.words[1].end,71);assert.equal(c.words[2].start,71);assert.ok(moveEdge(c,1,'start',-10000).limited);assert.equal(c.words[0].end,1);assert.equal(c.words[1].start,1);assert.ok(validCaption(c));});
test('gaps may shrink without moving a disconnected neighbour',()=>{const c=phrase();c.words[0].end=18;moveEdge(c,1,'start',20);assert.equal(c.words[0].end,18);assert.equal(c.words[1].start,20);assert.ok(validCaption(c));});
test('invalid input leaves timing unchanged',()=>{const c=phrase(),before=structuredClone(c);assert.ok(moveEdge(c,1,'start',NaN).invalid);assert.deepEqual(c,before);});
test('thousands of mixed boundary edits retain integer non-overlapping intervals',()=>{const c=phrase();let seed=19321;for(let i=0;i<8000;i++){seed=(1664525*seed+1013904223)>>>0;const index=seed%3;seed=(1664525*seed+1013904223)>>>0;const edge=seed%2?'start':'end';seed=(1664525*seed+1013904223)>>>0;moveEdge(c,index,edge,(seed%200)-60+.24);assert.ok(validCaption(c),`Invariant failed at edit ${i}`);}});
