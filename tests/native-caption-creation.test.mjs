import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8');
const TICKS = 254016000000, TPF = 8467200000;
const MATCH = 'AE.com.swen.bettercaptions.native.experimental';
const NS = 'http://ns.adobe.com/premierePrivateProjectMetaData/1.0/';
const FIELD = 'BetterCaptionsNativeCarrier';
const CREATION = '12345678-1234-1234-abcd-123456789abc';
const collection = (items, key = 'numItems') => Object.defineProperty(items, key, { get: () => items.length });
const time = seconds => ({ ticks: String(Math.round(seconds * TICKS)) });

/** Runs the production bridge in a VM; all Adobe calls are mocks, never live host tools. */
function fixture(options = {}) {
  const files = new Map(), mutations = [], timingAssignments = [], parameterWrites = [];
  let createdClip, createdItem, serial = 0, documentReadsAfterWrite = 0;
  function hook(event) { options.hook?.(event, { context, project, sequence, createdItem, createdClip, mutations, parameterWrites }); }
  function item(id, path, extra = {}) {
    return { nodeId: id, type: 1, name: id, _metadata: { unrelated: 'retained-' + id },
      getMediaPath: () => path,
      getProjectMetadata() { hook('metadata-read:' + id); return JSON.stringify(this._metadata); },
      setProjectMetadata(encoded, fields) {
        mutations.push(['metadata', id, [...fields]]);
        if (!options.ignoreMetadata) this._metadata = JSON.parse(encoded);
        return options.rejectMetadata ? false : true;
      },
      setInPoint(seconds, media) { mutations.push(['source-in', id, seconds, media]); this.sourceIn = seconds; hook('source-in'); },
      setOutPoint(seconds, media) { mutations.push(['source-out', id, seconds, media]); this.sourceOut = seconds; }, ...extra };
  }
  const footageItem = item('footage-item', '/media/human.mp4');
  const movieItem = item('movie-item', '/project/Better Captions/seq-a/caption-user-old/caption.mov');
  function clip(id, projectItem, start = 0, end = 10) {
    return { nodeId: id, projectItem, name: id, disabled: false, selected: false,
      start: time(start), end: time(end), inPoint: time(0), outPoint: time(end - start),
      isAdjustmentLayer: () => false, isSelected() { return this.selected; },
      components: collection([{ matchName: 'AE.ADBE Motion', properties: collection([{ displayName: 'Position', value: [.3, .7], keys: [{ ticks: '5', value: [.4, .8], interpolation: 'bezier', easing: 72 }] }]) }]) };
  }
  const footage = clip('footage', footageItem), movie = clip('user-movie', movieItem, 1, 8);
  function parameter(name, initial) {
    let value = initial;
    return { displayName: name, isTimeVarying: () => false, getValue() { if (name === 'Caption document (experimental)' && parameterWrites.length >= 5) hook('document-read:' + ++documentReadsAfterWrite); return value; },
      setValue(next, update) {
        parameterWrites.push([name, next, update]); mutations.push(['parameter', name]);
        if (options.ignoreParameter !== name) value = next;
        hook('parameter-write:' + name);
        if (options.throwParameter === name) throw new Error('Setter result uncertain');
        return 0;
      } };
  }
  function track(name, clips = []) {
    return { name, clips: collection(clips), locked: false, muted: false,
      isLocked() { return this.locked; }, isMuted() { return this.muted; },
      overwriteClip(projectItem, at) {
        mutations.push(['overwrite', projectItem.nodeId, at]);
        if (options.ignoreInsert) return;
        const result = clip('created-clip', projectItem);
        const values = { inPoint: time(3600), outPoint: time(3610), start: time(0), end: time(10) };
        for (const field of Object.keys(values)) Object.defineProperty(result, field, { enumerable: true,
          get() { return values[field]; }, set(next) { timingAssignments.push({ field, object: next, ticks: next.ticks }); if (options.ignoreTiming !== field) values[field] = next; } });
        createdClip = result; this.clips.push(result);
      } };
  }
  const tracks = collection([track('Footage', [footage]), track('Existing movie', [movie])], 'numTracks');
  if (!options.occupiedTop) tracks.push(track('Empty top'));
  const sequence = { sequenceID: 'seq-a', timebase: String(TPF), frameSizeHorizontal: 1280, frameSizeVertical: 720,
    videoTracks: tracks, audioTracks: collection([track('Audio')], 'numTracks'), getPlayerPosition: () => time(2) };
  const root = { children: collection([footageItem, { nodeId: 'human-bin', type: 2, children: collection([movieItem]) }]) };
  const project = { path: '/project/edit.prproj', activeSequence: sequence, rootItem: root,
    addPropertyToProjectMetadataSchema(field, label, type) { mutations.push(['schema', field, label, type]); return true; } };
  const qSequence = {
    addTracks(...args) { mutations.push(['tracks', ...args]); if (!options.ignoreTrackCreation) tracks.push(track('New top')); },
    getVideoTrackAt(index) {
      const current = tracks[index];
      const rows = [{ type: 'Gap' }, ...current.clips.map(c => ({ type: 'Clip', start: c.start, end: c.end,
        addVideoEffect(effect) {
          mutations.push(['effect', c.nodeId, effect.name]);
          if (options.ignoreEffect) return;
          const properties = collection([
            parameter('Height', 150), parameter('Position', [.5, .9]), parameter('Width', 1536),
            parameter('Caption document (experimental)', 'BCDOC1:424341500200000000000000'), parameter('Characters per caption', 56),
          ]);
          // Insert in the middle, never at components.length-1.
          c.components.splice(1, 0, { matchName: MATCH, properties });
          c.components.push({ matchName: 'AE.ADBE Opacity', properties: collection([]) });
        } }))];
      return { numItems: rows.length, getItemAt: i => { hook('qe-item'); return rows[i]; } };
    },
  };
  const qe = { project: { getActiveSequence: () => { hook('qe-sequence'); return qSequence; }, getVideoEffectByName: name => options.missingEffect ? null : { name },
    newTransparentVideo(...args) {
      mutations.push(['factory', ...args]);
      const n = options.factoryCount ?? 1;
      for (let i = 0; i < n; i++) { const generated = item('generated-' + ++serial, ''); root.children.push(generated); createdItem = generated; }
      if (options.mutateExisting) footage.end = time(11);
      return options.factoryResult ?? true;
    } } };
  function XMPMeta(encoded = '{}') { this.data = JSON.parse(encoded || '{}'); }
  XMPMeta.registerNamespace = () => 'bc';
  XMPMeta.prototype.getProperty = function(ns, name) { const value = this.data[ns + name]; return value === undefined ? undefined : { toString: () => value }; };
  XMPMeta.prototype.setProperty = function(ns, name, value) { this.data[ns + name] = value; };
  XMPMeta.prototype.serialize = function() { return JSON.stringify(this.data); };
  function Time() { this.ticks = '0'; }
  const context = { app: { project, enableQE() {} }, qe, Time, XMPMeta, JSON: undefined,
    File: function(path) { this.length = (files.get(path) ?? '').length; this.open = mode => mode === 'r' && files.has(path); this.read = () => files.get(path); this.close = () => {}; } };
  vm.createContext(context); vm.runInContext(source, context);
  const payload = { version: 1, creationId: CREATION, sequenceId: 'seq-a', projectPath: project.path, width: 1280, height: 720,
    ticksPerFrame: String(TPF), expectedVideoTrackCount: tracks.length, startFrame: 0, endFrame: 300, sourceInTicks: '0',
    documentText: 'BCDOC1:424341500200000001000000', geometry: { position: [.3, .8], width: 700, height: 260, maxChars: 42 } };
  function call(name, data) { files.set('/request.json', JSON.stringify(data)); return JSON.parse(context.BetterCaptionsHost[name]('/request.json')); }
  const original = () => JSON.stringify({ footage, movie, items: [footageItem, movieItem], tracks: tracks.slice(0, 2).map(t => ({ name: t.name, locked: t.locked, muted: t.muted, clips: t.clips.map(c => c.nodeId) })) });
  return { payload, sequence, project, tracks, root, footage, movie, mutations, timingAssignments, parameterWrites, original,
    get createdClip() { return createdClip; }, get createdItem() { return createdItem; },
    create: patch => call('createNativeCaptionDocument', { ...payload, ...patch }),
    read: patch => call('readCaptionConnections', { sequenceId: 'seq-a', projectPath: project.path, generatedRoot: '/project/Better Captions/seq-a', knownLinks: [], includeDocuments: true, ...patch }),
    write: (snapshot, text) => call('writeNativeCaptionDocument', { sequenceId: 'seq-a', projectPath: project.path, snapshot, documentText: text }),
  };
}

