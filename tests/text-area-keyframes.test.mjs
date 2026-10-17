import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript'), loaded = {};
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(compile(readFileSync(new URL('../webview-ui/src/lib/text-area.ts', import.meta.url), 'utf8')), { exports: loaded, structuredClone });
const { sampleArea, sampleAt, editSample } = loaded;
const plain = value => JSON.parse(JSON.stringify(value));
const normalizeSource = source => source.replace(/\r\n?/g, '\n');
function animated(track = 'position') {
  let area = sampleArea(1920, 1080, 24, 10, 14);
  area = editSample(area, { signature: area.signature, frame: 0, operation: 'toggle', track });
  return editSample(area, { signature: area.signature, frame: 24, operation: 'set', track, value: track === 'position' ? [1200, 700] : [800] });
}
test('sample selected-key edits use exact ticks independently of the displayed playhead', () => {
  const area = animated(), key = area.tracks.position.keys[0];
  const next = editSample(sampleAt(area, 48), { signature: area.signature, frame: 48, operation: 'set-key', track: 'position', keyTicks: key.ticks, value: [800, 500] });
  assert.equal(next.frame, 48); assert.deepEqual(plain(next.tracks.position.keys[0].value), [800, 500]);
  assert.deepEqual(plain(next.tracks.position.keys[1].value), [1200, 700]); assert.equal(area.tracks.position.keys[0].value[0], 960);
});
test('moving a sample key preserves its value and easing while changing exact tick identity', () => {
  let area = animated(); const key = area.tracks.position.keys[1];
  area = editSample(area, { signature: area.signature, frame: 0, operation: 'interpolation', track: 'position', keyTicks: key.ticks, interpolation: 'hold' });
  const next = editSample(area, { signature: area.signature, frame: 0, operation: 'move-key', track: 'position', keyTicks: key.ticks, targetFrame: 36 });
  const moved = next.tracks.position.keys[1]; assert.equal(moved.frame, 36); assert.notEqual(moved.ticks, key.ticks);
  assert.deepEqual(plain(moved.value), [1200, 700]); assert.equal(moved.interpolation, 'hold');
});
test('timing collisions, stale ticks and invalid frames leave sample keys unchanged', () => {
  const area = animated(), before = plain(area), keyTicks = area.tracks.position.keys[1].ticks;
  for (const request of [
    { operation: 'move-key', keyTicks, targetFrame: 0 }, { operation: 'move-key', keyTicks, targetFrame: -1 },
    { operation: 'move-key', keyTicks, targetFrame: 96 }, { operation: 'move-key', keyTicks, targetFrame: 2.5 },
    { operation: 'remove-key', keyTicks: 'missing' },
  ]) assert.throws(() => editSample(area, { signature: area.signature, frame: 0, track: 'position', ...request }));
  assert.deepEqual(plain(area), before);
});
test('deleting a selected key never deletes a different playhead key', () => {
  const area = animated(), next = editSample(area, { signature: area.signature, frame: 24, operation: 'remove-key', track: 'position', keyTicks: area.tracks.position.keys[0].ticks });
  assert.equal(next.tracks.position.keys.length, 1); assert.equal(next.tracks.position.keys[0].frame, 24);
});
test('width and height stay independent when editing a selected size key', () => {
  const area = animated('width'), height = plain(area.tracks.height);
  const next = editSample(area, { signature: area.signature, frame: 48, operation: 'set-key', track: 'width', keyTicks: area.tracks.width.keys[1].ticks, value: [500] });
  assert.equal(next.tracks.width.keys[1].value[0], 500); assert.deepEqual(plain(next.tracks.height), height);
});
function revisionHarness(source) {
  const effect = normalizeSource(source).match(/\$effect\(\(\)=>\{\n    const revision=refreshRevision;[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(effect, 'Exercise the actual refreshRevision effect');
  const api = {}; vm.runInNewContext(compile(`let refreshRevision=0,refreshReady=false,lastRefreshRevision,refreshes=0,run;const controller={refresh(){refreshes++;}},untrack=fn=>fn(),$effect=fn=>run=fn;${effect};export function update(value){refreshRevision=value;run();return refreshes;}`), { exports: api });
  return api;
}
for (const [ending, newline] of [['LF', '\n'], ['CRLF', '\r\n']]) test(`a native dirty revision requests one read-only refresh without polling unchanged revisions (${ending})`, () => {
  const source = normalizeSource(readFileSync(new URL('../webview-ui/src/components/TextAreaControls.svelte', import.meta.url), 'utf8')).replace(/\n/g, newline);
  if (ending === 'CRLF') assert.ok(source.includes('\r\n'), 'Run the actual source with Windows line endings');
  const api = revisionHarness(source);
  assert.equal(api.update(0), 0, 'Initial mount already has its normal read');
  assert.equal(api.update('native-one'), 1); assert.equal(api.update('native-one'), 1);
  assert.equal(api.update('native-two'), 2); assert.equal(api.update('native-two'), 2);
});
test('keyframe lane keyboard navigation moves both selection and focus to the next native key', () => {
  const source = normalizeSource(readFileSync(new URL('../webview-ui/src/components/TextAreaControls.svelte', import.meta.url), 'utf8'));
  const handler = source.match(/  function keyNavigation\([\s\S]*?(?=  function setKeyValue)/)?.[0];
  assert.ok(handler, 'Exercise the actual component keyboard handler');
  const keys = [{ ticks: 'outside', frame: -10 }, { ticks: '0', frame: 0 }, { ticks: '24', frame: 24 }], chosen = [];
  const api = {}; vm.runInNewContext(compile(`type AreaTrack=string;type AreaKey=any;declare const shownArea:any,chooseKey:any;${handler};export const navigate=keyNavigation;`), { exports: api, shownArea: { count: 48, tracks: { position: { keys } } }, chooseKey: (track, key) => chosen.push([track, key.ticks]) });
  let focused = null, prevented = false;
  const buttons = keys.slice(1).map(key => ({ dataset: { keyTicks: key.ticks }, focus() { focused = key.ticks; } }));
  api.navigate({ key: 'ArrowRight', preventDefault() { prevented = true; }, currentTarget: { parentElement: { querySelectorAll: () => buttons } } }, 'position', keys[1]);
  assert.equal(prevented, true); assert.equal(focused, '24'); assert.deepEqual(chosen, [['position', '24']]);
});
