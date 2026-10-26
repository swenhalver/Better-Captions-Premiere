import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as nativePanel from '../webview-ui/src/lib/native-effect/panel.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import * as nativeEncode from '../webview-ui/src/lib/native-effect/encode.ts';
import { connectionKey } from '../webview-ui/src/lib/clip-connections.ts';
import { deleteTranscriptLine, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { typingAnchor } from '../webview-ui/src/lib/transcript/typing.ts';
const { encodeNativeTransportText } = nativeEncode;

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const ts = require('typescript');
const sourceRoot = fileURLToPath(new URL('../webview-ui/src/', import.meta.url));
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const script = file => readFileSync(file, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const routedPaths = {
  session: 'lib/session/manager.svelte.ts', watcher: 'lib/program-monitor.ts',
  live: 'lib/live-output.ts', renderer: 'lib/export/exporter.ts',
};
function moduleRoute(filename) {
  const normalized = filename.replace(/\\/g, '/');
  return Object.entries(routedPaths).find(([, suffix]) => normalized.endsWith('/' + suffix))?.[0] ?? null;
}

// Run the actual component controller. Rune state is plain storage and effects
// are explicitly flushed; lazy $derived expressions retain their real guards.
function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [context => file => {
      const lazy = new Set();
      function collect(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === '$derived') lazy.add(node.name.text);
        ts.forEachChild(node, collect);
      }
      collect(file);
      function visit(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && lazy.has(node.name.text)) return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.createArrowFunction(undefined, undefined, [], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.visitNode(node.initializer.arguments[0], visit)));
        if (ts.isIdentifier(node) && lazy.has(node.text) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return ts.factory.createCallExpression(node, undefined, []);
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(file, visit);
    }] },
  }).outputText;
}

