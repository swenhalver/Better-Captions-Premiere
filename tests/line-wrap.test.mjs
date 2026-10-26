import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { lineStarts, LINE_WRAPS, validateLineWrap } from '../webview-ui/src/lib/native-effect/line-wrap.ts';
import { defaultNativeStyle, validateNativeDocument, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument, encodeNativeTransportText, decodeNativeTransportTimeOrigin } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument, rehydrateNativePanel, prepareNativePanelUpdate, nativeLineFitCharacterCapacity } from '../webview-ui/src/lib/native-effect/panel.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { transcriptLines } from '../webview-ui/src/lib/transcript/lines.ts';
import { capturePresetLook, applyPresetLook } from '../webview-ui/src/lib/style-presets.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
import { restoreSessionStyle } from '../webview-ui/src/lib/session/style.ts';
import { nativeCarrier, legacyNativeDocumentBytes } from './helpers/native-document.mjs';

const words = text => text.split(' ').map((text, i) => ({ text, startTime: i * .25, endTime: i * .25 + .2, isActive: false, endOfSentence: false }));
const indices = starts => starts.flatMap((start, i) => start ? [i] : []);
const rows = (input, maxChars, mode) => {
  const starts = indices(lineStarts(input, maxChars, mode));
  return starts.map((start, i) => input.slice(start, starts[i + 1] ?? input.length).map(word => word.text).join(' '));
};
const captionsFor = input => [0, Math.floor(input.length / 2), input.length].slice(0, -1).map((start, i, cuts) => {
  const part = structuredClone(input.slice(start, cuts[i + 1] ?? input.length));
  return { id: 'store-' + i, text: part.map(word => word.text).join(' '), startTime: part[0]?.startTime ?? 0, endTime: part.length ? Math.max(...part.map(word => word.endTime)) : 0, manualSplit: true, words: part };
});
function documentFor(input, mode = 'fill') {
  const style = defaultNativeStyle(); if (mode !== 'fill') style.lineWrap = mode;
  return { version: 1, binaryVersion: 11, animationAuthority: 'premiere-effect', sequenceId: 'sequence', timeOriginSeconds: 12.125, style,
    captions: captionsFor(input).map(c => ({ id: c.id, start: c.startTime, end: c.endTime, manualSplit: c.manualSplit,
      words: c.words.map(({ startTime, endTime, isActive, ...w }) => ({ ...w, start: startTime, end: endTime })) })) };
}
const fox = words('The quick brown fox jumps over the lazy dog.');

test('Fill, Balance and Pretty have distinct deterministic fox layouts', () => {
  assert.deepEqual(rows(fox, 20, 'fill'), ['The quick brown fox', 'jumps over the lazy', 'dog.']);
  assert.deepEqual(rows(fox, 20, 'balance'), ['The quick brown', 'fox jumps over', 'the lazy dog.']);
  assert.deepEqual(rows(fox, 20, 'pretty'), ['The quick brown fox', 'jumps over', 'the lazy dog.']);
  assert.deepEqual(lineStarts([], 20), []);
  assert.deepEqual(lineStarts(fox, 20), lineStarts(fox, 20, 'fill'));
  for (const mode of LINE_WRAPS) assert.equal(validateLineWrap(mode), mode);
  for (const mode of ['', null, undefined, 'Fill', 1, {}, []]) assert.throws(() => validateLineWrap(mode), /Choose Fill/);
});

test('Balance resolves equal costs toward the longer first line and Pretty only repairs its last two lines', () => {
  assert.deepEqual(rows(words('aa bb cc'), 5, 'balance'), ['aa bb', 'cc']);
  const input = words('one two three four five six seven eight nine ten eleven');
  assert.deepEqual(rows(input, 12, 'pretty'), ['one two', 'three four', 'five six', 'seven eight', 'nine', 'ten eleven'], 'a two-unit tail wins even when it is less even');
  const healthy = words('one two three four five six');
  assert.deepEqual(rows(healthy, 12, 'pretty'), rows(healthy, 12, 'fill'), 'a healthy multi-unit last line keeps Fill');
  assert.deepEqual(rows(words('aaaa bbbb c d'), 10, 'pretty'), ['aaaa', 'bbbb c d'], 'a short two-unit tail also triggers repair');
});

