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
  const media = { kind:'clip', getMediaFilePath: async () => moviePath.replaceAll('\\', '/'), isSequence: async () => options.seedIsSequence??false };
  const projectMedia={kind:'project-item',clip:media};
  const userMedia={kind:'clip',getMediaFilePath:async()=>options.windows?'D:/Project/source.mp4':'/project/source.mp4',isSequence:async()=>false};
  const mediaBin={kind:'folder',items:options.missingSeed?[]:options.ambiguous?[media,{...media}]:[media]};
  const root={getItems:async()=>[userMedia,mediaBin]};
  const sequenceItem = { findItemsMatchingMediaPath: async () => {throw new Error('Sequence path search must not resolve newly imported project-bin media');} };
  const sequence = { guid: 'seq', getProjectItem: async () => sequenceItem,
    getVideoTrackCount: async () => options.staleTracks ? 2 : trackItems.length,
    getAudioTrackCount: async () => 1,
    getVideoTrack: async index => ({ getTrackItems: async () => trackItems[index] }) };
  let removeAttempts = 0, locked = false;
  const editor = {
    createInsertProjectItemAction(item, at, video, audio, limited) {
      assert.equal(locked,true,'native Actions must be created while the project lock is held');
      assert.equal(item, projectMedia,'SequenceEditor requires the generic ProjectItem wrapper, not ClipProjectItem'); events.push(['insert', at.ticks, video, audio, limited]);
      return () => {
        assert.equal(video, trackItems.length);
        trackItems.push([{ getProjectItem: async () => media,
          getStartTime: async () => ({ ticks: '1000' }), getEndTime: async () => ({ ticks: '2000' }) }]);
      };
    },
    createRemoveItemsAction(selection, ripple, mediaType, shift) {
      assert.equal(locked,true);
      events.push(['remove', ripple, mediaType, shift]);
      return () => { for (const item of selection.items) trackItems[1] = trackItems[1].filter(candidate => candidate !== item); };
    },
  };
  const project = { path: projectPath, getRootItem:async()=>root, getActiveSequence: async () => options.changedSequence ? { guid: 'other' } : sequence,
    lockedAccess(callback) { assert.equal(locked,false);locked=true;try{return callback();}finally{locked=false;} },
    executeTransaction(callback, title) {
      assert.equal(locked,true);assert.notEqual(callback.constructor.name,'AsyncFunction');
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
    FolderItem:{cast:item=>{if(item.kind!=='folder')throw new Error('Not a FolderItem');return {getItems:async()=>item.items};}},
    ProjectItem:{cast:item=>{assert.equal(locked,true,'prepare the generic insert wrapper inside the native lock');assert.equal(item,media);return projectMedia;}},
    ClipProjectItem: { cast: item => item.kind==='clip'?item:null }, TickTime: { createWithTicks: value => ({ ticks: value }) },
    Constants: { TrackItemType: { CLIP: 1 }, MediaType: { VIDEO: 'video' } },
    TrackItemSelection: { createEmptySelection: callback => { assert.equal(locked,true);const selection = { items: [], addItem(item,skipDuplicateCheck) { assert.equal(skipDuplicateCheck,false);this.items.push(item); return true; } }; callback(selection); return true; } } };
  return { ppro, project, sequence, plan, trackItems, footage, media, projectMedia, editor, mediaBin, root, userMedia, events, get removeAttempts() { return removeAttempts; } };
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

test('newly imported seed is found in nested generic project folders without being present in the sequence',async()=>{
 const h=harness();h.mediaBin.items=[{kind:'folder',items:[{kind:'folder',items:[h.media]}]}];
 h.sequence.getProjectItem=async()=>{throw new Error('This media is not yet in any sequence');};
 assert.equal(await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan),1);assert.deepEqual(h.trackItems[1],[]);assert.equal(h.trackItems[0][0],h.footage);
});
test('ordinary project sequences need no filesystem media path when finding an imported seed',async()=>{
 const h=harness(),sequenceItem={kind:'clip',isSequence:async()=>true,getMediaFilePath:async()=>{throw new Error('A project sequence has no atomic filesystem media');}};
 h.root.getItems=async()=>[sequenceItem,h.mediaBin,h.userMedia];
 assert.equal(await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan),1);assert.deepEqual(h.trackItems[1],[]);assert.equal(h.trackItems[0][0],h.footage);
});
test('seed lookup requires a unique exact local path and a non-sequence project item before creating Actions',async()=>{
 for(const kind of ['missing','prefix','sequence','duplicate-other-bin','invalid-identity']){
  const h=harness();
  if(kind==='missing')h.mediaBin.items=[];
  if(kind==='prefix')h.media.getMediaFilePath=async()=>h.plan.seed.path+'.backup';
  if(kind==='sequence')h.media.isSequence=async()=>true;
  if(kind==='duplicate-other-bin')h.root.getItems=async()=>[h.mediaBin,{kind:'folder',items:[{...h.media}]}];
  if(kind==='invalid-identity')h.media.isSequence=async()=>null;
  const error=await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan).catch(error=>error);
  assert.ok(error instanceof Error,kind);assert.match(error.message,/items=\d+, folders=\d+, matches=\d+, sequences=\d+/);assert.equal(h.trackItems.length,1,kind);assert.deepEqual(h.events,[],kind);
 }
});
test('caption-track guards normalize only host drive prefixes and still reject foreign or changed projects',async()=>{
 const h=harness({windows:true});h.project.path='\\\\?\\'+h.plan.projectPath;
 assert.equal(await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan),1);assert.equal(h.trackItems[0][0],h.footage);assert.equal(h.trackItems[1].length,0);
 for(const changed of ['D:\\Other\\edit.prproj','D:\\Project\\Edit.prproj']){
  const f=harness({windows:true});f.project.path='\\\\?\\'+changed;
  await assert.rejects(createCaptionTrack(f.ppro,f.project,f.sequence,f.plan),/project or sequence changed/);
  assert.deepEqual(f.events,[]);assert.equal(f.trackItems.length,1);
 }
 const moved=harness({windows:true});moved.project.path='\\\\?\\'+moved.plan.projectPath;const read=moved.root.getItems;
 moved.root.getItems=async()=>{moved.project.path='\\\\?\\D:\\Saved As\\edit.prproj';return read();};
 await assert.rejects(createCaptionTrack(moved.ppro,moved.project,moved.sequence,moved.plan),/project or sequence changed/);
 assert.deepEqual(moved.events,[]);assert.equal(moved.trackItems.length,1);
});