for (const occupiedTop of [false, true]) test(`native creator preserves footage/MOV and uses ${occupiedTop ? 'new' : 'existing empty'} top track`, () => {
  const h = fixture({ occupiedTop }), before = h.original(), originalTracks = h.tracks.length;
  const result = h.create(); assert.equal(result.ok, true, result.error);
  assert.equal(result.readbackVerified, true); assert.equal(result.renderVerified, false); assert.equal(result.retry, 'never');
  assert.equal(h.original(), before); assert.equal(result.created.createdTrack, occupiedTop); assert.equal(result.created.trackIndex, originalTracks - (occupiedTop ? 0 : 1));
  assert.equal(h.tracks.length, originalTracks + Number(occupiedTop));
  assert.equal(result.connection.locator.componentIndex, 1); assert.equal(result.connection.locator.documentParamIndex, 3);
  assert.equal(result.connection.documentText, h.payload.documentText); assert.equal(result.connection.carrierKind, 'transparent-video');
  assert.equal(result.connection.inTicks, '0'); assert.equal(result.connection.startTicks, '0'); assert.equal(result.connection.endTicks, String(300 * TPF));
  assert.equal(h.timingAssignments.length, 4); assert.equal(new Set(h.timingAssignments.map(v => v.object)).size, 4);
  assert.deepEqual(h.timingAssignments.map(v => v.field), ['inPoint', 'outPoint', 'start', 'end']);
  assert.equal(h.timingAssignments[0].ticks, '0');
  assert.ok(h.mutations.some(e => e[0] === 'source-in' && e[2] === 0 && e[3] === 4));
  const marker = JSON.parse(h.createdItem._metadata[NS + FIELD]);
  assert.deepEqual(marker, { version: 1, owner: 'com.swen.bettercaptions', kind: 'transparent-video', projectItemId: h.createdItem.nodeId, creationId: CREATION, width: 1280, height: 720 });
  assert.equal(h.createdItem._metadata.unrelated, 'retained-' + h.createdItem.nodeId);
  const repeated = h.create({ expectedVideoTrackCount: h.tracks.length }); assert.match(repeated.error, /retried|exists/); assert.equal(h.mutations.filter(e => e[0] === 'factory').length, 1);
});

