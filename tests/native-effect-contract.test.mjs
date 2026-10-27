import { legacyNativeDocumentBytes, nativeCarrier } from './helpers/native-document.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultNativeStyle, validateNativeStyle, NATIVE_PARAMETER_DISK_MAPPING, NATIVE_EFFECT_MATCH_NAME, validateNativeDocument, requireNativeHost, planNativeParameterEdit, planNativeMigration } from '../webview-ui/src/lib/native-effect/contract.ts';
const host = { host: 'premiere', matchName: NATIVE_EFFECT_MATCH_NAME, loaded: true, renderVerified: true, parameterReadWriteVerified: true, serializationVerified: true };
const target = { sequenceId: 'seq-1', clipId: 'clip-1', effectId: 'fx-1', revision: 'rev-1' };
const document = () => ({ version: 1, animationAuthority: 'premiere-effect', timeOriginSeconds: 0, sequenceId: 'seq-1', style: defaultNativeStyle(), captions: [{ id: 'caption-1', start: 0, end: 3, manualSplit: true, words: [{ text: 'original CASE!', start: 0, end: 1, endOfSentence: true }] }] });
const migration = () => ({ explicitConsent: true, document: document(), snapshot: { target, snapshotId: 'snapshot-1', sourceFingerprint: 'sha256:' + 'a'.repeat(64), protectedAnimation: false, adjustmentLayer: true } });
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
  assert.throws(() => planNativeMigration({ ...input, snapshot: { ...input.snapshot, adjustmentLayer: false } }, host), /adjustment layer/);
  assert.throws(() => planNativeMigration({ ...input, snapshot: { ...input.snapshot, adjustmentLayer: undefined } }, host), /adjustment layer/);
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
    data.style.spoken.shadowY = -7; data.style.wordSpacing = 19; data.timeOriginSeconds = -12.5;
    data.captions[0].words.at(-1).lineBreakBefore = 'edge';
    const encoded = encodeNativeDocument(data), input = join(temp, 'in.bcap'), output = join(temp, 'out.bcap');
    writeFileSync(input, encoded); execFileSync(executable, ['--roundtrip', input, output]);
    assert.deepEqual(new Uint8Array(readFileSync(output)), encoded);
    assert.deepEqual(Array.from(encoded.slice(0, 8)), [66, 67, 65, 80, 11, 0, 0, 0]);
    const { decodeNativePanelDocument } = await import('../webview-ui/src/lib/native-effect/panel.ts');
    // Merge edges are v10 only.
    const older = structuredClone(data); delete older.captions[0].words.at(-1).lineBreakBefore;
    for (let version = 1; version <= 8; version++) {
      const legacy = legacyNativeDocumentBytes({ ...older, timeOriginSeconds: 0 }, version);
      writeFileSync(input, legacy); execFileSync(executable, ['--roundtrip', input, output]);
      const expected = encodeNativeDocument(decodeNativePanelDocument(nativeCarrier(legacy), 'seq-1'));
      assert.deepEqual(new Uint8Array(readFileSync(output)), expected, `v${version} upgrades identically in TS and C++`);
    }
    const rich = structuredClone(data); rich.style.baseFontWeight = 442.5;
    Object.assign(rich.style.current, { fontWeight: 700, fontWeightOffset: 100, italic: true, bubbleFillSpaces: true,
      bubblePaddingInline: 19, bubblePaddingBlock: 3.5, underline: true, paddingTop: 2, marginLeft: -3, radiusBR: 14 });
    Object.assign(rich.style.upcoming, { fontWeight: 1, italic: false, bubblePaddingBlock: 0 });
    Object.assign(rich.style.spoken, { fontWeight: 442.5, fontWeightOffset: 0, underline: false });
    rich.captions[0].words[0].lineBreakBefore = 'break';
    rich.captions[0].words[0].pauseLinesRemoved = 8;
    rich.captions[0].words.push({ text: 'after', start: 1, end: 2, endOfSentence: false, lineBreakBefore: 'join' });
    for (const letterCase of ['uppercase', 'lowercase']) {
      rich.style.letterCase = letterCase; rich.style.titleCase = false;
      const bytes = encodeNativeDocument(rich); writeFileSync(input, bytes); execFileSync(executable, ['--roundtrip', input, output]);
      assert.deepEqual(new Uint8Array(readFileSync(output)), bytes, 'v9 boundaries, pause removal and every optional style roundtrip through C++');
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('native typography validates bounded weights, explicit italic and the relative B mode', async () => {
  const {encodeNativeTransportText,decodeNativeTransportTimeOrigin}=await import('../webview-ui/src/lib/native-effect/encode.ts');
  const {decodeNativePanelDocument}=await import('../webview-ui/src/lib/native-effect/panel.ts');
  const data=document();data.timeOriginSeconds=123.456;data.style.baseFontWeight=400;
  Object.assign(data.style.current,{fontWeight:700,italic:true,fontWeightOffset:100});
  Object.assign(data.style.upcoming,{fontWeight:1,italic:false,fontWeightOffset:0});
  const text=encodeNativeTransportText(data),decoded=decodeNativePanelDocument(text,'seq-1');
  assert.equal(decoded.binaryVersion,11);assert.deepEqual(decoded.style,data.style);
  assert.equal(decodeNativeTransportTimeOrigin(text),123.456);
  assert.equal(encodeNativeTransportText(decoded),text);
  for(const patch of [{fontWeight:0},{fontWeight:.999},{fontWeight:1000.01},{fontWeight:NaN},{italic:1},{fontWeightOffset:50}]){
    const bad=structuredClone(data);Object.assign(bad.style.current,patch);assert.throws(()=>validateNativeDocument(bad));
  }
  for(const value of [0,.999,1000.01,Infinity])assert.throws(()=>validateNativeDocument({...data,style:{...data.style,baseFontWeight:value}}));
  const bytes=Buffer.from(text.slice(7),'hex');
  for(const field of [bytes.length-408,bytes.length-404]){
    const malformed=Buffer.from(bytes);malformed.writeUInt32LE(3,field);const carrier='BCDOC1:'+malformed.toString('hex');
    assert.throws(()=>decodeNativePanelDocument(carrier,'seq-1'));assert.throws(()=>decodeNativeTransportTimeOrigin(carrier));
  }
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

test('only the exact native effect and single observed AE prefix normalize', async () => {
  const { normalizeNativeMatchName } = await import('../webview-ui/src/lib/native-effect/contract.ts');
  for (const name of [NATIVE_EFFECT_MATCH_NAME, 'AE.' + NATIVE_EFFECT_MATCH_NAME]) {
    assert.equal(normalizeNativeMatchName(name), NATIVE_EFFECT_MATCH_NAME);
    assert.doesNotThrow(() => requireNativeHost({ ...host, matchName: name }));
  }
  for (const name of ['AE.AE.' + NATIVE_EFFECT_MATCH_NAME, 'ae.' + NATIVE_EFFECT_MATCH_NAME, NATIVE_EFFECT_MATCH_NAME + '.other', ' ' + NATIVE_EFFECT_MATCH_NAME, null, {}, NATIVE_EFFECT_MATCH_NAME.toUpperCase()]) {
    assert.equal(normalizeNativeMatchName(name), null);
    assert.throws(() => requireNativeHost({ ...host, matchName: name }));
  }
});

test('Position pixel intent maps only with render-verified host units and preserves other coordinate', async () => {
  const { planNativePointCoordinate } = await import('../webview-ui/src/lib/native-effect/contract.ts');
  const plan = planNativeParameterEdit({ ...edit(), parameter: 'positionX', value: 640 }, target, host);
  const current = { x: .3, y: .75 };
  const calibration = { target, renderingVerified: true, space: 'normalized-sequence', frameWidth: 1280, frameHeight: 720 };
  assert.deepEqual(planNativePointCoordinate(plan, current, calibration).point, { x: .5, y: .75 });
  assert.deepEqual(current, { x: .3, y: .75 });
  const yPlan = planNativeParameterEdit({ ...edit(), parameter: 'positionY', value: 360 }, target, host);
  assert.deepEqual(planNativePointCoordinate(yPlan, current, calibration).point, { x: .3, y: .5 });
  assert.deepEqual(planNativePointCoordinate(plan, { x: 300, y: 500 }, { ...calibration, space: 'sequence-pixels' }).point, { x: 640, y: 500 });
  for (const patch of [{ renderingVerified: false }, { frameWidth: 0 }, { space: 'assumed-motion-units' }, { target: { ...target, revision: 'stale' } }]) assert.throws(() => planNativePointCoordinate(plan, current, { ...calibration, ...patch }));
});

test('ASCII carrier preserves exact BCAP bytes and accounts for native UTF-16 terminator', async () => {
  const { encodeNativeDocument, encodeNativeTransportText, NATIVE_TRANSPORT_PREFIX, MAX_NATIVE_CARRIER_BYTES, MAX_NATIVE_TRANSPORT_BCAP_BYTES } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const doc = document(); doc.captions[0].words[0].text = 'café 日本語';
  const encoded = encodeNativeDocument(doc), text = encodeNativeTransportText(doc);
  assert.equal(text.startsWith('BCDOC1:'), true);
  assert.equal(text.length, NATIVE_TRANSPORT_PREFIX.length + encoded.length * 2);
  assert.match(text, /^BCDOC1:[0-9a-f]+$/);
  assert.deepEqual(new Uint8Array(Buffer.from(text.slice(NATIVE_TRANSPORT_PREFIX.length), 'hex')), encoded);
  assert.equal(Buffer.byteLength(text + '\0', 'utf16le'), (text.length + 1) * 2);
  assert.ok((text.length + 1) * 2 <= MAX_NATIVE_CARRIER_BYTES);
  assert.ok((NATIVE_TRANSPORT_PREFIX.length + MAX_NATIVE_TRANSPORT_BCAP_BYTES * 2 + 1) * 2 <= MAX_NATIVE_CARRIER_BYTES);
  assert.ok((NATIVE_TRANSPORT_PREFIX.length + (MAX_NATIVE_TRANSPORT_BCAP_BYTES + 1) * 2 + 1) * 2 > MAX_NATIVE_CARRIER_BYTES);
});

test('native text carrier rejects a valid BCAP document too large for UTF-16 hex transport', async () => {
  const { encodeNativeTransportText } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const doc = document();
  doc.captions[0].end = 50000;
  doc.captions[0].words = Array.from({ length: 50000 }, (_, i) => ({ text: 'é'.repeat(40), start: i, end: i + .5, endOfSentence: false }));
  assert.throws(() => encodeNativeTransportText(doc), /UTF-16 carrier exceeds/);
});

test('generated CEP operations guard exact target/revision and write once with exact readback', async () => {
  const { buildCepNativeReadScript, buildCepNativeDocumentApplyScript } = await import('../webview-ui/src/lib/native-effect/cep-operations.ts');
  const { encodeNativeTransportText } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const { runInNewContext } = await import('node:vm');
  const locator = { projectPath: '/scratch/project.prproj', sequenceId: 'seq-1', clipNodeId: 'clip-1', trackIndex: 0, clipIndex: 0, componentIndex: 0, documentParamIndex: 0 };
  let carrier = encodeNativeTransportText(document()), writes = 0;
  const param = { displayName: 'Caption document (experimental)', isTimeVarying() { return false; }, getValue() { return carrier; }, setValue(value, update) { assert.equal(update, 1); writes++; carrier = value; return true; } };
  const effect = { matchName: 'AE.' + NATIVE_EFFECT_MATCH_NAME, properties: { numItems: 1, 0: param } };
  const clip = { isAdjustmentLayer: () => true, nodeId: 'clip-1', start: {ticks:'0'}, end:{ticks:'100'}, inPoint:{ticks:'0'}, outPoint:{ticks:'100'}, components:{numItems:1,0:effect} };
  const sequence = { sequenceID:'seq-1', videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}} };
  // Premiere returns a fresh sequence wrapper; compare its stable ID, not object identity.
  const app = { project:{path:locator.projectPath,get activeSequence(){return {...sequence};}} };
  const run = source => JSON.parse(runInNewContext(source, { app }));
  const read = run(buildCepNativeReadScript(locator)); assert.equal(read.ok, true); assert.equal(writes, 0);
  const next = document(); next.captions[0].words[0].text = 'new text';
  const source = buildCepNativeDocumentApplyScript({locator,revision:read.revision},next,true,'initial-attachment');
  const result = run(source); assert.equal(result.ok,true); assert.equal(result.readbackVerified,true); assert.equal(result.renderVerified,false); assert.equal(writes,1);
  assert.equal(carrier,encodeNativeTransportText(next));
  const stale = run(source); assert.equal(stale.ok,false); assert.equal(stale.uncertain,false); assert.equal(writes,1);
  for (const mutate of [() => {app.project.path='/other.prproj';}, () => {sequence.sequenceID='other';}, () => {clip.nodeId='other';}, () => {effect.matchName='AE.other';}, () => {clip.end.ticks='101';}, () => {clip.start.ticks='5';}, () => {clip.inPoint.ticks='5';}]) {
    const path=app.project.path,seq=sequence.sequenceID,id=clip.nodeId,name=effect.matchName,end=clip.end.ticks,start=clip.start.ticks,input=clip.inPoint.ticks;
    const baseline=run(buildCepNativeReadScript(locator)); mutate();
    const failed=run(buildCepNativeDocumentApplyScript({locator,revision:baseline.revision},next,true,'initial-attachment'));
    assert.equal(failed.ok,false); assert.equal(failed.uncertain,false); assert.equal(writes,1);
    app.project.path=path;sequence.sequenceID=seq;clip.nodeId=id;effect.matchName=name;clip.end.ticks=end;clip.start.ticks=start;clip.inPoint.ticks=input;
  }
  for (const result of [false, 1, 'true', undefined]) {
    clip.isAdjustmentLayer=()=>result;
    assert.equal(run(buildCepNativeReadScript(locator)).ok,false);
    assert.equal(run(source).ok,false);assert.equal(writes,1);
  }
  clip.isAdjustmentLayer=()=>{throw new Error('host detection failed');};
  assert.equal(run(buildCepNativeReadScript(locator)).ok,false);assert.equal(run(source).ok,false);assert.equal(writes,1);
  delete clip.isAdjustmentLayer;assert.equal(run(buildCepNativeReadScript(locator)).ok,false);
  clip.isAdjustmentLayer=()=>true;
  clip.components.numItems=2;clip.components[1]=effect;
  assert.equal(run(buildCepNativeReadScript(locator)).ok,false);
  clip.components.numItems=1;delete clip.components[1];
  assert.throws(() => buildCepNativeDocumentApplyScript({locator,revision:read.revision},next,false,'initial-attachment'),/consent/);
  assert.throws(() => buildCepNativeDocumentApplyScript({locator:{...locator,clipNodeId:'other'},revision:read.revision},next,true,'initial-attachment'),/identity/);
  assert.throws(() => buildCepNativeDocumentApplyScript({locator,revision:read.revision},{...next,sequenceId:'other'},true,'initial-attachment'),/sequence/);
});

test('CEP write failure is uncertain and never retries; binary getters fail closed', async () => {
  const { buildCepNativeReadScript, buildCepNativeDocumentApplyScript } = await import('../webview-ui/src/lib/native-effect/cep-operations.ts');
  const { encodeNativeTransportText } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const { runInNewContext } = await import('node:vm');
  const locator = {projectPath:'/scratch.prproj',sequenceId:'seq-1',clipNodeId:'clip-1',trackIndex:0,clipIndex:0,componentIndex:0,documentParamIndex:0};
  let carrier=encodeNativeTransportText(document()), writes=0;
  const param={displayName:'Caption document (experimental)',isTimeVarying:()=>false,getValue:()=>carrier,setValue(){writes++;throw new Error('uncertain mutation');}};
  const clip={isAdjustmentLayer:()=>true,nodeId:'clip-1',start:{ticks:'0'},end:{ticks:'1'},inPoint:{ticks:'0'},outPoint:{ticks:'1'},components:{numItems:1,0:{matchName:NATIVE_EFFECT_MATCH_NAME,properties:{numItems:1,0:param}}}};
  const app={project:{path:locator.projectPath,activeSequence:{sequenceID:locator.sequenceId,videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}}}}};
  const run=source=>JSON.parse(runInNewContext(source,{app}));
  const baseline=run(buildCepNativeReadScript(locator));
  const result=run(buildCepNativeDocumentApplyScript({locator,revision:baseline.revision},document(),true,'initial-attachment'));
  assert.equal(result.ok,false);assert.equal(result.uncertain,true);assert.equal(result.retry,'never');assert.equal(writes,1);
  carrier='BCAP\0truncated';assert.equal(run(buildCepNativeReadScript(locator)).ok,false);assert.equal(writes,1);
});


