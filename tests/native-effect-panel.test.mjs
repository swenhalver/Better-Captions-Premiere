import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument, encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { nativePanelSequenceId, decodeNativePanelDocument, rehydrateNativePanel, prepareNativePanelUpdate, confirmNativePanelUpdate, deriveNativePanelPhrases, NATIVE_PANEL_CAPABILITIES } from '../webview-ui/src/lib/native-effect/panel.ts';
import { registerFontCatalog } from '../webview-ui/src/lib/font-catalog.ts';
import { moveWord, moveWordEdge } from '../webview-ui/src/lib/transcript/timing.ts';

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
const clone = structuredClone;
function document() {
  const style = defaultNativeStyle();
  Object.assign(style.current, { fontFamily: 'Georgia', fontSize: 48, sizeScale: 1.25, opacity: .8, bubble: true, padding: 13, radius: 17, outlineWidth: 2, shadowBlur: 4, shadowX: -2, shadowY: 3 });
  style.current.color = { r: .123456789, g: .234567891, b: .345678912, a: .456789123 };
  style.current.bubbleColor = { r: .9, g: .7, b: .2, a: .6 };
  style.current.outlineColor = { r: .05, g: .06, b: .07, a: .8 };
  return { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 3600, style,
    captions: [{ id: 'one', start: 2.1, end: 3.7, manualSplit: true, words: [
      { text: 'Hello,', start: 2.1, end: 2.4, endOfSentence: false },
      { text: '世界!', start: 2.5, end: 3.7, endOfSentence: true },
    ] }] };
}
function entry(doc = document(), patch = {}) {
  const locator = { projectPath: '/Projects/native.prproj', sequenceId: `{${id.toUpperCase()}}`, clipNodeId: 'native-clip', trackIndex: 2, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const result = { kind: 'native-effect', clipNodeId: 'native-clip', projectItemId: 'native-item', trackIndex: 2, clipIndex: 0,
    startTicks: ticks(0), endTicks: ticks(10), inTicks: ticks(3600), outTicks: ticks(3610), selected: true,
    locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc), ...patch };
  result.revision = JSON.stringify({ projectPath: result.locator.projectPath, sequenceId: result.locator.sequenceId, clipNodeId: result.clipNodeId, adjustmentLayer: true,
    start: result.startTicks, end: result.endTicks, inPoint: result.inTicks, outPoint: result.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: result.locator.documentParamIndex, documentText: result.documentText });
  return result;
}
const sequence = () => ({ id, name: 'Native captions', duration: 20, frameWidth: 720, frameHeight: 1280, frameRate: 29.97002997002997, playhead: 2.6 });
const binding = () => rehydrateNativePanel(entry(), sequence());

function framedDocument(fps) {
  const result = document();
  result.captions = [{ id: 'timed', start: 60 / fps, end: 180 / fps, manualSplit: true, words: [
    { text: 'First', start: 60 / fps, end: 90 / fps, endOfSentence: false },
    { text: 'middle', start: 100 / fps, end: 130 / fps, endOfSentence: false },
    { text: 'last.', start: 140 / fps, end: 180 / fps, endOfSentence: true },
  ] }];
  return result;
}

