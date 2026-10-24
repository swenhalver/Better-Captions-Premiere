import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultNativeStyle } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument } from '../webview-ui/src/lib/native-effect/panel.ts';
import { legacyNativeDocumentBytes, nativeCarrier } from './helpers/native-document.mjs';

const source = fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8');
const MATCH = 'AE.com.swen.bettercaptions.native.experimental', NS = 'http://ns.adobe.com/premierePrivateProjectMetaData/1.0/', FIELD = 'BetterCaptionsNativeCarrier';
const TICKS = 254016000000, tick = seconds => String(Math.round(seconds * TICKS));
const time = seconds => ({ ticks: tick(seconds) });
const collection = (values, name = 'numItems') => Object.defineProperty(values, name, { get: () => values.length });
const word = (text, start, end) => ({ text, start, end, endOfSentence: false });

function fixture(options = {}) {
  const files = new Map(), writes = [];
  const document = { version: 1, binaryVersion: 8, animationAuthority: 'premiere-effect', sequenceId: 'seq-a', timeOriginSeconds: 3600, style: { ...defaultNativeStyle(), letterCase: 'uppercase' },
    captions: [{ id: 'manual-first', start: 1, end: 2, manualSplit: true, words: [word('My correction!', 1, 2)] }, { id: 'manual-last', start: 3, end: 4, manualSplit: true, words: [word('Keep edited timings.', 3, 4)] }] };
  if (options.binaryVersion !== undefined) {
    document.binaryVersion = options.binaryVersion;
    if (options.binaryVersion < 4) delete document.style.letterCase;
    if (options.binaryVersion === 1) document.timeOriginSeconds = 0;
  }
  if (options.fillSpaces) {
    Object.assign(document.style.current, {bubble:true, bubbleFillSpaces:true, opacity:.7, padding:13, radius:17});
    Object.assign(document.style.spoken, {bubble:true, bubbleFillSpaces:true, opacity:.3});
    document.style.current.bubbleColor={r:.123,g:.456,b:.789,a:.35};
  }
  if (options.paddingAxes) {
    Object.assign(document.style.upcoming, {bubblePaddingInline:0,bubblePaddingBlock:7.5});
    Object.assign(document.style.current, {bubblePaddingInline:19,bubblePaddingBlock:4096});
    // Spoken intentionally omits one axis, retaining the uniform fallback.
    Object.assign(document.style.spoken, {bubblePaddingInline:3.125});
  }
  if (options.underline) {
    document.style.upcoming.underline=true;
    document.style.current.underline=false;
    // Spoken omits underline to retain document/default fallback.
  }
  options.prepareDocument?.(document);
  let originalText = options.binaryVersion < 8 ? nativeCarrier(legacyNativeDocumentBytes(document, options.binaryVersion)) : encodeNativeTransportText(document);
  if (options.binaryVersion === 9 || options.binaryVersion === 10) {
    const bytes = Buffer.from(originalText.slice(7), 'hex').subarray(0, -4); // pre-wrap base
    bytes.writeUInt32LE(options.binaryVersion, 4); originalText = nativeCarrier(bytes);
  }
  // Extension starts with the real decoder's one-time boundary/default migration.
  const next = decodeNativePanelDocument(originalText, 'seq-a'); next.captions[1].words.push(word('New tail', 6, 7)); next.captions[1].end = 7;
  const appendedText = encodeNativeTransportText(next);
  const marker = JSON.stringify({ version: 1, owner: 'com.swen.bettercaptions', kind: 'transparent-video', projectItemId: 'carrier-item', creationId: '12345678-1234-1234-abcd-123456789abc', width: 720, height: 1280 });
  const carrierItem = { type: 1, nodeId: 'carrier-item', getMediaPath: () => '', getProjectMetadata: () => JSON.stringify({ [NS + FIELD]: marker }) };
  const item = (id, path) => ({ nodeId: id, getMediaPath: () => path });
  function parameter(name, value, animated = false) {
    return { displayName: name, value, animated, keys: animated ? [{ ticks: tick(3601), value, interpolation: 5 }, { ticks: tick(3604), value, interpolation: 0 }] : [],
      isTimeVarying() { return this.animated; }, getValue() { return this.value; }, getKeys() { return this.keys.map(key => ({ ticks: key.ticks })); },
      getValueAtKey(at) { return this.keys.find(key => key.ticks === at.ticks).value; }, getValueAtTime() { return this.value; }, getInterpolationTypeAtKey(at) { return this.keys.find(key => key.ticks === at.ticks).interpolation; },
      setValue(value) { writes.push(['document', name, value]); if (!options.ignoreDocument) this.value = value; options.hook?.('document', h); if (options.throwDocument) throw new Error('Unconfirmed document setter'); } };
  }
  function clip(id, projectItem, start, end) {
    return { nodeId: id, name: id, projectItem, disabled: false, start: time(start), end: time(end), inPoint: time(0), outPoint: time(end - start),
      components: collection([]), isAdjustmentLayer: () => false, isSelected: () => false, getSpeed: () => 1, isSpeedReversed: () => false };
  }
  const caption = clip('caption', carrierItem, 10, 15), fields = { start: time(10), end: time(15), inPoint: time(3600), outPoint: time(3605) };
  for (const name of Object.keys(fields)) Object.defineProperty(caption, name, { get: () => fields[name], set(value) {
    writes.push(['timing', name, value.ticks]); if (options.ignoreTiming !== name) fields[name] = value; options.hook?.(name, h);
    if (options.throwTiming === name) throw new Error('Unconfirmed duration setter');
  } });
  const params = collection([parameter('Position', [.5, .8], true), parameter('Width', 576, true), parameter('Height', 415), parameter('Characters per line', 56), parameter('Caption document (experimental)', originalText), parameter('Global font size (64 = 1x)', 64)]);
  caption.components.push({ matchName: 'AE.ADBE Motion', properties: collection([parameter('Scale', 100)]) }, { matchName: MATCH, properties: params });
  const footage = clip('footage', item('footage-item', '/media/base.mp4'), 0, 20);
  const audio = clip('audio', item('audio-item', '/media/dialogue.wav'), 0, 20);
  const movie = clip('old-movie', item('movie-item', '/project/Better Captions/seq-a/caption-old/caption.mov'), 0, 100);
  const track = (name, clips) => ({ name, clips: collection(clips), locked: false, muted: false, isLocked() { return this.locked; }, isMuted() { return this.muted; } });
  const tracks = collection([track('Footage', [footage]), track('Backup caption movie', [movie]), track('Native captions', [caption])], 'numTracks');
  const sequence = { sequenceID: 'seq-a', timebase: tick(1 / 24), frameSizeHorizontal: 720, frameSizeVertical: 1280, getPlayerPosition: () => time(12), videoTracks: tracks, audioTracks: collection([track('Dialogue', [audio])], 'numTracks') };
  const project = { path: '/project/edit.prproj', activeSequence: sequence, sequences: collection([sequence], 'numSequences') };
  function XMPMeta(encoded) { this.data = JSON.parse(encoded); }
  XMPMeta.prototype.getProperty = function(ns, key) { const value = this.data[ns + key]; return value === undefined ? undefined : { toString: () => value }; };
  function Time() { this.ticks = '0'; }
  const context = { app: { project }, Time, XMPMeta, JSON: undefined,
    File: function(path) { this.length = (files.get(path) ?? '').length; this.open = mode => mode === 'r' && files.has(path); this.read = () => files.get(path); this.close = () => {}; } };
  vm.createContext(context); vm.runInContext(source, context);
  function call(name, payload) { files.set('/request.json', JSON.stringify(payload)); return JSON.parse(context.BetterCaptionsHost[name]('/request.json')); }
  function connection() { const result = call('readCaptionConnections', { sequenceId: 'seq-a', projectPath: project.path, generatedRoot: '/project/Better Captions/seq-a', knownLinks: [], includeDocuments: true }); assert.equal(result.ok, true, result.error); assert.ok(result.native[0], JSON.stringify(result.warnings)); return result.native[0]; }
  const c = connection(), snapshot = { locator: c.locator, revision: c.revision };
  const base = { sequenceId: 'seq-a', projectPath: project.path, snapshot };
  const h = { document, next, originalText, appendedText, caption, footage, audio, movie, params, tracks, sequence, project, writes, snapshot, clip,
    read: () => call('readNativeCaptionExtension', base),
    extend: (receipt, patch = {}) => call('extendNativeCaptionDocument', { ...base, request: { revision: receipt.revision, documentText: appendedText, endTicks: receipt.targetEndTicks, outTicks: receipt.targetOutTicks, ...patch } }),
    connection };
  return h;
}