test('persistent adjustment origin validates exact bounded ticks and leaves transcript times unchanged', async () => {
  const { adjustmentLayerTimeOrigin, buildCepNativeDocumentApplyScript } = await import('../webview-ui/src/lib/native-effect/cep-operations.ts');
  assert.equal(adjustmentLayerTimeOrigin('2540160000000', '508032000000'), -8);
  assert.equal(adjustmentLayerTimeOrigin('0', '2540160000000'), 10);
  for (const input of [undefined, '1.5', '1e3', ' 1', '+1', 1, '999999999999999999999']) assert.throws(() => adjustmentLayerTimeOrigin(input, '0'));
  assert.throws(() => adjustmentLayerTimeOrigin('-219469824000000000', '219469824000000000'));
  const doc = document(); delete doc.timeOriginSeconds;
  assert.equal(validateNativeDocument(doc).timeOriginSeconds, 0);
  for (const timeOriginSeconds of [NaN, Infinity, -864001, 864001, '0']) assert.throws(() => validateNativeDocument({ ...doc, timeOriginSeconds }));
  const locator = {projectPath:'/scratch.prproj',sequenceId:'seq-1',clipNodeId:'clip-1',trackIndex:0,clipIndex:0,componentIndex:0,documentParamIndex:0};
  const revision = JSON.stringify({projectPath:locator.projectPath,sequenceId:'seq-1',clipNodeId:'clip-1',adjustmentLayer:true,start:'2540160000000',inPoint:'508032000000',documentIndex:0,components:[NATIVE_EFFECT_MATCH_NAME]});
  const source = buildCepNativeDocumentApplyScript({locator,revision}, {...doc,timeOriginSeconds:300}, true, 'initial-attachment');
  const embedded = JSON.parse(source.match(/var r=(.*);/)[1]);
  const binary = Buffer.from(embedded.documentText.slice(7), 'hex');
  assert.equal(binary.readDoubleLE(binary.length-432), -8);
  assert.equal(binary.readUInt32LE(4),11);
  assert.equal(doc.captions[0].words[0].start, 0);
  const bad = JSON.parse(revision); bad.start = '1e3';
  assert.throws(() => buildCepNativeDocumentApplyScript({locator,revision:JSON.stringify(bad)}, doc, true, 'initial-attachment'), /ticks/);
});