function fixture(t, options = {}) {
  let time = 0, nextTimer = 0, main, component, mounted, cleanup, availability, liveOptions, playheadCallback;
  const timers = new Map(), modules = new Map(), storage = new Map(), effects = [], calls = { apply: [], commits: [], saves: [], renders: [], seeks: [], transcript: 0, supersedes: 0 };
  const info = { id: 'sequence', name: 'Caption verification', projectPath: '/project/test.prproj', frameWidth: 1920, frameHeight: 1080, frameRate: 24, duration: 8, playhead: .25, tracks: [{ index: 2, name: 'Captions', clips: 1, locked: false }] };
  const profile = { signature: 'motion-rendered', watchSignature: 'geometry-rendered', samples: [{ time: .25, scaleX: 1, scaleY: 1 }, { time: 7.75, scaleX: 1, scaleY: 1 }] };
  const document = { hidden: false, visibilityState: 'visible', activeElement: null, hasFocus: () => false, querySelector: () => null, addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {}, removeEventListener() {} };
  const clockDate = class extends Date { static now() { return time; } };
  const globals = {
    document, window, navigator: { userAgent: 'node-test' }, Date: clockDate, HTMLElement: class {}, AbortController, structuredClone, TextDecoder, TextEncoder, Uint8Array, DataView, BigInt,
    $state: Object.assign(value => value, { raw: value => value }), $derived: Object.assign(value => value, { by: fn => fn }), $effect: fn => effects.push(fn),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: (fn, delay = 0) => { timers.set(++nextTimer, { fn, at: time + delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  };
  const watcher = { reset() {}, notifyRevision() {}, setVisible() {}, stop() {}, diagnostics: () => ({ inFlight: false, paused: false }) };
  const api = {
    isDemo: false,
    getActiveSequenceInfo: async () => options.getInfo ? options.getInfo() : clone(info), loadSession: async () => options.stored === null ? null : clone(options.stored ?? saved()),
    readCaptionConnections: options.connections ? async (id, links, optionsRead) => options.connections(id, links, optionsRead) : undefined,
    writeNativeCaptionDocument: options.writeNative,
    fetchTranscriptJSON: async () => { calls.transcript++; return options.transcript ? JSON.stringify(options.transcript) : null; },
    saveSession: async value => calls.saves.push(clone(value)), getFonts: async () => ['Arial'], getFontCatalog: async () => [{ family: 'Arial', weights: [400, 700], italic: true }], startAgentBridge: () => () => {},
    onTransportAvailability(listener) { availability = listener; listener({ state: options.availability ?? 'ready' }); return () => {}; },
    readTimeline: async captions => ({ ok: true, cues: captions.map(c => ({ id: c.id, clipNodeId: c.clipNodeId, path: c.mediaPath, start: c.startTime, end: c.endTime, projectItemId: c.projectItemId })) }),
    readCaptionMotion: async captions => ({ ok: true, cues: captions.map(c => ({ id: c.id, clipNodeId: c.clipNodeId, projectItemId: c.projectItemId, path: c.mediaPath, motionProfile: clone(c.motionProfile ?? profile) })) }),
    preflightCaptionClips: async () => ({ ok: true }),
    applyCaptionClips: async captions => { calls.commits.push(clone(captions)); return { ok: true, cues: captions.map(c => ({ id: c.id, clipNodeId: c.clipNodeId ?? 'new-clip', projectItemId: c.projectItemId ?? 'new-item', path: c.mediaPath, start: c.startTime, end: c.endTime, motionProfile: clone(c.motionProfile ?? profile) })) }; },
    showInPremiere: async (time, id) => calls.seeks.push([time, id]), selectCaptionClip: async () => ({ ok: true }),
  };
  function execute(source, filename, extras = {}) {
    const output = {};
    vm.runInNewContext(transpile(source), { ...globals, exports: output, ...extras, require: name => dependency(name, filename) }, { filename });
    return output;
  }
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    const result = execute(readFileSync(filename, 'utf8'), filename);
    if (moduleRoute(filename) === 'session') {
      const manager = result.sessionManager;
      result.sessionManager = new Proxy(manager, { get(target, key, receiver) { return key === 'current' ? target.current() : Reflect.get(target, key, receiver); } });
    }
    modules.set(filename, result); return result;
  }
  function dependency(name, from) {
    if (name === 'svelte') return { onMount: fn => { mounted = fn; }, tick: async () => {} };
    if (name === 'svelte/reactivity') return { SvelteMap: Map };
    if (name.includes('/components/') && name.endsWith('.svelte')) return {};
    if (name === './webview-api') return { setSequenceCallbacks() {}, setTimelinePlayheadCallback(callback) { playheadCallback = callback; } };
    if (name === './webview-setup') return { initWebview: () => ({ api }) };
    const base = resolve(dirname(from), name), filename = [base, base + '.ts'].find(existsSync);
    if (!filename) throw new Error('Unexpected controller dependency: ' + name);
    // The real native adapter validates plain-object prototypes. Keep it and
    // its decoder/contract in one Node module realm, matching a real bundle.
    if (filename === resolve(sourceRoot, 'lib/native-effect/panel.ts')) return nativePanel;
    if (filename === resolve(sourceRoot, 'lib/native-effect/encode.ts')) return nativeEncode;
    const result = load(filename);
    if (moduleRoute(filename) === 'watcher') return { ...result, startProgramMonitorWatcher: () => watcher };
    if (moduleRoute(filename) === 'live') return { ...result, createLiveOutput: value => { liveOptions = value; return result.createLiveOutput(value); } };
    if (moduleRoute(filename) === 'renderer') return { ...result, exportFrames: async (captions, style, ...args) => {
      const signal = args.at(-1), index = calls.renders.length + 1;
      calls.renders.push({ style: clone(style), captions: clone(captions), signal });
      await options.render?.(index, signal);
      return captions.map(c => ({ ...clone(c), mediaPath: `/render-${index}.mov` }));
    } };
    return result;
  }
  const types = load(resolve(sourceRoot, 'lib/types.ts'));
  const parser = load(resolve(sourceRoot, 'lib/transcript/parser.ts'));
  function caption(id = 'cue', text = 'Alpha beta gamma delta epsilon zeta', start = 0, linked = true) {
    const words = text.split(' ').map((text, index) => ({ text, startTime: start + index * .4, endTime: start + index * .4 + .3, isActive: false }));
    return { id, text, words, startTime: start, endTime: words.at(-1).endTime + .1, captionBundle: true, groupingMaxChars: 56,
      ...(linked ? { clipNodeId: 'clip-' + id, projectItemId: 'item-' + id, mediaPath: '/' + id + '.mov', motionProfile: clone(profile), renderBounds: { x: 192, y: 648, width: 1536, height: 432, frameWidth: 1920, frameHeight: 1080 } } : {}) };
  }
  function saved(captions = [caption()]) {
    return { sequenceId: info.id, sequenceName: info.name, transcriptJson: null, captions, style: clone(types.DEFAULT_STYLE), animation: clone(types.DEFAULT_ANIMATION), hasTranscript: true, isLoading: false, currentTime: .25, duration: info.duration, frameRate: info.frameRate, frameWidth: info.frameWidth, frameHeight: info.frameHeight };
  }
  main = execute(script(resolve(sourceRoot, 'main-webview.svelte')) + `
    export { refreshSequence, transcribe, restoreTranscription, updateStyle, changeCharacterLimit, updateCaptions, outputSignature, selectionPauseReason, motionPauseReason, motionContext, ensureLegacyBaseline, getState, recordApplied, recordMonitorApplied, flushSave, setTimelineBusy, inspectConnections, setCharacterLimitGesture, transcriptTyping };
    export function setExport(value) { exportButton = value; }
    export function setPhase(value) { outputPhase = value; }
    export function selectForTest(id) { selectedId = id; const s=sessionManager.current,c=s?.captions.find(c=>c.id===id); nativeSelection=c?.clipNodeId?{sequenceId:s.sequenceId,captionId:id,clipNodeId:c.clipNodeId}:null; }
  `, resolve(sourceRoot, 'main-webview.svelte'));
  const manager = load(resolve(sourceRoot, 'lib/session/manager.svelte.ts')).sessionManager;
  function props() { const s = manager.current; return { ...s, sequenceId: s?.sequenceId, sequenceName: s?.sequenceName, hostApi: api, tracks: info.tracks,
    onBusy: main.setTimelineBusy, onPhase: main.setPhase, onUpdated: main.recordApplied, onApplied: main.recordMonitorApplied, selectedId: main.getState()?.runtime.selectedId }; }
  const simulatedExport = { async apply(value) { calls.apply.push(clone(value)); main.recordMonitorApplied(manager.current.captions, manager.current.sequenceId, value); }, supersede() { calls.supersedes++; } };
  main.setExport(simulatedExport);
  function sync() { if (component && manager.current) component.setProps(props()); for (const run of effects) run(); }
  async function settle() { for (let index = 0; index < 40; index++) await Promise.resolve(); sync(); }
  async function advance(ms) {
    time += ms;
    for (let count = 0; count < 100; count++) {
      await settle();
      const due = [...timers].find(([, task]) => task.at <= time);
      if (!due) return;
      timers.delete(due[0]); due[1].fn();
    }
    throw new Error('Controller timers failed to settle.');
  }
  function realExport() {
    component = execute(script(resolve(sourceRoot, 'components/ExportButton.svelte')) + `
      export function setProps(value) { captions=value.captions;style=value.style;animation=value.animation;currentTime=value.currentTime;sequenceId=value.sequenceId;selectedId=value.selectedId; }
    `, resolve(sourceRoot, 'components/ExportButton.svelte'), { $props: props });
    main.setExport(component); sync();
  }
  t.after(() => cleanup?.());
  return { main, manager, storage, calls, info, api, caption, saved, parser, realExport, sync, advance, settle,
    context: () => liveOptions.current(), emitAvailability: state => { availability({ state }); sync(); },
    emitPlayhead: value => { playheadCallback?.(value); sync(); },
    stop() { cleanup?.(); cleanup = null; },
    async start() { cleanup = mounted(); await settle(); sync(); return this; },
  };
}

test('Premiere timeline position follows without selecting, seeking, saving or rendering captions', async t => {
  const h = fixture(t); h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; await h.start();
  const before = clone(h.calls), storage = [...h.storage], selected = h.main.getState().runtime.selectedId, signature = h.main.outputSignature(h.manager.current);
  const position = { sequenceId: '{' + h.info.id.toUpperCase() + '}', projectPath: h.info.projectPath, time: 1.25 };
  h.emitPlayhead(position); assert.equal(h.manager.current.currentTime, 1.25);
  assert.equal(h.main.getState().runtime.selectedId, selected); assert.equal(h.main.outputSignature(h.manager.current), signature);
  assert.deepEqual([...h.storage], storage, 'CTI display state never persists a caption edit');
  await h.advance(5000); assert.deepEqual(h.calls, before, 'Following playback never queues an automatic movie or native document update');
  for (const bad of [null, [], {}, { ...position, time: NaN }, { ...position, time: -1 }, { ...position, time: '2' }, { ...position, projectPath: '/project/copy.prproj' }, { ...position, sequenceId: 'another-sequence' }]) h.emitPlayhead(bad);
  assert.equal(h.manager.current.currentTime, 1.25, 'Malformed and other-project/sequence positions are ignored');
  h.stop(); h.emitPlayhead({ ...position, time: 2 }); assert.equal(h.manager.current.currentTime, 1.25, 'Unmount removes its callback');
});

test('harness module routes match native Windows and POSIX paths without matching unrelated basenames', () => {
  for (const [route, suffix] of Object.entries(routedPaths)) {
    assert.equal(moduleRoute('/project/webview-ui/src/' + suffix), route);
    assert.equal(moduleRoute('D:\\a\\Better Captions\\webview-ui\\src\\' + suffix.replace(/\//g, '\\')), route);
  }
  assert.equal(moduleRoute('D:\\project\\other\\manager.svelte.ts'), null);
  assert.equal(moduleRoute('/project/other/program-monitor.ts'), null);
});

test('loading a fully linked saved session establishes its existing output without rendering or saving it', async t => {
  const h = fixture(t); await h.start(); await h.advance(5000);
  assert.equal(h.context().needed, false); assert.equal(h.context().ready, true);
  assert.equal(h.main.selectionPauseReason(), null);
  assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.commits.length, 0); assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.transcript, 0);
  const original = clone(h.manager.current.captions); await h.main.refreshSequence(); h.sync(); await h.advance(5000);
  assert.deepEqual(clone(h.manager.current.captions), original); assert.equal(h.calls.apply.length, 0);
});

test('saved unlinked captions and a newly imported native transcript remain pending until output is available', async t => {
  for (const source of ['saved', 'native']) {
    const h = fixture(t, { availability: 'waiting', ...(source === 'native' ? { stored: null, transcript: { segments: [{ words: [{ text: 'Fresh', start: 0, duration: .3 }, { text: 'words', start: .4, duration: .3 }] }] } } : {}) });
    if (source === 'saved') h.api.loadSession = async () => h.saved([h.caption('unlinked', 'Fresh words', 0, false)]);
    await h.start(); await h.advance(5000);
    assert.equal(h.manager.current.hasTranscript, true); assert.equal(h.context().needed, true); assert.equal(h.context().ready, false);
    assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.commits.length, 0);
    assert.equal(h.calls.transcript, source === 'native' ? 1 : 0);
  }
});

test('style A to B to A restores both selection and native reflow eligibility without an unnecessary render', async t => {
  const h = fixture(t); await h.start(); h.main.selectForTest('cue'); h.sync();
  const original = h.manager.current.style.textColor, signature = h.main.motionContext().savedSignature;
  h.main.updateStyle({ textColor: '#FF0000' }); h.sync();
  assert.equal(h.context().needed, true); assert.equal(h.main.selectionPauseReason(), 'caption-edits-pending'); assert.equal(h.main.motionContext(), null);
  h.main.updateStyle({ textColor: original }); h.sync();
  assert.equal(h.context().needed, false); assert.equal(h.main.selectionPauseReason(), null); assert.equal(h.main.motionPauseReason(), null);
  assert.equal(h.main.motionContext().savedSignature, signature);
  await h.advance(5000); assert.equal(h.calls.apply.length, 0);
});

test('the character control regroups linked bundled sentences while preserving native containers and explicit split boundaries', async t => {
  const h = fixture(t); const first = { ...h.caption('left', 'Alpha beta gamma', 0), manualSplit: true }, second = { ...h.caption('right', 'delta epsilon zeta', 1.2), manualSplit: true };
  h.api.loadSession = async () => h.saved([first, second]); await h.start();
  const identity = c => [c.id, c.clipNodeId, c.projectItemId, c.mediaPath, c.startTime, c.endTime, c.manualSplit, c.captionBundle, c.renderBounds, c.motionProfile];
  const native = clone(h.manager.current.captions.map(identity));
  h.main.changeCharacterLimit(10); h.sync();
  const short = clone(h.manager.current.captions), shortCount = h.parser.captionSentenceCount(short);
  assert.ok(shortCount >= 5); assert.ok(short.every(c => c.groupingMaxChars === 10));
  assert.deepEqual(clone(short.map(identity)), native);
  assert.equal(h.context().needed, true, 'Derived sentence changes are real render inputs');
  h.main.changeCharacterLimit(200); h.sync();
  assert.ok(h.parser.captionSentenceCount(h.manager.current.captions) < shortCount);
  assert.deepEqual(clone(h.manager.current.captions.map(identity)), native, 'Regrouping never joins native/manual containers');
  assert.equal(h.manager.current.style.maxChars, 200);
  await h.main.flushSave(); assert.ok(h.calls.saves.length >= 2);
});

test('live character changes split and rejoin fresh unlinked captions immediately', async t => {
  const h = fixture(t), caption = h.caption('fresh', 'Alpha beta gamma delta epsilon zeta', 0, false);
  delete caption.groupingMaxChars; delete caption.captionBundle;
  h.api.loadSession = async () => h.saved([caption]); await h.start();
  const words = clone(h.manager.current.captions.flatMap(c => c.words));
  h.main.changeCharacterLimit(15); h.sync();
  const shortCount = h.manager.current.captions.length;
  assert.ok(shortCount > 1, 'unlinked captions are actually split, not merely relabeled');
  assert.deepEqual(clone(h.manager.current.captions.flatMap(c => c.words)), words);
  h.main.changeCharacterLimit(150); h.sync();
  assert.ok(h.manager.current.captions.length < shortCount, 'larger limits rejoin earlier automatic groups');
  assert.deepEqual(clone(h.manager.current.captions.flatMap(c => c.words)), words);
  assert.equal(h.manager.current.style.maxChars, 150);
});

test('slow native availability gates the real mounted automatic-output callback and resumes only its latest style', async t => {
  const h = fixture(t); await h.start();
  h.main.updateStyle({ textColor: '#FF0000' }); h.sync(); h.emitAvailability('waiting');
  await h.advance(6000); assert.equal(h.calls.apply.length, 0); assert.equal(h.context().ready, false);
  h.main.updateStyle({ textColor: '#00FF00' }); h.sync(); await h.advance(1000); assert.equal(h.calls.apply.length, 0);
  h.emitAvailability('ready'); await h.advance(500);
  assert.equal(h.calls.apply.length, 1); assert.equal(h.calls.apply[0].automatic, true);
  assert.equal(h.manager.current.style.textColor, '#00FF00'); assert.equal(h.context().needed, false);
  await h.advance(5000); assert.equal(h.calls.apply.length, 1);
});

test('a typed recoverable legacy-baseline read can succeed later without poisoning the selected caption', async t => {
  const h = fixture(t), legacy = h.caption(); delete legacy.motionProfile.watchSignature;
  h.api.loadSession = async () => h.saved([legacy]);
  let reads = 0;
  const pending = Object.assign(new Error('Premiere is still reading Motion.'), { code: 'BC_NATIVE_PENDING', method: 'readCaptionMotion', recoverable: true });
  h.api.readCaptionMotion = async captions => {
    if (++reads === 1) throw pending;
    const c = captions[0];
    return { ok: true, cues: [{ id: c.id, clipNodeId: c.clipNodeId, projectItemId: c.projectItemId, path: c.mediaPath,
      motionProfile: { ...clone(legacy.motionProfile), watchSignature: 'geometry-reconnected' } }] };
  };
  await h.start(); h.main.selectForTest('cue'); h.sync();
  await assert.rejects(h.main.ensureLegacyBaseline(), error => error === pending);
  assert.equal(h.main.motionPauseReason(), 'legacy-baseline-unarmed');
  await h.main.ensureLegacyBaseline(); await h.main.ensureLegacyBaseline();
  assert.equal(reads, 2, 'The recoverable first read is not retained as a permanent baseline error');
  assert.equal(h.main.motionContext().savedSignature, 'geometry-reconnected');
  assert.equal(h.manager.current.captions[0].motionProfile.watchSignature, undefined, 'A read-only migration does not rewrite the saved render profile');
  await h.advance(5000); assert.equal(h.calls.apply.length, 0);
});

test('editing through the actual main and export controllers supersedes an obsolete render before any timeline commit', async t => {
  const renders = [deferred(), deferred()];
  const h = fixture(t, { render: index => renders[index - 1].promise }); await h.start(); h.realExport();
  h.main.updateStyle({ textColor: '#FF0000' }); h.sync(); await h.advance(400);
  assert.equal(h.calls.renders.length, 1, JSON.stringify(h.main.getState().runtime)); assert.equal(h.calls.renders[0].style.textColor, '#FF0000');
  assert.equal(h.main.getState().runtime.busy.timeline, true);
  h.main.updateStyle({ textColor: '#00FF00' }); h.sync();
  assert.equal(h.calls.renders[0].signal.aborted, true, 'The main edit handler reaches the actual ExportButton supersede method');
  renders[0].resolve(); await h.settle();
  assert.equal(h.calls.commits.length, 0, 'Obsolete rendered media is never sent to applyCaptionClips');
  await h.advance(400); assert.equal(h.calls.renders.length, 2); assert.equal(h.calls.renders[1].style.textColor, '#00FF00');
  renders[1].resolve(); await h.settle(); await h.settle();
  assert.equal(h.calls.commits.length, 1); assert.equal(h.calls.commits[0][0].mediaPath, '/render-2.mov');
  assert.equal(h.context().needed, false, JSON.stringify(h.main.getState().runtime)); assert.equal(h.main.getState().runtime.busy.timeline, false);
  assert.equal(h.main.getState().runtime.liveOutput.phase, 'idle');
});

function connectionSnapshot(info, captions, change = {}) {
  const ticks = seconds => String(Math.round(seconds * 254016000000));
  return { ok: true, version: 1, readOnly: true, projectPath: info.projectPath, sequenceId: info.id, nativeSequenceId: info.id,
    playhead: info.playhead, playheadTicks: ticks(info.playhead), selectedClipNodeIds: [], native: [], warnings: [],
    legacy: captions.filter(c => c.clipNodeId).map((c, clipIndex) => ({ kind: 'generated-movie', clipNodeId: c.clipNodeId, projectItemId: c.projectItemId, path: c.mediaPath,
      trackIndex: 2, clipIndex, startTime: c.startTime, endTime: c.endTime, startTicks: ticks(c.startTime), endTicks: ticks(c.endTime), inTicks: '0', outTicks: ticks(c.endTime - c.startTime), selected: false })), ...change };
}

test('returning to a project reloads its saved sidecar after the other project discarded its in-memory session', async t => {
  const h = fixture(t, { availability: 'waiting' }), originalPath = h.info.projectPath, reads = [];
  h.api.loadSession = async () => {
    reads.push(h.info.projectPath);
    return h.saved([h.caption(h.info.projectPath === originalPath ? 'project-a' : 'project-b')]);
  };
  await h.start(); assert.equal(h.manager.current.captions[0].id, 'project-a');
  h.info.projectPath = '/project/copy.prproj'; await h.main.refreshSequence(); h.sync();
  assert.equal(h.manager.current.captions[0].id, 'project-b'); assert.equal(h.manager.current.projectPath, '/project/copy.prproj');
  h.info.projectPath = originalPath; await h.main.refreshSequence(); h.sync();
  assert.deepEqual(reads, [originalPath, '/project/copy.prproj', originalPath]);
  assert.equal(h.manager.current.captions[0].id, 'project-a'); assert.equal(h.manager.current.captions[0].clipNodeId, 'clip-project-a');
  assert.equal(h.manager.current.projectPath, originalPath); assert.equal(h.context().needed, false); assert.equal(h.calls.apply.length, 0);
});

test('same-GUID project copies cannot inherit an applied signature for an identical but unlinked transcript', async t => {
  const h = fixture(t, { availability: 'waiting' }), originalPath = h.info.projectPath;
  h.api.loadSession = async () => h.saved([h.caption('cue', 'Identical saved words', 0, h.info.projectPath === originalPath)]);
  await h.start(); const appliedContext = h.context(); assert.equal(appliedContext.needed, false);
  h.info.projectPath = '/project/copy.prproj'; await h.main.refreshSequence(); h.sync();
  assert.equal(h.manager.current.captions[0].clipNodeId, undefined);
  assert.notEqual(h.context().sequenceId, appliedContext.sequenceId, 'Automatic output identity includes the project path');
  assert.equal(h.context().needed, true); assert.equal(h.main.selectionPauseReason(), 'waiting-for-premiere');
  await h.advance(5000); assert.equal(h.calls.apply.length, 0);
});

test('same-GUID project transitions invalidate a prior native selection even when copied caption nodes match', async t => {
  const h = fixture(t, { availability: 'waiting' }); await h.start(); h.main.selectForTest('cue'); h.sync();
  assert.equal(h.main.getState().runtime.nativeSelection.clipNodeId, 'clip-cue');
  h.info.projectPath = '/project/copied.prproj'; await h.main.refreshSequence(); h.sync();
  assert.equal(h.manager.current.captions[0].clipNodeId, 'clip-cue');
  assert.equal(h.main.getState().runtime.nativeSelection, null, 'Native selection proof must come from the current project');
});

test('a previous-transcription backup from another project cannot replace a same-GUID project copy', async t => {
  const h = fixture(t, { availability: 'waiting' }), firstPath = h.info.projectPath;
  h.api.loadSession = async () => h.saved([h.caption('unlinked', h.info.projectPath === firstPath ? 'Original project A' : 'Original project B', 0, false)]);
  h.api.transcribeSequence = async () => ({ segments: [{ words: [{ text: 'Retranscribed', start: 0, duration: .3 }] }] });
  await h.start(); await h.main.transcribe(); h.sync();
  assert.equal(h.manager.current.captions[0].text, 'Retranscribed');
  h.info.projectPath = '/project/copied.prproj'; await h.main.refreshSequence(); h.sync();
  h.main.restoreTranscription(); h.sync();
  assert.equal(h.manager.current.projectPath, h.info.projectPath); assert.equal(h.manager.current.captions[0].text, 'Original project B');
});

test('reconnecting a stale legacy node saves the repaired link once without rendering or changing words and Motion', async t => {
  const requested = [], h = fixture(t, { connections: async (_id, links) => {
    requested.push(clone(links));
    const result = connectionSnapshot(h.info, h.manager.current.captions);
    result.legacy[0].clipNodeId = 'reconnected-node';
    return result;
  } });
  const original = h.saved(); h.api.loadSession = async () => clone(original);
  await h.start(); await h.main.flushSave(); h.sync();
  assert.equal(requested[0][0].clipNodeId, 'clip-cue'); assert.equal(h.manager.current.captions[0].clipNodeId, 'reconnected-node');
  assert.deepEqual({ ...clone(h.manager.current.captions[0]), clipNodeId: 'clip-cue' }, original.captions[0]);
  assert.equal(h.calls.saves.length, 1); assert.equal(h.calls.saves[0].captions[0].clipNodeId, 'reconnected-node');
  await h.main.inspectConnections(); await h.advance(5000);
  assert.equal(h.calls.saves.length, 1, 'Unchanged polling never rewrites the saved caption session');
  assert.equal(h.context().needed, false); assert.equal(h.calls.renders.length, 0); assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.commits.length, 0);
});

test('a slow reconnect result cannot repair old links over a newer style edit', async t => {
  const h = fixture(t); await h.start();
  const pending = deferred(), reply = connectionSnapshot(h.info, h.manager.current.captions); reply.legacy[0].clipNodeId = 'obsolete-node';
  h.api.readCaptionConnections = async () => pending.promise;
  const inspection = h.main.inspectConnections(); await h.settle();
  h.main.updateStyle({ textColor: '#00FF00' }); h.sync();
  pending.resolve(reply); await inspection; await h.main.flushSave();
  assert.equal(h.manager.current.captions[0].clipNodeId, 'clip-cue'); assert.equal(h.manager.current.style.textColor, '#00FF00');
  assert.equal(h.context().needed, true); assert.equal(h.calls.saves.length, 1); assert.equal(h.calls.saves[0].style.textColor, '#00FF00');
});

test('late reconnect replies cannot replace the session after a project or sequence transition', async t => {
  for (const transition of ['project', 'sequence']) {
    const h = fixture(t, { availability: 'waiting' }); await h.start();
    h.emitAvailability('ready');
    const old = connectionSnapshot(h.info, h.manager.current.captions), pending = deferred(); old.legacy[0].clipNodeId = 'obsolete-node';
    let first = true;
    h.api.readCaptionConnections = async () => { if (first) { first = false; return pending.promise; } return connectionSnapshot(h.info, h.manager.current.captions); };
    const inspection = h.main.inspectConnections(); await h.settle();
    if (transition === 'project') h.info.projectPath = '/project/another.prproj'; else h.info.id = 'another-sequence';
    h.api.loadSession = async () => h.saved([h.caption('new-context')]);
    await h.main.refreshSequence(); h.sync();
    pending.resolve(old); await inspection;
    assert.equal(h.manager.current.sequenceId, h.info.id); assert.equal(h.manager.current.projectPath, h.info.projectPath);
    assert.equal(h.manager.current.captions[0].id, 'new-context'); assert.equal(h.manager.current.captions[0].clipNodeId, 'clip-new-context');
    assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.saves.length, 0);
  }
});