test('extension read is mutation-free, excludes caption carriers, and plans exact moved/trimmed source duration', () => {
  const h = fixture(), before = h.connection(), result = h.read();
  assert.equal(result.ok, true, result.error); assert.equal(result.canExtend, true);
  assert.equal(result.targetEndTicks, tick(20)); assert.equal(result.targetOutTicks, tick(3610));
  assert.equal(result.connection.clipNodeId, before.clipNodeId); assert.equal(result.connection.documentText, before.documentText);
  assert.deepEqual(h.writes, []);
});

test('extension appends once to the same clip and preserves source in/start, old document words, all parameter values/keys/interpolation', () => {
  const h = fixture(), curves = JSON.stringify(h.params.slice(0, 4)), result = h.extend(h.read());
  assert.equal(result.ok, true, result.error); assert.equal(result.readbackVerified, true); assert.equal(result.retry, 'never');
  assert.equal(result.connection.clipNodeId, 'caption'); assert.equal(result.connection.projectItemId, 'carrier-item');
  assert.equal(result.connection.startTicks, tick(10)); assert.equal(result.connection.inTicks, tick(3600));
  assert.equal(result.connection.endTicks, tick(20)); assert.equal(result.connection.outTicks, tick(3610));
  assert.equal(result.connection.documentText, h.appendedText); assert.equal(JSON.stringify(h.params.slice(0, 4)), curves);
  assert.deepEqual(h.writes.map(value => value.slice(0, 2)), [['timing', 'outPoint'], ['timing', 'end'], ['document', 'Caption document (experimental)']]);
  assert.equal(h.footage.end.ticks, tick(20)); assert.equal(h.movie.end.ticks, tick(100));
});