for (const mode of LINE_WRAPS) {
  test(mode + ': hard boundaries, duration, glue, punctuation and Unicode', () => {
    const input = words('aa bb cc dd ee ff'); input[1].endOfSentence = true; input[4].lineBreakBefore = 'break';
    assert.deepEqual(indices(lineStarts(input, 500, mode)), [0, 2, 4]);
    input[1].endOfSentence = false; input[1].text = 'bb!'; input[4].lineBreakBefore = 'edge';
    assert.deepEqual(indices(lineStarts(input, 500, mode)), [0, 2, 4]);
    const pause = words('a b c'); pause[0].endTime = .4; pause[1].startTime = 1; pause[1].endTime = 1.2; pause[2].startTime = 1.801; pause[2].endTime = 2;
    assert.deepEqual(indices(lineStarts(pause, 500, mode)), [0, 2], 'a gap of exactly .6 is allowed; above .6 breaks');
    const slow = words('a b c d e f g h').map((w, i) => ({ ...w, startTime: i * 1.5, endTime: (i + 1) * 1.5 }));
    assert.deepEqual(rows(slow, 56, mode), ['a b c', 'd e f', 'g h']);
    const exact = words('a b'); exact[0].endTime = 5; exact[1].startTime = 5; exact[1].endTime = 5.5;
    assert.deepEqual(indices(lineStarts(exact, 56, mode)), [0]); exact[1].endTime += .001;
    assert.deepEqual(indices(lineStarts(exact, 56, mode)), [0, 1]);
    exact[0].endTime = 7; exact[1].startTime = 7; exact[1].endTime = 7.3;
    assert.deepEqual(indices(lineStarts(exact, 56, mode)), [0, 1], 'a single overlong word stands alone');
    const joined = words('aa bb cc dd ee'); joined[1].lineBreakBefore = 'edge'; joined[2].lineBreakBefore = joined[3].lineBreakBefore = 'join'; joined[4].lineBreakBefore = 'edge';
    assert.deepEqual(rows(joined, 5, mode), ['aa', 'bb cc dd', 'ee']);
    joined[1].endOfSentence = true; joined[2].startTime = 8; joined[2].endTime = 8.2; joined[3].startTime = 9; joined[3].endTime = 9.2; joined[4].startTime = 10; joined[4].endTime = 10.2;
    assert.deepEqual(rows(joined, 5, mode), ['aa', 'bb cc dd', 'ee'], 'joins also override EOS, pauses and duration');
    assert.deepEqual(rows(words('aaaa bbbb ,'), 9, mode), ['aaaa', 'bbbb ,'], 'punctuation consumes width in its glued unit');
    const punct = words('aaaa , tail'); punct[1].lineBreakBefore = 'break';
    assert.deepEqual(indices(lineStarts(punct, 500, mode)), [0, 1], 'explicit breaks precede punctuation glue');
    assert.deepEqual(rows(words('😀😀 café 日本語'), 7, mode), ['😀😀 café', '日本語'], 'Unicode scalars, not UTF-16 or UTF-8 length');
    assert.deepEqual(rows(words('go extraordinarily far'), 6, mode), ['go', 'extraordinarily', 'far']);
    const before = structuredClone(joined); lineStarts(joined, 7, mode); assert.deepEqual(joined, before);
    const containers = captionsFor(fox);
    assert.deepEqual(transcriptLines(nativeCaptionPhrases(containers, 20, mode)).map(row => row.start), indices(lineStarts(fox, 20, mode)), 'storage edges/manualSplit do not add rows');
  });
}