test('loading a GUID-equivalent saved sidecar restores its current sequence identity without importing another transcript', async t => {
  const h = fixture(t); h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e';
  h.api.loadSession = async () => ({ ...h.saved(), sequenceId: '{' + h.info.id.toUpperCase() + '}' });
  await h.start();
  assert.equal(h.manager.current.sequenceId, h.info.id); assert.equal(h.manager.current.captions[0].text, 'Alpha beta gamma delta epsilon zeta');
  assert.equal(h.calls.transcript, 0); assert.equal(h.context().needed, false); assert.equal(h.calls.apply.length, 0);
});

function nativeConnection(info) {
  const ticks = seconds => String(Math.round(seconds * 254016000000));
  const document = { version: 1, animationAuthority: 'premiere-effect', sequenceId: info.id, timeOriginSeconds: 0, style: defaultNativeStyle(),
    captions: [{ id: 'native-sentence', start: 0, end: .7, manualSplit: true, words: [{ text: 'Native', start: 0, end: .3, endOfSentence: false }, { text: 'words', start: .4, end: .7, endOfSentence: true }] }] };
  const entry = { kind: 'native-effect', clipNodeId: 'native-layer', projectItemId: 'native-item', trackIndex: 2, clipIndex: 0, startTicks: '0', endTicks: ticks(8), inTicks: '0', outTicks: ticks(8), selected: true,
    locator: { projectPath: info.projectPath, sequenceId: '{' + info.id.toUpperCase() + '}', clipNodeId: 'native-layer', trackIndex: 2, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 },
    matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, connectionRevision: 'native-connection-1', documentText: encodeNativeTransportText(document) };
  function revision() {
    return JSON.stringify({ projectPath: entry.locator.projectPath, sequenceId: entry.locator.sequenceId, clipNodeId: entry.clipNodeId, adjustmentLayer: true,
      start: entry.startTicks, end: entry.endTicks, inPoint: entry.inTicks, outPoint: entry.outTicks, components: ['AE.ADBE Motion', entry.matchName], documentIndex: entry.locator.documentParamIndex, documentText: entry.documentText });
  }
  entry.revision = revision();
  return { entry, document, revision };
}