test('old text, timing, style and manual-split changes are refused before any duration setter', () => {
  for (const mutate of [doc => { doc.captions[0].words[0].text = 'Overwritten'; }, doc => { doc.captions[0].words[0].end = 1.9; }, doc => { doc.style.current.fontSize = 200; }, doc => { doc.captions[0].manualSplit = false; }]) {
    const h = fixture(), receipt = h.read(), changed = structuredClone(h.next); mutate(changed);
    const result = h.extend(receipt, { documentText: encodeNativeTransportText(changed) });
    assert.ok(result.error); assert.equal(result.code, undefined); assert.deepEqual(h.writes, []);
  }
});

test('v8 extension preserves every automatic, break and join boundary while accepting new tail boundaries', () => {
  for (const lineBreakBefore of [undefined, 'break', 'join']) {
    const h = fixture({ prepareDocument(document) {
      document.captions[0].words = [word('Automatic', 1, 1.2), { ...word('Break', 1.2, 1.5), lineBreakBefore: 'break' }, { ...word('Join', 1.5, 2), lineBreakBefore: 'join' }];
    } });
    const next = structuredClone(h.next); if (lineBreakBefore) next.captions[1].words[1].lineBreakBefore = lineBreakBefore;
    const result = h.extend(h.read(), { documentText: encodeNativeTransportText(next) });
    assert.equal(result.ok, true, result.error);
    const after = decodeNativePanelDocument(result.connection.documentText, 'seq-a');
    assert.deepEqual(after.captions[0], decodeNativePanelDocument(h.originalText, 'seq-a').captions[0]);
    assert.equal(after.captions[1].words[1].lineBreakBefore, lineBreakBefore);
  }
  for (const [before, after] of [[undefined, 'break'], ['break', 'join'], ['join', undefined]]) {
    const h = fixture({ prepareDocument(document) { if (before) document.captions[0].words[0].lineBreakBefore = before; } });
    const next = structuredClone(h.next);
    if (after) next.captions[0].words[0].lineBreakBefore = after; else delete next.captions[0].words[0].lineBreakBefore;
    assert.match(h.extend(h.read(), { documentText: encodeNativeTransportText(next) }).error, /previous caption/);
    assert.deepEqual(h.writes, []);
  }
});

test('invalid or missing v8 word boundaries refuse before any setter, including matching old and new carriers', () => {
  for (const mutate of [
    (bytes, offset) => { bytes.writeUInt32LE(4, offset); return bytes; },
    (bytes, offset) => { bytes.writeUInt32LE(0xffffffff, offset); return bytes; },
    (bytes, offset) => Buffer.concat([bytes.subarray(0, offset), bytes.subarray(offset + 4)]),
  ]) {
    for (const corruptExisting of [false, true]) {
      const h = fixture(), bytes = Buffer.from((corruptExisting ? h.originalText : h.appendedText).slice(7), 'hex');
      const identitySize = bytes.readUInt32LE(12), wordOffset = 12 + 4 + identitySize + 8;
      const boundaryOffset = wordOffset + 4 + bytes.readUInt32LE(wordOffset) + 20;
      const documentText = nativeCarrier(mutate(bytes, boundaryOffset));
      if (corruptExisting) {
        h.params[4].value = documentText;
        const fresh = h.connection(); h.snapshot.locator = fresh.locator; h.snapshot.revision = fresh.revision;
      }
      assert.ok(h.extend(h.read(), { documentText }).error);
      assert.deepEqual(h.writes, []);
    }
  }
});