for (const patch of [{ sequenceId: 'wrong' }, { projectPath: '/other.prproj' }, { ticksPerFrame: '10584000000' }, { width: 720 }, { expectedVideoTrackCount: 1 }, { sourceInTicks: '3600' }, { startFrame: 1 }, { endFrame: 0 }, { creationId: 'bad' }, { documentText: 'bad' }, { geometry: { position: [.3, 2], width: 700, height: 260, maxChars: 42 } }]) test(`stale/invalid creation context refuses before mutation: ${JSON.stringify(patch)}`, () => {
  const h = fixture(), result = h.create(patch); assert.ok(result.error); assert.equal(result.code, undefined); assert.deepEqual(h.mutations, []);
});

for (const factoryCount of [0, 2]) test(`ambiguous factory diff ${factoryCount} is unconfirmed and never retries or rolls back`, () => {
  const h = fixture({ factoryCount }), before = h.original(), result = h.create();
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.equal(result.retry, 'never'); assert.equal(result.recoverable, false); assert.equal(result.outputApplied, false);
  assert.equal(result.created.projectItemId, null); assert.equal(h.original(), before);
  assert.equal(h.createdClip, undefined); const second = h.create(); assert.ok(second.error); assert.equal(h.mutations.filter(e => e[0] === 'factory').length, 1);
});

