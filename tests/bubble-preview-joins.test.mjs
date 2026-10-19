import test from 'node:test';
import assert from 'node:assert/strict';
import { bubblePreviewJoins } from '../webview-ui/src/lib/bubble-preview-joins.ts';
const word=(left,baseline=20,bubble=true,fillSpaces=true)=>({left,baseline,bubble,fillSpaces});

test('wrapped background rows each retain rounded first and last outer ends',()=>{
  const result=bubblePreviewJoins([word(20),word(90),word(160),word(25,50),word(100,50),word(170,50)]);
  assert.deepEqual(result.before,[false,true,true,false,true,true]);
  assert.deepEqual(result.after,[true,true,false,true,true,false]);
});

test('a non-bubbled word or unfilled space ends the continuous rounded run',()=>{
  const result=bubblePreviewJoins([word(20),word(80,20,false),word(140),word(200,20,true,false),word(260)]);
  assert.deepEqual(result.before,[false,false,false,true,false]);
  assert.deepEqual(result.after,[false,false,true,false,false]);
});

test('overlapping padded boxes with centered short next row never join across text baselines',()=>{
  // Large padding creates overlapping background rectangles; centering may put
  // the next row's start to the right of a prior row's final short word.
  const boxes=[
    {...word(20,60),top:0,bottom:80},
    {...word(80,60),top:0,bottom:80},
    {...word(120,100),top:40,bottom:120},
    {...word(200,100),top:40,bottom:120},
  ];
  assert.ok(boxes[1].bottom>boxes[2].top && boxes[2].left>boxes[1].left,'Reproduces the old overlap heuristic’s false positive');
  assert.deepEqual(bubblePreviewJoins(boxes),{before:[false,true,false,true],after:[true,false,true,false]});
});

test('the reported Every-word-has-its / own-style wrap keeps both outer line ends rounded',()=>{
  // Left positions and 43.5px row advance from the reported live layout;
  // baseline values use that same row advance, independent of padded height.
  const result=bubblePreviewJoins([word(344,555),word(432.82,555),word(514.37,555),word(576.5,555),word(409.23,598.5),word(480.21,598.5)]);
  assert.deepEqual(result.before,[false,true,true,true,false,true]);
  assert.deepEqual(result.after,[true,true,true,false,true,false]);
});

test('different font and padding boxes on the same baseline join without depending on box tops',()=>{
  const result=bubblePreviewJoins([{...word(10,30),top:8,bottom:36},{...word(50,30),top:0,bottom:44},word(20,70)]);
  assert.deepEqual(result,{before:[false,true,false],after:[true,false,false]});
});