/** Exercise the production fixed writer in a VM; no Adobe/app APIs are invoked. */
function nativeWriter(source) {
  const collection = (values, key = 'numItems') => Object.defineProperty(values, key, { get: () => values.length });
  const files = new Map(), writes = [], unexpected = [];
  let carrier = source.documentText;
  const forbid = name => () => { unexpected.push(name); assert.fail(`Word timing must not change native ${name}`); };
  const parameter = (displayName, value, keys = []) => ({ displayName, value, keys, setValue: forbid(displayName), setValueAtKey: forbid(displayName + ' key'), addKey: forbid(displayName + ' key insertion'), removeKey: forbid(displayName + ' key removal') });
  const motion = collection([
    parameter('Position', [.5, .85], [{ ticks: ticks(3601), value: [.3, .8], interpolation: 'native-bezier', tangent: [.1, -.2] }]),
    parameter('Scale Height', 112, [{ ticks: ticks(3601), value: 98, interpolation: 'hold' }]),
    parameter('Scale Width', 88, [{ ticks: ticks(3602), value: 105, interpolation: 'bezier', tangent: 17 }]),
    parameter('Uniform Scale', false), parameter('Rotation', 13), parameter('Anchor Point', [.5, .5]),
  ]);
  const controls = collection(['Position', 'Width', 'Height', 'Character limit', 'Upcoming opacity', 'Current opacity'].map((name, index) => parameter(name, index + .25, [{ ticks: ticks(3602), value: index + .5, interpolation: 'native' }])));
  const documentParam = { displayName: 'Caption document (experimental)', isTimeVarying: () => false, getValue: () => carrier,
    setValue(value, refresh) { writes.push({ value, refresh }); carrier = value; return 0; } };
  controls.push(documentParam);
  const clip = { nodeId: source.clipNodeId, projectItem: { nodeId: source.projectItemId },
    isAdjustmentLayer: () => true, isSelected: () => source.selected,
    setSelected: forbid('selection'), remove: forbid('clip removal'),
    components: collection([{ matchName: 'AE.ADBE Motion', properties: motion }, { matchName: source.matchName, properties: controls }]) };
  for (const [field, value] of [['start', source.startTicks], ['end', source.endTicks], ['inPoint', source.inTicks], ['outPoint', source.outTicks]]) {
    Object.defineProperty(clip, field, { enumerable: true, get: () => ({ ticks: value }), set: forbid(field) });
  }
  const tracks = collection([0, 1, 2].map(index => ({ clips: collection(index === 2 ? [clip] : []), isLocked: () => false, overwriteClip: forbid('clip insertion') })), 'numTracks');
  const activeSequence = { sequenceID: source.locator.sequenceId, videoTracks: tracks, setPlayerPosition: forbid('playhead') };
  const context = { app: { project: { path: source.locator.projectPath, activeSequence, importFiles: forbid('import') } }, JSON: undefined,
    File: function (path) { this.length = (files.get(path) ?? '').length; this.open = mode => mode === 'r' && files.has(path); this.read = () => files.get(path); this.close = () => {}; } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8'), context);
  const physicalState = () => JSON.stringify({ clipNodeId: clip.nodeId, projectItemId: clip.projectItem.nodeId, start: clip.start, end: clip.end, inPoint: clip.inPoint, outPoint: clip.outPoint,
    motion, controls: controls.slice(0, -1), tracks: tracks.map(track => track.clips.map(item => item.nodeId)) });
  return { writes, unexpected, physicalState, get carrier() { return carrier; }, write(snapshot, documentText) {
    files.set('/native-word-timing.json', JSON.stringify({ sequenceId: source.locator.sequenceId, projectPath: source.locator.projectPath, snapshot, documentText }));
    return JSON.parse(context.BetterCaptionsHost.writeNativeCaptionDocument('/native-word-timing.json'));
  } };
}

test('the bounded native reader restores source Unicode, manual splits, styles and origin', () => {
  assert.deepEqual(decodeNativePanelDocument(encodeNativeTransportText(document()), `{${id.toUpperCase()}}`), document());
  const bytes = encodeNativeDocument({ ...document(), timeOriginSeconds: 0 }).slice(0, -8);
  new DataView(bytes.buffer).setUint32(4, 1, true);
  const text = 'BCDOC1:' + Buffer.from(bytes).toString('hex');
  assert.equal(decodeNativePanelDocument(text, id).timeOriginSeconds, 0, 'Legacy v1 origin remains zero');
});

test('malformed, truncated, future and trailing native carriers cannot be adopted', () => {
  const text = encodeNativeTransportText(document());
  for (const invalid of [null, 'BCDOC1:0', text.slice(0, -2), text + '00', text.replace('42434150', '00000000'), text.slice(0, 15) + '04000000' + text.slice(23)]) {
    assert.throws(() => decodeNativePanelDocument(invalid, id));
  }
});

test('adoption is bound to exact native revision/clip identity and GUID-equivalent sequence only', () => {
  const result = binding();
  assert.equal(result.session.sequenceId, id);
  assert.equal(result.binding.snapshot.locator.sequenceId, `{${id.toUpperCase()}}`);
  assert.equal(result.binding.document.sequenceId, id);
  assert.equal(nativePanelSequenceId('sequence-A'), 'sequence-A');
  assert.equal(nativePanelSequenceId('SEQUENCE-A'), 'SEQUENCE-A');
  assert.throws(() => rehydrateNativePanel(entry(), { ...sequence(), id: 'another-sequence' }), /another sequence/);
  assert.throws(() => rehydrateNativePanel({ ...entry(), clipNodeId: 'another-clip' }, sequence()), /identity/);
  assert.throws(() => rehydrateNativePanel({ ...entry(), documentText: 'BCDOC1:00' }, sequence()), /identity/);
  assert.throws(() => rehydrateNativePanel({ ...entry(), startTicks: ticks(1) }, sequence()), /timing/);
});

test('native captions populate the editor without fabricated legacy movie identities', () => {
  const { session, binding: connected, capabilities, warnings } = binding();
  assert.equal(session.hasTranscript, true);
  assert.equal(session.captions[0].text, 'Hello, 世界!');
  assert.equal(session.captions[0].manualSplit, true);
  assert.equal(session.style.activeWord.fontSize, 60);
  assert.equal(session.style.activeWord.opacity, .8);
  assert.equal(session.style.activeWord.bubbleOpacity, .6);
  assert.equal(session.frameRate, sequence().frameRate, 'Actual timeline cadence is retained');
  assert.equal(session.currentTime, 2.6);
  for (const field of ['clipNodeId', 'projectItemId', 'mediaPath', 'renderBounds', 'motionProfile']) assert.equal(session.captions[0][field], undefined);
  assert.equal(connected.clip.clipNodeId, 'native-clip');
  assert.equal(capabilities.geometry, 'premiere-effect-controls');
  assert.equal(capabilities.animation, 'premiere-effect-controls');
  assert.ok(warnings.some(warning => warning.includes('synthetic italic')));
  assert.ok(warnings.some(warning => warning.includes('pixels')));
});

test('no-op adoption and a style-only edit retain exact hidden alpha, floats and source times', () => {
  const { session, binding: connected } = binding();
  assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(connected, session)), entry().documentText);
  const edited = clone(session); edited.style.activeWord.bubbleColor = '#ff0000';
  const result = prepareNativePanelUpdate(connected, edited);
  assert.deepEqual(result.captions, connected.document.captions);
  assert.deepEqual(result.style.current.color, connected.document.style.current.color);
  assert.equal(result.style.current.fontSize, 48);
  assert.equal(result.style.current.sizeScale, 1.25);
  assert.equal(result.style.current.bubbleColor.a, .6);
  assert.deepEqual(result.style.current.bubbleColor, { r: 1, g: 0, b: 0, a: .6 });
  assert.deepEqual(result.style.upcoming, connected.document.style.upcoming);
  assert.deepEqual(result.style.spoken, connected.document.style.spoken);
});