test('project media traversal bounds every folder, item and depth before timeline mutation',async()=>{
 for(const kind of ['items','folders','depth','unreadable-folder','null-item','unreadable-path']){
  const h=harness();
  if(kind==='items')h.root.getItems=async()=>Array.from({length:2001},()=>h.userMedia);
  if(kind==='folders')h.root.getItems=async()=>Array.from({length:256},()=>({kind:'folder',items:[]}));
  if(kind==='depth'){let child=h.media;for(let i=0;i<33;i++)child={kind:'folder',items:[child]};h.root.getItems=async()=>[child];}
  if(kind==='unreadable-folder')h.root.getItems=async()=>null;
  if(kind==='null-item')h.mediaBin.items=[h.media,null];
  if(kind==='unreadable-path')h.userMedia.getMediaFilePath=async()=>{throw new Error('Native path lookup failed');};
  await assert.rejects(createCaptionTrack(h.ppro,h.project,h.sequence,h.plan),/No track was created/,kind);assert.deepEqual(h.events,[],kind);assert.equal(h.trackItems.length,1,kind);
 }
});
test('a project or track change during asynchronous bin traversal cannot reach insertion',async()=>{
 for(const kind of ['project','tracks']){
  const options={},h=harness(options),read=h.root.getItems;
  h.root.getItems=async()=>{if(kind==='project')h.project.path='/other/project.prproj';else options.staleTracks=true;return read();};
  await assert.rejects(createCaptionTrack(h.ppro,h.project,h.sequence,h.plan),/changed/);assert.deepEqual(h.events,[]);assert.equal(h.trackItems.length,1);
 }
});

test('native parameter failures identify the exact pre-insert operation with bounded non-media context',async()=>{
 const cases=[
  ['active project read',h=>{h.ppro.Project.getActiveProject=async()=>{throw new Error('Invalid parameter.');};}],
  ['project root media read',h=>{h.project.getRootItem=async()=>{throw new Error('Invalid parameter.');};}],
  ['sequence editor',h=>{h.ppro.SequenceEditor.getEditor=()=>{throw new Error('Invalid parameter.');};}],
  ['initial audio track count',h=>{h.sequence.getAudioTrackCount=async()=>{throw new Error('Invalid parameter.');};}],
  ['insert locked access',h=>{h.project.lockedAccess=()=>{throw new Error('Invalid parameter.');};}],
  ['seed ProjectItem cast',h=>{h.ppro.ProjectItem.cast=()=>{throw new Error('Invalid parameter.');};}],
  ['insert TickTime',h=>{h.ppro.TickTime.createWithTicks=()=>{throw new Error('Invalid parameter.');};}],
  ['insert Action creation',h=>{h.editor.createInsertProjectItemAction=()=>{throw new Error('Invalid parameter.');};}],
  ['insert transaction',h=>{h.project.executeTransaction=()=>{throw new Error('Invalid parameter.');};}],
 ];
 for(const [phase,change]of cases){
  const h=harness();change(h);const error=await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan).catch(error=>error);
  assert.equal(error.details.phase,phase);assert.match(error.message,/Invalid parameter/);assert.equal(error.details.videoTrackIndex,1);assert.equal(error.details.expectedVideoTracks,1);assert.ok(error.message.length<600);assert.ok(!error.message.includes(h.plan.seed.path));assert.equal(h.trackItems.length,1);assert.equal(h.trackItems[0][0],h.footage);assert.equal(h.removeAttempts,0);
 }
});
test('cleanup failures retain their native phase and never reinsert or remove unrelated footage',async()=>{
 const h=harness();h.editor.createRemoveItemsAction=()=>{throw new Error('Invalid parameter.');};
 const error=await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan).catch(error=>error);
 assert.match(error.message,/setup clip on V2.*Undo.*cleanup Action creation.*Invalid parameter/);assert.equal(h.events.filter(event=>event[0]==='insert').length,1);assert.equal(h.trackItems.length,2);assert.equal(h.trackItems[1].length,1);assert.equal(h.trackItems[0][0],h.footage);
});
test('a native setup-clip read error retains the post-insert phase and does not guess cleanup ownership',async()=>{
 const h=harness();h.sequence.getVideoTrack=async()=>({getTrackItems:async()=>{throw new Error('Invalid parameter.');}});
 const error=await createCaptionTrack(h.ppro,h.project,h.sequence,h.plan).catch(error=>error);
 assert.equal(error.details.phase,'setup clip read');assert.equal(error.details.observedVideoTracks,2);assert.equal(error.details.insertionAttempted,true);assert.equal(h.events.filter(event=>event[0]==='insert').length,1);assert.equal(h.trackItems[1].length,1);assert.equal(h.removeAttempts,0);assert.equal(h.trackItems[0][0],h.footage);
});
