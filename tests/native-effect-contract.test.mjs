import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultNativeStyle, validateNativeStyle, NATIVE_PARAMETER_DISK_MAPPING, NATIVE_EFFECT_MATCH_NAME, validateNativeDocument, requireNativeHost, planNativeParameterEdit, planNativeMigration } from '../webview-ui/src/lib/native-effect/contract.ts';
const host = { host: 'premiere', matchName: NATIVE_EFFECT_MATCH_NAME, loaded: true, renderVerified: true, parameterReadWriteVerified: true, serializationVerified: true };
const target = { sequenceId: 'seq-1', clipId: 'clip-1', effectId: 'fx-1', revision: 'rev-1' };
const document = () => ({ version: 1, animationAuthority: 'premiere-effect', sequenceId: 'seq-1', style: defaultNativeStyle(), captions: [{ id: 'caption-1', start: 0, end: 3, manualSplit: true, words: [{ text: 'original CASE!', start: 0, end: 1, endOfSentence: true }] }] });
const migration = () => ({ explicitConsent: true, document: document(), snapshot: { target, snapshotId: 'snapshot-1', sourceFingerprint: 'sha256:' + 'a'.repeat(64), protectedAnimation: false } });
const edit = () => ({ target, parameter: 'width', value: 700, timeTicks: '254016000000', operation: 'set-value' });

test('native document preserves exact transcript, split, timing and identity without retaining caller references', () => {
  const input = document(), baseline = structuredClone(input), output = validateNativeDocument(input);
  assert.deepEqual(output, baseline); output.captions[0].words[0].text = 'changed';
  assert.deepEqual(input, baseline);
});
test('native documents reject future schemas, shadow animation, duplicate IDs and unknown data', () => {
  for (const patch of [{ version: 2 }, { animationAuthority: 'panel' }, { keyframes: [] }, { fallbackMovie: '/tmp/a.mov' }]) assert.throws(() => validateNativeDocument({ ...document(), ...patch }));
  const duplicate = document(); duplicate.captions.push(duplicate.captions[0]); assert.throws(() => validateNativeDocument(duplicate), /Duplicate/);
  for (const word of [{ text: '', start: 0, end: 1 }, { text: '\ud800', start: 0, end: 1 }, { text: 'x', start: NaN, end: 1 }, { text: 'x', start: 2, end: 4 }]) {
    const data = document(); data.captions[0].words = [word]; assert.throws(() => validateNativeDocument(data));
  }
});
test('transport rejects prototypes, dangerous properties and getters without invoking them', () => {
  for (const property of ['__proto__', 'constructor', 'prototype']) assert.throws(() => validateNativeDocument(JSON.parse(JSON.stringify(document()).replace('"version":1', '"version":1,"' + property + '":{}'))));
  let called = false; const input = document(); Object.defineProperty(input, 'version', { get() { called = true; return 1; } });
  assert.throws(() => validateNativeDocument(input)); assert.equal(called, false);
  assert.throws(() => validateNativeDocument(Object.assign(Object.create({ injected: true }), document())));
});
test('every unverified host capability fails closed', () => {
  for (const key of ['loaded', 'renderVerified', 'parameterReadWriteVerified', 'serializationVerified']) assert.throws(() => requireNativeHost({ ...host, [key]: false }), /No automatic movie fallback/);
  assert.throws(() => requireNativeHost({ ...host, host: 'after-effects' }));
  assert.throws(() => requireNativeHost({ ...host, matchName: 'legacy' }));
});
test('independent pixel dimensions and position use one host animation authority with exact revision and ticks', () => {
  for (const parameter of ['positionX', 'positionY', 'width', 'height']) {
    const result = planNativeParameterEdit({ ...edit(), parameter }, target, host);
    assert.equal(result.parameter, parameter); assert.equal(result.animationAuthority, 'premiere-effect');
    assert.equal(result.preserveOtherKeysAndInterpolation, true); assert.equal(result.retry, 'never');
    assert.equal('keyframes' in result, false);
  }
  assert.throws(() => planNativeParameterEdit(edit(), { ...target, revision: 'rev-2' }, host), /changed/);
  for (const patch of [{ value: Infinity }, { value: 0 }, { value: 8193 }, { parameter: 'motionScale' }, { timeTicks: 1 }, { keyframes: [] }]) assert.throws(() => planNativeParameterEdit({ ...edit(), ...patch }, target, host));
});
test('per-time reset delegates default to native host and explicitly preserves other keys and easing', () => {
  const input = edit(); delete input.value; input.operation = 'reset-at-time';
  const result = planNativeParameterEdit(input, target, host);
  assert.equal('value' in result, false); assert.equal(result.timeTicks, input.timeTicks);
  assert.equal(result.preserveOtherKeysAndInterpolation, true);
  assert.throws(() => planNativeParameterEdit({ ...input, value: 100 }, target, host));
});
test('migration requires explicit consent and a preservation snapshot and leaves legacy input untouched', () => {
  const input = migration(), baseline = structuredClone(input), plan = planNativeMigration(input, host);
  assert.deepEqual(input, baseline); assert.equal(plan.preserveLegacy, true);
  assert.equal(plan.strategy, 'create-separate-native-container'); assert.equal(plan.rollback, 'remove-new-container-only');
  plan.document.captions[0].words[0].text = 'changed'; assert.deepEqual(input, baseline);
  assert.throws(() => planNativeMigration({ ...input, explicitConsent: false }, host));
  assert.throws(() => planNativeMigration({ ...input, snapshot: { ...input.snapshot, protectedAnimation: true } }, host), /Protected/);
  assert.throws(() => planNativeMigration({ ...input, snapshot: { ...input.snapshot, sourceFingerprint: '' } }, host));
  assert.throws(() => planNativeMigration({ ...input, document: { ...input.document, sequenceId: 'other' } }, host), /sequence changed/);
});