test('extension rejects container replacement, reordering, removal, and append to multiple containers', () => {
  for (const mutate of [
    document => { document.captions[0].id = 'replacement'; },
    document => { document.captions.reverse(); },
    document => { document.captions.shift(); },
    document => { document.captions[0].words.push(word('Another tail', 2, 2.5)); document.captions[0].end = 2.5; },
  ]) {
    const h = fixture(), next = structuredClone(h.next); mutate(next);
    assert.ok(h.extend(h.read(), { documentText: encodeNativeTransportText(next) }).error);
    assert.deepEqual(h.writes, []);
  }
});

test('stale footage, parameter values, keys, interpolation and target duration refuse before mutation', () => {
  for (const change of [h => { h.footage.end = time(21); }, h => { h.params[2].value = 600; }, h => { h.params[1].keys[0].value = 900; }, h => { h.params[1].keys[0].interpolation = 2; }, h => { h.audio.disabled = true; h.footage.disabled = true; }]) {
    const h = fixture(), before = h.read(); change(h);
    const result = h.extend(before); assert.ok(result.error); assert.equal(result.code, undefined); assert.deepEqual(h.writes, []);
  }
  const h = fixture(), receipt = h.read(); assert.ok(h.extend(receipt, { endTicks: tick(21) }).error); assert.deepEqual(h.writes, []);
});

test('same-track collisions are refused while other manual splits of the same source remain preserved', () => {
  const blocked = fixture(); blocked.tracks[2].clips.push(blocked.clip('neighbor', { nodeId: 'other', getMediaPath: () => '/media/other.mp4' }, 17, 19));
  assert.match(blocked.read().error, /blocks/); assert.deepEqual(blocked.writes, []);
  const shared = fixture(), copy = shared.clip('copy', shared.caption.projectItem, 0, 5);
  shared.tracks[2].clips.unshift(copy);
  // Rediscover because the manual split changes the clip index.
  const fresh = shared.connection(); shared.snapshot.locator = fresh.locator; shared.snapshot.revision = fresh.revision;
  const before = JSON.stringify(copy), result = shared.extend(shared.read());
  assert.equal(result.ok, true, result.error); assert.equal(JSON.stringify(copy), before);
});

test('disabled/locked/muted caption and nonordinary source timing refuse without mutation', () => {
  for (const change of [h => { h.caption.disabled = true; }, h => { h.tracks[2].locked = true; }, h => { h.tracks[2].muted = true; }, h => { h.caption.getSpeed = () => 2; }]) {
    const h = fixture(); change(h); assert.ok(h.read().error); assert.deepEqual(h.writes, []);
  }
});

test('duration/document setters with uncertain outcomes never retry or roll back', () => {
  for (const options of [{ ignoreTiming: 'outPoint' }, { ignoreTiming: 'end' }, { throwTiming: 'outPoint' }, { ignoreDocument: true }, { throwDocument: true }]) {
    const h = fixture(options), receipt = h.read(), result = h.extend(receipt);
    assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED', result.error); assert.equal(result.retry, 'never'); assert.equal(result.recoverable, false);
    const count = h.writes.length, retry = h.extend(receipt); assert.ok(retry.error); assert.equal(h.writes.length, count);
    assert.equal(h.writes.filter(row => row[0] === 'timing' && row[1] === 'start').length, 0);
    assert.equal(h.writes.filter(row => row[0] === 'timing' && row[1] === 'inPoint').length, 0);
  }
});

test('context changing in the first timing setter prevents remaining host writes', () => {
  const h = fixture({ hook(event, h) { if (event === 'outPoint') h.project.path = '/other.prproj'; } }), result = h.extend(h.read());
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.deepEqual(h.writes.map(row => row.slice(0, 2)), [['timing', 'outPoint']]);
});

test('parameter race after duration update is unconfirmed and cannot reach document setter', () => {
  const h = fixture({ hook(event, h) { if (event === 'end') h.params[2].value = 900; } }), result = h.extend(h.read());
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.equal(h.writes.filter(row => row[0] === 'document').length, 0);
});

test('duration-only extension can reveal existing hidden words without rewriting the document', () => {
  const h = fixture(), receipt = h.read(), result = h.extend(receipt, { documentText: h.originalText });
  assert.equal(result.ok, true, result.error); assert.equal(result.connection.documentText, h.originalText);
  assert.equal(h.writes.filter(row => row[0] === 'document').length, 0);
});