test('existing-document edit preserves host origin3600 after split/move and ignores caller origin', async () => {
  const { buildCepNativeReadScript, buildCepNativeDocumentApplyScript } = await import('../webview-ui/src/lib/native-effect/cep-operations.ts');
  const { encodeNativeTransportText, decodeNativeTransportTimeOrigin } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const { runInNewContext } = await import('node:vm');
  const locator={projectPath:'/scratch.prproj',sequenceId:'seq-1',clipNodeId:'right-split',trackIndex:0,clipIndex:0,componentIndex:0,documentParamIndex:0};
  for (const typography of [false, true]) {
  const original={...document(),timeOriginSeconds:3600};let carrier=encodeNativeTransportText(original),writes=0;
  if (typography) { original.style.baseFontWeight=400; Object.assign(original.style.current,{fontWeight:700,italic:true,fontWeightOffset:100}); carrier=encodeNativeTransportText(original); }
  const param={displayName:'Caption document (experimental)',isTimeVarying:()=>false,getValue:()=>carrier,setValue(value){writes++;carrier=value;return true;}};
  const tick=seconds=>String(BigInt(seconds)*254016000000n);
  const clip={isAdjustmentLayer:()=>true,nodeId:'right-split',start:{ticks:tick(4)},end:{ticks:tick(8)},inPoint:{ticks:tick(3604)},outPoint:{ticks:tick(3608)},components:{numItems:1,0:{matchName:NATIVE_EFFECT_MATCH_NAME,properties:{numItems:1,0:param}}}};
  const app={project:{path:locator.projectPath,activeSequence:{sequenceID:locator.sequenceId,videoTracks:{numTracks:1,0:{clips:{numItems:1,0:clip}}}}}};
  const run=source=>JSON.parse(runInNewContext(source,{app}));
  const baseline=run(buildCepNativeReadScript(locator));
  const edited={...original,timeOriginSeconds:-999};edited.captions=structuredClone(original.captions);edited.captions[0].words[0].text='edited';
  const staleSource=buildCepNativeDocumentApplyScript({locator,revision:baseline.revision},edited,true,'edit-existing');
  clip.start.ticks=tick(10);clip.end.ticks=tick(14);
  assert.equal(run(staleSource).ok,false);assert.equal(writes,0);
  const fresh=run(buildCepNativeReadScript(locator));
  const result=run(buildCepNativeDocumentApplyScript({locator,revision:fresh.revision},edited,true,'edit-existing'));
  assert.equal(result.ok,true);assert.equal(writes,1);assert.equal(decodeNativeTransportTimeOrigin(carrier),3600);
  assert.equal(edited.timeOriginSeconds,-999);assert.equal(edited.captions[0].words[0].start,0);
  assert.throws(()=>buildCepNativeDocumentApplyScript({locator,revision:fresh.revision},edited,true),/Choose explicit/);
  if(typography)assert.equal(Buffer.from(carrier.slice(7),'hex').readUInt32LE(4),11,'Typography and persisted origin use BCAP11');
  }
});

