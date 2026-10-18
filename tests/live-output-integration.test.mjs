import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
  let time = 0, nextTimer = 0, main, component, mounted, cleanup, availability, liveOptions;
  const timers = new Map(), modules = new Map(), effects = [], calls = { apply: [], commits: [], saves: [], renders: [], seeks: [], transcript: 0, supersedes: 0 };
  const info = { id: 'sequence', name: 'Caption verification', projectPath: '/project/test.prproj', frameWidth: 1920, frameHeight: 1080, frameRate: 24, duration: 8, playhead: .25, tracks: [{ index: 2, name: 'Captions', clips: 1, locked: false }] };
  const profile = { signature: 'motion-rendered', watchSignature: 'geometry-rendered', samples: [{ time: .25, scaleX: 1, scaleY: 1 }, { time: 7.75, scaleX: 1, scaleY: 1 }] };
  const document = { hidden: false, visibilityState: 'visible', activeElement: null, hasFocus: () => false, addEventListener() {}, removeEventListener() {} };
  const window = { addEventListener() {}, removeEventListener() {} };
  const clockDate = class extends Date { static now() { return time; } };
  const globals = {
    document, window, Date: clockDate, HTMLElement: class {}, AbortController,
    $state: value => value, $derived: Object.assign(value => value, { by: fn => fn }), $effect: fn => effects.push(fn),
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn, delay = 0) => { timers.set(++nextTimer, { fn, at: time + delay }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  };
  const watcher = { reset() {}, notifyRevision() {}, setVisible() {}, stop() {}, diagnostics: () => ({ inFlight: false, paused: false }) };
  const api = {
    isDemo: false,
    getActiveSequenceInfo: async () => clone(info), loadSession: async () => options.stored === null ? null : clone(options.stored ?? saved()),
    fetchTranscriptJSON: async () => { calls.transcript++; return options.transcript ? JSON.stringify(options.transcript) : null; },
    saveSession: async value => calls.saves.push(clone(value)), getFonts: async () => ['Arial'], startAgentBridge: () => () => {},
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
    if (name === './webview-api') return { setSequenceCallbacks() {} };
    if (name === './webview-setup') return { initWebview: () => ({ api }) };
    const base = resolve(dirname(from), name), filename = [base, base + '.ts'].find(existsSync);
    if (!filename) throw new Error('Unexpected controller dependency: ' + name);
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
    export { refreshSequence, updateStyle, changeCharacterLimit, updateCaptions, outputSignature, selectionPauseReason, motionPauseReason, motionContext, ensureLegacyBaseline, getState, recordApplied, recordMonitorApplied, flushSave, setTimelineBusy };
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
  return { main, manager, calls, info, api, caption, saved, parser, realExport, sync, advance, settle,
    context: () => liveOptions.current(), emitAvailability: state => { availability({ state }); sync(); },
    async start() { cleanup = mounted(); await settle(); sync(); return this; },
  };
}

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
