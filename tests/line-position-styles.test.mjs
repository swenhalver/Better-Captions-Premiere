import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME, validateNativeDocument } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument, encodeNativeTransportText, decodeNativeTransportTimeOrigin } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument, rehydrateNativePanel, prepareNativePanelUpdate, confirmNativePanelUpdate, nativeLineFitCharacterCapacity } from '../webview-ui/src/lib/native-effect/panel.ts';
import { POSITION_STYLES_VERSION, nativeLineStyles, panelLineStyles } from '../webview-ui/src/lib/native-effect/line-styles.ts';
import { lineStylePatch, lineStyleReset, resolveLineAppearance, lineOverrideGroups, lineScopePosition } from '../webview-ui/src/lib/line-styles.ts';
import { capturePresetLook, applyPresetLook, validatePresetLook } from '../webview-ui/src/lib/style-presets.ts';
import { validateStylePatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { DEFAULT_ANIMATION, DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';
import { nativeCarrier } from './helpers/native-document.mjs';

const id = '12345678-1234-5678-abcd-123456789abc';
const ticks = seconds => String(BigInt(Math.round(seconds * 254016000000)));
function nativeDocument(lineStyles) {
  const style = defaultNativeStyle();
  if (lineStyles) style.lineStyles = lineStyles;
  return { version: 1, animationAuthority: 'premiere-effect', sequenceId: id, timeOriginSeconds: 3600, style,
    captions: [{ id: 'one', start: 2.1, end: 3.7, manualSplit: false, words: [
      { text: 'Hello,', start: 2.1, end: 2.4, endOfSentence: false },
      { text: 'world.', start: 2.5, end: 3.7, endOfSentence: true },
    ] }] };
}
function entry(doc) {
  const locator = { projectPath: '/Projects/native.prproj', sequenceId: `{${id.toUpperCase()}}`, clipNodeId: 'native-clip', trackIndex: 2, clipIndex: 0, componentIndex: 1, documentParamIndex: 6 };
  const result = { kind: 'native-effect', clipNodeId: 'native-clip', projectItemId: 'native-item', trackIndex: 2, clipIndex: 0, maxChars: 56, lineFitWidth: 600, lineFitFontScale: 1,
    startTicks: ticks(0), endTicks: ticks(10), inTicks: ticks(3600), outTicks: ticks(3610), selected: true,
    locator, matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, documentText: encodeNativeTransportText(doc) };
  result.revision = JSON.stringify({ projectPath: locator.projectPath, sequenceId: locator.sequenceId, clipNodeId: result.clipNodeId, adjustmentLayer: true,
    start: result.startTicks, end: result.endTicks, inPoint: result.inTicks, outPoint: result.outTicks,
    components: ['AE.ADBE Motion', 'AE.' + NATIVE_EFFECT_MATCH_NAME], documentIndex: locator.documentParamIndex, documentText: result.documentText });
  return result;
}
const sequence = () => ({ id, name: 'Lines', duration: 20, frameWidth: 1920, frameHeight: 1080, frameRate: 25, playhead: 2.6 });
const version = text => Buffer.from(text.slice(7), 'hex').readUInt32LE(4);
const everyField = {
  fontFamily: 'Georgia', fontWeight: 700, italic: true, underline: false, fontSize: 80, color: { r: 1, g: 0, b: 0 }, opacity: .5,
  bubble: true, bubbleFillSpaces: true, bubbleColor: { r: 0, g: .2, b: .4 }, bubbleOpacity: .75,
  paddingTop: 1, paddingRight: 2, paddingBottom: 3, paddingLeft: 4, radiusTL: 5, radiusTR: 6, radiusBR: 7, radiusBL: 8,
  marginTop: -9, marginRight: 10, marginBottom: 11, marginLeft: 12, outlineWidth: 3, outlineColor: { r: .1, g: .1, b: .1 }, outlineOpacity: .9,
  shadowBlur: 4, shadowX: -2, shadowY: 6, shadowColor: { r: .3, g: .3, b: .3 }, shadowOpacity: .4,
};

test('documents without line position styles keep writing BCAP v10, byte for byte', () => {
  const plain = encodeNativeTransportText(nativeDocument());
  assert.equal(version(plain), 10);
  const decoded = decodeNativePanelDocument(plain, id);
  assert.equal(decoded.style.lineStyles, undefined);
  assert.equal(encodeNativeTransportText(decoded), plain);
  assert.equal(decodeNativeTransportTimeOrigin(plain), 3600);
});

test('line position styles round-trip through BCAP v11 with every field, and clearing them writes v10 again', () => {
  const lines = { '1': structuredClone(everyField), '4': { fontWeight: 0, fontWeightOffset: 100, marginBottom: 24 }, '8': { opacity: 0 } };
  const text = encodeNativeTransportText(nativeDocument(lines));
  assert.equal(version(text), POSITION_STYLES_VERSION);
  const decoded = decodeNativePanelDocument(text, id);
  assert.deepEqual(decoded.style.lineStyles, lines);
  assert.equal(encodeNativeTransportText(decoded), text);
  assert.equal(decodeNativeTransportTimeOrigin(text), 3600);
  // The state styles and transcript bytes are the v10 bytes plus the appended block.
  const plain = encodeNativeTransportText(nativeDocument());
  assert.equal(text.slice(23).startsWith(plain.slice(23)), true);
  delete decoded.style.lineStyles;
  assert.equal(encodeNativeTransportText(decoded), plain);
  // Empty positions are dropped rather than written.
  assert.equal(version(encodeNativeTransportText(nativeDocument({ '2': {} }))), 10);
});

test('malformed line position blocks are rejected by both panel readers', () => {
  const bytes = Buffer.from(encodeNativeDocument(nativeDocument({ '2': { marginTop: 4 } })));
  const block = Buffer.from(encodeNativeDocument(nativeDocument())).length;
  const variants = [
    b => b.writeUInt32LE(9, block),                       // more than eight positions
    b => b.writeUInt32LE(0, block + 4),                   // position 0
    b => b.writeUInt32LE(9, block + 4),                   // position 9
    b => b.writeUInt32LE(0, block + 8),                   // no fields
    b => b.writeUInt32LE(2 ** 31, block + 8),             // unknown field bit
  ];
  for (const mutate of variants) {
    const copy = Buffer.from(bytes); mutate(copy);
    assert.throws(() => decodeNativePanelDocument(nativeCarrier(copy), id));
    assert.throws(() => decodeNativeTransportTimeOrigin(nativeCarrier(copy)));
  }
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(bytes.subarray(0, bytes.length - 1)), id));
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(Buffer.concat([bytes, Buffer.from([0])])), id));
  const missing = Buffer.from(encodeNativeDocument(nativeDocument()));
  missing.writeUInt32LE(POSITION_STYLES_VERSION, 4);
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(missing), id), /Truncated/);
  for (const bad of [{ '9': { opacity: 1 } }, { '1': { opacity: 2 } }, { '1': { textTransform: 'none' } }, { '1': { fontWeightOffset: 100 } }, { '1': { color: { r: 1, g: 0, b: 0, a: 1 } } }])
    assert.throws(() => validateNativeDocument(nativeDocument(bad)));
});

