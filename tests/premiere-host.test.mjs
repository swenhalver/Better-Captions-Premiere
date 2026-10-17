import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const TICKS = 254016000000, TPF = 8475667200, FPS = TICKS / TPF;
function collection(values = [], size = 'numItems') { Object.defineProperty(values, size, { get: () => values.length }); return values; }
class Time { constructor(seconds = 0) { this.seconds = seconds; } get seconds() { return this._ticks / TICKS; } set seconds(value) { this._ticks = Math.round(value * TICKS); } get ticks() { return String(this._ticks); } set ticks(value) { this._ticks = Number(value); } }
function hostFixture() {
  const files = new Map(), imports = [], overwrites = [], knownItems = new Map(); let nextItem = 1, nextClip = 1;
  const item = (media, id = 'item-' + nextItem++) => ({ nodeId: id, type: 1, media, inSeconds: 0, outSeconds: 1,
    getMediaPath() { return this.media; }, changeMediaPath(value) { if (this.failNext) { this.failNext = false; throw new Error('Simulated relink failure'); } this.media = value; return 0; },
    setInPoint(value) { this.inSeconds = value; }, setOutPoint(value) { this.outSeconds = value; } });
  const bin = name => ({ name, type: 2, children: collection(), createBin(name) { const child = bin(name); this.children.push(child); return child; } });
  const root = bin('Root'), clips = collection();
  function addClip(projectItem, start, end) { const clip = { nodeId: 'clip-' + nextClip++, projectItem, name: 'Original caption', start: new Time(start), end: new Time(end), inPoint: new Time(), outPoint: new Time(end - start), motion: { position: [101, 222], scale: 127, keys: ['preserve this'] }, remove() { const index = clips.indexOf(this); if (index >= 0) clips.splice(index, 1); } }; clips.push(clip); return clip; }
  const track = { name: 'Video 1', clips, isLocked: () => false, overwriteClip(projectItem, seconds) { overwrites.push(seconds); return addClip(projectItem, seconds, seconds + projectItem.outSeconds); } };
  const sequence = { sequenceID: 'seq-a', name: 'Test sequence', timebase: String(TPF), frameSizeHorizontal: 1920, frameSizeVertical: 1080, end: String(10 * TICKS), videoTracks: collection([track], 'numTracks'), audioTracks: collection([], 'numTracks'), getPlayerPosition: () => new Time() };
  const project = { path: '/project/test.prproj', activeSequence: sequence, sequences: collection([sequence], 'numSequences'), rootItem: root, importFiles(paths, suppress, target) { imports.push(...paths); for (const path of paths) { const value = item(path); target.children.push(value); knownItems.set(path, value); } return true; } };
  class File { constructor(path) { this.path = path; this.exists = files.has(path); this.length = (files.get(path) ?? '').length; } open() { return files.has(this.path); } read() { return files.get(this.path); } close() {} }
  const sandbox = { app: { project }, File, Time, JSON: undefined, isFinite, Math, Number, String, Error };
  vm.runInNewContext(fs.readFileSync(new URL('../cep/host/bridge.jsx', import.meta.url), 'utf8'), sandbox);
  function payload(cues) { const value = { sequenceId: sequence.sequenceID, projectPath: project.path, width: 1920, height: 1080, fps: FPS, track: 0, cues }; files.set('/job.json', JSON.stringify(value)); return '/job.json'; }
  function cue(id, startFrame = 0, endFrame = 30, extra = {}) { const path = '/render/' + id + '.mov'; files.set(path, 'media'); return { id, text: id, startFrame, endFrame, path, ...extra }; }
  return { host: sandbox.BetterCaptionsHost, files, imports, overwrites, item, addClip, clips, track, sequence, project, payload, cue };
}