test('persisted-origin reader accepts legacyv1 zero and rejects malformed footer/layout', async () => {
  const { encodeNativeDocument, decodeNativeTransportTimeOrigin } = await import('../webview-ui/src/lib/native-effect/encode.ts');
  const bytes=encodeNativeDocument({...document(),timeOriginSeconds:3600});
  const text=bytes=>'BCDOC1:'+Buffer.from(bytes).toString('hex');
  assert.equal(decodeNativeTransportTimeOrigin(text(bytes)),3600);
  const v1=legacyNativeDocumentBytes({...document(),timeOriginSeconds:0},1);assert.equal(decodeNativeTransportTimeOrigin(text(v1)),0);
  for (const data of [bytes.slice(0,-1),new Uint8Array([...bytes,0]),bytes.slice(0,12)]) assert.throws(()=>decodeNativeTransportTimeOrigin(text(data)));
  const bad=bytes.slice();bad[4]=3;assert.throws(()=>decodeNativeTransportTimeOrigin(text(bad)));
  const nan=bytes.slice();new DataView(nan.buffer).setFloat64(nan.length-432,NaN,true);assert.throws(()=>decodeNativeTransportTimeOrigin(text(nan)));
  const malformed=bytes.slice();new DataView(malformed.buffer).setUint32(8,10001,true);assert.throws(()=>decodeNativeTransportTimeOrigin(text(malformed)));
});


