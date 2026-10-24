import test from 'node:test';
import assert from 'node:assert/strict';
import { changeTranscriptLineBreak, clearLineMerges, transcriptLines, transcriptWords } from '../webview-ui/src/lib/transcript/lines.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { rehydrateNativePanel, prepareNativePanelUpdate, deriveNativePanelPhrases, nativeDocumentWriteSnapshot } from '../webview-ui/src/lib/native-effect/panel.ts';

// Ten words over two storage containers. At 15 characters per line the
// automatic rows are pairs: "word0 word1", "word2 word3", ...
const words = Array.from({ length: 10 }, (_, index) => ({ text: 'word' + index, startTime: index * .5, endTime: index * .5 + .4, isActive: false }));
const fixture = () => [0, 5].map((start, index) => {
  const part = structuredClone(words.slice(start, start + 5));
  return { id: 'store-' + index, words: part, text: part.map(word => word.text).join(' '), startTime: part[0].startTime, endTime: part.at(-1).endTime };
});
const rows = (captions, limit = 15) => transcriptLines(nativeCaptionPhrases(captions, limit)).map(line => [line.start, line.end]);
const markers = captions => transcriptWords(captions).map(word => word.lineBreakBefore ?? '-');
const merge = (captions, row, limit = 15) => { const grouped = nativeCaptionPhrases(captions, limit); return changeTranscriptLineBreak(grouped, transcriptLines(grouped)[row]); };
const split = (captions, row, at, limit = 15) => { const grouped = nativeCaptionPhrases(captions, limit); return changeTranscriptLineBreak(grouped, transcriptLines(grouped)[row], at); };

test('a merge writes clearable edges and joins; a reflow forgets all of it and regroups freshly', () => {
  const merged = merge(fixture(), 1);
  assert.deepEqual(rows(merged), [[0, 2], [2, 6], [6, 8], [8, 10]]);
  assert.deepEqual(markers(merged), ['-', '-', 'edge', 'join', 'join', 'join', 'edge', '-', '-', '-']);
  const reflowed = clearLineMerges(merged);
  assert.deepEqual(markers(reflowed), Array(10).fill('-'), 'no hard boundary remains where the merge was');
  assert.deepEqual(rows(reflowed), rows(fixture()), 'the same as a transcript that was never merged');
  assert.deepEqual(rows(reflowed, 24), rows(fixture(), 24));
  assert.deepEqual(reflowed.map(caption => caption.id), ['store-0', 'store-1']);
  assert.deepEqual(transcriptWords(reflowed).map(word => [word.text, word.startTime, word.endTime]), words.map(word => [word.text, word.startTime, word.endTime]));
});

test('only scissor splits survive a reflow, also when a later merge borders or crosses them', () => {
  const cut = split(fixture(), 1, 3); // scissors between word2 and word3
  assert.equal(transcriptWords(cut)[3].lineBreakBefore, 'break');
  // Merging the row that starts at the cut keeps the cut a manual break.
  const bordering = merge(cut, 2);
  assert.equal(transcriptWords(bordering)[3].lineBreakBefore, 'break', 'a merge edge never overwrites a manual split');
  assert.deepEqual(markers(clearLineMerges(bordering)), ['-', '-', '-', 'break', '-', '-', '-', '-', '-', '-']);
  // A cut between word8 and word9 right after a merged row stays a manual break.
  const tail = split(bordering, 4, 9);
  const after = merge(tail, 3);
  assert.equal(transcriptWords(after)[9].lineBreakBefore, 'break');
  assert.deepEqual(markers(clearLineMerges(after)).map((marker, index) => marker === 'break' ? index : null).filter(index => index !== null), [3, 9]);
  // Merging across a cut removes that cut: the user joined those lines.
  const crossing = merge(cut, 1);
  assert.notEqual(transcriptWords(crossing)[3].lineBreakBefore, 'break');
  assert.deepEqual(markers(clearLineMerges(crossing)), Array(10).fill('-'));
});

test('a reflow keeps removed pause lines, and merging works again until the next reflow', () => {
  const source = fixture(); source[1].words[0].pauseLinesRemoved = 3;
  const reflowed = clearLineMerges(merge(source, 2));
  assert.equal(transcriptWords(reflowed)[5].pauseLinesRemoved, 3);
  const again = merge(reflowed, 0);
  assert.deepEqual(rows(again), [[0, 4], [4, 6], [6, 8], [8, 10]]);
  assert.deepEqual(rows(clearLineMerges(again)), rows(fixture()));
});

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
function connected(captions, maxChars) {
  const doc = { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 0, style: defaultNativeStyle(),
    captions: captions.map(caption => ({ id: caption.id, start: caption.startTime, end: caption.endTime, manualSplit: false,
      words: caption.words.map(word => ({ text: word.text, start: word.startTime, end: word.endTime, endOfSentence: false,
        ...(word.lineBreakBefore ? { lineBreakBefore: word.lineBreakBefore } : {}), ...(word.pauseLinesRemoved ? { pauseLinesRemoved: word.pauseLinesRemoved } : {}) })) })) };
  const locator = { projectPath: '/p.prproj', sequenceId: id, clipNodeId: 'clip', trackIndex: 0, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const entry = { kind: 'native-effect', maxChars, clipNodeId: 'clip', projectItemId: 'item', trackIndex: 0, clipIndex: 0, startTicks: ticks(0), endTicks: ticks(10), inTicks: ticks(0), outTicks: ticks(10),
    selected: true, locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc) };
  entry.revision = JSON.stringify({ projectPath: locator.projectPath, sequenceId: id, clipNodeId: 'clip', adjustmentLayer: true, start: entry.startTicks, end: entry.endTicks, inPoint: entry.inTicks, outPoint: entry.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: 6, documentText: entry.documentText });
  return rehydrateNativePanel(entry, { id, name: 'Seq', duration: 10, frameWidth: 1920, frameHeight: 1080, frameRate: 25, playhead: 0 });
}
// As main-webview's reflowCharacterLimit edits the session before its one write.
function reflow({ session, binding }, maxChars) {
  const edited = { ...structuredClone(session), style: { ...structuredClone(session.style), maxChars } };
  edited.captions = deriveNativePanelPhrases(binding, { ...edited, captions: clearLineMerges(edited.captions) });
  return { edited, document: prepareNativePanelUpdate(binding, edited), snapshot: nativeDocumentWriteSnapshot(binding, edited) };
}