test('panel line appearances map to native overrides and back without drift', () => {
  const panel = { '1': { marginTop: 12, marginBottom: 12, color: '#ff0000', fontSize: 80 }, '2': { strokeEnabled: true, strokeWidth: 3, shadowEnabled: false, fontWeightOffset: 100 },
    '3': { strokeEnabled: false, shadowEnabled: true, shadowOpacity: .4, fontWeight: 600, bubbleColor: '#336699', bubbleOpacity: .5 } };
  const native = nativeLineStyles(panel);
  assert.deepEqual(native['1'], { marginTop: 12, marginBottom: 12, color: { r: 1, g: 0, b: 0 }, fontSize: 80 });
  assert.deepEqual(native['2'], { fontWeight: 0, fontWeightOffset: 100, outlineWidth: 3, shadowOpacity: 0 });
  assert.equal(native['3'].outlineWidth, 0); assert.equal(native['3'].shadowOpacity, .4); assert.equal(native['3'].fontWeight, 600);
  assert.deepEqual(panelLineStyles(native), panel);
  assert.deepEqual(nativeLineStyles(panelLineStyles(native)), native);
  // Enabling an outline or shadow without an amount uses the word-state defaults.
  assert.equal(nativeLineStyles({ '1': { strokeEnabled: true } })['1'].outlineWidth, 2);
  assert.equal(nativeLineStyles({ '1': { shadowEnabled: true } })['1'].shadowOpacity, .5);
  assert.equal(nativeLineStyles({}), undefined);
});