test('bubble space flags retain legacy bytes, roundtrip all three states and reject malformed booleans',async()=>{
 const {encodeNativeDocument,encodeNativeTransportText,decodeNativeTransportTimeOrigin}=await import('../webview-ui/src/lib/native-effect/encode.ts');
 const {decodeNativePanelDocument}=await import('../webview-ui/src/lib/native-effect/panel.ts');
 for(const version of [1,2,3,4]){
  const data=document();data.binaryVersion=version;const before=encodeNativeDocument(data);
  for(const key of ['upcoming','current','spoken'])data.style[key].bubbleFillSpaces=false;
  assert.deepEqual(encodeNativeDocument(data),before,'explicit false must not upgrade a legacy carrier');
  assert.equal(encodeNativeTransportText(decodeNativePanelDocument(encodeNativeTransportText(data),'seq-1')),encodeNativeTransportText(data));
 }
 for(const state of ['upcoming','current','spoken']){
  const data=document();data.timeOriginSeconds=42.125;data.style[state].bubbleFillSpaces=true;
  const text=encodeNativeTransportText(data),decoded=decodeNativePanelDocument(text,'seq-1');
  assert.equal(decoded.binaryVersion,11);assert.equal(decoded.style[state].bubbleFillSpaces,true);assert.equal(decodeNativeTransportTimeOrigin(text),42.125);assert.equal(encodeNativeTransportText(decoded),text);
  const bytes=Buffer.from(text.slice(7),'hex');bytes.writeUInt32LE(2,bytes.length-360);
  const malformed='BCDOC1:'+bytes.toString('hex');assert.throws(()=>decodeNativePanelDocument(malformed,'seq-1'));assert.throws(()=>decodeNativeTransportTimeOrigin(malformed));
 }
 for(const value of [1,0,null,'true',{}]){const data=document();data.style.current.bubbleFillSpaces=value;assert.throws(()=>validateNativeDocument(data),/bubble spaces flag/);}
});