test('ordinary moved-layer timing maps both directions without rounding untouched source words', () => {
  const source = entry(document(), { startTicks: ticks(10.2), endTicks: ticks(16.2), inTicks: ticks(3604.1), outTicks: ticks(3610.1) });
  const result = rehydrateNativePanel(source, sequence());
  assert.ok(Math.abs(result.binding.timelineOffsetSeconds - 6.1) < 1e-9);
  assert.ok(Math.abs(result.session.captions[0].startTime - 8.2) < 1e-9);
  assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(result.binding, result.session)), source.documentText);
  const edited = clone(result.session); edited.style.activeWord.opacity = .5;
  assert.deepEqual(prepareNativePanelUpdate(result.binding, edited).captions, document().captions);
  edited.captions[0].words[0].text = 'Edited'; edited.captions[0].text = 'Edited 世界!';
  const prepared = prepareNativePanelUpdate(result.binding, edited);
  assert.equal(prepared.captions[0].words[0].text, 'Edited');
  assert.equal(prepared.timeOriginSeconds, 3600);
  assert.deepEqual(prepared.captions[0].words[1], document().captions[0].words[1]);
});

test('supported state size, opacity, bubble and effect values map without touching neighbors', () => {
  const { session, binding: connected } = binding();
  const edited = clone(session);
  Object.assign(edited.style.activeWord, { fontSize: 90, opacity: .4, bubble: false, padding: 20, radius: 30, strokeWidth: 3, strokeOpacity: .7, shadowBlur: 10, shadowOffsetX: 4 });
  const result = prepareNativePanelUpdate(connected, edited);
  assert.equal(result.style.current.fontSize * result.style.current.sizeScale, 90);
  assert.equal(result.style.current.opacity, .4);
  assert.equal(result.style.current.bubble, false);
  assert.equal(result.style.current.padding, 20);
  assert.equal(result.style.current.radius, 30);
  assert.equal(result.style.current.outlineWidth, 3);
  assert.equal(result.style.current.outlineColor.a, .7);
  assert.equal(result.style.current.shadowBlur, 10);
  assert.equal(result.style.current.shadowX, 4);
  assert.deepEqual(result.style.spoken, connected.document.style.spoken);
});

test('unsupported formatting, presets and geometry are refused rather than lost', () => {
  const { session, binding: connected } = binding(), original = clone(connected.document);
  for (const patch of [
    state => state.style.activeWord.letterSpacing = 3,
    state => state.style.textAlign = 'left',
    state => state.style.backgroundEnabled = true,
    state => state.style.maxChars = 30,
    state => state.animation.preset = 'pop',
    state => state.captions[0].position = { x: .2, y: .2 },
  ]) {
    const edited = clone(session); patch(edited);
    assert.throws(() => prepareNativePanelUpdate(connected, edited), /cannot apply/);
    assert.deepEqual(connected.document, original);
  }
  assert.ok(NATIVE_PANEL_CAPABILITIES.supportedWordStyleFields.includes('fontWeightOffset'));
});

test('native weight, relative B and italic roundtrip per state while preserving hidden colors and origin', () => {
  registerFontCatalog([{family:'Arial',weights:[400,700],italic:true},{family:'Georgia',weights:[400,700],italic:true}]);
  const {session,binding:connected}=binding(), edited=clone(session);
  Object.assign(edited.style.activeWord,{fontWeightOffset:100,italic:true});
  const prepared=prepareNativePanelUpdate(connected,edited);
  assert.equal(prepared.style.baseFontWeight,400);
  assert.equal(prepared.style.current.fontWeight,700,'B resolves next available Georgia face');
  assert.equal(prepared.style.current.fontWeightOffset,100);
  assert.equal(prepared.style.current.italic,true);
  assert.deepEqual(prepared.style.current.color,connected.document.style.current.color);
  assert.deepEqual(prepared.style.spoken,connected.document.style.spoken);
  assert.deepEqual(prepared.captions,connected.document.captions);
  assert.equal(prepared.timeOriginSeconds,3600);
  const readback=rehydrateNativePanel(entry(prepared),sequence());
  assert.equal(readback.session.style.fontWeight,400,'Shared base is not flattened into B weight');
  assert.equal(readback.session.style.activeWord.fontWeightOffset,100);
  assert.equal(readback.session.style.activeWord.italic,true);
  assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(readback.binding,readback.session)),entry(prepared).documentText);
  const off=clone(readback.session);off.style.activeWord.fontWeightOffset=0;off.style.activeWord.italic=false;
  const offDocument=prepareNativePanelUpdate(readback.binding,off);
  assert.equal(offDocument.style.current.fontWeight,400);
  assert.equal(offDocument.style.current.fontWeightOffset,0);
  assert.equal(offDocument.style.current.italic,false);
});