test('real native adoption and a supported style update bypass legacy sidecars and transparent movie exports', async t => {
  let native; const writes = [], h = fixture(t, { stored: null,
    connections: async (_id, _links, options) => {
      const { documentText, revision, ...summary } = native.entry;
      return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
    },
    writeNative: async (snapshot, documentText, sequenceId) => {
      writes.push({ snapshot: clone(snapshot), documentText, sequenceId });
      native.entry.documentText = documentText; native.entry.revision = native.revision();
      return { ok: true, readbackVerified: true, documentText, revision: native.entry.revision };
    },
  });
  h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
  await h.start();
  assert.equal(h.manager.current.nativeClipId, 'native-layer'); assert.equal(h.manager.current.captions[0].text, 'Native words');
  assert.equal(h.manager.current.captions[0].manualSplit, true); assert.equal(h.manager.current.captions[0].clipNodeId, undefined);
  const recovered = { ...nativePanel.rehydrateNativePanel(native.entry, h.info).session, projectPath: h.info.projectPath, nativeClipId: 'native-layer' };
  assert.deepEqual(JSON.parse(h.main.outputSignature(h.manager.current)), JSON.parse(h.main.outputSignature(recovered)), 'Native restore retains semantically identical render inputs');
  assert.equal(h.context().needed, false); assert.equal(writes.length, 0); assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.transcript, 0);
  h.main.updateStyle({ activeWord: { color: '#FF0000' } }); h.sync(); await h.advance(400); await h.settle();
  assert.equal(writes.length, 1, JSON.stringify(h.main.getState().runtime)); assert.equal(writes[0].sequenceId, h.info.id, 'Native API receives its real GUID, never the project-scoped output key');
  assert.equal(writes[0].snapshot.locator.clipNodeId, 'native-layer');
  const result = nativePanel.decodeNativePanelDocument(writes[0].documentText, h.info.id);
  assert.deepEqual(result.style.current.color, { r: 1, g: 0, b: 0, a: native.document.style.current.color.a });
  assert.deepEqual(result.captions, native.document.captions); assert.deepEqual(result.style.upcoming, native.document.style.upcoming);
  await h.advance(5000); assert.equal(writes.length, 1); assert.equal(h.context().needed, false);
  assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.renders.length, 0); assert.equal(h.calls.commits.length, 0);
});

