import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedNumber, parsedNumber, scrubbedNumber } from '../webview-ui/src/lib/scrubbable-number.ts';

test('dragging uses the original value, including fine decimal steps and negative ranges', () => {
  assert.equal(scrubbedNumber(1.2, 3, .05), 1.35);
  assert.equal(scrubbedNumber(1.2, -13, .05), .55);
  assert.equal(scrubbedNumber(-2.5, -4, .5), -4.5);
  assert.equal(scrubbedNumber(12.35, 4, .5, { altKey: true }), 12.55);
  assert.equal(scrubbedNumber(12, -4, .5, { shiftKey: true }), -8);
  assert.equal(scrubbedNumber(12, 3, 1, { shiftKey: true, altKey: true }), 12.3);
});

test('dragging stops at the bounds without changing its anchor for a reverse drag', () => {
  const bounds = { min: 8, max: 400 };
  assert.equal(scrubbedNumber(390, 100, .5, {}, bounds), 400);
  assert.equal(scrubbedNumber(390, 10, .5, {}, bounds), 395);
  assert.equal(scrubbedNumber(8, -10, .5, {}, bounds), 8);
  assert.equal(boundedNumber(.1 + .2), .3);
});

test('exact input accepts decimals independently of drag step and ignores incomplete input', () => {
  assert.equal(parsedNumber(' 17.125 ', { min: 8, max: 400 }), 17.125);
  assert.equal(parsedNumber('401', { min: 8, max: 400 }), 400);
  assert.equal(parsedNumber('-5', { min: 8, max: 400 }), 8);
  for (const text of ['', ' ', '-', '.', 'NaN', 'Infinity', '12px']) assert.equal(parsedNumber(text), null);
  assert.throws(() => boundedNumber(Infinity), /finite number/);
});
