import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const root = path.resolve(import.meta.dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function loadTypeScript(file, replacements = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: name => replacements[name] ?? loadTypeScript(path.resolve(path.dirname(file), name.endsWith('.ts') ? name : name + '.ts'), replacements) });
  return exports;
}
const planner = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class {} } });
const containers = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/containers.ts'));
const deletedLinks = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/deleted-links.ts'));
const liveOutput = loadTypeScript(path.join(root, 'webview-ui/src/lib/live-output.ts'));
const profile = (signature, scaleX) => ({ signature, samples: [{ time: .5, scaleX, scaleY: 1 }] });
function caption(id, start, end) {
  return { id, text: id, startTime: start, endTime: end, words: [{ text: id, startTime: start, endTime: end }],
    clipNodeId: 'clip-' + id, projectItemId: 'item-' + id, mediaPath: '/generated/old-' + id + '/caption.mov',
    motionProfile: profile('saved-100', 1), renderBounds: { x: 72, y: 832, width: 576, height: 512, frameWidth: 720, frameHeight: 1280 } };
}

/** Run the component's real Apply function; rune shims only supply its props and initial track selection. */
function harness({ changeDuringRender = false, changeSelection = false, unlinked = false, differentPositions = false, editorChanges = false, automaticLegacy = false, verificationFailure = false, mutationFailure = false, malformedMutation = false } = {}) {
  const source = [caption('first', 0, 1), caption('second', 1, 2)], events = [], saved = [], completed = [], busy = [];
  if (unlinked) for (const item of source) { delete item.clipNodeId; delete item.projectItemId; delete item.mediaPath; delete item.motionProfile; }
  if (differentPositions) source[1].position = { x:.1,y:.2 };
  let currentProfile = profile('native-resized-60', .6), applied = false;
  const hostApi = {
    readCaptionConsolidation:async items=>{events.push('plan');return {ok:true,bounds:items[0].renderBounds,motionProfile:currentProfile};},
    applyConsolidatedCaption:async (item,previous,plan)=>{
      events.push('consolidate');assert.deepEqual(plain(previous),source);assert.equal(item.clipNodeId,undefined);assert.equal(item.captionBundle,true);
      if(currentProfile.signature!==plan.motionProfile.signature)throw new Error('Legacy caption geometry changed while rendering.');
      applied=true;currentProfile=profile('native-consolidated-60',.6);
      return {ok:true,cues:[{id:item.id,clipNodeId:'combined-clip',projectItemId:'combined-item',path:item.mediaPath,start:item.startTime,end:item.endTime,motionProfile:currentProfile}]};
    },
    readCaptionMotion: async items => {
      events.push('read');
      return { ok: true, cues: items.map(item => ({ id: item.id, clipNodeId: item.clipNodeId, projectItemId: item.projectItemId, path: item.mediaPath, motionProfile: currentProfile })) };
    },
    preflightCaptionClips: async items => {
      events.push('preflight');
      if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60', 'preflight must receive the newly read size rather than the saved render signature');
      else assert.equal(items[0].captionBundle,true);
    },
    applyCaptionClips: async items => {
      if (mutationFailure) throw mutationFailure;
      events.push('apply'); applied = true;
      if (malformedMutation) return { ok: true, cues: [] };
      if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60');
      currentProfile = unlinked ? profile('native-created-100',1) : profile('native-unlocked-60', .6);
      return { ok: true, cues: items.map(item => ({ id: item.id, clipNodeId: item.clipNodeId ?? 'new-clip-'+item.id, projectItemId: item.projectItemId ?? 'new-item-'+item.id, path: item.mediaPath, start: item.startTime, end: item.endTime, motionProfile: currentProfile })) };
    },
    readTimeline: async items => {
      if (applied && verificationFailure) throw verificationFailure;
      return { ok: true, cues: items.map(item => ({ id: item.id, clipNodeId:item.clipNodeId, projectItemId:item.projectItemId, path: item.mediaPath, start: item.startTime, end: item.endTime })) };
    },
    readCaptionSelection: async () => ({ ok: true, captionId: changeSelection ? 'second' : 'first', time: .5 }),
    selectCaptionClip: async item => { events.push('select-' + item.id); },
  };
  const exporter = { ...planner, exportFrames: async items => {
    events.push('render'); assert.equal(items.length, automaticLegacy ? 2 : 1); if (!unlinked) assert.equal(items[0].motionProfile.signature, 'native-resized-60');
    if (changeDuringRender) currentProfile = profile('native-resized-70', .7);
    if (editorChanges) props.style.fontSize = 88;
    return items.map(item => ({ ...item, mediaPath: '/generated/new-' + item.id + '/caption.mov' }));
  } };
  const props = { captions: source, style: { maxChars: 56 }, animation: {}, frameWidth: 720, frameHeight: 1280, frameRate: 24, duration: 2,
    sequenceName: 'Verification', sequenceId: 'sequence', tracks: [{ index: 2, name: 'Captions', locked: false, clips: 0 }], hostApi,
    selectedId: 'first', onBusy: value => busy.push(value), onUpdated: items => { saved.push(plain(items)); }, onApplied: (items, id, options) => completed.push({ items: plain(items), id, options: plain(options) }) };
  return { apply: componentApply(props,exporter,events), source, events, saved, completed, busy, get applied() { return applied; } };
}
function componentApply(props, exporter, events, selectedTrack=-1) {
  const sourceFile = path.join(root, 'webview-ui/src/components/ExportButton.svelte');
  const script = fs.readFileSync(sourceFile, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = {}, code = ts.transpileModule(script.replace('selectedTrack = $state(-1)', 'selectedTrack = $state('+selectedTrack+')'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, $props: () => props, $state: value => value, $derived: value => value, $effect: () => {},
    require: name => name === '../lib/export/exporter' ? exporter : name === '../lib/export/containers' ? containers : name === '../lib/export/deleted-links' ? deletedLinks : name === '../lib/live-output' ? liveOutput : { refreshProgramMonitor: async () => { events.push('refresh'); } } });
  return exports.apply;
}

test('actual partial Apply uses the captured resized native profile through preflight, rendering and persistence', async () => {
  const h = harness(), updated = await h.apply({ captionIds: ['first'] });
  assert.equal(h.applied, true); assert.deepEqual(h.events, ['read', 'preflight', 'render', 'read', 'apply', 'read', 'refresh', 'select-first']);
  assert.equal(updated[0].motionProfile.signature, 'native-unlocked-60'); assert.equal(h.saved.at(-1)[0].motionProfile.signature, 'native-unlocked-60');
  assert.deepEqual(plain(updated[1]), h.source[1], 'unrequested captions keep their original media, native keys and timings');
  assert.equal(h.source[0].motionProfile.signature, 'saved-100', 'Apply leaves its original prop snapshot untouched');
  assert.deepEqual(h.completed[0].options, { captionIds: ['first'] });
});
test('actual Apply aborts before relinking when native width changes again during rendering', async () => {
  const h = harness({ changeDuringRender: true });
  await assert.rejects(h.apply({ captionIds: ['first'] }), /box size or its keyframes changed/);
  assert.equal(h.applied, false); assert.equal(h.saved.length, 0); assert.equal(h.completed.length, 0);
});
test('automatic partial Apply does not take native selection back after the user chooses another caption', async () => {
  const h = harness({ changeSelection: true }); await h.apply({ captionIds: ['first'] });
  assert.equal(h.applied, true); assert.ok(!h.events.includes('refresh')); assert.ok(!h.events.some(event => event.startsWith('select-')));
});
test('actual first Apply renders and persists one full-transcript native clip for multiple sentence cues', async () => {
  const h=harness({unlinked:true}),updated=await h.apply();
  assert.equal(updated.length,1); assert.equal(updated[0].captionBundle,true); assert.equal(updated[0].clipNodeId,'new-clip-first');
  assert.equal(updated[0].startTime,0); assert.equal(updated[0].endTime,2);
  assert.deepEqual(plain(updated[0].words),h.source.flatMap(caption=>caption.words));
  assert.equal(h.saved.at(-1).length,1); assert.equal(h.saved.at(-1)[0].captionBundle,true);
  assert.equal(h.completed[0].items.length,1); assert.deepEqual(h.busy,[true,false]);
});
test('live output discards an obsolete rendered version before any timeline write', async () => {
  const h = harness({ unlinked: true, editorChanges: true });
  await assert.rejects(h.apply({ automatic: true }), error => error.code === 'BC_RENDER_SUPERSEDED');
  assert.equal(h.applied, false); assert.equal(h.saved.length, 0);
});
test('a recoverable verification read after a successful placement cannot replay the placement', async () => {
  const failure = Object.assign(new Error('slow verification read'), { code: 'BC_NATIVE_PENDING', method: 'readTimeline', recoverable: true });
  const h = harness({ unlinked: true, verificationFailure: failure });
  await assert.rejects(h.apply({ automatic: true }), error => error.code === 'BC_OUTPUT_UNCONFIRMED' && error.recoverable === false && error.outputApplied === true);
  assert.equal(h.events.filter(event => event === 'apply').length, 1);
  assert.equal(h.saved.length, 1, 'Save the known clip links before a later verification read can fail');
  assert.equal(h.saved[0][0].clipNodeId, 'new-clip-first');
});
test('malformed placement acknowledgement is uncertain and cannot be treated as an ordinary retry', async () => {
  const h = harness({ unlinked: true, malformedMutation: true });
  await assert.rejects(h.apply({ automatic: true }), error => error.code === 'BC_OUTPUT_UNCONFIRMED' && error.recoverable === false);
  assert.equal(h.saved.length, 0);
});
test('known unstarted native placement errors retain their safe retry metadata', async () => {
  const failure = Object.assign(new Error('another operation is pending'), { code: 'BC_NATIVE_WAITING', recoverable: true });
  const h = harness({ unlinked: true, mutationFailure: failure });
  await assert.rejects(h.apply({ automatic: true }), error => error === failure);
  assert.equal(h.applied, false);
});
test('automatic styling preserves legacy containers instead of converting human animation', async () => {
  const h = harness({ automaticLegacy: true }), updated = await h.apply({ automatic: true });
  assert.equal(updated.length, 2); assert.deepEqual(plain(updated.map(item => item.clipNodeId)), ['clip-first', 'clip-second']);
  assert.ok(!h.events.includes('plan')); assert.ok(!h.events.includes('consolidate')); assert.ok(!h.events.some(item => item.startsWith('select-')));
});
test('bundle validation failure releases the actual Apply busy gate before any native writes', async () => {
  const h=harness({unlinked:true,differentPositions:true});
  await assert.rejects(h.apply(),/different frame positions/);
  assert.equal(h.applied,false); assert.equal(h.events.length,0); assert.deepEqual(h.busy,[true,false]);
});

test('full Apply converts legacy captions only through verified native consolidation and saves the resulting single link',async()=>{
 const h=harness({differentPositions:true}),before=structuredClone(h.source),updated=await h.apply();
 assert.equal(updated.length,1);assert.equal(updated[0].clipNodeId,'combined-clip');assert.equal(updated[0].captionBundle,true);
 assert.deepEqual(h.source,before);assert.equal(h.saved.at(-1).length,1);assert.equal(h.saved.at(-1)[0].motionProfile.signature,'native-consolidated-60');
 assert.deepEqual(h.events,['plan','preflight','render','consolidate','read','refresh','select-first']);assert.deepEqual(h.busy,[true,false]);
});

test('legacy geometry changed while rendering cannot persist a replacement or discard the original links',async()=>{
 const h=harness({changeDuringRender:true});await assert.rejects(h.apply(),error=>error.code==='BC_OUTPUT_UNCONFIRMED'&&/Legacy caption geometry changed/.test(error.detail));
 assert.equal(h.applied,false);assert.equal(h.saved.length,0);assert.ok(h.source.every(item=>item.clipNodeId.startsWith('clip-')));assert.deepEqual(h.busy,[true,false]);
});

function recoveryHarness(options={}) {
 const source=options.source??[{...caption('bundle',0,2),captionBundle:true,groupingMaxChars:30,position:{x:.5,y:.8}}],before=plain(source),saved=[],events=[],renders=[],writes=[];
 const live=options.live??new Map(source.filter(item=>(options.survivors??[]).includes(item.id)).map(item=>[item.clipNodeId,plain(item)]));
 let applied=false;
 const receipt=item=>({id:item.id,clipNodeId:item.clipNodeId,projectItemId:item.projectItemId,path:item.mediaPath,start:item.startTime,end:item.endTime,...(!live.has(item.clipNodeId)?{missing:true}:{})});
 const hostApi={
  readTimeline:async items=>{events.push('timeline');if(applied&&options.failReadback)throw new Error('Readback interrupted');return options.timelineResult??{ok:true,cues:items.map(receipt)};},
  readCaptionMotion:async items=>{events.push('motion');return {ok:true,cues:items.map(item=>{if(!live.has(item.clipNodeId))throw new Error('Caption clip is missing');return {...receipt(item),motionProfile:profile('live-'+item.id,1)};})};},
  preflightCaptionClips:async(items,track,id,deleted)=>{events.push('preflight');writes.push({stage:'preflight',items:plain(items),track,id,deleted:plain(deleted)});},
  applyCaptionClips:async(items,track,id,previous,deleted)=>{
   events.push('apply');writes.push({stage:'apply',items:plain(items),previous:plain(previous),track,id,deleted:plain(deleted)});
   for(const old of deleted)if(live.has(old.clipNodeId))throw new Error('A deleted caption returned during rendering');
   const cues=items.map(item=>{const linked={...item,clipNodeId:item.clipNodeId??'restored-'+item.id,projectItemId:item.projectItemId??'restored-item-'+item.id};live.set(linked.clipNodeId,plain(linked));return {...receipt(linked),motionProfile:profile('live-'+item.id,1)};});applied=true;return {ok:true,cues};
  },
  selectCaptionClip:async()=>{},readCaptionSelection:async()=>({ok:true,captionId:null}),
 };
 const exporter={...planner,exportFrames:async items=>{events.push('render');renders.push(plain(items));options.duringRender?.(live,before);return items.map(item=>({...item,mediaPath:'/generated/recreated-'+item.id+'/caption.mov'}));}};
 const props={captions:source,style:{maxChars:30},animation:{},frameWidth:720,frameHeight:1280,frameRate:24,duration:2,sequenceName:'Recovery',sequenceId:'sequence',tracks:[{index:7,name:'Old caption track',locked:false,clips:0}],hostApi,onUpdated:items=>saved.push(plain(items))};
 return {apply:componentApply(props,exporter,events,7),source,before,saved,events,renders,writes,live};
}
test('full Apply restores a deleted caption track from the transcript with fresh native links and automatic placement',async()=>{
 const h=recoveryHarness(),updated=await h.apply();
 assert.equal(updated.length,1);assert.equal(updated[0].clipNodeId,'restored-bundle');assert.equal(h.live.size,1);assert.equal(updated[0].captionBundle,true);assert.equal(updated[0].groupingMaxChars,30);assert.deepEqual(plain(updated[0].position),{x:.5,y:.8});
 assert.deepEqual(h.source,h.before,'the saved stale links are retained until successful native Apply');assert.deepEqual(plain(updated[0].words),h.before[0].words);
 for(const write of h.writes){assert.equal(write.track,-1);assert.equal(write.deleted[0].clipNodeId,'clip-bundle');assert.equal(write.deleted[0].projectItemId,'item-bundle');assert.equal(write.deleted[0].mediaPath,h.before[0].mediaPath);assert.equal(write.items[0].clipNodeId,undefined);}
 assert.equal(h.renders[0][0].motionProfile,undefined);assert.equal(h.renders[0][0].renderBounds,undefined);assert.equal(h.renders[0][0].mediaPath,undefined);assert.equal(h.saved.at(-1)[0].clipNodeId,'restored-bundle');
});
test('full Apply restores one deleted manual split while retaining surviving clip identity and native profile',async()=>{
 const source=[{...caption('first',0,1),manualSplit:true},{...caption('second',1,2),manualSplit:true}],h=recoveryHarness({source,survivors:['second']}),updated=await h.apply();
 assert.equal(updated.length,2);assert.ok(updated.every(c=>c.manualSplit));assert.deepEqual(plain(updated.map(c=>c.clipNodeId)),['restored-first','clip-second']);assert.equal(h.live.size,2);
 assert.equal(h.writes.at(-1).deleted.length,1);assert.equal(h.renders[0][0].motionProfile,undefined);assert.equal(h.renders[0][1].motionProfile.signature,'live-second');assert.equal(h.renders[0][1].projectItemId,'item-second');assert.deepEqual(h.source,h.before);
});
test('deleting a legacy track with different saved caption positions preserves its existing containers',async()=>{
 const source=[{...caption('first',0,1),position:{x:.2,y:.7}},{...caption('second',1,2),position:{x:.8,y:.8}}],h=recoveryHarness({source}),updated=await h.apply();
 assert.equal(updated.length,2);assert.deepEqual(plain(updated.map(c=>c.position)),source.map(c=>c.position));assert.deepEqual(plain(updated.map(c=>c.words)),source.map(c=>c.words));assert.equal(h.live.size,2);assert.ok(updated.every(c=>!c.manualSplit));assert.equal(h.writes.at(-1).deleted.length,2);assert.deepEqual(h.source,h.before);
});
test('deleted legacy captions with one shared placement recreate as one unified caption clip',async()=>{
 const source=[caption('first',0,1),caption('second',1,2)],h=recoveryHarness({source}),updated=await h.apply();
 assert.equal(updated.length,1);assert.equal(updated[0].captionBundle,true);assert.equal(updated[0].clipNodeId,'restored-first');assert.deepEqual(plain(updated[0].words),source.flatMap(c=>c.words));assert.equal(h.live.size,1);assert.equal(h.writes.at(-1).deleted.length,2);
});
test('automatic partial reflow never detaches or recreates a caption deleted from Premiere',async()=>{
 const h=recoveryHarness();await assert.rejects(h.apply({captionIds:['bundle']}),/missing/);assert.deepEqual(h.events,['motion']);assert.equal(h.live.size,0);assert.equal(h.saved.length,0);assert.equal(h.renders.length,0);assert.deepEqual(h.source,h.before);
});
test('missing, duplicate, stale and unsuccessful read receipts cannot authorize caption recreation',async()=>{
 const base=caption('bundle',0,2),receipt={id:base.id,clipNodeId:base.clipNodeId,projectItemId:base.projectItemId,path:base.mediaPath,missing:true};
 for(const timelineResult of [{ok:false,cues:[receipt]},{ok:true,cues:[]},{ok:true,cues:[receipt,receipt]},{ok:true,cues:[{id:'bundle',missing:true}]},{ok:true,cues:[{...receipt,clipNodeId:'other'}]},{ok:true,cues:[{...receipt,projectItemId:'other'}]},{ok:true,cues:[{...receipt,path:'/wrong.mov'}]}]){
  const h=recoveryHarness({timelineResult});await assert.rejects(h.apply(),/could not confirm|link changed/);assert.equal(h.renders.length,0);assert.equal(h.saved.length,0);assert.equal(h.live.size,0);assert.deepEqual(h.source,h.before);
 }
});
test('Undo during rendering preserves old links and cannot persist duplicate recreated captions',async()=>{
 const h=recoveryHarness({duringRender:(live,before)=>live.set(before[0].clipNodeId,before[0])});await assert.rejects(h.apply(),error=>error.code==='BC_OUTPUT_UNCONFIRMED'&&/returned during rendering/.test(error.detail));assert.equal(h.saved.length,0);assert.equal(h.live.size,1);assert.deepEqual(h.source,h.before);
});
test('new links are saved before interrupted verification so retry updates instead of inserting again',async()=>{
 const h=recoveryHarness({failReadback:true});await assert.rejects(h.apply(),error=>error.code==='BC_OUTPUT_UNCONFIRMED'&&error.outputApplied===true&&/Readback interrupted/.test(error.detail));assert.equal(h.saved.length,1);assert.equal(h.saved[0][0].clipNodeId,'restored-bundle');assert.equal(h.live.size,1);
 const retry=recoveryHarness({source:h.saved[0],live:h.live}),updated=await retry.apply();assert.equal(updated[0].clipNodeId,'restored-bundle');assert.equal(retry.live.size,1);assert.equal(retry.writes.at(-1).deleted.length,0);assert.equal(retry.renders[0][0].clipNodeId,'restored-bundle');
});