test('connected native summaries do not reread full document carriers until the refresh interval even without a header revision', async t => {
  let native; const reads = [], h = fixture(t, { stored: null, connections: async (_id, _links, options) => {
    reads.push(options.includeDocuments);
    const { documentText, revision, ...summary } = native.entry;
    return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
  } });
  h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
  await h.start(); assert.deepEqual(reads, [true]);
  await h.main.inspectConnections(); await h.main.inspectConnections();
  assert.deepEqual(reads, [true, false, false]);
  await h.advance(29999); assert.equal(reads.filter(Boolean).length, 1);
  await h.advance(1); await h.main.inspectConnections();
  assert.equal(reads.filter(Boolean).length, 2); assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.apply.length, 0);
});

test('style-only project preferences survive another project edit and restore without a caption sidecar', async t => {
  const h = fixture(t, { stored: null }), originalPath = h.info.projectPath, firstKey = connectionKey(h.info);
  await h.start(); assert.equal(h.manager.current.captions.length, 0);
  h.main.updateStyle({ fontSize: 79, activeWord: { bubbleColor: '#123456' } }); await h.main.flushSave();
  let cached = JSON.parse(h.storage.get('better-captions-sessions'));
  assert.equal(cached[firstKey].style.fontSize, 79); assert.equal(cached[firstKey].style.activeWord.bubbleColor, '#123456');
  h.info.projectPath = '/project/style-only-copy.prproj'; await h.main.refreshSequence(); h.sync();
  const secondKey = connectionKey(h.info);
  h.main.updateStyle({ fontSize: 92 }); await h.main.flushSave();
  cached = JSON.parse(h.storage.get('better-captions-sessions'));
  assert.equal(cached[firstKey].style.fontSize, 79, 'Saving project B must not delete project A’s cached style');
  assert.equal(cached[secondKey].style.fontSize, 92);
  h.info.projectPath = originalPath; await h.main.refreshSequence(); h.sync();
  assert.equal(h.manager.current.captions.length, 0, 'No sidecar transcript was used to restore the style');
  assert.equal(h.manager.current.style.fontSize, 79); assert.equal(h.manager.current.style.activeWord.bubbleColor, '#123456');
  assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.renders.length, 0);
});