test('native document line spacing uses the visible .6 minimum and retains legacy 10 maximum',()=>{
 for(const lineHeight of [.6,1.2,2,10]){const data=document();data.style.lineHeight=lineHeight;assert.equal(validateNativeDocument(data).style.lineHeight,lineHeight);}
 for(const lineHeight of [.599999,0,-.6,10.000001,NaN,Infinity,null,'0.6']){const data=document();data.style.lineHeight=lineHeight;assert.throws(()=>validateNativeDocument(data));}
});


test('axis padding v6 retains old bytes when absent, roundtrips explicit zero and validates both axes',async()=>{
 const {encodeNativeDocument,encodeNativeTransportText,decodeNativeTransportTimeOrigin}=await import('../webview-ui/src/lib/native-effect/encode.ts');
 const {decodeNativePanelDocument}=await import('../webview-ui/src/lib/native-effect/panel.ts');
 for(const binaryVersion of [1,2,3,4,5]){const data=document();data.binaryVersion=binaryVersion;const text=encodeNativeTransportText(data),decoded=decodeNativePanelDocument(text,'seq-1');assert.equal(encodeNativeTransportText(decoded),text);for(const state of ['upcoming','current','spoken']){assert.equal(decoded.style[state].bubblePaddingInline,undefined);assert.equal(decoded.style[state].bubblePaddingBlock,undefined);}}
 const data=document();data.timeOriginSeconds=123.5;Object.assign(data.style.current,{bubblePaddingInline:0,bubblePaddingBlock:4096});Object.assign(data.style.upcoming,{bubblePaddingInline:12.5});data.style.spoken.bubblePaddingBlock=3;
 const text=encodeNativeTransportText(data),decoded=decodeNativePanelDocument(text,'seq-1');assert.equal(decoded.binaryVersion,11);assert.deepEqual(decoded.style,data.style);assert.equal(decodeNativeTransportTimeOrigin(text),123.5);assert.equal(encodeNativeTransportText(decoded),text);
 for(const axis of ['bubblePaddingInline','bubblePaddingBlock'])for(const value of [-1,-.01,4096.01,NaN,Infinity,null,'10']){const bad=document();bad.style.current[axis]=value;assert.throws(()=>validateNativeDocument(bad));}
 const bytes=Buffer.from(text.slice(7),'hex');for(const value of [-2,4097,Infinity,NaN]){const bad=Buffer.from(bytes);bad.writeDoubleLE(value,bad.length-348);const carrier='BCDOC1:'+bad.toString('hex');assert.throws(()=>decodeNativePanelDocument(carrier,'seq-1'));assert.throws(()=>decodeNativeTransportTimeOrigin(carrier));}
});