test('relative B follows changed shared baseline and numeric state weights become absolute', () => {
  const source=document();source.style.baseFontWeight=400;
  Object.assign(source.style.current,{fontWeight:700,fontWeightOffset:100,italic:true});
  const {session,binding:connected}=rehydrateNativePanel(entry(source),sequence());
  const changed=clone(session);changed.style.fontWeight=700;
  const prepared=prepareNativePanelUpdate(connected,changed);
  assert.equal(prepared.style.baseFontWeight,700);
  assert.equal(prepared.style.current.fontWeightOffset,100,'A base edit preserves B mode');
  assert.equal(prepared.style.current.italic,true);
  const absolute=clone(session);Object.assign(absolute.style.activeWord,{fontWeight:400,fontWeightOffset:null});
  const absoluteDocument=prepareNativePanelUpdate(connected,absolute);
  assert.equal(absoluteDocument.style.current.fontWeight,400);
  assert.equal(absoluteDocument.style.current.fontWeightOffset,null);
  assert.equal(absoluteDocument.style.baseFontWeight,400);
});

test('untouched binary versions 1 and 2 remain byte exact and typography edits upgrade only the carrier', () => {
  for(const binaryVersion of [1,2]){
    const source={...document(),timeOriginSeconds:0,binaryVersion};
    const nativeEntry=entry(source), {session,binding:connected}=rehydrateNativePanel(nativeEntry,sequence());
    assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(connected,session)),nativeEntry.documentText);
    const edited=clone(session);edited.style.activeWord.italic=true;
    const prepared=prepareNativePanelUpdate(connected,edited), bytes=encodeNativeDocument(prepared);
    assert.equal(new DataView(bytes.buffer).getUint32(4,true),3);
    assert.deepEqual(prepared.captions,connected.document.captions);
    assert.deepEqual(prepared.style.current.color,connected.document.style.current.color);
    assert.equal(prepared.timeOriginSeconds,0);
  }
});

test('an overridden base style is not silently discarded by the native projection', () => {
  const { session, binding: connected } = binding();
  const edited = clone(session); edited.style.fontFamily = 'Verdana';
  assert.throws(() => prepareNativePanelUpdate(connected, edited), /base fontFamily override/);
  edited.style.upcomingWord.fontFamily = 'Verdana';
  assert.equal(prepareNativePanelUpdate(connected, edited).style.upcoming.fontFamily, 'Verdana');
});

test('shared native Title Case preserves source text and rejects different per-state modes', () => {
  const { session, binding: connected } = binding();
  const edited = clone(session); edited.style.activeWord.textTransform = 'titlecase';
  assert.throws(() => prepareNativePanelUpdate(connected, edited), /different word-state case/);
  edited.style.textTransform = 'titlecase';
  edited.style.upcomingWord.textTransform = edited.style.spokenWord.textTransform = 'titlecase';
  const prepared = prepareNativePanelUpdate(connected, edited);
  assert.equal(prepared.style.titleCase, true);
  assert.deepEqual(prepared.captions, connected.document.captions);
});

test('caption boundary-only changes and fabricated movie identities cannot be written', () => {
  const { session, binding: connected } = binding();
  const edited = clone(session); edited.captions[0].endTime += 1;
  assert.throws(() => prepareNativePanelUpdate(connected, edited), /word boundaries/);
  const movie = clone(session); movie.captions[0].mediaPath = '/caption.mov';
  assert.throws(() => prepareNativePanelUpdate(connected, movie), /caption mediaPath/);
});