for (const mode of [{ ignoreMetadata: true }, { rejectMetadata: true }, { ignoreParameter: 'Width' }, { throwParameter: 'Caption document (experimental)' }, { ignoreTiming: 'inPoint' }, { ignoreEffect: true }, { ignoreInsert: true }]) test(`uncertain/ignored mutation retains owned receipt and does not retry: ${JSON.stringify(mode)}`, () => {
  const h = fixture(mode), before = h.original(), result = h.create();
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.equal(result.retry, 'never'); assert.ok(result.created.projectItemId); assert.equal(h.original(), before);
  const count = h.mutations.length; const next = h.create(); assert.ok(next.error); assert.equal(h.mutations.length, count);
  assert.equal(h.root.children.filter(item => item.nodeId === result.created.projectItemId).length, 1, 'uncertain owned source remains inspectable');
});

test('tagged transparent native carrier reconnects after move/trim and document update requires exact revision', () => {
  const h = fixture(), created = h.create(); assert.equal(created.ok, true, created.error);
  const clip = h.createdClip; clip.start = time(4); clip.end = time(9); clip.inPoint = time(1); clip.outPoint = time(6);
  const result = h.read(); assert.equal(result.ok, true, result.error); assert.equal(result.native.length, 1); assert.equal(result.legacy.length, 1);
  const entry = result.native[0]; assert.equal(entry.clipNodeId, clip.nodeId); assert.equal(entry.carrierKind, 'transparent-video'); assert.equal(entry.startTicks, time(4).ticks); assert.equal(entry.inTicks, time(1).ticks);
  const staleSnapshot = { locator: created.connection.locator, revision: created.connection.revision };
  const text = 'BCDOC1:424341500200000002000000';
  const beforeWrites = h.parameterWrites.length, stale = h.write(staleSnapshot, text); assert.ok(stale.error); assert.equal(h.parameterWrites.length, beforeWrites);
  const fresh = h.write({ locator: entry.locator, revision: entry.revision }, text); assert.equal(fresh.ok, true, fresh.error); assert.equal(fresh.documentText, text);
  assert.equal(h.parameterWrites.length, beforeWrites + 1);
  h.createdItem._metadata[NS + FIELD] = JSON.stringify({ ...JSON.parse(entry.carrierRevision), projectItemId: 'forged' });
  const forged = h.read(); assert.equal(forged.native.length, 0); assert.ok(forged.warnings.length);
});

test('missing effect and occupied/muted top destination cannot mutate existing media', () => {
  const absent = fixture({ missingEffect: true }); assert.ok(absent.create().error); assert.deepEqual(absent.mutations, []);
  const h = fixture(); h.tracks.at(-1).muted = true; const result = h.create(); assert.equal(result.ok, true, result.error); assert.equal(result.created.createdTrack, true);
});


