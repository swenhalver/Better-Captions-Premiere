import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToHsla, hslaToHex } from '../webview-ui/src/lib/hsla-color.ts';

test('the picker converts exact primary, neutral and mixed caption colors without altering alpha', () => {
  for (const color of ['#ffffff','#000000','#ff0000','#00ff00','#0000ff','#abcdef','#993fa0','#f6ca23','#010203']) {
    const converted = hslaToHex(hexToHsla(color, .37));
    assert.deepEqual(converted, { color, opacity: .37 });
  }
  assert.deepEqual(hexToHsla('#f00', .6), { h: 0, s: 100, l: 50, a: .6 });
  assert.deepEqual(hexToHsla('#808080'), { h: 0, s: 0, l: 128/255*100, a: 1 });
});

test('HSLA channel edits use separate hex and alpha values supported by saved caption styles', () => {
  assert.deepEqual(hslaToHex({h:120,s:100,l:50,a:.25}),{color:'#00ff00',opacity:.25});
  assert.deepEqual(hslaToHex({h:360,s:100,l:50,a:1}),{color:'#ff0000',opacity:1});
  assert.deepEqual(hslaToHex({h:240,s:100,l:0,a:0}),{color:'#000000',opacity:0});
  assert.deepEqual(hslaToHex({h:200,s:100,l:100,a:1}),{color:'#ffffff',opacity:1});
});

test('invalid or out-of-range channels never produce malformed saved colors or alpha', () => {
  for (const input of [
    {h:NaN,s:Infinity,l:NaN,a:Infinity},
    {h:-10,s:200,l:-2,a:8},
    {h:500,s:-4,l:120,a:-2},
  ]) {
    const result=hslaToHex(input);
    assert.match(result.color,/^#[\da-f]{6}$/);
    assert.ok(result.opacity>=0&&result.opacity<=1);
  }
  assert.deepEqual(hexToHsla('invalid', -1),{h:0,s:0,l:0,a:0});
});