test('first/last word moves and edge trims save through the fixed native writer without moving its clip or curves', () => {
  for (const fps of [30, 30000 / 1001]) {
    const edits = [
      ['first move', caption => moveWord(caption, 0, 70 / fps, fps)],
      ['last move', caption => moveWord(caption, 2, 135 / fps, fps)],
      ['first start trim', caption => moveWordEdge(caption, 0, 'startTime', 75 / fps, fps)],
      ['last end trim', caption => moveWordEdge(caption, 2, 'endTime', 165 / fps, fps)],
      ['first collision to three frames', caption => moveWord(caption, 0, 120 / fps, fps)],
      ['last collision to three frames', caption => moveWord(caption, 2, 90 / fps, fps)],
    ];
    for (const [name, edit] of edits) {
      const source = entry(framedDocument(fps)), { session, binding: connected } = rehydrateNativePanel(source, { ...sequence(), frameRate: fps });
      const original = clone(session), edited = clone(session), host = nativeWriter(source), physical = host.physicalState();
      edited.captions[0] = edit(session.captions[0]);
      assert.deepEqual(session, original, `${name}: timing helper is immutable`);
      assert.equal(edited.captions[0].startTime, original.captions[0].startTime, `${name}: editable container start stays fixed`);
      assert.equal(edited.captions[0].endTime, original.captions[0].endTime, `${name}: editable container end stays fixed`);
      const prepared = prepareNativePanelUpdate(connected, edited);
      assert.equal(prepared.captions[0].start, edited.captions[0].words[0].startTime, name);
      assert.equal(prepared.captions[0].end, edited.captions[0].words.at(-1).endTime, name);
      assert.deepEqual(prepared.captions[0].words.map(word => [word.start, word.end]), edited.captions[0].words.map(word => [word.startTime, word.endTime]), name);
      assert.equal(prepared.captions[0].manualSplit, true);
      assert.equal(prepared.timeOriginSeconds, 3600);
      assert.deepEqual(prepared.style, connected.document.style, `${name}: timing leaves native styles intact`);
      const response = host.write(connected.snapshot, encodeNativeTransportText(prepared));
      assert.equal(response.ok, true, `${name}: ${response.error ?? 'native readback confirmed'}`);
      assert.equal(response.readbackVerified, true);
      const next = confirmNativePanelUpdate(connected, prepared, edited, response);
      assert.deepEqual(decodeNativePanelDocument(host.carrier, id).captions, prepared.captions, `${name}: actual carrier contains the edited words`);
      assert.equal(next.baseline.captions[0].startTime, original.captions[0].startTime);
      assert.equal(next.baseline.captions[0].endTime, original.captions[0].endTime);
      const styleEdit = clone(edited); styleEdit.style.activeWord.opacity = .42;
      const styled = prepareNativePanelUpdate(next, styleEdit);
      assert.deepEqual(styled.captions, prepared.captions, `${name}: a follow-up style save retains exact word times`);
      const styleResponse = host.write(next.snapshot, encodeNativeTransportText(styled));
      assert.equal(styleResponse.ok, true, styleResponse.error);
      confirmNativePanelUpdate(next, styled, styleEdit, styleResponse);
      assert.equal(host.writes.length, 2, `${name}: exactly one document setter per edit`);
      assert.equal(host.physicalState(), physical, `${name}: physical clip timing, identity, scalar controls and all native curves are unchanged`);
      assert.deepEqual(host.unexpected, []);
    }
  }
});

test('outer word edits on a moved/trimmed native layer preserve its source clock and untouched words exactly', () => {
  const fps = 30000 / 1001, source = entry(framedDocument(fps), { startTicks: ticks(10.2), endTicks: ticks(16.2), inTicks: ticks(3604.1), outTicks: ticks(3610.1) });
  const { session, binding: connected } = rehydrateNativePanel(source, { ...sequence(), frameRate: fps });
  const edited = clone(session), before = clone(connected);
  edited.captions[0] = moveWordEdge(edited.captions[0], 0, 'startTime', edited.captions[0].words[0].startTime + 6 / fps, fps);
  edited.captions[0] = moveWordEdge(edited.captions[0], 2, 'endTime', edited.captions[0].words[2].endTime - 9 / fps, fps);
  const prepared = prepareNativePanelUpdate(connected, edited), host = nativeWriter(source), physical = host.physicalState();
  assert.equal(prepared.captions[0].start, edited.captions[0].words[0].startTime - connected.timelineOffsetSeconds);
  assert.equal(prepared.captions[0].end, edited.captions[0].words[2].endTime - connected.timelineOffsetSeconds);
  assert.deepEqual(prepared.captions[0].words[1], before.document.captions[0].words[1], 'Untouched source floats are not offset and rounded');
  assert.equal(prepared.timeOriginSeconds, before.document.timeOriginSeconds);
  const response = host.write(connected.snapshot, encodeNativeTransportText(prepared));
  assert.equal(response.ok, true, response.error);
  const next = confirmNativePanelUpdate(connected, prepared, edited, response);
  assert.equal(next.timelineOffsetSeconds, connected.timelineOffsetSeconds);
  assert.equal(host.physicalState(), physical);
  assert.deepEqual(connected, before, 'Preparation/readback do not mutate the captured binding');
});

test('retained native caption envelopes require an existing capture and finite contained edited words', () => {
  const { session, binding: connected } = rehydrateNativePanel(entry(framedDocument(30)), { ...sequence(), frameRate: 30 });
  const inset = clone(session); inset.captions[0] = moveWordEdge(inset.captions[0], 0, 'startTime', 75 / 30, 30);
  for (const [name, change] of [
    ['fabricated ID with a retained envelope', state => state.captions[0].id = 'new-caption'],
    ['changed mismatched start', state => state.captions[0].startTime -= .1],
    ['changed mismatched end', state => state.captions[0].endTime += .1],
    ['word before container', state => state.captions[0].words[0].startTime = state.captions[0].startTime - .1],
    ['word after container', state => state.captions[0].words[2].endTime = state.captions[0].endTime + .1],
    ['nonfinite start', state => state.captions[0].startTime = NaN],
    ['nonfinite end', state => state.captions[0].endTime = Infinity],
    ['string start', state => state.captions[0].startTime = '2'],
    ['reversed container', state => state.captions[0].endTime = state.captions[0].startTime - .1],
    ['nonfinite word', state => state.captions[0].words[0].startTime = NaN],
    ['reversed word', state => state.captions[0].words[0].endTime = state.captions[0].words[0].startTime - .1],
  ]) {
    const invalid = clone(inset); change(invalid);
    assert.throws(() => prepareNativePanelUpdate(connected, invalid), /word boundaries/, name);
  }
  const newCaption = clone(inset); newCaption.captions[0].id = 'new-caption';
  newCaption.captions[0].startTime = newCaption.captions[0].words[0].startTime;
  assert.equal(prepareNativePanelUpdate(connected, newCaption).captions[0].id, 'new-caption', 'A new caption with exact word bounds remains valid');
  const missingCapture = clone(connected); missingCapture.document.captions = [];
  assert.throws(() => prepareNativePanelUpdate(missingCapture, inset), /word boundaries/, 'A panel-only ID does not prove a native capture');
  const invalidCapture = clone(connected); invalidCapture.baseline.captions[0].endTime = Infinity;
  assert.throws(() => prepareNativePanelUpdate(invalidCapture, inset), /word boundaries/, 'An invalid captured envelope cannot authorize retained bounds');
});