test('v5 extension preserves background space flags, all styles/manual splits, native keys and old words',()=>{
 const h=fixture({binaryVersion:5,fillSpaces:true}),curves=JSON.stringify(h.params.slice(0,4)),before=decodeNativePanelDocument(h.originalText,'seq-a');
 assert.equal(Buffer.from(h.originalText.slice(7),'hex').readUInt32LE(4),5);assert.equal(before.binaryVersion,11);assert.equal(before.style.current.bubbleFillSpaces,true);assert.equal(before.style.spoken.bubbleFillSpaces,true);
 const result=h.extend(h.read());assert.equal(result.ok,true,result.error);assert.equal(result.connection.documentText,h.appendedText);
 const after=decodeNativePanelDocument(result.connection.documentText,'seq-a');
 assert.equal(after.binaryVersion,11);assert.deepEqual(after.style,before.style);assert.equal(after.timeOriginSeconds,before.timeOriginSeconds);
 assert.deepEqual(after.captions[0],before.captions[0]);assert.deepEqual(after.captions[1].words.slice(0,before.captions[1].words.length),before.captions[1].words);
 assert.equal(after.captions[1].id,before.captions[1].id);assert.equal(after.captions[1].manualSplit,true);assert.equal(JSON.stringify(h.params.slice(0,4)),curves);
 assert.equal(result.connection.startTicks,tick(10));assert.equal(result.connection.inTicks,tick(3600));
});

test('v1 through v7 extension migrates boundaries and defaults to v11 without changing previous content',()=>{
 for(const binaryVersion of [1,2,3,4,5,6,7]){
  const h=fixture({binaryVersion}),before=decodeNativePanelDocument(h.originalText,'seq-a'),result=h.extend(h.read());
  assert.equal(result.ok,true,result.error);assert.equal(result.connection.documentText,h.appendedText);
  const after=decodeNativePanelDocument(result.connection.documentText,'seq-a');assert.equal(Buffer.from(h.originalText.slice(7),'hex').readUInt32LE(4),binaryVersion);assert.equal(after.binaryVersion,11);assert.deepEqual(after.style,before.style);
  assert.equal(after.timeOriginSeconds,before.timeOriginSeconds);assert.deepEqual(after.captions[0],before.captions[0]);assert.deepEqual(after.captions[1].words.slice(0,1),before.captions[1].words);assert.equal(after.captions[1].words[0].lineBreakBefore,'break');assert.equal(after.captions[1].manualSplit,true);
 }
});

test('legacy migration seeds breaks in storage order even for automatic containers with earlier timestamps', () => {
  const h = fixture({ binaryVersion: 7, prepareDocument(document) {
    document.captions[0].words = [word('Stored first', 3, 4)];
    document.captions[0].start = 3; document.captions[0].end = 4;
    document.captions[1].manualSplit = false; document.captions[1].words = [word('Stored second', 1, 2)];
    document.captions[1].start = 1; document.captions[1].end = 2;
  } });
  const result = h.extend(h.read()); assert.equal(result.ok, true, result.error);
  const after = decodeNativePanelDocument(result.connection.documentText, 'seq-a');
  assert.equal(after.captions[0].id, 'manual-first'); assert.equal(after.captions[0].words[0].lineBreakBefore, undefined);
  assert.equal(after.captions[1].id, 'manual-last'); assert.equal(after.captions[1].words[0].lineBreakBefore, 'break');
  assert.equal(after.captions[1].manualSplit, false);
});

test('legacy-to-v8 append rejects lost storage breaks and changes to previously absent style defaults', () => {
  for (const binaryVersion of [1, 2, 3, 4, 5, 6, 7]) {
    for (const mutate of [
      document => { delete document.captions[1].words[0].lineBreakBefore; },
      document => { document.captions[1].words[0].lineBreakBefore = 'join'; },
      document => { document.captions[0].words[0].lineBreakBefore = 'break'; },
      document => { document.captions[0].words[0].endOfSentence = true; },
      document => { document.style.current.opacity = .123; },
      document => {
        if (binaryVersion === 1) document.timeOriginSeconds = 1;
        else if (binaryVersion === 2) document.style.baseFontWeight = 500;
        else if (binaryVersion === 3) document.style.letterCase = 'uppercase';
        else if (binaryVersion === 4) document.style.current.bubbleFillSpaces = true;
        else if (binaryVersion === 5) document.style.current.bubblePaddingInline = 0;
        else document.style.current.paddingTop = 0;
      },
    ]) {
      const h = fixture({ binaryVersion }), next = structuredClone(h.next); mutate(next);
      assert.ok(h.extend(h.read(), { documentText: encodeNativeTransportText(next) }).error, `v${binaryVersion} must preserve its decoded state`);
      assert.deepEqual(h.writes, []);
    }
  }
});

test('v1 through v7 duration-only extension keeps its exact original carrier without a migration write', () => {
  for (const binaryVersion of [1, 2, 3, 4, 5, 6, 7]) {
    const h = fixture({ binaryVersion }), result = h.extend(h.read(), { documentText: h.originalText });
    assert.equal(result.ok, true, result.error); assert.equal(result.connection.documentText, h.originalText);
    assert.equal(h.writes.filter(row => row[0] === 'document').length, 0);
  }
});

