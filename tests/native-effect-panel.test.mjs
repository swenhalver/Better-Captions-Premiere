import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument, encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { nativePanelSequenceId, decodeNativePanelDocument, rehydrateNativePanel, prepareNativePanelUpdate, confirmNativePanelUpdate, NATIVE_PANEL_CAPABILITIES } from '../webview-ui/src/lib/native-effect/panel.ts';
import { registerFontCatalog } from '../webview-ui/src/lib/font-catalog.ts';

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
  assert.ok(warnings.some(warning => warning.includes('px')));
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
    state => state.style.activeWord.strokeEnabled = false,
    state => state.style.activeWord.shadowEnabled = false,
    state => state.style.textAlign = 'left',
    state => state.style.backgroundEnabled = true,
    state => state.style.wordSpacing = 100,
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

test('shared native Title Case preserves source text and rejects per-state or upper/lowercase', () => {
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