test('confirmed exact readback advances binding only and rejects differing or stale revisions', () => {
  const { session, binding: connected } = binding();
  const edited = clone(session); edited.style.activeWord.opacity = .5;
  const prepared = prepareNativePanelUpdate(connected, edited), responseEntry = entry(prepared);
  const next = confirmNativePanelUpdate(connected, prepared, edited, responseEntry);
  assert.equal(next.snapshot.revision, responseEntry.revision);
  assert.equal(next.document.style.current.opacity, .5);
  assert.equal(next.baseline.style.activeWord.opacity, .5);
  assert.equal(connected.document.style.current.opacity, .8, 'Previous binding stays intact');
  assert.throws(() => confirmNativePanelUpdate(connected, prepared, edited, { ...responseEntry, documentText: entry().documentText }), /readback differs/);
  assert.throws(() => confirmNativePanelUpdate(connected, prepared, edited, { ...responseEntry, revision: entry().revision }), /identity/);
});

test('upper/lower display modes round trip without altering source words, times or native container identity',async()=>{
 const {decodeNativeTransportTimeOrigin}=await import('../webview-ui/src/lib/native-effect/encode.ts');
 for(const mode of ['uppercase','lowercase']){
  const {session,binding:connected}=binding();const edited=clone(session);edited.style.textTransform=mode;
  for(const key of ['activeWord','upcomingWord','spokenWord'])edited.style[key].textTransform=mode;
  const prepared=prepareNativePanelUpdate(connected,edited),carrier=encodeNativeTransportText(prepared),decoded=decodeNativePanelDocument(carrier,id);
  assert.equal(decoded.style.letterCase,mode);assert.equal(decoded.binaryVersion,4);assert.deepEqual(decoded.captions,connected.document.captions);
  assert.equal(decodeNativeTransportTimeOrigin(carrier),connected.document.timeOriginSeconds);assert.equal(encodeNativeTransportText(decoded),carrier);
  const restored=rehydrateNativePanel(entry(decoded),{id,name:'Native',frameWidth:1920,frameHeight:1080,frameRate:24,duration:7200});
  assert.equal(restored.session.style.textTransform,mode);assert.equal(restored.session.style.activeWord.textTransform,mode);
  const reset=clone(restored.session);reset.style.textTransform='none';for(const key of ['activeWord','upcomingWord','spokenWord'])reset.style[key].textTransform='none';
  const originalCase=prepareNativePanelUpdate(restored.binding,reset);assert.equal(originalCase.style.letterCase,undefined);assert.equal(originalCase.style.titleCase,false);assert.deepEqual(originalCase.captions,prepared.captions);
 }
});