test('host refuses an unrelated collision before import or overwrite', () => {
  const f = hostFixture(), existing = f.addClip(f.item('/original.mov'), 0, 1);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('caption')])));
  assert.match(result.error, /contains another clip/); assert.equal(f.imports.length, 0); assert.equal(f.overwrites.length, 0); assert.equal(f.clips[0], existing);
});
test('host places one clip per phrase on exact sequence frames and reads back links', () => {
  const f = hostFixture(), result = JSON.parse(f.host.apply(f.payload([f.cue('a', 1, 30), f.cue('b', 30, 61)])));
  assert.equal(result.ok, true); assert.equal(f.clips.length, 2); assert.equal(result.cues.length, 2);
  assert.equal(f.clips[0].start.ticks, String(TPF)); assert.equal(f.clips[1].start.ticks, f.clips[0].end.ticks);
  assert.equal(f.clips[1].end.ticks, String(61 * TPF));
});
test('relink updates the original clip while preserving manual Motion and keyframe values', () => {
  const f = hostFixture(), media = f.item('/old.mov'), clip = f.addClip(media, 1, 2), motion = structuredClone(clip.motion);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('updated', 31, 65, { clipNodeId: clip.nodeId, projectItemId: media.nodeId, previousPath: media.media })])));
  assert.equal(result.ok, true); assert.equal(f.clips[0], clip); assert.equal(f.overwrites.length, 0); assert.deepEqual(clip.motion, motion); assert.equal(media.media, '/render/updated.mov');
});
test('host refuses relinking media reused by another sequence', () => {
  const f = hostFixture(), media = f.item('/old.mov'), clip = f.addClip(media, 1, 2);
  f.project.sequences.push({ videoTracks: collection([{ clips: collection([{ projectItem: media }]) }], 'numTracks'), audioTracks: collection([], 'numTracks') });
  const result = JSON.parse(f.host.apply(f.payload([f.cue('updated', 31, 65, { clipNodeId: clip.nodeId, projectItemId: media.nodeId, previousPath: media.media })])));
  assert.match(result.error, /used by another/); assert.equal(media.media, '/old.mov'); assert.equal(f.imports.length, 0);
});
test('host restores already updated clips when a later relink fails', () => {
  const f = hostFixture(), firstMedia = f.item('/first-old.mov'), secondMedia = f.item('/second-old.mov');
  const first = f.addClip(firstMedia, 0, 1), second = f.addClip(secondMedia, 2, 3), before = { start: first.start.ticks, end: first.end.ticks, motion: structuredClone(first.motion) };
  secondMedia.failNext = true;
  const result = JSON.parse(f.host.apply(f.payload([f.cue('first', 0, 35, { clipNodeId: first.nodeId, projectItemId: firstMedia.nodeId, previousPath: firstMedia.media }), f.cue('second', 62, 96, { clipNodeId: second.nodeId, projectItemId: secondMedia.nodeId, previousPath: secondMedia.media })])));
  assert.match(result.error, /Simulated/); assert.equal(result.rolledBack, true); assert.equal(firstMedia.media, '/first-old.mov'); assert.equal(secondMedia.media, '/second-old.mov'); assert.equal(first.start.ticks, before.start); assert.equal(first.end.ticks, before.end); assert.deepEqual(first.motion, before.motion);
});
test('host rejects captured sequence/project changes before mutation', () => {
  const f = hostFixture(), file = f.payload([f.cue('a')]); f.project.path = '/other/project.prproj';
  const result = JSON.parse(f.host.apply(file)); assert.match(result.error, /project changed/); assert.equal(f.imports.length, 0);
});
test('an unexpectedly placed new clip is removed during rollback', () => {
  const f = hostFixture(), insert = f.track.overwriteClip;
  f.track.overwriteClip = (item, seconds) => insert(item, seconds + 10);
  const result = JSON.parse(f.host.apply(f.payload([f.cue('misplaced')])));
  assert.match(result.error, /expected timeline position/); assert.equal(result.rolledBack, true); assert.equal(result.attemptedCreated, 1); assert.equal(f.clips.length, 0);
});
test('host JSON works without another extension polyfill and preserves escaped caption text', () => {
  const f = hostFixture(), text = 'Quoted "word" \\ line\nCafé — 字';
  const result = JSON.parse(f.host.apply(f.payload([f.cue('unicode', 0, 24, { text })])));
  assert.equal(result.ok, true); assert.equal(f.clips[0].name, 'Better Captions | ' + text);
});
test('host rejects executable file text and prototype keys without evaluating either', () => {
  const f = hostFixture(); f.files.set('/job.json', '{"sequenceId":"seq-a","attack":(function(){throw new Error("executed")})()}');
  assert.match(JSON.parse(f.host.apply('/job.json')).error, /Invalid caption job JSON/);
  f.files.set('/job.json', '{"__proto__":{"polluted":true}}');
  assert.match(JSON.parse(f.host.apply('/job.json')).error, /Invalid caption job JSON/); assert.equal(f.imports.length, 0);
});
