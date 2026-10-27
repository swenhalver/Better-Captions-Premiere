import test from 'node:test';
import assert from 'node:assert/strict';
import { numericInput, numericInputValue } from '../webview-ui/src/lib/numeric-input.ts';

function harness(value, attributes = {}, options = {}) {
  const node = new EventTarget(), changes = [], inputs = [];
  Object.assign(node, { value, disabled: false, readOnly: false, blurred: 0,
    getAttribute: name => attributes[name] ?? null,
    blur() { this.blurred++; this.dispatchEvent(new Event('blur')); } });
  const action = numericInput(node, options);
  node.addEventListener('change', () => changes.push(node.value));
  node.addEventListener('input', () => inputs.push(node.value));
  const key = (key, modifiers = {}) => {
    const event = new Event('keydown', { cancelable: true, bubbles: true });
    Object.assign(event, { key, ...modifiers }); node.dispatchEvent(event); return event;
  };
  node.dispatchEvent(new Event('focus'));
  return { node, key, changes, inputs, action };
}

test('numeric parsing preserves empty and partial drafts without treating them as zero', () => {
  for (const value of ['', ' ', '-', '+', '.', '-.', '1e', '1e-', '12px', '0x10', 'Infinity']) assert.ok(Number.isNaN(numericInputValue({ value })), value);
  for (const [value, expected] of [['-.25', -.25], ['+3.5', 3.5], ['1.', 1], ['1e-2', .01], [' 24 ', 24]]) assert.equal(numericInputValue({ value }), expected);
});

test('text editing keys retain browser defaults in both deletion directions', () => {
  const h = harness('125');
  for (const [key, modifiers] of [['Backspace', {}], ['Delete', {}], ['ArrowLeft', {}], ['ArrowRight', {}], ['Home', {}], ['End', {}], ['a', { metaKey: true }], ['Delete', { altKey: true }]]) {
    assert.equal(h.key(key, modifiers).defaultPrevented, false, key);
    assert.equal(h.node.value, '125');
  }
  assert.deepEqual(h.inputs, []); assert.deepEqual(h.changes, []);
});

test('Enter commits a valid numeric draft and Escape cancels without committing', () => {
  const h = harness('125');
  h.node.value = '25'; assert.equal(h.key('Enter').defaultPrevented, true);
  assert.deepEqual(h.changes, ['25']); assert.equal(h.node.blurred, 1);
  h.node.dispatchEvent(new Event('focus'));
  h.node.value = '-'; h.key('Escape');
  assert.equal(h.node.value, '25'); assert.deepEqual(h.changes, ['25']);
});

test('incomplete drafts are restored before change handlers receive them', () => {
  const h = harness('125');
  for (const value of ['', '-', '12px']) {
    h.node.value = value; h.node.dispatchEvent(new Event('change'));
    assert.equal(h.node.value, '125');
  }
  assert.deepEqual(h.changes, []);
});

test('up/down steps keep decimal precision and bounds without capturing horizontal caret keys', () => {
  const h = harness('1.2', { min: '.6', max: '1.3', step: '.05' });
  h.key('ArrowUp'); h.key('ArrowUp'); h.key('ArrowUp');
  assert.deepEqual(h.changes, ['1.25', '1.3']);
  h.key('ArrowDown'); assert.equal(h.node.value, '1.25');
  assert.equal(h.key('ArrowLeft').defaultPrevented, false);
});

test('readonly and disabled numeric fields keep their current value', () => {
  for (const flag of ['readOnly', 'disabled']) {
    const h = harness('125'); h.node[flag] = true;
    assert.equal(h.key('ArrowUp').defaultPrevented, false); assert.equal(h.node.value, '125');
  }
});

test('timing editors retain their own Enter/Escape handlers and action cleanup removes listeners', () => {
  const h = harness('1.25', {}, { managedKeys: true });
  assert.equal(h.key('Enter').defaultPrevented, false); assert.equal(h.key('Escape').defaultPrevented, false);
  h.action.destroy(); assert.equal(h.key('ArrowUp').defaultPrevented, false);
  assert.deepEqual(h.changes, []);
});


test('Enter followed by browser blur change publishes exactly once', () => {
  const h = harness('125');
  h.node.value = '25'; h.key('Enter');
  h.node.dispatchEvent(new Event('change'));
  assert.deepEqual(h.changes, ['25']);
});

test('validation readback becomes the baseline instead of a rejected value', async () => {
  const h = harness('125');
  h.node.addEventListener('change', () => { if (numericInputValue(h.node) > 500) h.node.value = '125'; });
  h.node.value = '501'; h.node.dispatchEvent(new Event('change'));
  await Promise.resolve();
  h.node.value = '-'; h.node.dispatchEvent(new Event('change'));
  assert.equal(h.node.value, '125');
});