test('native underline is an independent optional boolean with byte-exact absent legacy state and strict tri-state footer',async()=>{
 const {encodeNativeTransportText,decodeNativeTransportTimeOrigin}=await import('../webview-ui/src/lib/native-effect/encode.ts');const {decodeNativePanelDocument}=await import('../webview-ui/src/lib/native-effect/panel.ts');
 for(const state of ['upcoming','current','spoken'])for(const underline of [true,false]){const data=document();data.timeOriginSeconds=42.25;data.style[state].underline=underline;const text=encodeNativeTransportText(data),decoded=decodeNativePanelDocument(text,'seq-1');assert.equal(decoded.binaryVersion,11);assert.deepEqual(decoded.style,data.style);assert.equal(decodeNativeTransportTimeOrigin(text),42.25);assert.equal(encodeNativeTransportText(decoded),text);}
 for(const value of [null,0,1,'true',{}]){const data=document();data.style.current.underline=value;assert.throws(()=>validateNativeDocument(data),/underline flag/);}
 const data=document();data.style.current.underline=true;const bytes=Buffer.from(encodeNativeTransportText(data).slice(7),'hex');for(const offset of [bytes.length-300,bytes.length-296,bytes.length-292]){const bad=Buffer.from(bytes);bad.writeUInt32LE(3,offset);const text='BCDOC1:'+bad.toString('hex');assert.throws(()=>decodeNativePanelDocument(text,'seq-1'));assert.throws(()=>decodeNativeTransportTimeOrigin(text));}
});