test('native adoption and supported style edits never overwrite the sequence’s cached legacy style preferences', async t => {
  const h = fixture(t, { stored: null }); h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e';
  await h.start(); h.main.updateStyle({ fontSize: 79 }); await h.main.flushSave();
  const cacheBefore = h.storage.get('better-captions-sessions'), savesBefore = h.calls.saves.length;
  const native = nativeConnection(h.info);
  native.document.style.upcoming.fontSize = 96; native.entry.documentText = encodeNativeTransportText(native.document); native.entry.revision = native.revision();
  h.api.readCaptionConnections = async (_id, _links, options) => {
    const { documentText, revision, ...summary } = native.entry;
    return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
  };
  await h.main.inspectConnections(); h.sync();
  assert.equal(h.manager.current.nativeClipId, 'native-layer'); assert.equal(h.manager.current.style.fontSize, 96);
  h.main.updateStyle({ activeWord: { color: '#00FF00' } }); h.sync(); await h.main.flushSave();
  assert.equal(h.storage.get('better-captions-sessions'), cacheBefore, 'Native display styles must not replace the legacy cache entry');
  assert.equal(JSON.parse(cacheBefore)[connectionKey(h.info)].style.fontSize, 79);
  assert.equal(h.calls.saves.length, savesBefore, 'Native edits also bypass the legacy caption sidecar');
  assert.equal(h.calls.apply.length, 0); assert.equal(h.calls.renders.length, 0);
});

test('startup adopts the sole live native document over an obsolete saved movie sidecar without selection or output writes', async t => {
  let native; const h = fixture(t, {connections:async()=>connectionSnapshot(h.info,[],{nativeSequenceId:native.entry.locator.sequenceId,native:[{...clone(native.entry),selected:false}],selectedClipNodeIds:[]})});
  h.info.id='f18a14ea-2be5-4393-a113-c1b43bfcab1e';native=nativeConnection(h.info);
  const saved=h.saved(); saved.captions[0].layoutOverflow=true;h.api.loadSession=async()=>clone(saved);
  await h.start();
  assert.equal(h.manager.current.nativeClipId,'native-layer');assert.equal(h.context().needed,false);
  assert.equal(h.manager.current.captions[0].layoutOverflow,undefined);
  assert.equal(h.main.getState().runtime.connection.status,'Connected to native caption layer');
  assert.equal(h.calls.saves.length,0);assert.equal(h.calls.renders.length,0);assert.equal(h.calls.commits.length,0);
  assert.equal(saved.captions[0].layoutOverflow,true);
});

test('pending obsolete movie edits cannot deadlock selected native discovery or leave its unrelated uncertain-output banner stuck', async t => {
  const h=fixture(t,{render:async()=>{throw Object.assign(new Error('Unconfirmed old movie output'),{code:'BC_OUTPUT_UNCONFIRMED'});}});
  h.info.id='f18a14ea-2be5-4393-a113-c1b43bfcab1e';await h.start();h.realExport();
  h.main.updateStyle({fontSize:79});h.sync();await h.advance(400);await h.settle();await h.main.flushSave();
  assert.equal(h.context().needed,true);assert.equal(h.main.getState().runtime.liveOutput.blocked,true);
  const saved=clone(h.calls.saves.at(-1)),native=nativeConnection(h.info),reads=[];
  h.api.readCaptionConnections=async(_id,_links,options)=>{
    reads.push(options.includeDocuments);const {documentText,revision,...summary}=native.entry;
    return connectionSnapshot(h.info,[],{nativeSequenceId:native.entry.locator.sequenceId,selectedClipNodeIds:['native-layer'],native:[options.includeDocuments?clone(native.entry):summary]});
  };
  await h.main.inspectConnections();h.sync();await h.advance(5000);
  assert.deepEqual(reads.slice(0,2),[false,true]);assert.equal(h.manager.current.nativeClipId,'native-layer');
  assert.equal(h.context().needed,false);assert.equal(h.main.getState().runtime.liveOutput.blocked,false);
  assert.equal(h.main.getState().runtime.liveOutput.phase,'idle');assert.equal(h.calls.renders.length,1,'Failed movie render was never replayed');
  assert.equal(h.calls.commits.length,0);assert.deepEqual(h.calls.saves.at(-1),saved,'The old saved edits were retained');
});

test('read-only reconnect never replaces pending edits already belonging to the native document', async t => {
  let native;const h=fixture(t,{stored:null,connections:async()=>connectionSnapshot(h.info,[],{nativeSequenceId:native.entry.locator.sequenceId,selectedClipNodeIds:['native-layer'],native:[clone(native.entry)]})});
  h.info.id='f18a14ea-2be5-4393-a113-c1b43bfcab1e';native=nativeConnection(h.info);await h.start();
  h.main.updateStyle({activeWord:{color:'#123456'}});h.sync();
  await h.main.inspectConnections();
  assert.equal(h.manager.current.style.activeWord.color,'#123456');assert.equal(h.context().needed,true);
  assert.equal(h.calls.saves.length,0);assert.equal(h.calls.commits.length,0);
});