test('v8 extension cannot downgrade to a legacy layout and lose word boundaries', () => {
  const h = fixture(), documentText = nativeCarrier(legacyNativeDocumentBytes(h.next, 7));
  assert.match(h.extend(h.read(), { documentText }).error, /preserve/); assert.deepEqual(h.writes, []);
});

test('v5 footer flag edits, malformed booleans, trailing bytes and truncation refuse before any setter',()=>{
 const altered=fixture({binaryVersion:5,fillSpaces:true}),receipt=altered.read(),changed=structuredClone(altered.next);changed.style.current.bubbleFillSpaces=false;
 assert.match(altered.extend(receipt,{documentText:encodeNativeTransportText(changed)}).error,/preserve/);assert.deepEqual(altered.writes,[]);
 for(const mutate of [bytes=>{bytes.writeUInt32LE(2,bytes.length-12);return bytes;},bytes=>bytes.subarray(0,bytes.length-4),bytes=>Buffer.concat([bytes,Buffer.from([0,0,0,0])]),bytes=>{bytes.writeUInt32LE(7,4);return bytes;}]){
  const h=fixture({binaryVersion:5,fillSpaces:true}),bytes=mutate(Buffer.from(h.originalText.slice(7),'hex'));
  // Even matching malformed old/new footers cannot serve as an append-only
  // preservation proof. Reject before changing the host clip duration.
  h.params[4].value='BCDOC1:'+bytes.toString('hex');const fresh=h.connection();h.snapshot.locator=fresh.locator;h.snapshot.revision=fresh.revision;
  const result=h.extend(h.read(),{documentText:h.params[4].value});assert.ok(result.error);assert.deepEqual(h.writes,[]);
 }
});

test('v6 extension preserves both padding axes and absent-axis fallback with every previous style, word and native key',()=>{
 const h=fixture({binaryVersion:6,paddingAxes:true,fillSpaces:true,underline:true}),curves=JSON.stringify(h.params.slice(0,4)),before=decodeNativePanelDocument(h.originalText,'seq-a');
 assert.equal(Buffer.from(h.originalText.slice(7),'hex').readUInt32LE(4),6);assert.equal(before.binaryVersion,11);assert.equal(before.style.current.bubblePaddingInline,19);assert.equal(before.style.current.bubblePaddingBlock,4096);assert.equal(before.style.spoken.bubblePaddingBlock,undefined);
 assert.equal(before.style.upcoming.underline,true);assert.equal(before.style.current.underline,false);assert.equal(before.style.spoken.underline,undefined);
 const result=h.extend(h.read());assert.equal(result.ok,true,result.error);const after=decodeNativePanelDocument(result.connection.documentText,'seq-a');
 assert.equal(after.binaryVersion,11);assert.deepEqual(after.style,before.style);assert.equal(after.timeOriginSeconds,before.timeOriginSeconds);assert.deepEqual(after.captions[0],before.captions[0]);
 assert.deepEqual(after.captions[1].words.slice(0,before.captions[1].words.length),before.captions[1].words);assert.equal(after.captions[1].manualSplit,true);assert.equal(JSON.stringify(h.params.slice(0,4)),curves);
 assert.equal(result.connection.startTicks,tick(10));assert.equal(result.connection.inTicks,tick(3600));
});

test('v6 axis changes, invalid IEEE values and malformed footer refuse before any duration or document setter',()=>{
 for(const field of ['bubblePaddingInline','bubblePaddingBlock']){
  const h=fixture({binaryVersion:6,paddingAxes:true}),changed=structuredClone(h.next);changed.style.current[field]=17;
  assert.match(h.extend(h.read(),{documentText:encodeNativeTransportText(changed)}).error,/preserve/);assert.deepEqual(h.writes,[]);
 }
 for(const value of [-2,-.001,4096.000000001,Infinity,-Infinity,NaN]){
  const h=fixture({binaryVersion:6,paddingAxes:true}),bytes=Buffer.from(h.originalText.slice(7),'hex');bytes.writeDoubleLE(value,bytes.length-60);
  h.params[4].value='BCDOC1:'+bytes.toString('hex');const entry=h.connection();h.snapshot.locator=entry.locator;h.snapshot.revision=entry.revision;
  assert.match(h.extend(h.read(),{documentText:h.params[4].value}).error,/padding axis/);assert.deepEqual(h.writes,[]);
 }
 for(const adjust of [bytes=>bytes.subarray(0,bytes.length-1),bytes=>Buffer.concat([bytes,Buffer.from([0])])]){
  const h=fixture({binaryVersion:6,paddingAxes:true}),bytes=adjust(Buffer.from(h.originalText.slice(7),'hex'));h.params[4].value='BCDOC1:'+bytes.toString('hex');
  const entry=h.connection();h.snapshot.locator=entry.locator;h.snapshot.revision=entry.revision;assert.ok(h.extend(h.read(),{documentText:h.params[4].value}).error);assert.deepEqual(h.writes,[]);
 }
});

