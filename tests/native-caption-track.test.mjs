import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCaptionTrack, validatePlan } = require('../uxp/caption-track.js');

function harness(options = {}) {
  const moviePath = options.windows ? 'D:\\Project\\Better Captions\\seq\\caption-one-123\\caption.mov' : '/project/Better Captions/seq/caption-one-123/caption.mov';
  const projectPath = options.windows ? 'D:\\Project\\edit.prproj' : '/project/edit.prproj';
  const plan = { ok: true, sequenceId: 'seq', projectPath,
    destination: { mode: 'create', expectedVideoTrackCount: 1, trackIndex: 1, newCaptionCount: 1 },
    seed: { id: 'caption-one', path: moviePath, videoOnly: true, startTicks: '1000', endTicks: '2000', durationTicks: '1000' } };
  const footage = { id: 'user-footage', start: '0', end: '5000' }, trackItems = [[footage]], events = [];
  const media = { getMediaFilePath: async () => moviePath.replaceAll('\\', '/'), isSequence: async () => false };
  const sequenceItem = { findItemsMatchingMediaPath: async () => options.ambiguous ? [media, media] : [media] };
  const sequence = { guid: 'seq', getProjectItem: async () => sequenceItem,
    getVideoTrackCount: async () => options.staleTracks ? 2 : trackItems.length,
    getAudioTrackCount: async () => 1,
    getVideoTrack: async index => ({ getTrackItems: async () => trackItems[index] }) };
  let removeAttempts = 0;
  const editor = {
    createInsertProjectItemAction(item, at, video, audio, limited) {
      assert.equal(item, media); events.push(['insert', at.ticks, video, audio, limited]);
      return () => {
        assert.equal(video, trackItems.length);
        trackItems.push([{ getProjectItem: async () => media,
          getStartTime: async () => ({ ticks: '1000' }), getEndTime: async () => ({ ticks: '2000' }) }]);
      };
    },
    createRemoveItemsAction(selection, ripple, mediaType, shift) {
      events.push(['remove', ripple, mediaType, shift]);
      return () => { for (const item of selection.items) trackItems[1] = trackItems[1].filter(candidate => candidate !== item); };
    },
  };
  const project = { path: projectPath, getActiveSequence: async () => options.changedSequence ? { guid: 'other' } : sequence,
    lockedAccess: callback => callback(),
    executeTransaction(callback, title) {
      const actions = []; callback({ addAction: action => { actions.push(action); return true; } });
      if (title.endsWith('Create caption track')) {
        if (options.rejectInsert) return false;
        actions.forEach(action => action());
        return !options.uncertainInsert;
      }
      removeAttempts++;
      if (options.rejectRemove || options.retryRemove && removeAttempts === 1) return false;
      actions.forEach(action => action()); return true;
    } };
  const ppro = { Project: { getActiveProject: async () => project }, SequenceEditor: { getEditor: () => editor },
    ClipProjectItem: { cast: item => item }, TickTime: { createWithTicks: value => ({ ticks: value }) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: 'video' } },
    TrackItemSelection: { createEmptySelection: callback => { const selection = { items: [], addItem(item) { this.items.push(item); return true; } }; callback(selection); return true; } } };
  return { ppro, project, sequence, plan, trackItems, footage, events, get removeAttempts() { return removeAttempts; } };
}

for (const windows of [false, true]) test(`public native action creates one empty top track without shifting footage (${windows ? 'Windows paths' : 'macOS paths'})`, async () => {
  const h = harness({ windows }), before = structuredClone(h.footage);
  assert.equal(await createCaptionTrack(h.ppro, h.project, h.sequence, h.plan), 1);
  assert.equal(h.trackItems.length, 2); assert.deepEqual(h.trackItems[1], []);
  assert.deepEqual(h.footage, before); assert.equal(h.trackItems[0][0], h.footage);
  assert.deepEqual(h.events, [['insert', '1000', 1, 0, true], ['remove', false, 'video', false]]);
});

for (const option of ['changedSequence', 'staleTracks', 'ambiguous']) test(`native track setup refuses ${option} before timeline mutation`, async () => {
  const h = harness({ [option]: true });
  await assert.rejects(createCaptionTrack(h.ppro, h.project, h.sequence, h.plan));
  assert.equal(h.trackItems.length, 1); assert.deepEqual(h.events, []);
});

test('a refused insertion leaves existing tracks untouched', async () => {
  const h = harness({ rejectInsert: true });
  await assert.rejects(createCaptionTrack(h.ppro, h.project, h.sequence, h.plan), /did not commit/);
  assert.equal(h.trackItems.length, 1); assert.equal(h.removeAttempts, 0);
});
test('an uncertain committed insert cleans only its seed and reports failure for a safe retry', async () => {
  const h = harness({ uncertainInsert: true });
  await assert.rejects(createCaptionTrack(h.ppro, h.project, h.sequence, h.plan), /did not commit/);
  assert.equal(h.trackItems.length, 2); assert.deepEqual(h.trackItems[1], []);
  assert.equal(h.trackItems[0][0], h.footage);
});
test('one refused cleanup gets a bounded second attempt', async () => {
  const h = harness({ retryRemove: true });
  assert.equal(await createCaptionTrack(h.ppro, h.project, h.sequence, h.plan), 1);
  assert.equal(h.removeAttempts, 2); assert.deepEqual(h.trackItems[1], []);
});
test('persistent cleanup failure reports its exact generated clip track and preserves footage', async () => {
  const h = harness({ rejectRemove: true });
  await assert.rejects(createCaptionTrack(h.ppro, h.project, h.sequence, h.plan), /setup clip on V2.*Undo/);
  assert.equal(h.removeAttempts, 2); assert.equal(h.trackItems[1].length, 1);
  assert.equal(h.trackItems[0][0], h.footage);
});
test('native creation requires an exact generated video-only destination plan', () => {
  const h = harness();
  for (const modify of [p => p.seed.videoOnly = false, p => p.destination.trackIndex = 0,
    p => p.destination.expectedVideoTrackCount = 256, p => p.seed.startTicks = '-1',
    p => p.seed.path = '/project/../other/clip.mov', p => p.destination.mode = 'reuse']) {
    const plan = structuredClone(h.plan); modify(plan); assert.throws(() => validatePlan(plan));
  }
});