test('one Characters per line gesture makes one native write holding the original merges and limit', async t => {
  const decode = text => nativePanel.decodeNativePanelDocument(text, t.info.id);
  for (const gesture of [true, false]) {
    let native; const writes = [], h = fixture(t, { stored: null,
      connections: async (_id, _links, options) => {
        const { documentText, revision, ...summary } = native.entry;
        return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
      },
      writeNative: async (snapshot, documentText) => {
        writes.push({ snapshot: clone(snapshot), documentText });
        native.entry.documentText = documentText; if (snapshot.grouping) native.entry.maxChars = snapshot.grouping.value; native.entry.revision = native.revision();
        return { ok: true, readbackVerified: true, documentText, revision: native.entry.revision, maxChars: native.entry.maxChars };
      },
    });
    t.info = h.info; h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
    // Ten words, rows 2-5 merged (edges at 2 and 6, joins inside), limit 15.
    const marks = { 2: 'edge', 3: 'join', 4: 'join', 5: 'join', 6: 'edge' };
    native.document.captions = [{ id: 'merged', start: 0, end: 4.9, manualSplit: false, words: Array.from({ length: 10 }, (_, i) => ({ text: 'word' + i, start: i * .5, end: i * .5 + .4, endOfSentence: false, ...(marks[i] ? { lineBreakBefore: marks[i] } : {}) })) }];
    native.entry.maxChars = 15; native.entry.documentText = encodeNativeTransportText(native.document); native.entry.revision = native.revision();
    await h.start();
    const original = native.entry.revision;
    assert.equal(h.manager.current.style.maxChars, 15); assert.equal(h.context().needed, false);
    if (gesture) h.main.setCharacterLimitGesture(true);
    for (const value of [20, 30, 24]) { h.main.changeCharacterLimit(value); h.sync(); await h.advance(1000); }
    if (!gesture) { assert.equal(writes.length, 3, 'without the gesture hold every pause in a long drag wrote'); assert.equal(writes[1].snapshot.grouping.before, 20, 'and later writes lost the original limit'); continue; }
    await h.advance(3000);
    assert.equal(writes.length, 0, 'nothing is written while the drag or typing session is open');
    assert.equal(h.context().ready, false); assert.equal(h.context().needed, true);
    assert.equal(h.manager.current.style.maxChars, 24, 'the panel previews the latest value');
    assert.ok(h.manager.current.captions.every(caption => caption.words.every(word => word.lineBreakBefore === undefined)), 'and the reflowed rows');
    // Released, it writes at live output's next readiness check (within 500 ms).
    h.main.setCharacterLimitGesture(false); h.sync(); await h.advance(500); await h.settle();
    assert.equal(writes.length, 1, 'one write, so one Premiere Undo');
    assert.deepEqual(writes[0].snapshot.grouping, { before: 15, value: 24 }, 'the write carries the original limit');
    assert.equal(writes[0].snapshot.revision, original, 'against the layer as it was before the gesture');
    const written = decode(writes[0].documentText).captions[0];
    assert.ok(written.words.every(word => word.lineBreakBefore === undefined), 'merges cleared in the same write');
    assert.deepEqual(written.words.map(word => [word.text, word.start, word.end]), native.document.captions[0].words.map(word => [word.text, word.start, word.end]));
    await h.advance(5000); assert.equal(writes.length, 1); assert.equal(h.context().needed, false);
  }
});

test('deleting the last line writes one empty native document as Delete line, and Premiere Undo and Redo bring it back and empty it again', async t => {
  let native; const writes = [], h = fixture(t, { stored: null,
    connections: async (_id, _links, options) => {
      const { documentText, revision, ...summary } = native.entry;
      return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
    },
    writeNative: async (snapshot, documentText, sequenceId, label) => {
      writes.push({ snapshot: clone(snapshot), documentText, label });
      native.entry.documentText = documentText; native.entry.revision = native.revision();
      return { ok: true, readbackVerified: true, documentText, revision: native.entry.revision };
    },
  });
  h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
  native.document.timeOriginSeconds = 2; native.entry.documentText = encodeNativeTransportText(native.document); native.entry.revision = native.revision();
  const original = native.entry.documentText, decode = text => nativePanel.decodeNativePanelDocument(text, h.info.id);
  await h.start();
  const lines = clone(h.manager.current.captions);
  assert.deepEqual(lines[0].words.map(word => [word.text, word.startTime]), [['Native', 2], ['words', 2.4]]);
  h.main.updateCaptions([], true, 'Delete line'); h.sync(); await h.advance(1000); await h.settle();
  assert.equal(writes.length, 1, JSON.stringify(h.main.getState().runtime)); assert.equal(writes[0].label, 'Delete line', 'one named Premiere history step');
  const empty = decode(writes[0].documentText);
  assert.deepEqual(empty.captions, []); assert.equal(empty.timeOriginSeconds, 2); assert.deepEqual(empty.style, decode(original).style);
  assert.deepEqual(h.manager.current.captions, []); assert.equal(h.manager.current.nativeClipId, 'native-layer');
  assert.equal(h.context().needed, false, 'the empty document is confirmed');
  await h.advance(5000); assert.equal(writes.length, 1);
  // Premiere Undo puts the original document back; the panel follows it without writing.
  native.entry.documentText = original; native.entry.revision = native.revision(); native.entry.connectionRevision = 'native-connection-undo';
  await h.main.inspectConnections(); h.sync();
  assert.deepEqual(clone(h.manager.current.captions).map(caption => caption.words.map(word => [word.text, word.startTime, word.endTime])), lines.map(caption => caption.words.map(word => [word.text, word.startTime, word.endTime])));
  assert.equal(h.context().needed, false);
  // Redo empties the layer again.
  native.entry.documentText = writes[0].documentText; native.entry.revision = native.revision(); native.entry.connectionRevision = 'native-connection-redo';
  await h.main.inspectConnections(); h.sync();
  assert.deepEqual(h.manager.current.captions, []); assert.equal(h.manager.current.nativeClipId, 'native-layer');
  await h.advance(5000); assert.equal(writes.length, 1, 'Undo and Redo never write'); assert.equal(h.context().needed, false);
  assert.equal(h.calls.saves.length, 0); assert.equal(h.calls.apply.length, 0);
});

