import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';
import { sampleArea, sampleAt, editSample } from '../webview-ui/src/lib/text-area.ts';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { compile } = require('svelte/compiler');
const folder = mkdtempSync(join(tmpdir(), 'better-captions-area-properties-'));
after(() => rmSync(folder, { recursive: true, force: true }));
symlinkSync(fileURLToPath(new URL('../webview-ui/node_modules', import.meta.url)), join(folder, 'node_modules'), 'dir');
const sourceUrl = new URL('../webview-ui/src/components/TextAreaControls.svelte', import.meta.url);
function component(file) {
  const result = compile(readFileSync(file, 'utf8'), { generate: 'server', filename: fileURLToPath(file) });
  assert.deepEqual(result.warnings, [], 'Compile the actual component without accessibility warnings');
  return result.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, (_match, quote, path) => {
    const url = path.endsWith('.svelte') ? pathToFileURL(join(folder, 'MotionIcon.mjs')) : new URL(`${path}.ts`, file);
    return `from ${quote}${url.href}${quote}`;
  });
}
writeFileSync(join(folder, 'MotionIcon.mjs'), component(new URL('../webview-ui/src/components/MotionIcon.svelte', import.meta.url)));
writeFileSync(join(folder, 'TextAreaControls.mjs'), component(sourceUrl));
const { default: TextAreaControls, captionAreaDefaults, areaPropertyReset, createTextAreaController } = await import(pathToFileURL(join(folder, 'TextAreaControls.mjs')));
const { render } = await import(pathToFileURL(require.resolve('svelte/server')));
const defaultPosition = { x: DEFAULT_STYLE.positionX, y: DEFAULT_STYLE.positionY };
const caption = patch => ({ id: 'caption', clipNodeId: 'clip', startTime: 10, endTime: 14, words: [], text: '',
  renderBounds: { x: 72, y: 832, width: 576, height: 512, frameWidth: 720, frameHeight: 1280 }, ...patch });

test('property resets use the original caption rectangle and its lower anchor', () => {
  const defaults = captionAreaDefaults(caption(), 720, 1280, defaultPosition);
  assert.deepEqual(defaults, { position: [360, 1088], width: 576, height: 512 });
  assert.deepEqual(areaPropertyReset('position', defaults), { track: 'position', operation: 'set', value: [360, 1088] });
  assert.deepEqual(areaPropertyReset('width', defaults), { track: 'width', operation: 'set', value: [576] });
  assert.deepEqual(areaPropertyReset('height', defaults), { track: 'height', operation: 'set', value: [512] });
});

test('missing bounds preserve explicit caption placement or the real default anchor', () => {
  const placed = captionAreaDefaults(caption({ renderBounds: undefined, position: { x: .25, y: .75 } }), 720, 1280, defaultPosition);
  assert.deepEqual(placed, { position: [180, 960], width: null, height: null });
  const defaults = captionAreaDefaults(caption({ renderBounds: undefined }), 720, 1280, defaultPosition);
  assert.deepEqual(defaults.position, [360, 1088]);
  assert.equal(areaPropertyReset('width', defaults), null, 'Do not invent a natural native width');
  assert.equal(areaPropertyReset('height', defaults), null, 'Do not invent a natural native height');
  const demo = captionAreaDefaults(caption({ renderBounds: undefined }), 720, 1280, defaultPosition, { width: 576, height: 512 });
  assert.deepEqual(areaPropertyReset('height', demo).value, [512]);
});

test('invalid reset values cannot produce a native mutation', () => {
  for (const track of ['position', 'width', 'height']) {
    const defaults = { position: [NaN, 100], width: 0, height: Infinity };
    assert.equal(areaPropertyReset(track, defaults), null);
  }
});

