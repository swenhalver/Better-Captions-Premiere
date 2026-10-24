import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLineControls, confirmedLineScope } from '../webview-ui/src/lib/native-effect/line-controls.ts';

const empty = () => ({ clipKey: null, count: null });
const controls = (count, rolling = true) => ({ rollUp: { value: rolling ? 1 : 0 }, rollUpLines: { value: count }, groups: { value: count } });
function update(state, scope, clipKey, read) {
  const next = confirmLineControls(state, clipKey, read);
  return { state: next, scope: confirmedLineScope(scope, state, next) };
}

test('same-clip transient refreshes preserve the confirmed count and selected line scope', () => {
  let state = confirmLineControls(empty(), 'clip-A', controls(4));
  let scope = 'line-3';
  for (const read of [null, null, controls(4), null]) {
    const result = update(state, scope, 'clip-A', read);
    assert.equal(result.state.count, 4);
    assert.equal(result.scope, 'line-3');
    state = result.state; scope = result.scope;
  }
});

test('a confirmed reduction closes only a selected line above the new active count', () => {
  const state = confirmLineControls(empty(), 'clip-A', controls(4));
  const reduced = update(state, 'line-4', 'clip-A', controls(2));
  assert.equal(reduced.state.count, 2);
  assert.equal(reduced.scope, 'all');
  assert.equal(update(state, 'line-2', 'clip-A', controls(2)).scope, 'line-2');
  assert.equal(update(state, 'current', 'clip-A', controls(2)).scope, 'current');
  assert.equal(update(state, 'line-1', 'clip-A', controls(0)).scope, 'all');
  const paged = update(state, 'line-4', 'clip-A', { rollUp: { value: 0 }, rollUpLines: { value: 8 }, groups: { value: 2 } });
  assert.equal(paged.state.count, 2, 'nonrolling captions use lines per page');
  assert.equal(paged.scope, 'all');
});

test('changing or disconnecting the clip clears its confirmed count and line scope', () => {
  const state = confirmLineControls(empty(), 'clip-A', controls(4));
  const switched = update(state, 'line-2', 'clip-B', null);
  assert.deepEqual(switched, { state: { clipKey: 'clip-B', count: null }, scope: 'all' });
  assert.equal(update(state, 'line-2', 'clip-B', controls(4)).scope, 'all', 'a matching count on a new clip still resets the scope');
  assert.equal(update(state, 'current', 'clip-B', null).scope, 'current');
  const disconnected = update(state, 'line-2', null, null);
  assert.deepEqual(disconnected.state, empty());
  assert.equal(disconnected.scope, 'all');
  assert.equal(confirmLineControls(disconnected.state, 'clip-A', null).count, null, 'reconnecting must confirm again');
});

test('missing or invalid control values do not invent a count or erase a confirmed count', () => {
  const state = confirmLineControls(empty(), 'clip-A', controls(3));
  for (const read of [{}, { rollUp: { value: 1 } }, { rollUp: { value: 0 } }, controls(NaN), controls(Infinity)]) {
    assert.equal(confirmLineControls(state, 'clip-A', read), state);
    assert.equal(confirmLineControls(empty(), 'clip-B', read).count, null);
  }
});