test('a line style edit takes the normal document write path and rehydrates identically after Undo or Redo', () => {
  const { session, binding } = rehydrateNativePanel(entry(nativeDocument()), sequence());
  assert.equal(session.style.lineStyles, undefined);
  const edited = structuredClone(session);
  Object.assign(edited.style, lineStylePatch(edited.style, '1', { marginTop: 12, marginBottom: 12 }));
  Object.assign(edited.style, lineStylePatch(edited.style, '4', { color: '#00ff00' }));
  validateStylePatch({ lineStyles: edited.style.lineStyles });
  const prepared = prepareNativePanelUpdate(binding, edited);
  assert.deepEqual(prepared.style.lineStyles, { '1': { marginTop: 12, marginBottom: 12 }, '4': { color: { r: 0, g: 1, b: 0 } } });
  assert.deepEqual(prepared.style.current, binding.document.style.current);
  const text = encodeNativeTransportText(prepared);
  assert.equal(version(text), POSITION_STYLES_VERSION);
  const confirmed = confirmNativePanelUpdate(binding, prepared, edited, { revision: JSON.stringify({ ...JSON.parse(binding.clip.revision), documentText: text }), documentText: text });
  // Premiere Undo restores the earlier document; Redo this one. Each rehydrates to the same session style.
  const redone = rehydrateNativePanel({ ...confirmed.clip }, sequence());
  assert.deepEqual(redone.session.style.lineStyles, edited.style.lineStyles);
  assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(redone.binding, redone.session)), text);
  const undone = rehydrateNativePanel(entry(nativeDocument()), sequence());
  assert.equal(undone.session.style.lineStyles, undefined);
  // Unrelated edits keep the stored overrides untouched; clearing them returns to v10.
  const sized = structuredClone(redone.session); sized.style.lineHeight = 1.5;
  assert.deepEqual(prepareNativePanelUpdate(redone.binding, sized).style.lineStyles, prepared.style.lineStyles);
  const cleared = structuredClone(redone.session);
  Object.assign(cleared.style, lineStyleReset(cleared.style, '1', ['marginTop', 'marginBottom']));
  Object.assign(cleared.style, lineStyleReset(cleared.style, '4', ['color']));
  assert.equal(cleared.style.lineStyles, undefined);
  assert.equal(version(encodeNativeTransportText(prepareNativePanelUpdate(redone.binding, cleared))), 10);
});

test('precedence: a line shows its own values over the inherited states; unset fields inherit', () => {
  const style = structuredClone(DEFAULT_STYLE);
  const inherited = resolveAppearance(style, 'spokenWord');
  assert.equal(resolveLineAppearance(style, '2', inherited), inherited);
  Object.assign(style, lineStylePatch(style, '2', { color: '#123456', marginTop: 7, fontWeight: 300 }));
  const shown = resolveLineAppearance(style, '2', inherited);
  assert.equal(shown.color, '#123456'); assert.equal(shown.marginTop, 7); assert.equal(shown.fontWeight, 300);
  assert.equal(shown.opacity, inherited.opacity); assert.equal(shown.bubble, inherited.bubble); assert.equal(shown.fontSize, inherited.fontSize);
  // A relative bold step replaces the absolute weight, and resetting it drops both.
  Object.assign(style, lineStylePatch(style, '2', { fontWeightOffset: 100 }));
  assert.deepEqual(style.lineStyles['2'], { color: '#123456', marginTop: 7, fontWeightOffset: 100 });
  Object.assign(style, lineStyleReset(style, '2', ['fontWeightOffset']));
  assert.deepEqual(style.lineStyles['2'], { color: '#123456', marginTop: 7 });
  assert.deepEqual(lineOverrideGroups(style, '2').map(group => group.label), ['Color', 'Margin']);
  // Fields a line cannot hold are ignored; axis padding sets both of its sides.
  Object.assign(style, lineStylePatch(style, '3', { textTransform: 'uppercase', letterSpacing: 4, bubblePaddingInline: 6 }));
  assert.deepEqual(style.lineStyles['3'], { paddingLeft: 6, paddingRight: 6 });
  assert.equal(lineScopePosition('line-3'), '3'); assert.equal(lineScopePosition('current'), null); assert.equal(lineScopePosition('line-9'), null);
});

test('settings of lines beyond Visible lines are kept, unused, and still saved', () => {
  const { session, binding } = rehydrateNativePanel(entry(nativeDocument({ '6': { marginTop: 9 } })), sequence());
  assert.deepEqual(session.style.lineStyles, { '6': { marginTop: 9 } });
  // Editing Line 1 while only three lines show keeps Line 6 in the document.
  const edited = structuredClone(session);
  Object.assign(edited.style, lineStylePatch(edited.style, '1', { opacity: .5 }));
  assert.deepEqual(prepareNativePanelUpdate(binding, edited).style.lineStyles, { '1': { opacity: .5 }, '6': { marginTop: 9 } });
});