test('all three word states validate independently and display transforms preserve source', () => {
  const input = document(); input.style.titleCase = true; input.style.wordSpacing = 17;
  input.style.current.bubble = true; input.style.current.sizeScale = 1.4;
  input.style.upcoming.color.a = .4; input.style.spoken.outlineWidth = 3;
  const result = validateNativeDocument(input);
  assert.equal(result.captions[0].words[0].text, 'original CASE!');
  assert.equal(result.style.current.sizeScale, 1.4); assert.equal(result.style.upcoming.color.a, .4);
  for (const state of ['upcoming', 'current', 'spoken']) {
    for (const patch of [{ fontSize: NaN }, { opacity: 2 }, { shadowX: -5000 }, { fontFamily: '\u0000bad' }, { effectScript: 'x' }]) {
      const style = defaultNativeStyle(); Object.assign(style[state], patch); assert.throws(() => validateNativeStyle(style));
    }
  }
});

test('TS encoder bytes roundtrip through actual C++ decoder and encoder', async () => {
  const { encodeNativeDocument } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url)), temp = mkdtempSync(join(tmpdir(), 'bcap-interop-'));
  try {
    const executable = join(temp, process.platform === 'win32' ? 'core-test.exe' : 'core-test');
    execFileSync(process.env.CXX || (process.platform === 'win32' ? 'clang++' : 'c++'), ['-std=c++17', join(root, 'native/core/caption_core.cpp'), join(root, 'native/tests/caption_core_test.cpp'), '-o', executable]);
    const data = document(); data.captions[0].words[0].text = 'café 日本語 CASE!'; data.style.titleCase = true;
    data.style.current.fontFamily = 'Helvetica'; data.style.current.bubble = true; data.style.current.color.r = .25;
    data.style.spoken.shadowY = -7; data.style.wordSpacing = 19;
    const encoded = encodeNativeDocument(data), input = join(temp, 'in.bcap'), output = join(temp, 'out.bcap');
    writeFileSync(input, encoded); execFileSync(executable, ['--roundtrip', input, output]);
    assert.deepEqual(new Uint8Array(readFileSync(output)), encoded);
    assert.deepEqual(Array.from(encoded.slice(0, 8)), [66, 67, 65, 80, 1, 0, 0, 0]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('documented UXP component probe stays read-only and does not infer arbitrary transport', async () => {
  const { probeNativeComponent } = await import('../webview-ui/src/lib/native-effect/probe.ts');
  let mutations = 0;
  const component = {
    async getMatchName() { return NATIVE_EFFECT_MATCH_NAME; }, getParamCount() { return 2; },
    getParam(index) { return { displayName: index ? 'Document' : 'Width', async areKeyframesSupported() { return !index; }, isTimeVarying() { return false; }, async getStartValue() { return { value: index ? 'private transcript' : 700 }; }, setValue() { mutations++; } }; },
  };
  const result = await probeNativeComponent(component);
  assert.equal(mutations, 0); assert.equal(result.readOnly, true); assert.equal(result.writeSupportVerified, false);
  assert.equal(result.arbitraryTextTransportVerified, false); assert.equal(result.parameters[0].finiteNumber, 700);
  assert.equal(result.parameters[1].stringLength, 18); assert.equal(JSON.stringify(result).includes('private transcript'), false);
  await assert.rejects(() => probeNativeComponent({ ...component, async getMatchName() { return 'other-effect'; } }));
  await assert.rejects(() => probeNativeComponent({ ...component, getParamCount() { return 1000000; } }));
  const failed = await probeNativeComponent({ ...component, getParamCount() { return 1; }, getParam() { throw new Error('secret path'); } });
  assert.equal(failed.parameters[0].error, 'Host parameter read failed.'); assert.equal(JSON.stringify(failed).includes('secret'), false);
});


test('logical Position coordinates share native point identity while dimensions remain independent', () => {
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.positionX.diskId, 1);
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.positionY.diskId, 1);
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.positionX.coordinate, 'x');
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.positionY.coordinate, 'y');
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.width.diskId, 2);
  assert.equal(NATIVE_PARAMETER_DISK_MAPPING.height.diskId, 3);
});
