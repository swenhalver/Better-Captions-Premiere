import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultNativeStyle } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument } from '../webview-ui/src/lib/native-effect/panel.ts';

const source = fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8');
const MATCH = 'AE.com.swen.bettercaptions.native.experimental', NS = 'http://ns.adobe.com/premierePrivateProjectMetaData/1.0/', FIELD = 'BetterCaptionsNativeCarrier';
const TICKS = 254016000000, tick = seconds => String(Math.round(seconds * TICKS));
const time = seconds => ({ ticks: tick(seconds) });
const collection = (values, name = 'numItems') => Object.defineProperty(values, name, { get: () => values.length });
const word = (text, start, end) => ({ text, start, end, endOfSentence: false });

function fixture(options = {}) {
  const files = new Map(), writes = [];
  const document = { version: 1, binaryVersion: 4, animationAuthority: 'premiere-effect', sequenceId: 'seq-a', timeOriginSeconds: 3600, style: { ...defaultNativeStyle(), letterCase: 'uppercase' },
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
  const next = structuredClone(document); next.captions[1].words.push(word('New tail', 6, 7)); next.captions[1].end = 7;
  const originalText = encodeNativeTransportText(document), appendedText = encodeNativeTransportText(next);
  const marker = JSON.stringify({ version: 1, owner: 'com.swen.bettercaptions', kind: 'transparent-video', projectItemId: 'carrier-item', creationId: '12345678-1234-1234-abcd-123456789abc', width: 720, height: 1280 });
  const carrierItem = { type: 1, nodeId: 'carrier-item', getMediaPath: () => '', getProjectMetadata: () => JSON.stringify({ [NS + FIELD]: marker }) };
  const item = (id, path) => ({ nodeId: id, getMediaPath: () => path });
  function parameter(name, value, animated = false) {
    return { displayName: name, value, animated, keys: animated ? [{ ticks: tick(3601), value, interpolation: 5 }, { ticks: tick(3604), value, interpolation: 0 }] : [],
      isTimeVarying() { return this.animated; }, getValue() { return this.value; }, getKeys() { return this.keys.map(key => ({ ticks: key.ticks })); },
      getValueAtKey(at) { return this.keys.find(key => key.ticks === at.ticks).value; }, getInterpolationTypeAtKey(at) { return this.keys.find(key => key.ticks === at.ticks).interpolation; },
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
  const params = collection([parameter('Position', [.5, .8], true), parameter('Width', 576, true), parameter('Height', 415), parameter('Characters per caption', 56), parameter('Caption document (experimental)', originalText)]);
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
 const h=fixture({fillSpaces:true}),curves=JSON.stringify(h.params.slice(0,4)),before=decodeNativePanelDocument(h.originalText,'seq-a');
 assert.equal(before.binaryVersion,5);assert.equal(before.style.current.bubbleFillSpaces,true);assert.equal(before.style.spoken.bubbleFillSpaces,true);
 const result=h.extend(h.read());assert.equal(result.ok,true,result.error);assert.equal(result.connection.documentText,h.appendedText);
 const after=decodeNativePanelDocument(result.connection.documentText,'seq-a');
 assert.equal(after.binaryVersion,5);assert.deepEqual(after.style,before.style);assert.equal(after.timeOriginSeconds,before.timeOriginSeconds);
 assert.deepEqual(after.captions[0],before.captions[0]);assert.deepEqual(after.captions[1].words.slice(0,before.captions[1].words.length),before.captions[1].words);
 assert.equal(after.captions[1].id,before.captions[1].id);assert.equal(after.captions[1].manualSplit,true);assert.equal(JSON.stringify(h.params.slice(0,4)),curves);
 assert.equal(result.connection.startTicks,tick(10));assert.equal(result.connection.inTicks,tick(3600));
});

test('v1 through v5 extension retains its original format and exact style footer',()=>{
 for(const binaryVersion of [1,2,3,4,5]){
  const h=fixture({binaryVersion}),before=decodeNativePanelDocument(h.originalText,'seq-a'),result=h.extend(h.read());
  assert.equal(result.ok,true,result.error);assert.equal(result.connection.documentText,h.appendedText);
  const after=decodeNativePanelDocument(result.connection.documentText,'seq-a');assert.equal(after.binaryVersion,before.binaryVersion);assert.deepEqual(after.style,before.style);
 }
});

test('v5 footer flag edits, malformed booleans, trailing bytes and truncation refuse before any setter',()=>{
 const altered=fixture({fillSpaces:true}),receipt=altered.read(),changed=structuredClone(altered.next);changed.style.current.bubbleFillSpaces=false;
 assert.match(altered.extend(receipt,{documentText:encodeNativeTransportText(changed)}).error,/preserve/);assert.deepEqual(altered.writes,[]);
 for(const mutate of [bytes=>{bytes.writeUInt32LE(2,bytes.length-12);return bytes;},bytes=>bytes.subarray(0,bytes.length-4),bytes=>Buffer.concat([bytes,Buffer.from([0,0,0,0])]),bytes=>{bytes.writeUInt32LE(6,4);return bytes;}]){
  const h=fixture({fillSpaces:true}),bytes=mutate(Buffer.from(h.originalText.slice(7),'hex'));
  // Even matching malformed old/new footers cannot serve as an append-only
  // preservation proof. Reject before changing the host clip duration.
  h.params[4].value='BCDOC1:'+bytes.toString('hex');const fresh=h.connection();h.snapshot.locator=fresh.locator;h.snapshot.revision=fresh.revision;
  const result=h.extend(h.read(),{documentText:h.params[4].value});assert.ok(result.error);assert.deepEqual(h.writes,[]);
 }
});