function confirmStyleEdit(connected,edited,prepared){
 const documentText=encodeNativeTransportText(prepared),revision=JSON.parse(connected.snapshot.revision);revision.documentText=documentText;
 return confirmNativePanelUpdate(connected,prepared,edited,{documentText,revision:JSON.stringify(revision)});
}
test('native pixel word spacing is editable without changing transcript or other native fields and immediately affects Smart groups',()=>{
 const {session,binding:connected}=binding();assert.equal(session.style.wordSpacing,connected.document.style.wordSpacing);
 const before=clone(connected.document),edited=clone(session);edited.style.wordSpacing=20.25;const next=prepareNativePanelUpdate(connected,edited);before.style.wordSpacing=20.25;assert.deepEqual(next,before);
 const smart={...connected,clip:{...connected.clip,smartLineFit:true,lineFitWidth:100,lineFitFontScale:1}};
 assert.equal(deriveNativePanelPhrases(smart,session,()=>10)[0].renderSegments.length,1);edited.style.wordSpacing=40;assert.equal(deriveNativePanelPhrases(smart,edited,()=>10)[0].renderSegments.length,2);
 for(const wordSpacing of [-1,4097,NaN,undefined,'12']){const bad=clone(session);bad.style.wordSpacing=wordSpacing;assert.throws(()=>prepareNativePanelUpdate(connected,bad),/word spacing/);}
 assert.equal(NATIVE_PANEL_CAPABILITIES.wordSpacing,'editable-native-pixels');assert.ok(!NATIVE_PANEL_CAPABILITIES.unsupportedGlobalStyleFields.includes('wordSpacing'));
});
test('outline toggle maps off to native width zero and retains the remembered session width for re-enabling',()=>{
 const {session,binding:connected}=binding(),off=clone(session);off.style.activeWord.strokeEnabled=false;
 const disabled=prepareNativePanelUpdate(connected,off),expected=clone(connected.document);expected.style.current.outlineWidth=0;assert.deepEqual(disabled,expected);assert.equal(off.style.activeWord.strokeWidth,2);
 const confirmed=confirmStyleEdit(connected,off,disabled),on=clone(off);on.style.activeWord.strokeEnabled=true;
 assert.deepEqual(prepareNativePanelUpdate(confirmed,on),connected.document);
 const remembered=clone(off);remembered.style.activeWord.strokeWidth=7;const stillOff=prepareNativePanelUpdate(confirmed,remembered);assert.equal(stillOff.style.current.outlineWidth,0);
 const confirmedRemembered=confirmStyleEdit(confirmed,remembered,stillOff),enabled=clone(remembered);enabled.style.activeWord.strokeEnabled=true;assert.equal(prepareNativePanelUpdate(confirmedRemembered,enabled).style.current.outlineWidth,7);
 assert.ok(NATIVE_PANEL_CAPABILITIES.supportedWordStyleFields.includes('strokeEnabled'));
});
test('enabling an imported zero-width outline uses a visible default without touching its tint or opacity',()=>{
 const doc=document();doc.style.current.outlineWidth=0;doc.style.current.outlineColor={r:.11,g:.22,b:.33,a:.44};const {session,binding:connected}=rehydrateNativePanel(entry(doc),sequence()),edited=clone(session);edited.style.activeWord.strokeEnabled=true;
 const next=prepareNativePanelUpdate(connected,edited);assert.equal(next.style.current.outlineWidth,2);assert.deepEqual(next.style.current.outlineColor,doc.style.current.outlineColor);assert.deepEqual(next.style.spoken,doc.style.spoken);
});
test('shadow toggle maps alpha to zero while preserving native extents and restores remembered opacity without changing neighbors',()=>{
 const {session,binding:connected}=binding(),off=clone(session);off.style.activeWord.shadowEnabled=false;
 const disabled=prepareNativePanelUpdate(connected,off),expected=clone(connected.document);expected.style.current.shadowColor.a=0;assert.deepEqual(disabled,expected);
 const confirmed=confirmStyleEdit(connected,off,disabled),on=clone(off);on.style.activeWord.shadowEnabled=true;assert.deepEqual(prepareNativePanelUpdate(confirmed,on),connected.document);
 const remembered=clone(off);remembered.style.activeWord.shadowBlur=8;remembered.style.activeWord.shadowOpacity=.75;const stillOff=prepareNativePanelUpdate(confirmed,remembered);assert.equal(stillOff.style.current.shadowColor.a,0);assert.equal(stillOff.style.current.shadowBlur,8);
 const rebound=confirmStyleEdit(confirmed,remembered,stillOff),enabled=clone(remembered);enabled.style.activeWord.shadowEnabled=true;const restored=prepareNativePanelUpdate(rebound,enabled);assert.equal(restored.style.current.shadowColor.a,.75);assert.equal(restored.style.current.shadowBlur,8);
 assert.ok(NATIVE_PANEL_CAPABILITIES.supportedWordStyleFields.includes('shadowEnabled'));
});
test('enabling a native shadow with zero alpha/extents supplies visible defaults while unrelated edits remain byte-identical',()=>{
 const doc=document();Object.assign(doc.style.current,{shadowBlur:0,shadowX:0,shadowY:0});doc.style.current.shadowColor={r:.123456,g:.234567,b:.345678,a:0};
 const source=entry(doc),{session,binding:connected}=rehydrateNativePanel(source,sequence());assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(connected,session)),source.documentText);
 const edited=clone(session);edited.style.activeWord.shadowEnabled=true;const next=prepareNativePanelUpdate(connected,edited);assert.equal(next.style.current.shadowColor.a,.5);assert.equal(next.style.current.shadowBlur,4);assert.deepEqual({...next.style.current.shadowColor,a:0},doc.style.current.shadowColor);
});

test('all-word outline/shadow controls accept remembered disabled sliders and restore their effective native values',()=>{
 const {session,binding:connected}=binding(),on=clone(session);Object.assign(on.style,{strokeEnabled:true,strokeWidth:2,shadowEnabled:true,shadowOpacity:.5,shadowBlur:4});
 for(const key of ['upcomingWord','activeWord','spokenWord'])Object.assign(on.style[key],{strokeEnabled:true,strokeWidth:2,shadowEnabled:true,shadowOpacity:.5,shadowBlur:4});
 const enabled=prepareNativePanelUpdate(connected,on),enabledBinding=confirmStyleEdit(connected,on,enabled),off=clone(on);off.style.strokeEnabled=false;off.style.shadowEnabled=false;
 for(const key of ['upcomingWord','activeWord','spokenWord']){off.style[key].strokeEnabled=false;off.style[key].shadowEnabled=false;}
 const disabled=prepareNativePanelUpdate(enabledBinding,off);for(const key of ['upcoming','current','spoken']){assert.equal(disabled.style[key].outlineWidth,0);assert.equal(disabled.style[key].shadowColor.a,0);assert.equal(disabled.style[key].shadowBlur,4);}
 const disabledBinding=confirmStyleEdit(enabledBinding,off,disabled),restore=clone(off);restore.style.strokeEnabled=true;restore.style.shadowEnabled=true;
 for(const key of ['upcomingWord','activeWord','spokenWord']){restore.style[key].strokeEnabled=true;restore.style[key].shadowEnabled=true;}
 assert.deepEqual(prepareNativePanelUpdate(disabledBinding,restore),enabled);
});


