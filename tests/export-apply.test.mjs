import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const root = path.resolve(import.meta.dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function loadTypeScript(file, replacements = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: name => replacements[name] ?? loadTypeScript(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts'), replacements) });
  return exports;
}
const planner = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class {} } });
const containers = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/containers.ts'));
const profile = (signature, scaleX) => ({ signature, samples: [{ time: .5, scaleX, scaleY: 1 }] });
function caption(id, start, end) {
  return { id, text: id, startTime: start, endTime: end, words: [{ text: id, startTime: start, endTime: end }],
    clipNodeId: 'clip-' + id, projectItemId: 'item-' + id, mediaPath: '/generated/old-' + id + '/caption.mov',
    motionProfile: profile('saved-100', 1), renderBounds: { x: 72, y: 832, width: 576, height: 512, frameWidth: 720, frameHeight: 1280 } };
}

/** Run the component's real Apply function; rune shims only supply its props and initial track selection. */
function harness({ changeDuringRender = false, changeSelection = false, unlinked = false, differentPositions = false } = {}) {
  const source = [caption('first', 0, 1), caption('second', 1, 2)], events = [], saved = [], completed = [], busy = [];
  if (unlinked) for (const item of source) { delete item.clipNodeId; delete item.projectItemId; delete item.mediaPath; delete item.motionProfile; }
  if (differentPositions) source[1].position = { x:.1,y:.2 };
  let currentProfile = profile('native-resized-60', .6), applied = false;
  const hostApi = {
    readCaptionMotion: async items => {
      events.push('read');
      return { ok: true, cues: items.map(item => ({ id: item.id, clipNodeId: item.clipNodeId, projectItemId: item.projectItemId, path: item.mediaPath, motionProfile: currentProfile })) };
    },
    preflightCaptionClips: async items => {
      events.push('preflight');
      if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60', 'preflight must receive the newly read size rather than the saved render signature');
      else assert.equal(items[0].captionBundle,true);
    },
    applyCaptionClips: async items => {
      events.push('apply'); applied = true;
      if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60');
      currentProfile = unlinked ? profile('native-created-100',1) : profile('native-unlocked-60', .6);
      return { ok: true, cues: items.map(item => ({ id: item.id, clipNodeId: item.clipNodeId ?? 'new-clip-'+item.id, projectItemId: item.projectItemId ?? 'new-item-'+item.id, path: item.mediaPath, start: item.startTime, end: item.endTime, motionProfile: currentProfile })) };
    },
    readTimeline: async items => ({ ok: true, cues: items.map(item => ({ id: item.id, path: item.mediaPath, start: item.startTime, end: item.endTime })) }),
    readCaptionSelection: async () => ({ ok: true, captionId: changeSelection ? 'second' : 'first', time: .5 }),
    selectCaptionClip: async item => { events.push('select-' + item.id); },
  };
  const exporter = { ...planner, exportFrames: async items => {
    events.push('render'); assert.equal(items.length, 1); if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60');
    if (changeDuringRender) currentProfile = profile('native-resized-70', .7);
    return items.map(item => ({ ...item, mediaPath: '/generated/new-' + item.id + '/caption.mov' }));
  } };
  const props = { captions: source, style: { maxChars: 56 }, animation: {}, frameWidth: 720, frameHeight: 1280, frameRate: 24, duration: 2,
    sequenceName: 'Verification', sequenceId: 'sequence', tracks: [{ index: 2, name: 'Captions', locked: false, clips: 0 }], hostApi,
    selectedId: 'first', onBusy: value => busy.push(value), onUpdated: items => { saved.push(plain(items)); }, onApplied: (items, id, options) => completed.push({ items: plain(items), id, options: plain(options) }) };
  const sourceFile = path.join(root, 'webview-ui/src/components/ExportButton.svelte');
  const script = fs.readFileSync(sourceFile, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = {}, code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, $props: () => props, $state: value => value, $derived: value => value, $effect: effect => effect(),
    require: name => name === '../lib/export/exporter' ? exporter : name === '../lib/export/containers' ? containers : { refreshProgramMonitor: async () => { events.push('refresh'); } } });
  return { apply: exports.apply, source, events, saved, completed, busy, get applied() { return applied; } };
}

test('actual partial Apply uses the captured resized native profile through preflight, rendering and persistence', async () => {
  const h = harness(), updated = await h.apply({ captionIds: ['first'] });
  assert.equal(h.applied, true); assert.deepEqual(h.events, ['read', 'preflight', 'render', 'read', 'apply', 'read', 'refresh', 'select-first']);
  assert.equal(updated[0].motionProfile.signature, 'native-unlocked-60'); assert.equal(h.saved.at(-1)[0].motionProfile.signature, 'native-unlocked-60');
  assert.deepEqual(plain(updated[1]), h.source[1], 'unrequested captions keep their original media, native keys and timings');
  assert.equal(h.source[0].motionProfile.signature, 'saved-100', 'Apply leaves its original prop snapshot untouched');
  assert.deepEqual(h.completed[0].options, { captionIds: ['first'] });
});
test('actual Apply aborts before relinking when native width changes again during rendering', async () => {
  const h = harness({ changeDuringRender: true });
  await assert.rejects(h.apply({ captionIds: ['first'] }), /box size or its keyframes changed/);
  assert.equal(h.applied, false); assert.equal(h.saved.length, 0); assert.equal(h.completed.length, 0);
});
test('automatic partial Apply does not take native selection back after the user chooses another caption', async () => {
  const h = harness({ changeSelection: true }); await h.apply({ captionIds: ['first'] });
  assert.equal(h.applied, true); assert.ok(!h.events.includes('refresh')); assert.ok(!h.events.some(event => event.startsWith('select-')));
});
test('actual first Apply renders and persists one full-transcript native clip for multiple sentence cues', async () => {
  const h=harness({unlinked:true}),updated=await h.apply();
  assert.equal(updated.length,1); assert.equal(updated[0].captionBundle,true); assert.equal(updated[0].clipNodeId,'new-clip-first');
  assert.equal(updated[0].startTime,0); assert.equal(updated[0].endTime,2);
  assert.deepEqual(plain(updated[0].words),h.source.flatMap(caption=>caption.words));
  assert.equal(h.saved.at(-1).length,1); assert.equal(h.saved.at(-1)[0].captionBundle,true);
  assert.equal(h.completed[0].items.length,1); assert.deepEqual(h.busy,[true,false]);
});
test('bundle validation failure releases the actual Apply busy gate before any native writes', async () => {
  const h=harness({unlinked:true,differentPositions:true});
  await assert.rejects(h.apply(),/different frame positions/);
  assert.equal(h.applied,false); assert.equal(h.events.length,0); assert.deepEqual(h.busy,[true,false]);
});