test('a native Characters per line change sends the cleared document and the limit in one write', () => {
  const panel = connected(split(merge(fixture(), 1), 3, 9), 15);
  assert.deepEqual(panel.session.captions.flatMap(caption => caption.words.map(word => word.lineBreakBefore ?? '-')), ['-', '-', 'edge', 'join', 'join', 'join', 'edge', '-', 'edge', 'break']);
  const { document, snapshot } = reflow(panel, 24);
  assert.deepEqual(snapshot.grouping, { before: 15, value: 24 });
  assert.equal(snapshot.revision, panel.binding.snapshot.revision);
  assert.deepEqual(document.captions.flatMap(caption => caption.words.map(word => word.lineBreakBefore ?? '-')), ['-', '-', '-', '-', '-', '-', '-', '-', '-', 'break']);
});

test('Smart line fit with an unchanged capacity still clears merges, as a document-only write', () => {
  const panel = connected(merge(fixture(), 1), 15);
  const { document, snapshot } = reflow(panel, 15);
  assert.equal(snapshot.grouping, undefined, 'no scalar change to commit');
  assert.notEqual(encodeNativeTransportText(document), panel.binding.clip.documentText, 'the document still changes');
  assert.ok(document.captions.every(caption => caption.words.every(word => word.lineBreakBefore === undefined)));
  // Nothing merged and the same capacity: nothing to write.
  const plain = connected(fixture(), 15);
  assert.equal(encodeNativeTransportText(reflow(plain, 15).document), plain.binding.clip.documentText);
});

// The production controller in main-webview.svelte, with only Svelte, the host
// API and the session store shimmed.
async function controller(panel) {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const vm = (await import('node:vm')).default;
  const ts = createRequire(new URL('../webview-ui/package.json', import.meta.url))('typescript');
  const source = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const modules = {};
  for (const name of [...source.matchAll(/from ["'](\.\/lib\/[^"']+)["']/g)].map(match => match[1]))
    if (!name.endsWith('.svelte')) try { modules[name] = await import(new URL('../webview-ui/src/' + name.slice(2).replace(/\.ts$/, '') + '.ts', import.meta.url)); } catch { modules[name] = {}; }
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
    export { changeCharacterLimit, applyNativeOutput, agent };
    export function connect(binding) { nativeBinding = binding; }
    export function problem() { return error; }`;
  vm.runInNewContext(ts.transpileModule(source + extension, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document: { hidden: false, visibilityState: 'visible', hasFocus: () => false, activeElement: null }, window: {}, HTMLElement: class {}, structuredClone, console,
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

test('the panel and agent limit changes make exactly one write carrying the limit and the cleared merges', async () => {
  const { decodeNativePanelDocument } = await import('../webview-ui/src/lib/native-effect/panel.ts');
  const boundaries = text => decodeNativePanelDocument(text, id).captions.flatMap(caption => caption.words.map(word => word.lineBreakBefore ?? '-'));
  for (const via of ['panel', 'agent']) {
    const ui = await controller(connected(split(merge(fixture(), 1), 3, 9), 15));
    if (via === 'panel') ui.changeCharacterLimit(24); else await ui.agent.patchStyle({ maxChars: 24 });
    assert.equal(ui.problem(), '', via);
    await ui.applyNativeOutput();
    assert.equal(ui.writes.length, 1, via + ': one write, so one Premiere undo step');
    assert.deepEqual({ ...ui.writes[0].snapshot.grouping }, { before: 15, value: 24 }, via);
    assert.equal(ui.writes[0].label, 'Characters per line', via);
    assert.deepEqual(boundaries(ui.writes[0].documentText), ['-', '-', '-', '-', '-', '-', '-', '-', '-', 'break'], via);
  }
  const same = await controller(connected(merge(fixture(), 1), 15));
  await same.agent.patchStyle({ maxChars: 15 });
  assert.ok(same.session.captions.some(caption => caption.words.some(word => word.lineBreakBefore === 'join')), 'an unchanged agent limit is not a reflow');
});