function harness(t, at) {
  let native = sampleArea(720, 1280, 24, 10, 14);
  for (const track of ['position', 'width', 'height']) {
    native = editSample(native, { signature: native.signature, frame: 0, track, operation: 'toggle' });
    native = editSample(native, { signature: native.signature, frame: 24, track, operation: 'set', value: track === 'position' ? [420, 900] : [track === 'width' ? 400 : 300] });
    native.tracks[track].keys[0].interpolation = 'bezier';
    native.tracks[track].keys[1].interpolation = 'native';
  }
  const context = { key: 'caption-link', caption: caption(), sequenceId: 'sequence', frameRate: 24, currentTime: 10, visible: true, disabled: false };
  const edits = [], before = structuredClone(native);
  let time = 10;
  const controller = createTextAreaController({ current: () => context,
    getTime: async () => time,
    read: async (_context, frame) => ({ ...sampleAt(native, frame), signature: `fresh-${frame}` }),
    edit: async (_context, request) => { edits.push(structuredClone(request)); native = editSample(native, request); return native; },
    seek: async () => {}, state() {}, busy() {}, error(error) { assert.fail(error); }, changed: async () => {},
  });
  t.after(() => controller.stop());
  return { controller, edits, before, get native() { return native; }, ready: async () => { await controller.sync(); time = 10 + at / 24; } };
}

test('reset updates the confirmed playhead key in place while preserving other keys and easing', async t => {
  const h = harness(t, 24); await h.ready();
  await h.controller.change(areaPropertyReset('width', captionAreaDefaults(caption(), 720, 1280, defaultPosition)));
  assert.deepEqual(h.edits, [{ track: 'width', operation: 'set', value: [576], signature: 'fresh-24', frame: 24 }]);
  assert.deepEqual(h.native.tracks.position, h.before.tracks.position);
  assert.deepEqual(h.native.tracks.height, h.before.tracks.height);
  assert.deepEqual(h.native.tracks.width.keys[0], h.before.tracks.width.keys[0]);
  assert.equal(h.native.tracks.width.keys[1].ticks, h.before.tracks.width.keys[1].ticks);
  assert.equal(h.native.tracks.width.keys[1].interpolation, 'native');
  assert.deepEqual(h.native.tracks.width.keys[1].value, [576]);
});

test('reset between animated keys adds only a current-frame key and never disables animation', async t => {
  const h = harness(t, 12); await h.ready();
  await h.controller.change(areaPropertyReset('height', captionAreaDefaults(caption(), 720, 1280, defaultPosition)));
  assert.equal(h.native.tracks.height.animated, true);
  assert.equal(h.native.tracks.height.keys.length, 3);
  assert.deepEqual(h.native.tracks.height.keys.filter(key => key.frame !== 12), h.before.tracks.height.keys);
  assert.deepEqual(h.native.tracks.height.keys.find(key => key.frame === 12).value, [512]);
  assert.deepEqual(h.native.tracks.width, sampleAt(h.before, 12).tracks.width);
});

test('the actual component shows compact property rows by default and keeps detailed keys closed', () => {
  const html = render(TextAreaControls, { props: { caption: caption(), sequenceId: 'sequence', frameRate: 24,
    frameWidth: 720, frameHeight: 1280, currentTime: 10, visible: true, isDemo: true,
    read: async () => {}, edit: async () => {}, getCurrentTime: async () => 10,
    onSeek() {}, onSelect() {}, onBusy() {}, onChanged() {},
  } }).body;
  assert.match(html, /<details[^>]*class="caption-section text-area[^>]*\bopen/);
  assert.doesNotMatch(html.match(/<details[^>]*class="text-area__keyframes[^>]*>/)?.[0] ?? '', /\bopen/);
  for (const label of ['Position X, px', 'Position Y, px', 'Width, px', 'Height, px',
    'Reset position at playhead', 'Reset width at playhead', 'Reset height at playhead']) assert.ok(html.includes(`aria-label="${label}"`), label);
  assert.equal((html.match(/aria-label="(?:Position|Width|Height) keyframes"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Uniform Scale|Refresh from sample|At playhead/);
});