test('native bubble spaces rehydrate and edit per state without changing layout, words, tints or opacity',()=>{
 const {session,binding:connected}=binding();const untouched=prepareNativePanelUpdate(connected,session);assert.equal(encodeNativeTransportText(untouched),connected.clip.documentText);
 for(const [panelKey,nativeKey] of [['activeWord','current'],['spokenWord','spoken'],['upcomingWord','upcoming']]){
  assert.equal(session.style[panelKey].bubbleFillSpaces,false);const edited=clone(session);edited.style[panelKey].bubbleFillSpaces=true;
  const next=prepareNativePanelUpdate(connected,edited),expected=clone(connected.document);expected.style[nativeKey].bubbleFillSpaces=true;assert.deepEqual(next,expected);
  const restored=rehydrateNativePanel(entry(next),sequence());assert.equal(restored.session.style[panelKey].bubbleFillSpaces,true);
  const off=clone(restored.session);off.style[panelKey].bubbleFillSpaces=false;const disabled=prepareNativePanelUpdate(restored.binding,off);assert.equal(disabled.style[nativeKey].bubbleFillSpaces,undefined);assert.deepEqual(disabled.captions,connected.document.captions);
 }
 assert.ok(NATIVE_PANEL_CAPABILITIES.supportedWordStyleFields.includes('bubbleFillSpaces'));
});


test('native line spacing accepts the ribbon minimum and preserves legacy maximum without changing caption data',()=>{
 const {session,binding:connected}=binding();
 for(const lineHeight of [.6,1.2,2,10]){
  const edited=clone(session);edited.style.lineHeight=lineHeight;const expected=clone(connected.document);expected.style.lineHeight=lineHeight;
  const next=prepareNativePanelUpdate(connected,edited);assert.deepEqual(next,expected);
  const text=encodeNativeTransportText(next),restored=decodeNativePanelDocument(text,id);assert.equal(restored.style.lineHeight,lineHeight);assert.deepEqual(restored.captions,connected.document.captions);assert.equal(encodeNativeTransportText(restored),text);
  assert.equal(rehydrateNativePanel(entry(next),sequence()).session.style.lineHeight,lineHeight);
 }
 for(const lineHeight of [.599999,0,-1,10.001,NaN,Infinity,'0.6',undefined]){const edited=clone(session);edited.style.lineHeight=lineHeight;assert.throws(()=>prepareNativePanelUpdate(connected,edited));}
});


test('native inline/block bubble padding edits preserve the other axis and legacy uniform fallback',()=>{
 const {session,binding:connected}=binding();assert.equal(session.style.activeWord.bubblePaddingInline,undefined);assert.equal(session.style.activeWord.bubblePaddingBlock,undefined);
 for(const [key,native] of [['activeWord','current'],['spokenWord','spoken'],['upcomingWord','upcoming']])for(const axis of ['bubblePaddingInline','bubblePaddingBlock']){
  const edited=clone(session);edited.style[key][axis]=axis==='bubblePaddingInline'?25:0;const next=prepareNativePanelUpdate(connected,edited),expected=clone(connected.document);expected.style[native][axis]=edited.style[key][axis];assert.deepEqual(next,expected);
  const restored=rehydrateNativePanel(entry(next),sequence());assert.equal(restored.session.style[key][axis],edited.style[key][axis]);assert.equal(restored.session.style[key].padding,session.style[key].padding);
  const off=clone(restored.session);delete off.style[key][axis];const reset=prepareNativePanelUpdate(restored.binding,off);assert.equal(reset.style[native][axis],undefined);assert.deepEqual(reset.style,connected.document.style);
 }
});


test('native underline changes only the requested state and explicit false resets without affecting other typography',()=>{
 const {session,binding:connected}=binding();
 for(const [key,native] of [['activeWord','current'],['spokenWord','spoken'],['upcomingWord','upcoming']])for(const underline of [true,false]){
  const edited=clone(session);edited.style[key].underline=underline;const next=prepareNativePanelUpdate(connected,edited),expected=clone(connected.document);expected.style[native].underline=underline;assert.deepEqual(next,expected);
  const restored=rehydrateNativePanel(entry(next),sequence());assert.equal(restored.session.style[key].underline,underline);const reset=clone(restored.session);delete reset.style[key].underline;assert.deepEqual(prepareNativePanelUpdate(restored.binding,reset).style,connected.document.style);
 }
 assert.ok(NATIVE_PANEL_CAPABILITIES.supportedWordStyleFields.includes('underline'));
});