test('deleting a line that spans native containers writes the surviving words byte-exact, with only the next line’s boundary added', async t => {
  let native; const writes = [], h = fixture(t, { stored: null,
    connections: async (_id, _links, options) => {
      const { documentText, revision, ...summary } = native.entry;
      return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
    },
    writeNative: async (snapshot, documentText, sequenceId, label) => {
      writes.push({ documentText, label });
      native.entry.documentText = documentText; native.entry.revision = native.revision();
      return { ok: true, readbackVerified: true, documentText, revision: native.entry.revision };
    },
  });
  h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
  // A fractional origin: adding and subtracting it would round unchanged times.
  native.document.timeOriginSeconds = .1;
  native.document.captions = [
    { id: 'first', start: .3, end: 1.9, manualSplit: false, words: [{ text: 'Alpha', start: .3, end: .7, endOfSentence: false }, { text: 'beta.', start: .7, end: 1.1, endOfSentence: true }, { text: 'Gamma', start: 1.3, end: 1.9, endOfSentence: false }] },
    { id: 'second', start: 1.9, end: 3.7, manualSplit: false, words: [{ text: 'delta.', start: 1.9, end: 2.3, endOfSentence: true }, { text: 'Epsilon', start: 2.9, end: 3.3, endOfSentence: false, pauseLinesRemoved: 1 }, { text: 'zeta.', start: 3.3, end: 3.7, endOfSentence: true }] },
  ];
  native.entry.documentText = encodeNativeTransportText(native.document); native.entry.revision = native.revision();
  await h.start();
  const captions = clone(h.manager.current.captions), all = transcriptWords(captions);
  const middle = transcriptLines(captions).find(line => all[line.start].text === 'Gamma');
  assert.equal(middle.end - middle.start, 2, 'the middle line spans both containers');
  h.main.updateCaptions(deleteTranscriptLine(captions, middle), true, 'Delete line'); h.sync(); await h.advance(1000); await h.settle();
  assert.equal(writes.length, 1); assert.equal(writes[0].label, 'Delete line');
  const written = nativePanel.decodeNativePanelDocument(writes[0].documentText, h.info.id);
  const [first, second] = native.document.captions;
  assert.equal(written.timeOriginSeconds, .1);
  assert.deepEqual(written.captions.map(caption => caption.id), ['first', 'second']);
  assert.deepEqual(written.captions[0].words, first.words.slice(0, 2));
  // Without pause settings the deleted line's own removals (none) are summed in.
  assert.deepEqual(written.captions[1].words, [{ ...second.words[1], lineBreakBefore: 'break' }, second.words[2]]);
});

// Delete line, then typing in the next line: the panel's settle bridge reports
// the Delete line write confirmed only for the current layer with nothing else
// pending, so typing steps start after it and merge into their own Edit text step.
function threeLineLayer(t) {
  let native; const writes = [], h = fixture(t, { stored: null,
    connections: async (_id, _links, options) => {
      const { documentText, revision, ...summary } = native.entry;
      return connectionSnapshot(h.info, [], { nativeSequenceId: native.entry.locator.sequenceId, selectedClipNodeIds: ['native-layer'], native: [options.includeDocuments ? clone(native.entry) : summary] });
    },
    writeNative: (snapshot, documentText, sequenceId, label) => {
      const write = { documentText, label, ...deferred() };
      writes.push(write);
      return write.promise.then(() => {
        native.entry.documentText = documentText; native.entry.revision = native.revision(); write.revision = native.entry.revision;
        return { ok: true, readbackVerified: true, documentText, revision: native.entry.revision };
      });
    },
  });
  h.info.id = 'f18a14ea-2be5-4393-a113-c1b43bfcab1e'; native = nativeConnection(h.info);
  native.document.captions = [
    { id: 'first', start: 0, end: .7, manualSplit: true, words: [{ text: 'Alpha', start: 0, end: .3, endOfSentence: false }, { text: 'beta.', start: .4, end: .7, endOfSentence: true }] },
    { id: 'second', start: 1, end: 1.7, manualSplit: true, words: [{ text: 'Gamma', start: 1, end: 1.3, endOfSentence: false }, { text: 'delta.', start: 1.4, end: 1.7, endOfSentence: true }] },
    { id: 'third', start: 2, end: 2.7, manualSplit: true, words: [{ text: 'Epsilon', start: 2, end: 2.3, endOfSentence: false }, { text: 'zeta.', start: 2.4, end: 2.7, endOfSentence: true }] },
  ];
  native.entry.documentText = encodeNativeTransportText(native.document); native.entry.revision = native.revision();
  const deleteMiddle = () => {
    const captions = clone(h.manager.current.captions), all = transcriptWords(captions);
    h.main.updateCaptions(deleteTranscriptLine(captions, transcriptLines(captions).find(line => all[line.start].text === 'Gamma')), true, 'Delete line');
  };
  return { h, writes, native: () => native, deleteMiddle };
}
test('Delete line settles as its own native step before typing in the next line starts, which then merges into Edit text', async t => {
  const { h, writes, native, deleteMiddle } = threeLineLayer(t);
  await h.start();
  deleteMiddle();
  let confirmed = null; void h.main.transcriptTyping.settle().then(value => { confirmed = value; });
  await h.advance(0);
  assert.deepEqual(writes.map(write => write.label), ['Delete line'], 'settling writes at once, without the quiet time');
  await h.advance(5000); assert.equal(confirmed, null, 'not settled before Premiere confirms the write');
  writes[0].resolve(); await h.advance(0);
  assert.equal(confirmed, true);
  // Now the next line opens for typing; its steps are separate writes.
  const captions = clone(h.manager.current.captions), next = transcriptLines(captions).find(line => transcriptWords(captions)[line.start].text === 'Epsilon');
  assert.ok(next, 'the line after the deleted one');
  h.api.collapseNativeTyping = async () => { native().entry.documentText = writes[0].documentText; native().entry.revision = writes[0].revision; return { collapsed: true, undone: 1, revision: writes[0].revision }; };
  h.main.transcriptTyping.open(typingAnchor(captions, next.caption.id, next.start, next.end, true), captions, 'Epsilon zeta.', 13, () => {});
  h.main.transcriptTyping.input('Epsilon zeta now.', 17);
  await h.advance(750); await h.advance(400);
  assert.deepEqual(writes.map(write => write.label), ['Delete line', 'Typing']);
  writes[1].resolve(); await h.advance(0);
  const ending = h.main.transcriptTyping.end('commit'); await h.advance(0);
  assert.deepEqual(writes.map(write => write.label), ['Delete line', 'Typing', 'Edit text']);
  writes[2].resolve(); await ending; await h.advance(0);
  const written = nativePanel.decodeNativePanelDocument(writes[2].documentText, h.info.id);
  assert.deepEqual(written.captions.flatMap(caption => caption.words.map(word => word.text)), ['Alpha', 'beta.', 'Epsilon', 'zeta', 'now.']);
  await h.advance(5000); assert.equal(writes.length, 3);
});
test('the settle bridge reports false when a newer edit replaces the one being written, and the newer edit is still written', async t => {
  const { h, writes, deleteMiddle } = threeLineLayer(t);
  await h.start();
  deleteMiddle();
  let confirmed = null; void h.main.transcriptTyping.settle().then(value => { confirmed = value; });
  await h.advance(0);
  assert.deepEqual(writes.map(write => write.label), ['Delete line']);
  // Another edit arrives while Premiere writes Delete line.
  const captions = clone(h.manager.current.captions); captions[0].words[0].endTime = .35;
  h.main.updateCaptions(captions, true, 'Line timing');
  writes[0].resolve(); await h.advance(0);
  assert.equal(confirmed, false, 'the current edit is not written yet');
  await h.advance(400); assert.deepEqual(writes.map(write => write.label), ['Delete line', 'Line timing']);
  writes[1].resolve(); await h.advance(0);
  assert.equal(await h.main.transcriptTyping.settle(), true, 'nothing pending: settled');
});