test('v11 sparse mode footer roundtrips; every older codec defaults to Fill', () => {
  assert.equal(restoreSessionStyle().lineWrap,'pretty','new sessions default to Pretty');
  for (const lineWrap of [undefined,'fill','balance','pretty']) {
    const saved=lineWrap===undefined?{}:{lineWrap};
    assert.equal(restoreSessionStyle(saved).lineWrap??'fill',lineWrap??'fill','restoring saved sessions retains their grouping choice');
  }
  for (const [value, mode] of LINE_WRAPS.entries()) {
    const doc = documentFor(fox, mode), bytes = encodeNativeDocument(doc), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(4, true), 11); assert.equal(view.getUint32(bytes.length - 4, true), value);
    const decoded = decodeNativePanelDocument(nativeCarrier(bytes), doc.sequenceId);
    assert.deepEqual(decoded, doc); assert.deepEqual(encodeNativeDocument(decoded), bytes);
    assert.equal(Object.hasOwn(decoded.style, 'lineWrap'), mode !== 'fill', 'Fill stays absent in sparse native JSON');
    assert.equal(decodeNativeTransportTimeOrigin(nativeCarrier(bytes)), 12.125);
    for (const bad of [3, 0xffffffff]) {
      const invalid = bytes.slice(); new DataView(invalid.buffer).setUint32(invalid.length - 4, bad, true);
      assert.throws(() => decodeNativePanelDocument(nativeCarrier(invalid), 'sequence'), /wrap/);
      assert.throws(() => decodeNativeTransportTimeOrigin(nativeCarrier(invalid)), /wrap/);
    }
    for (const removed of [1, 2, 3, 4]) assert.throws(() => decodeNativePanelDocument(nativeCarrier(bytes.slice(0, -removed)), 'sequence'));
    assert.throws(() => decodeNativePanelDocument(nativeCarrier(Buffer.concat([bytes, Buffer.from([0])])), 'sequence'));
    for (let version = 1; version <= 10; version++) {
      const old = version <= 8 ? legacyNativeDocumentBytes(doc, version) : bytes.slice(0, -4);
      new DataView(old.buffer, old.byteOffset, old.byteLength).setUint32(4, version, true);
      const restored = decodeNativePanelDocument(nativeCarrier(old), doc.sequenceId);
      assert.equal(restored.style.lineWrap, undefined, 'v' + version + ' defaults to Fill');
      const upgraded = encodeNativeDocument(restored); assert.equal(new DataView(upgraded.buffer).getUint32(4, true), 11);
      assert.deepEqual(decodeNativePanelDocument(nativeCarrier(upgraded), doc.sequenceId), restored);
    }
  }
  for (const lineWrap of ['fill', '', 0, null, 'Balance']) assert.throws(() => validateNativeDocument({ ...documentFor(fox), style: { ...defaultNativeStyle(), lineWrap } }), /wrap/);
});

function seededSamples() {
  let seed = 0x71a5b9;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const vocabulary = ['a', 'bb', 'ccc', 'longword', '😀', '日本語', 'café', 'é', ',', '!', 'tail.', 'extraordinarily'];
  return Array.from({ length: 48 }, () => {
    let at = 0;
    const input = Array.from({ length: 5 + random(24) }, () => {
      at += random(5) === 0 ? .85 : .05;
      const w = { text: vocabulary[random(vocabulary.length)], startTime: at, endTime: at + .15 + random(8) * .2, endOfSentence: random(12) === 0, isActive: false };
      at = w.endTime;
      const boundary = random(13); if (boundary < 3) w.lineBreakBefore = ['break', 'edge', 'join'][boundary];
      return w;
    });
    return { input, maxChars: 4 + random(35) };
  });
}