test('v6 axis walker accepts exact boundaries, fractional/subnormal positives, negative zero and absent sentinel without normalizing bytes',()=>{
 for(const value of [-1,-0,0,Number.MIN_VALUE,7.125,4096]){
  const h=fixture({binaryVersion:6,paddingAxes:true}),bytes=Buffer.from(h.originalText.slice(7),'hex');bytes.writeDoubleLE(value,bytes.length-60);
  h.params[4].value='BCDOC1:'+bytes.toString('hex');const entry=h.connection();h.snapshot.locator=entry.locator;h.snapshot.revision=entry.revision;
  const result=h.extend(h.read(),{documentText:h.params[4].value});assert.equal(result.ok,true,result.error);assert.equal(result.connection.documentText,h.params[4].value);
  assert.equal(h.writes.filter(row=>row[0]==='document').length,0);
 }
});

test('v6 underline tri-state bytes remain immutable and invalid or missing flags refuse before setters',()=>{
 const changed=fixture({binaryVersion:6,paddingAxes:true,underline:true}),next=structuredClone(changed.next);next.style.current.underline=true;
 assert.match(changed.extend(changed.read(),{documentText:encodeNativeTransportText(next)}).error,/preserve/);assert.deepEqual(changed.writes,[]);
 for(const mutate of [bytes=>{bytes.writeUInt32LE(3,bytes.length-12);return bytes;},bytes=>{bytes.writeUInt32LE(0xffffffff,bytes.length-4);return bytes;},bytes=>bytes.subarray(0,bytes.length-12)]){
  const h=fixture({binaryVersion:6,paddingAxes:true,underline:true}),bytes=mutate(Buffer.from(h.originalText.slice(7),'hex'));h.params[4].value='BCDOC1:'+bytes.toString('hex');
  const entry=h.connection();h.snapshot.locator=entry.locator;h.snapshot.revision=entry.revision;
  assert.match(h.extend(h.read(),{documentText:h.params[4].value}).error,/underline|Truncated/);assert.deepEqual(h.writes,[]);
 }
});


test('v9 extension preserves deletion counts and refuses changing an existing gap override',()=>{
 const h=fixture({prepareDocument(document){document.captions[0].words[0].pauseLinesRemoved=2;}});
 const result=h.extend(h.read());assert.equal(result.ok,true);
 const decoded=decodeNativePanelDocument(result.connection.documentText,'seq-a');assert.equal(decoded.captions[0].words[0].pauseLinesRemoved,2);
 const bad=fixture({prepareDocument(document){document.captions[0].words[0].pauseLinesRemoved=2;}}),next=structuredClone(bad.next);next.captions[0].words[0].pauseLinesRemoved=1;
 const refused=bad.extend(bad.read(),{documentText:encodeNativeTransportText(next)});assert.ok(refused.error);assert.deepEqual(bad.writes,[]);
});

test('line position styles survive an extension unchanged and cannot be changed by one',()=>{
 const lines={'1':{marginTop:12,marginBottom:12,color:{r:1,g:0,b:0}},'4':{fontWeight:0,fontWeightOffset:100,italic:true}};
 const prepareDocument=document=>{document.style.lineStyles=structuredClone(lines);};
 const h=fixture({prepareDocument});assert.equal(Buffer.from(h.originalText.slice(7),'hex').readUInt32LE(4),12);
 const result=h.extend(h.read());assert.equal(result.ok,true,result.error);
 assert.deepEqual(decodeNativePanelDocument(result.connection.documentText,'seq-a').style.lineStyles,lines);
 for(const mutate of [doc=>{doc.style.lineStyles['1'].marginTop=13;},doc=>{delete doc.style.lineStyles;},doc=>{doc.style.lineStyles['2']={opacity:.5};}]){
  const bad=fixture({prepareDocument}),next=structuredClone(bad.next);mutate(next);
  assert.ok(bad.extend(bad.read(),{documentText:encodeNativeTransportText(next)}).error);assert.deepEqual(bad.writes,[]);
 }
 const plain=fixture(),added=structuredClone(plain.next);added.style.lineStyles={'2':{marginTop:4}};
 assert.ok(plain.extend(plain.read(),{documentText:encodeNativeTransportText(added)}).error);assert.deepEqual(plain.writes,[]);
 // Malformed position blocks refuse before any setter, even when old and new match.
 // The block is 76 bytes: count, Line 1 (position, mask, RGB, two margins), Line 4 (position, mask, weight, italic).
 for(const mutate of [bytes=>{bytes.writeUInt32LE(9,bytes.length-76);return bytes;},bytes=>{bytes.writeUInt32LE(0,bytes.length-72);return bytes;},bytes=>{bytes.writeUInt32LE(2,bytes.length-4);return bytes;},bytes=>bytes.subarray(0,bytes.length-4)]){
  const h=fixture({prepareDocument}),bytes=mutate(Buffer.from(h.originalText.slice(7),'hex'));
  h.params[4].value='BCDOC1:'+bytes.toString('hex');const fresh=h.connection();h.snapshot.locator=fresh.locator;h.snapshot.revision=fresh.revision;
  const result=h.extend(h.read(),{documentText:h.params[4].value});assert.match(result.error,/line|Truncated|Trailing/i);assert.deepEqual(h.writes,[]);
 }
});