test('style presets save and apply line position styles; a look without them clears them', () => {
  const style = structuredClone(DEFAULT_STYLE);
  Object.assign(style, lineStylePatch(style, '1', { marginTop: 10, marginBottom: 10 }));
  Object.assign(style, lineStylePatch(style, '4', { marginTop: 10 }));
  assert.deepEqual(style.lineStyles, { '1': { marginTop: 10, marginBottom: 10 }, '4': { marginTop: 10 } });
  const look = capturePresetLook(style, DEFAULT_ANIMATION);
  assert.deepEqual(look.style.lineStyles, style.lineStyles);
  const fresh = structuredClone(DEFAULT_STYLE);
  assert.deepEqual(applyPresetLook(fresh, look).style.lineStyles, style.lineStyles);
  const plainLook = capturePresetLook(structuredClone(DEFAULT_STYLE), DEFAULT_ANIMATION);
  assert.equal('lineStyles' in plainLook.style, false);
  assert.equal(applyPresetLook(style, plainLook).style.lineStyles, undefined);
  assert.throws(() => validatePresetLook({ ...look, style: { ...look.style, lineStyles: { '0': { marginTop: 1 } } } }));
  assert.throws(() => validatePresetLook({ ...look, style: { ...look.style, lineStyles: { '1': { marginTop: 1000 } } } }));
});

test('Smart line fit includes a visible line position font, but not one beyond Visible lines', () => {
  const measure = (text, appearance) => text.length * appearance.fontSize * .5;
  const { session, binding } = rehydrateNativePanel(entry(nativeDocument()), sequence());
  const plain = nativeLineFitCharacterCapacity(binding, session, measure, 4);
  const styled = structuredClone(session);
  Object.assign(styled.style, lineStylePatch(styled.style, '3', { fontSize: 128 }));
  assert.ok(nativeLineFitCharacterCapacity(binding, styled, measure, 4) < plain);
  assert.equal(nativeLineFitCharacterCapacity(binding, styled, measure, 2), plain);
});

test('agent and panel style patches validate line position styles', () => {
  validateStylePatch({ lineStyles: { '1': { marginTop: -20, color: '#ffffff', italic: true, fontWeightOffset: 100 } } });
  validateStylePatch({ lineStyles: undefined });
  for (const bad of [{ '0': {} }, { '9': {} }, { '1': { textTransform: 'none' } }, { '1': { color: 'red' } }, { '1': { marginTop: 101 } }, { '1': [] }])
    assert.throws(() => validateStylePatch({ lineStyles: bad }));
});

test('TS line position bytes roundtrip through the actual C++ decoder and encoder', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url)), temp = mkdtempSync(join(tmpdir(), 'bcap-lines-'));
  try {
    const executable = join(temp, process.platform === 'win32' ? 'core-test.exe' : 'core-test');
    execFileSync(process.env.CXX || (process.platform === 'win32' ? 'clang++' : 'c++'), ['-std=c++17', join(root, 'native/core/caption_core.cpp'), join(root, 'native/tests/caption_core_test.cpp'), '-o', executable]);
    const input = join(temp, 'in.bcap'), output = join(temp, 'out.bcap');
    for (const lines of [{ '1': structuredClone(everyField) }, { '1': { marginTop: 12, marginBottom: 12 }, '4': { marginTop: 12, marginBottom: 12 } }, { '2': { fontWeight: 0, fontWeightOffset: 0, underline: true }, '8': { fontFamily: 'Avenir Next', fontWeight: 650 } }]) {
      const bytes = encodeNativeDocument(nativeDocument(lines));
      writeFileSync(input, bytes); execFileSync(executable, ['--roundtrip', input, output]);
      assert.deepEqual(new Uint8Array(readFileSync(output)), bytes);
      assert.deepEqual(decodeNativePanelDocument(nativeCarrier(readFileSync(output)), id).style.lineStyles, lines);
    }
    const plain = encodeNativeDocument(nativeDocument());
    writeFileSync(input, plain); execFileSync(executable, ['--roundtrip', input, output]);
    assert.deepEqual(new Uint8Array(readFileSync(output)), plain, 'documents without line styles stay v10 in C++ too');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