function boundarySamples() {
  const joined = words('aa bb cc dd ee'); joined[1].lineBreakBefore = 'edge'; joined[2].lineBreakBefore = joined[3].lineBreakBefore = 'join'; joined[1].endOfSentence = true; joined[4].lineBreakBefore = 'break';
  const pause = words('a b c'); pause[0].endTime = .4; pause[1].startTime = 1; pause[1].endTime = 1.2; pause[2].startTime = 1.801; pause[2].endTime = 2;
  const duration = words('a b c'); duration[0].endTime = 5; duration[1].startTime = 5; duration[1].endTime = 5.5; duration[2].startTime = 5.5; duration[2].endTime = 5.501;
  const longUnit = words('hold this'); longUnit[0].endTime = 7; longUnit[1].startTime = 7; longUnit[1].endTime = 7.3;
  const overlap = words('aa bb cc dd ee'); overlap[0].endTime = 5; overlap[1].endTime = .9;
  // Blank lines (empty words) stand alone beside joins, punctuation and each other.
  const blank = words('aa x ,bb cc x x dd'); blank[1].text = blank[5].text = blank[6].text = ''; blank[1].lineBreakBefore = blank[2].lineBreakBefore = 'join';
  return [{ input: blank, maxChars: 56 }, { input: joined, maxChars: 5 }, { input: pause, maxChars: 56 }, { input: duration, maxChars: 56 }, { input: longUnit, maxChars: 56 }, { input: overlap, maxChars: 8 }];
}

