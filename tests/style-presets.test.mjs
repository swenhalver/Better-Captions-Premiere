import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { capturePresetLook, applyPresetLook, emptyPresetLibrary, addStylePreset, changeStylePreset, validatePresetLibrary, PRESET_STORAGE_KEY } from '../webview-ui/src/lib/style-presets.ts';
import { createHostAPI } from '../webview-ui/src/cep-api.ts';
const require = createRequire(import.meta.url);
const { createPresetStore } = require('../uxp/style-presets.js');
const look = () => capturePresetLook(structuredClone(DEFAULT_STYLE), structuredClone(DEFAULT_ANIMATION));
const library = () => addStylePreset(emptyPresetLibrary(), 'Brand captions', look(), 'preset-brand', 1000);

test('presets capture the resolved appearance of all word states, layout and animation', () => {
  const source = structuredClone(DEFAULT_STYLE);
  source.strokeEnabled = true; source.strokeWidth = 7; source.shadowColor = '#123456';
  source.activeWord.italic = true; source.activeWord.letterSpacing = 3;
  source.spokenWord = { ...source.spokenWord, fontFamily: 'Georgia', bubble: true, bubbleColor: '#abc123' };
  source.upcomingWord = { color: '#abcdef', opacity: .25 };
  const animation = { ...DEFAULT_ANIMATION, preset: 'bounce', fadeInDuration: .8 };
  const saved = capturePresetLook(source, animation);
  for (const state of ['spokenWord', 'activeWord', 'upcomingWord']) assert.deepEqual(saved.style[state], resolveAppearance(source, state));
  assert.deepEqual(saved.animation, animation);
  assert.equal(saved.style.backgroundColor, source.backgroundColor);
  for (const excluded of ['positionX', 'positionY', 'maxChars']) assert.equal(Object.hasOwn(saved.style, excluded), false);
  source.activeWord.italic = false; animation.fadeInDuration = 0;
  assert.equal(saved.style.activeWord.italic, true); assert.equal(saved.animation.fadeInDuration, .8);
});

test('applying a preset clears unrelated optional word overrides and preserves placement and grouping', () => {
  const target = structuredClone(DEFAULT_STYLE);
  target.positionX = .1; target.positionY = .2; target.maxChars = 2;
  target.spokenWord.italic = true; target.activeWord.letterSpacing = 9; target.upcomingWord = { shadowEnabled: true, shadowColor: '#ff0000' };
  const saved = look(), result = applyPresetLook(target, saved);
  assert.equal(result.style.positionX, .1); assert.equal(result.style.positionY, .2); assert.equal(result.style.maxChars, 2);
  assert.equal(result.style.spokenWord.italic, false); assert.equal(result.style.activeWord.letterSpacing, 0);
  for (const state of ['spokenWord', 'activeWord', 'upcomingWord']) assert.deepEqual(resolveAppearance(result.style, state), saved.style[state]);
  assert.equal(target.activeWord.letterSpacing, 9, 'applying never mutates its input');
});

test('named library edits preserve IDs, reject duplicate names, and never modify source snapshots', () => {
  const initial = library();
  assert.throws(() => addStylePreset(initial, ' BRAND CAPTIONS ', look(), 'preset-second', 2000), /already exists/);
  for (const name of ['', '   ', 'x'.repeat(81), 'line\nbreak']) assert.throws(() => addStylePreset(initial, name, look(), 'preset-second', 2000), /name/);
  const renamed = changeStylePreset(initial, 'preset-brand', { name: '  Documentary  ' }, 2000);
  assert.equal(renamed.presets[0].name, 'Documentary'); assert.equal(renamed.presets[0].createdAt, 1000);
  const replacement = look(); replacement.animation.preset = 'pop'; replacement.style.activeWord.strokeWidth = 12;
  const replaced = changeStylePreset(renamed, 'preset-brand', { look: replacement }, 3000);
  assert.equal(replaced.presets[0].id, 'preset-brand'); assert.equal(replaced.presets[0].animation.preset, 'pop');
  assert.equal(initial.presets[0].name, 'Brand captions'); assert.deepEqual(changeStylePreset(replaced, 'preset-brand', 'delete').presets, []);
});

test('incomplete, unsupported and out-of-range saved looks fail before application', () => {
  for (const mutate of [
    v => v.version = 2, v => v.revision = -1, v => v.presets[0].id = '../file',
    v => delete v.presets[0].style.activeWord.italic,
    v => v.presets[0].style.positionX = .5,
    v => v.presets[0].style.upcomingWord.strokeWidth = 100,
    v => v.presets[0].animation.preset = 'unknown',
    v => v.presets[0].animation.fadeInDuration = -1,
    v => v.presets.push(structuredClone(v.presets[0])),
    v => v.presets[0].style.fontFamily = 'x'.repeat(3 * 1024 * 1024),
  ]) { const value = library(); mutate(value); assert.throws(() => validatePresetLibrary(value)); }
});