// Adobe calls may synchronously change the active document. These hooks exercise
// the production mutation boundaries rather than simulating guard decisions.
for (const trigger of ['qe-sequence', 'qe-item']) for (const target of ['project', 'sequence']) test(`context changed during ${trigger} (${target}) prevents effect insertion`, () => {
  const h = fixture({ hook(event, state) {
    if (event !== trigger || !state.createdClip) return;
    if (target === 'project') state.context.app.project = { ...state.project, path: '/other.prproj' };
    else state.project.activeSequence = { ...state.sequence, sequenceID: 'other-sequence' };
  } });
  const result = h.create();
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.notEqual(result.ok, true);
  assert.equal(h.mutations.filter(e => e[0] === 'effect').length, 0);
  assert.equal(h.parameterWrites.length, 0); assert.ok(result.created.clipNodeId);
});

test('metadata read changing context prevents schema and metadata writes', () => {
  const h = fixture({ hook(event, state) {
    if (event.startsWith('metadata-read:generated-')) state.project.activeSequence = { ...state.sequence, sequenceID: 'other-sequence' };
  } });
  const result = h.create(); assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED');
  assert.equal(h.mutations.filter(e => ['schema', 'metadata', 'source-in', 'overwrite'].includes(e[0])).length, 0);
  assert.ok(result.created.projectItemId);
});

test('source in-point setter changing context prevents out-point and timeline mutations', () => {
  const h = fixture({ occupiedTop: true, hook(event, state) {
    if (event === 'source-in') state.context.app.project = { ...state.project, path: '/other.prproj' };
  } });
  const result = h.create(); assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED');
  assert.equal(h.mutations.filter(e => e[0] === 'source-in').length, 1);
  assert.equal(h.mutations.filter(e => ['source-out', 'tracks', 'overwrite', 'effect'].includes(e[0])).length, 0);
});

test('first native setter changing context prevents every subsequent setter', () => {
  const h = fixture({ hook(event, state) {
    if (event === 'parameter-write:Position') state.project.activeSequence = { ...state.sequence, sequenceID: 'other-sequence' };
  } });
  const result = h.create(); assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED');
  assert.deepEqual(h.parameterWrites.map(e => e[0]), ['Position']);
  assert.ok(result.created.clipNodeId); assert.equal(result.retry, 'never');
});

test('final document read changing project cannot produce successful confirmation', () => {
  let triggered = false;
  const h = fixture({ hook(event, state) {
    if (event === 'document-read:2') { triggered = true; state.context.app.project = { ...state.project, path: '/other.prproj' }; }
  } });
  const result = h.create(); assert.equal(triggered, true, 'switch occurs during final connection readback');
  assert.equal(h.parameterWrites.length, 5); assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED');
  assert.notEqual(result.ok, true); assert.equal(result.retry, 'never'); assert.ok(result.created.clipNodeId);
});

test('false factory acknowledgement retains the one created item without ownership or retry', () => {
  const h = fixture({ factoryResult: false }), result = h.create();
  assert.equal(result.code, 'BC_OUTPUT_UNCONFIRMED'); assert.equal(result.retry, 'never');
  assert.equal(result.created.projectItemId, h.createdItem.nodeId);
  assert.equal(h.createdItem._metadata[NS + FIELD], undefined);
  assert.equal(h.mutations.filter(e => ['schema', 'metadata', 'overwrite', 'effect'].includes(e[0])).length, 0);
  assert.equal(h.createdClip, undefined);
  const repeated = h.create(); assert.ok(repeated.error);
  assert.equal(h.mutations.filter(e => e[0] === 'factory').length, 1);
});

test('ownership tag cannot reconnect a native carrier backed by external media', () => {
  const h = fixture(), created = h.create(); assert.equal(created.ok, true, created.error);
  const marker = h.createdItem._metadata[NS + FIELD];
  h.createdItem.getMediaPath = () => '/media/external.mov';
  const result = h.read(); assert.equal(result.ok, true, result.error);
  assert.equal(h.createdItem._metadata[NS + FIELD], marker, 'ownership tag remains otherwise unchanged');
  assert.equal(result.native.length, 0); assert.ok(result.warnings.length);
});