test('actual TS→BCAP→C++ line indices and codec roundtrips agree for all modes', t => {
  const root = fileURLToPath(new URL('../', import.meta.url)), temp = mkdtempSync(join(tmpdir(), 'bcap-wrap-parity-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const binary = join(temp, process.platform === 'win32' ? 'core-test.exe' : 'core-test');
  execFileSync(process.env.CXX || (process.platform === 'win32' ? 'clang++' : 'c++'), ['-std=c++17', join(root, 'native/core/caption_core.cpp'), join(root, 'native/tests/caption_core_test.cpp'), '-o', binary]);
  const fixtures = [ { input: fox, maxChars: 20 }, { input: words('go extraordinarily far'), maxChars: 6 },
    { input: words('one two three four five six seven eight nine ten eleven'), maxChars: 12 },
    { input: words('aaaa bbbb ,'), maxChars: 9 }, { input: words('😀😀 café 日本語 é'), maxChars: 7 },
    { input: words('a b c d e f g h').map((w, i) => ({ ...w, startTime: i * 1.5, endTime: (i + 1) * 1.5 })), maxChars: 56 },
    ...boundarySamples(), ...seededSamples() ];
  const inputPath = join(temp, 'in.bcap'), outputPath = join(temp, 'out.bcap');
  for (const [sample, { input, maxChars }] of fixtures.entries()) {
    const fillCount = indices(lineStarts(input, maxChars, 'fill')).length;
    for (const mode of LINE_WRAPS) {
      const expected = indices(lineStarts(input, maxChars, mode)), doc = documentFor(input, mode), bytes = encodeNativeDocument(doc);
      writeFileSync(inputPath, bytes);
      const result = execFileSync(binary, ['--lines', inputPath, String(maxChars)], { encoding: 'utf8' }).trim();
      assert.deepEqual(result ? result.split(/\s+/).map(Number) : [], expected, JSON.stringify({ sample, mode, maxChars, input }));
      if (mode === 'balance') assert.equal(expected.length, fillCount, 'Balance keeps Fill line count: ' + sample);
      execFileSync(binary, ['--roundtrip', inputPath, outputPath]);
      assert.deepEqual(new Uint8Array(readFileSync(outputPath)), bytes, 'C++ byte roundtrip: ' + mode + ' sample ' + sample);
    }
  }
  t.diagnostic(fixtures.length + ' fixtures × 3 modes: ' + fixtures.length * 3 + ' native line comparisons and byte roundtrips');
});

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
function connected(captions, maxChars, inSeconds = 0, mode = 'fill') {
  const doc = { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 0, style: defaultNativeStyle(),
    captions: captions.map(caption => ({ id: caption.id, start: caption.startTime, end: caption.endTime, manualSplit: false,
      words: caption.words.map(word => ({ text: word.text, start: word.startTime, end: word.endTime, endOfSentence: false,
        ...(word.lineBreakBefore ? { lineBreakBefore: word.lineBreakBefore } : {}), ...(word.pauseLinesRemoved ? { pauseLinesRemoved: word.pauseLinesRemoved } : {}) })) })) };
  if (mode !== 'fill') doc.style.lineWrap = mode;
  const locator = { projectPath: '/p.prproj', sequenceId: id, clipNodeId: 'clip', trackIndex: 0, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const entry = { kind: 'native-effect', maxChars, clipNodeId: 'clip', projectItemId: 'item', trackIndex: 0, clipIndex: 0, startTicks: ticks(0), endTicks: ticks(10), inTicks: ticks(inSeconds), outTicks: ticks(10 + inSeconds),
    lineFitWidth: 200, lineFitFontScale: 1, selected: true, locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc) };
  entry.revision = JSON.stringify({ projectPath: locator.projectPath, sequenceId: id, clipNodeId: 'clip', adjustmentLayer: true, start: entry.startTicks, end: entry.endTicks, inPoint: entry.inTicks, outPoint: entry.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: 6, documentText: entry.documentText });
  return rehydrateNativePanel(entry, { id, name: 'Seq', duration: 10, frameWidth: 1920, frameHeight: 1080, frameRate: 25, playhead: 0 });
}

async function controller(panel) {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const vm = (await import('node:vm')).default;
  const ts = createRequire(new URL('../webview-ui/package.json', import.meta.url))('typescript');
  const source = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const modules = {};
  for (const name of [...source.matchAll(/from ["'](\.\/lib\/[^"']+)["']/g)].map(match => match[1]))
    if (!name.endsWith('.svelte')) try { modules[name] = await import(new URL('../webview-ui/src/' + name.slice(2).replace(/\.ts$/, '') + '.ts', import.meta.url)); } catch { modules[name] = {}; }
  modules['./lib/native-effect/panel'] = { ...modules['./lib/native-effect/panel'], nativeLineFitCharacterCapacity: (binding, session) => nativeLineFitCharacterCapacity(binding, session, text => Array.from(text).length * 8) };
  const session = { ...structuredClone(panel.session), projectPath: '/p.prproj', nativeClipId: 'clip' };
  const manager = { current: session, sessions: new Map([[session.sequenceId, session]]), activeSequenceId: session.sequenceId,
    updateStyle(updates) { session.style = { ...session.style, ...updates }; }, updateCaptions(captions) { session.captions = captions; session.hasTranscript = captions.length > 0; },
    persist() {}, restore() {}, setCurrentTime() {} };
  const writes = [];
  const api = { isDemo: false, async writeNativeCaptionDocument(snapshot, documentText, sequenceId, label) {
    writes.push({ snapshot, documentText, label });
    const revision = JSON.parse(snapshot.revision); revision.documentText = documentText;
    return { ok: true, readbackVerified: true, revision: JSON.stringify(revision), documentText, maxChars: snapshot.grouping?.value ?? panel.binding.clip.maxChars };
  } };
  const exports = {};
  const extension = `
    export { changeCharacterLimit, changeLineWrap, fitCharacterLimit, applyNativeOutput, agent, updateCaptions };
    export function connect(binding) { nativeBinding = binding; }
    export function problem() { return error; }`;
  vm.runInNewContext(ts.transpileModule(source + extension, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document: { hidden: false, visibilityState: 'visible', hasFocus: () => false, activeElement: null, querySelector: () => null }, window: {}, navigator: { userAgent: 'node-test' }, HTMLElement: class {}, structuredClone, console,
    $state: Object.assign(value => value, { raw: value => value, snapshot: value => value }), $derived: Object.assign(value => value, { by: callback => callback() }), $effect() {}, $props: () => ({}),
    require(name) {
      if (name === 'svelte') return { onMount() {}, tick: async () => {} };
      if (name === './webview-setup') return { initWebview: () => ({ api }) };
      if (name === './lib/session/manager.svelte') return { sessionManager: manager };
      return modules[name] ?? {};
    },
  });
  exports.connect(panel.binding);
  return { ...exports, session, writes };
}

// A merged run bounded by edges, followed by a manual split and a removed
// pause row. Reflow must clear only the merge's markers.
function mergedFixture() {
  const input = words('one two three four five six seven eight');
  input[0].lineBreakBefore = 'edge'; input[1].lineBreakBefore = input[2].lineBreakBefore = 'join';
  input[3].lineBreakBefore = 'edge'; input[6].lineBreakBefore = 'break'; input[6].pauseLinesRemoved = 2;
  return captionsFor(input);
}
const boundaries = doc => doc.captions.flatMap(c => c.words.map(w => w.lineBreakBefore ?? '-'));

test('mounted panel and agent mode changes clear merges in one named document-only write', async () => {
  for (const via of ['panel', 'agent']) for (const mode of LINE_WRAPS) {
    const beforeMode = mode === 'fill' ? 'pretty' : 'fill';
    const panel = connected(mergedFixture(), 20, 0, beforeMode), ui = await controller(panel);
    if (via === 'panel') ui.changeLineWrap(mode); else await ui.agent.patchStyle({ lineWrap: mode });
    assert.equal(ui.problem(), '', via + ' ' + mode); await ui.applyNativeOutput();
    assert.equal(ui.writes.length, 1, via + ' ' + mode + ': one Premiere write');
    const write = ui.writes[0], decoded = decodeNativePanelDocument(write.documentText, id);
    assert.equal(write.label, 'Line wrap'); assert.equal(write.snapshot.grouping, undefined, 'capacity remains unchanged');
    assert.equal(decoded.style.lineWrap ?? 'fill', mode);
    assert.deepEqual(boundaries(decoded), ['-', '-', '-', '-', '-', '-', 'break', '-']);
    assert.equal(decoded.captions[1].words[2].pauseLinesRemoved, 2);
    const source = doc => doc.captions.map(c => [c.id, c.start, c.end, c.manualSplit, c.words.map(w => [w.text, w.start, w.end])]);
    assert.deepEqual(source(decoded), source(panel.binding.document), 'source identities, times, text and storage survive');
    const noChange = await controller(connected(mergedFixture(), 20, 0, mode));
    if (via === 'panel') noChange.changeLineWrap(mode); else await noChange.agent.patchStyle({ lineWrap: mode });
    assert.equal(noChange.writes.length, 0, 'same mode schedules no write');
    assert.equal(noChange.session.style.lineWrap ?? 'fill', mode);
    assert.ok(noChange.session.captions.some(c => c.words.some(w => w.lineBreakBefore === 'join')));
  }
});

test('Smart line fit preserves each wrapping mode while clearing merges, even at the same capacity', async () => {
  for (const mode of LINE_WRAPS) for (const unchanged of [false, true]) {
    const panel = connected(mergedFixture(), 20, 0, mode);
    const capacity = nativeLineFitCharacterCapacity(panel.binding, panel.session, text => Array.from(text).length * 8);
    assert.ok(Number.isInteger(capacity) && capacity > 0);
    if (unchanged) {
      panel.binding.clip.maxChars = capacity; panel.binding.baseline.style.maxChars = capacity; panel.session.style.maxChars = capacity;
    }
    const ui = await controller(panel); ui.fitCharacterLimit();
    assert.equal(ui.problem(), '', mode); await ui.applyNativeOutput();
    assert.equal(ui.writes.length, 1, mode + ': Smart fit still clears a merge at an unchanged capacity');
    const write = ui.writes[0], decoded = decodeNativePanelDocument(write.documentText, id);
    assert.equal(write.label, 'Smart line fit'); assert.equal(ui.session.style.maxChars, capacity);
    assert.equal(decoded.style.lineWrap ?? 'fill', mode); assert.equal(ui.session.style.lineWrap ?? 'fill', mode);
    assert.deepEqual(boundaries(decoded), ['-', '-', '-', '-', '-', '-', 'break', '-']);
    assert.deepEqual(write.snapshot.grouping ? { ...write.snapshot.grouping } : undefined, unchanged ? undefined : { before: 20, value: capacity });
  }
});

test('wrapping is grouping configuration: captured/applied style presets preserve the current mode', () => {
  for (const mode of LINE_WRAPS) {
    const style = { ...structuredClone(DEFAULT_STYLE), lineWrap: mode, maxChars: 27 };
    const look = capturePresetLook(style, DEFAULT_ANIMATION);
    assert.equal(Object.hasOwn(look.style, 'lineWrap'), false); assert.equal(Object.hasOwn(look.style, 'maxChars'), false);
    const applied = applyPresetLook({ ...style, fontSize: 13 }, look);
    assert.equal(applied.style.lineWrap, mode); assert.equal(applied.style.maxChars, 27);
  }
});

// Use the actual CEP bridge and UXP token history against an offline host mock.
// Nothing in this test connects to, launches or drives Premiere.
function historyHost(documentText) {
  const collection = (values, key = 'numItems') => Object.defineProperty(values, key, { get: () => values.length });
  const time = seconds => ({ seconds, ticks: ticks(seconds) });
  let token = 0;
  const documentParam = { displayName: 'Caption document (experimental)', isTimeVarying: () => false, getValue: () => documentText, setValue: value => { documentText = value; } };
  const tokenParam = { displayName: 'Layout editing guide', isTimeVarying: () => false, getValue: () => token, setValue: value => { token = value; } };
  const properties = collection([documentParam, { displayName: 'Characters per line', isTimeVarying: () => false, getValue: () => 20 }, tokenParam, { displayName: 'Width', isTimeVarying: () => false, getValue: () => 1536 }, { displayName: 'Global font size (64 = 1x)', isTimeVarying: () => false, getValue: () => 64 }]);
  const clip = { nodeId: 'clip', projectItem: { nodeId: 'item', getMediaPath: () => '' }, start: time(0), end: time(10), inPoint: time(0), outPoint: time(10), isSelected: () => true, isAdjustmentLayer: () => true,
    components: collection([{ matchName: NATIVE_EFFECT_MATCH_NAME, properties }]) };
  const sequence = { sequenceID: id, videoTracks: collection([{ clips: collection([clip]), isLocked: () => false }], 'numTracks'), audioTracks: collection([], 'numTracks'), getPlayerPosition: () => time(0) };
  let jobText;
  const context = { app: { project: { path: '/p.prproj', activeSequence: sequence } }, File: function () { this.open = () => true; this.read = () => jobText; this.close = () => {}; }, JSON: undefined };
  vm.createContext(context); vm.runInContext(readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8'), context);
  const call = (method, data = {}) => {
    jobText = JSON.stringify({ sequenceId: id, projectPath: '/p.prproj', generatedRoot: '/p/Better Captions/' + id, knownLinks: [], includeDocuments: true, ...data });
    return JSON.parse(context.BetterCaptionsHost[method]('/mock-job.json'));
  };
  const module = { exports: {} }; vm.runInNewContext(readFileSync(new URL('../uxp/native-params.js', import.meta.url), 'utf8'), { module, exports: module.exports, console: { log() {} } });
  const transactions = [];
  const component = { getMatchName: async () => NATIVE_EFFECT_MATCH_NAME, getParamCount: async () => properties.length,
    getParam: async index => ({ displayName: properties[index].displayName, createKeyframe: value => ({ value }), createSetValueAction: key => () => properties[index].setValue(key.value) }) };
  const chain = { getComponentCount: async () => 1, getComponentAtIndex: async () => component };
  const item = { getStartTime: async () => clip.start, getEndTime: async () => clip.end, getInPoint: async () => clip.inPoint, getComponentChain: async () => chain };
  const uxpSequence = { getVideoTrack: async () => ({ getTrackItems: async () => [item] }) };
  const uxpProject = { lockedAccess: callback => callback(), executeTransaction(callback, label) {
    const actions = []; callback({ addAction: action => { actions.push(action); return true; } });
    transactions.push({ label, actions: actions.length }); actions.forEach(action => action()); return true;
  } };
  const commit = (prepared, writes, label) => module.exports.commitNativeParams({ Constants: { TrackItemType: { CLIP: 1 } } }, uxpProject, uxpSequence, prepared, writes, label);
  return { call, history: module.exports, transactions, commit, read: () => call('readCaptionConnections'), get documentText() { return documentText; }, set token(value) { token = value; } };
}

test('one mode edit token restores both wrapping mode and merged document on mock Premiere Undo/Redo', async () => {
  for (const mode of ['balance', 'pretty', 'fill']) {
    const beforeMode = mode === 'fill' ? 'balance' : 'fill', panel = connected(mergedFixture(), 20, 0, beforeMode);
    const original = panel.binding.clip.documentText, host = historyHost(original), entry = host.read().native[0];
    assert.ok(entry, 'offline host discovers the caption effect: ' + JSON.stringify(host.read()));
    const binding = rehydrateNativePanel(entry, { id, name: 'Seq', duration: 10, frameWidth: 1920, frameHeight: 1080, frameRate: 25, playhead: 0 });
    const ui = await controller(binding); ui.changeLineWrap(mode); await ui.applyNativeOutput();
    assert.equal(ui.writes.length, 1); const write = ui.writes[0];
    const prepared = host.call('writeNativeCaptionDocument', { snapshot: { ...write.snapshot, phase: 'prepare' }, documentText: write.documentText });
    assert.equal(prepared.ok, true, prepared.error); assert.equal(prepared.documentChanged, true);
    const plan = host.history.planDocumentWrite(write.snapshot, prepared, write.documentText);
    assert.deepEqual(Array.from(plan.writes, w => w.label), ['Layout editing guide'], 'one transaction token; mode and merges ride in its document');
    const written = host.call('writeNativeCaptionDocument', { snapshot: { ...write.snapshot, phase: 'write', seedToken: plan.seedToken }, documentText: write.documentText });
    assert.equal(written.ok, true, written.error);
    await host.commit(prepared, plan.writes, write.label);
    assert.deepEqual(host.transactions, [{ label: 'S-Captions: Line wrap', actions: 1 }], 'actual UXP commit creates exactly one named transaction');
    const verified = host.call('writeNativeCaptionDocument', { snapshot: { ...write.snapshot, phase: 'verify', expectedToken: plan.token }, documentText: write.documentText });
    assert.equal(verified.readbackVerified, true, verified.error); plan.commit();
    const restore = token => {
      host.token = token; const pending = host.history.pendingRestores(host.read()); assert.equal(pending.length, 1);
      const item = pending[0], reply = host.call('restoreNativeCaptionDocument', { locator: item.locator, token: item.token, documentText: item.documentText });
      assert.equal(reply.ok, true, reply.error); host.history.restored(item, reply);
      assert.equal(host.history.pendingRestores(host.read()).length, 0);
      return decodeNativePanelDocument(host.documentText, id);
    };
    const undone = restore(plan.seedToken); assert.equal(host.documentText, original); assert.equal(undone.style.lineWrap ?? 'fill', beforeMode);
    assert.deepEqual(boundaries(undone), ['edge', 'join', 'join', 'edge', '-', '-', 'break', '-']);
    const redone = restore(plan.token); assert.equal(host.documentText, write.documentText); assert.equal(redone.style.lineWrap ?? 'fill', mode);
    assert.deepEqual(boundaries(redone), ['-', '-', '-', '-', '-', '-', 'break', '-']);
  }
});