function storage() {
  let data = null, fail = false, enumerationError = false, writes = 0;
  const folder = { getEntries: async () => { if (enumerationError) throw new Error('Permission denied'); return data === null ? [] : [{ name: 'style-presets.json', isFile: true }]; } };
  const deps = { getFolder: async () => folder, readJSON: async (_file, limit) => { assert.equal(limit, 2 * 1024 * 1024); return structuredClone(data); }, writeJSON: async (parent, name, value) => {
    assert.equal(parent, folder); assert.equal(name, 'style-presets.json');
    if (fail) throw new Error('Disk full'); data = structuredClone(value); writes++;
  } };
  return { store: () => createPresetStore(deps), setData: value => data = value, fail: () => fail = true, deny: () => enumerationError = true, get data() { return data; }, get writes() { return writes; } };
}
test('native presets persist across store instances, with revision-checked saves', async () => {
  const disk = storage(), first = disk.store();
  assert.deepEqual(await first.load(), emptyPresetLibrary());
  const saved = await first.save(library()); assert.equal(saved.revision, 1);
  const reopened = disk.store(); assert.deepEqual(await reopened.load(), saved);
  const renamed = await reopened.save(changeStylePreset(saved, 'preset-brand', { name: 'Another project' }));
  assert.equal(renamed.revision, 2);
  await assert.rejects(first.save(saved), /another panel/);
  assert.equal((await first.load()).presets[0].name, 'Another project');
  assert.equal(disk.writes, 2);
});
test('native storage failures and invalid existing files never erase the library', async () => {
  const disk = storage(); const saved = await disk.store().save(library());
  disk.fail(); await assert.rejects(disk.store().save(changeStylePreset(saved, 'preset-brand', 'delete')), /Disk full/);
  assert.deepEqual(disk.data, saved);
  disk.setData({ version: 99 }); await assert.rejects(disk.store().save(library()), /unsupported/);
  assert.deepEqual(disk.data, { version: 99 });
  disk.deny(); await assert.rejects(disk.store().load(), /Permission denied/);
});

test('browser presets survive reopening independently of sequence sessions and report failed saves', async t => {
  const values = new Map([['better-captions-fork-demo', '{"sequenceId":"demo"}']]);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network expected'); });
  function global(name, value) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (before) Object.defineProperty(globalThis, name, before); else delete globalThis[name]; });
  }
  global('window', {});
  let quota = false;
  global('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (quota) throw new Error('Storage full'); values.set(key, value); } });
  const first = createHostAPI(); const saved = await first.saveStylePresets(library());
  const reopened = createHostAPI(); assert.deepEqual(await reopened.loadStylePresets(), saved);
  assert.equal(values.get('better-captions-fork-demo'), '{"sequenceId":"demo"}');
  await assert.rejects(reopened.saveStylePresets(library()), /another tab/);
  quota = true; await assert.rejects(reopened.saveStylePresets(changeStylePreset(saved, 'preset-brand', 'delete')), /Storage full/);
  assert.deepEqual(await first.loadStylePresets(), saved);
  values.set(PRESET_STORAGE_KEY, '{broken');
  await assert.rejects(reopened.loadStylePresets());
  await assert.rejects(reopened.saveStylePresets(library()));
  assert.equal(values.get(PRESET_STORAGE_KEY), '{broken');
});


test('presets save independent bubble space choices while loading older looks with no space flag',()=>{
 const source=structuredClone(DEFAULT_STYLE);source.activeWord.bubbleFillSpaces=true;source.spokenWord.bubbleFillSpaces=false;
 const saved=capturePresetLook(source,structuredClone(DEFAULT_ANIMATION));assert.equal(saved.style.activeWord.bubbleFillSpaces,true);assert.equal(saved.style.spokenWord.bubbleFillSpaces,false);
 const restored=applyPresetLook(structuredClone(DEFAULT_STYLE),saved);assert.equal(restored.style.activeWord.bubbleFillSpaces,true);
 const legacy=structuredClone(saved);for(const key of ['activeWord','spokenWord','upcomingWord'])delete legacy.style[key].bubbleFillSpaces;
 assert.equal(resolveAppearance(applyPresetLook(source,legacy).style,'activeWord').bubbleFillSpaces,false);
});