test('CEP Extend preserves wrap and positions together in all six v11/v12 combinations', () => {
 for (const mode of ['fill', 'balance', 'pretty']) for (const positions of [undefined, { '1': { color: { r: .1, g: .2, b: .3 }, marginTop: 12 }, '4': { fontWeight: 0, fontWeightOffset: 100 } }]) {
  const prepareDocument = doc => {
    if (mode !== 'fill') doc.style.lineWrap = mode;
    if (positions) doc.style.lineStyles = structuredClone(positions);
  };
  const h = fixture({ prepareDocument }), before = decodeNativePanelDocument(h.originalText, 'seq-a');
  assert.equal(Buffer.from(h.originalText.slice(7), 'hex').readUInt32LE(4), positions ? 12 : 11);
  const result = h.extend(h.read()); assert.equal(result.ok, true, result.error);
  const after = decodeNativePanelDocument(result.connection.documentText, 'seq-a');
  assert.deepEqual(after.style, before.style);
  assert.equal(after.style.lineWrap ?? 'fill', mode);
  assert.deepEqual(after.style.lineStyles, positions);
  assert.deepEqual(after.captions[0], before.captions[0]);
  for (const mutate of [
    doc => { if (mode === 'pretty') delete doc.style.lineWrap; else doc.style.lineWrap = 'pretty'; },
    doc => { if (positions) delete doc.style.lineStyles; else doc.style.lineStyles = { '2': { opacity: .5 } }; },
    doc => { doc.style.lineStyles = { ...doc.style.lineStyles, '2': { opacity: .5 } }; },
  ]) {
    const bad = fixture({ prepareDocument }), next = structuredClone(bad.next); mutate(next);
    assert.match(bad.extend(bad.read(), { documentText: encodeNativeTransportText(next) }).error, /preserve/);
    assert.deepEqual(bad.writes, []);
  }
 }
});

test('CEP normalizes v9/v10 defaults independently of the pre-v10 boundary migration', () => {
 const prepareDocument = doc => {
  const caption = doc.captions[0]; caption.words[0].lineBreakBefore = 'break';
  caption.words.push({ ...word('joined', 2, 2.1), lineBreakBefore: 'join' }); caption.end = 2.1;
 };
 for (const binaryVersion of [9, 10]) {
  const h = fixture({ binaryVersion, prepareDocument });
  assert.equal(Buffer.from(h.originalText.slice(7), 'hex').readUInt32LE(4), binaryVersion);
  assert.equal(h.next.captions[0].words[0].lineBreakBefore, binaryVersion < 10 ? 'edge' : 'break');
  assert.equal(h.next.style.lineWrap, undefined); assert.equal(h.next.style.lineStyles, undefined);
  const result = h.extend(h.read()); assert.equal(result.ok, true, result.error);
  assert.equal(Buffer.from(result.connection.documentText.slice(7), 'hex').readUInt32LE(4), 11);
  assert.deepEqual(decodeNativePanelDocument(result.connection.documentText, 'seq-a').style, h.next.style);
  // A canonical v12 with zero positions has exactly the same normalized trailer.
  const empty = fixture({ binaryVersion, prepareDocument });
  const bytes = Buffer.concat([Buffer.from(empty.appendedText.slice(7), 'hex'), Buffer.alloc(4)]); bytes.writeUInt32LE(12, 4);
  const upgraded = empty.extend(empty.read(), { documentText: nativeCarrier(bytes) });
  assert.equal(upgraded.ok, true, upgraded.error);
  // Fill cannot become Balance during a legacy upgrade.
  const changed = fixture({ binaryVersion, prepareDocument }), next = structuredClone(changed.next); next.style.lineWrap = 'balance';
  assert.match(changed.extend(changed.read(), { documentText: encodeNativeTransportText(next) }).error, /preserve/);
  assert.deepEqual(changed.writes, []);
 }
});
