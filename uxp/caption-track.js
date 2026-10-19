'use strict';
const { hostProjectPath, localPath } = require('./paths.js');
const key = value => String(value).replace(/[{}]/g, '').toLowerCase();
const ticks = value => typeof value === 'string' && /^(0|[1-9]\d{0,23})$/.test(value);
function samePath(left, right) {
  const a = localPath(left), b = localPath(right);
  return /^[a-z]:/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function nativeFailure(phase, problem, context) {
  if (problem?.captionTrackFailure === true) return problem;
  let detail = 'Unknown native failure';
  try { detail = String(problem?.message ?? problem).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240); } catch {}
  const snapshot = { phase, videoTrackIndex: context.videoTrackIndex, expectedVideoTracks: context.expectedVideoTracks,
    observedVideoTracks: context.observedVideoTracks ?? null, audioTracks: context.audioTracks ?? null, insertionAttempted: context.insertionAttempted };
  return Object.assign(new Error('Caption track setup failed during ' + phase + ' [videoIndex=' + snapshot.videoTrackIndex
    + ', expectedVideoTracks=' + snapshot.expectedVideoTracks + ', observedVideoTracks=' + snapshot.observedVideoTracks
    + ', audioTracks=' + snapshot.audioTracks + ', insertionAttempted=' + snapshot.insertionAttempted + ']: ' + detail), { captionTrackFailure: true, details: snapshot });
}
function nativeStep(phase, run, context) {
  try { return run(); } catch (problem) { throw nativeFailure(phase, problem, context); }
}
async function nativeRead(phase, run, context) {
  try { return await run(); } catch (problem) { throw nativeFailure(phase, problem, context); }
}
function validatePlan(prepared) {
  const destination = prepared?.destination, seed = prepared?.seed;
  if (!prepared || prepared.ok !== true || typeof prepared.sequenceId !== 'string' || !prepared.sequenceId || typeof prepared.projectPath !== 'string'
      || !destination || destination.mode !== 'create' || !Number.isInteger(destination.expectedVideoTrackCount)
      || destination.expectedVideoTrackCount < 0 || destination.expectedVideoTrackCount >= 256
      || destination.trackIndex !== destination.expectedVideoTrackCount
      || !seed || seed.videoOnly !== true || !/^[\w-]{1,160}$/.test(seed.id)
      || ![seed.startTicks, seed.endTicks, seed.durationTicks].every(ticks) || Number(seed.endTicks) <= Number(seed.startTicks)
      || Number(seed.durationTicks) <= 0 || typeof seed.path !== 'string') {
    throw new Error('Premiere returned an invalid automatic caption-track plan. No track was created.');
  }
  localPath(prepared.projectPath);
  if (!localPath(seed.path).endsWith('/caption.mov')) throw new Error('Invalid generated caption media path.');
  return { destination, seed };
}
async function findSeedMedia(ppro, project, seed, context) {
  const limits = { items: 2000, folders: 256, depth: 32 };
  const counts = { items: 0, folders: 0, matches: 0, sequenceMatches: 0 };
  const fail = reason => new Error(reason + ' [items=' + counts.items + ', folders=' + counts.folders + ', matches=' + counts.matches + ', sequences=' + counts.sequenceMatches + ']. No track was created.');
  const root = await nativeRead('project root media read', () => project.getRootItem(), context);
  if (!root || typeof root.getItems !== 'function') throw fail('Premiere did not expose the project media root');
  const pending = [{ folder: root, depth: 0 }], visited = new Set(), matches = [];
  while (pending.length) {
    const { folder, depth } = pending.pop();
    if (depth > limits.depth || visited.has(folder) || ++counts.folders > limits.folders) throw fail('The project folder tree exceeds safe caption-media lookup bounds');
    visited.add(folder);
    let children;
    try { children = await folder.getItems(); }
    catch { throw fail('Premiere could not read a project media folder'); }
    if (!Array.isArray(children) || children.length > limits.items - counts.items) throw fail('Premiere returned an unreadable or oversized project media folder');
    for (const candidate of children) {
      counts.items++;
      if (!candidate) throw fail('Premiere returned an unreadable project media item');
      let childFolder = null;
      try { childFolder = ppro.FolderItem.cast(candidate); } catch { /* A clip cannot be cast to a folder. */ }
      if (childFolder) {
        if (typeof childFolder.getItems !== 'function') throw fail('Premiere did not expose a project folder child reader');
        pending.push({ folder: childFolder, depth: depth + 1 });
        continue;
      }
      let media = null;
      try { media = ppro.ClipProjectItem.cast(candidate); } catch { /* Fail closed below for an unclassified native item. */ }
      if (!media || typeof media.getMediaFilePath !== 'function' || typeof media.isSequence !== 'function') throw fail('Premiere could not classify a project media item');
      let mediaPath, sequence;
      try { sequence = await media.isSequence(); }
      catch { throw fail('Premiere could not inspect a project media item'); }
      if (typeof sequence !== 'boolean') throw fail('Premiere returned invalid project media identity');
      if (sequence) { counts.sequenceMatches++; continue; }
      try { mediaPath = await media.getMediaFilePath(); }
      catch { throw fail('Premiere could not inspect a project media path'); }
      if (typeof mediaPath !== 'string') throw fail('Premiere returned invalid project media identity');
      if (!mediaPath) continue; // Synthetic items have no file path.
      let exact = false;
      try { exact = samePath(mediaPath, seed.path); } catch { /* Non-local paths cannot match this validated local seed path. */ }
      if (!exact) continue;
      matches.push(media); counts.matches++;
      if (matches.length > 1) throw fail('The generated caption media is ambiguous in the project');
    }
  }
  if (matches.length !== 1) throw fail('The generated caption media is missing or ambiguous in the project');
  return matches[0];
}
async function createCaptionTrack(ppro, project, sequence, prepared) {
  const { destination, seed } = validatePlan(prepared), index = destination.trackIndex;
  const context = { videoTrackIndex: index, expectedVideoTracks: destination.expectedVideoTrackCount, observedVideoTracks: null, audioTracks: null, insertionAttempted: false };
  if (!ppro.SequenceEditor?.getEditor || !ppro.TrackItemSelection?.createEmptySelection || !ppro.TickTime?.createWithTicks
      || !ppro.FolderItem?.cast || !ppro.ClipProjectItem?.cast || !ppro.ProjectItem?.cast || typeof project.getRootItem !== 'function') {
    throw new Error('This Premiere version cannot create a caption track automatically. Update Premiere and retry.');
  }
  async function guard() {
    const activeProject = await nativeRead('active project read', () => ppro.Project.getActiveProject(), context);
    const activeSequence = activeProject && await nativeRead('active sequence read', () => activeProject.getActiveSequence(), context);
    if (!activeProject || hostProjectPath(activeProject.path) !== prepared.projectPath || hostProjectPath(project.path) !== prepared.projectPath
        || !activeSequence || key(activeSequence.guid) !== key(prepared.sequenceId) || key(sequence.guid) !== key(prepared.sequenceId)) {
      throw new Error('The active project or sequence changed before creating the caption track. Refresh Better Captions.');
    }
  }
  await guard();
  if (await nativeRead('initial video track count', () => sequence.getVideoTrackCount(), context) !== destination.expectedVideoTrackCount) {
    throw new Error('Video tracks changed while the captions were rendered. Apply again to choose a fresh caption track.');
  }
  // Enumerate the imported project bins directly. The setup media has not yet
  // appeared on a sequence, and native path-search results proved unreliable.
  const media = await nativeRead('project media lookup', () => findSeedMedia(ppro, project, seed, context), context);
  const editor = await nativeRead('sequence editor', () => ppro.SequenceEditor.getEditor(sequence), context);
  if (!editor?.createInsertProjectItemAction || !editor?.createRemoveItemsAction) throw new Error('Premiere did not expose automatic caption-track actions.');
  const audioCount = await nativeRead('initial audio track count', () => sequence.getAudioTrackCount(), context); context.audioTracks = audioCount;
  await guard();
  if (await nativeRead('pre-insert video track count', () => sequence.getVideoTrackCount(), context) !== destination.expectedVideoTrackCount) throw new Error('Video tracks changed before creating the caption track. Apply again.');
  let insertionFailure = null, committed = false;
  try {
    context.insertionAttempted = true;
    nativeStep('insert locked access', () => project.lockedAccess(() => {
      // UXP specialized wrappers are distinct native types. The insert API
      // requires ProjectItem, not the ClipProjectItem used to inspect media.
      const projectItem = nativeStep('seed ProjectItem cast', () => ppro.ProjectItem.cast(media), context);
      if (!projectItem) throw nativeFailure('seed ProjectItem cast', 'Premiere did not expose the generated ProjectItem.', context);
      committed = nativeStep('insert transaction', () => project.executeTransaction(compound => {
        // Adobe's insert action creates the next video track. Generated MOVs
        // are independently verified video-only; shift is limited to this new track.
        const time = nativeStep('insert TickTime', () => ppro.TickTime.createWithTicks(seed.startTicks), context);
        const action = nativeStep('insert Action creation', () => editor.createInsertProjectItemAction(projectItem, time, index, 0, true), context);
        if (nativeStep('insert Action registration', () => compound.addAction(action), context) === false) throw new Error('Premiere refused the caption-track action.');
      }, 'Better Captions: Create caption track'), context);
    }), context);
    if (!committed) insertionFailure = new Error('Premiere did not commit the caption-track action.');
  } catch (error) { insertionFailure = error; }
  const count = await nativeRead('post-insert video track count', () => sequence.getVideoTrackCount(), context); context.observedVideoTracks = count;
  if (count !== destination.expectedVideoTrackCount + 1) throw insertionFailure || new Error('Premiere did not create exactly one new caption track. No caption update was applied.');
  const track = await nativeRead('new video track read', () => sequence.getVideoTrack(index), context);
  const readItems = phase => nativeRead(phase, async () => {
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    if (!Array.isArray(items)) throw new Error('Premiere did not return valid caption-track items.');
    return items;
  }, context);
  const items = await readItems('setup clip read');
  if (items.length !== 1) throw new Error('The new caption track changed during setup. No unrelated clips were removed; review the track before retrying.');
  const owned = [];
  for (const item of items) {
    const sourceItem = await nativeRead('setup clip project item', () => item.getProjectItem(), context);
    const source = nativeStep('setup clip ClipProjectItem cast', () => ppro.ClipProjectItem.cast(sourceItem), context);
    const path = await nativeRead('setup clip media path', () => source.getMediaFilePath(), context);
    const start = await nativeRead('setup clip start time', () => item.getStartTime(), context), end = await nativeRead('setup clip end time', () => item.getEndTime(), context);
    if (nativeStep('setup clip identity verification', () => samePath(path, seed.path) && String(start.ticks) === seed.startTicks && String(end.ticks) === seed.endTicks, context)) owned.push(item);
  }
  if (items.length !== 1 || owned.length !== 1) throw new Error('The new caption track changed during setup. No unrelated clips were removed; review the track before retrying.');
  // Remove only this verified setup instance. Keep its imported media item for
  // normal caption Apply; an empty top track is reused after a later failure.
  let removed = false, removalFailure = null;
  for (let attempt = 0; attempt < 2 && !removed; attempt++) {
    try {
      nativeStep('cleanup locked access', () => project.lockedAccess(() => {
        const selected = nativeStep('cleanup selection creation', () => ppro.TrackItemSelection.createEmptySelection(selection => {
          if (nativeStep('cleanup selection addItem', () => selection.addItem(owned[0], false), context) === false) throw new Error('Premiere could not select its caption setup clip.');
          removed = nativeStep('cleanup transaction', () => project.executeTransaction(compound => {
            const action = nativeStep('cleanup Action creation', () => editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.VIDEO, false), context);
            if (nativeStep('cleanup Action registration', () => compound.addAction(action), context) === false) throw new Error('Premiere refused caption setup cleanup.');
          }, 'Better Captions: Finish caption track'), context);
        }), context);
        if (selected === false) throw new Error('Premiere could not prepare caption setup cleanup.');
      }), context);
    } catch (error) { removalFailure = error; }
    if ((await readItems('cleanup clip readback')).length === 0) removed = true;
  }
  if (!removed || (await readItems('final cleanup clip readback')).length !== 0) {
    throw new Error('Premiere could not remove its generated setup clip on V' + (index + 1) + '. Use Premiere Undo before retrying. ' + (removalFailure?.message || ''));
  }
  if (insertionFailure) throw insertionFailure;
  if (await nativeRead('final video track count', () => sequence.getVideoTrackCount(), context) !== count || await nativeRead('final audio track count', () => sequence.getAudioTrackCount(), context) !== audioCount) throw new Error('The track layout changed while creating the caption track. Apply again.');
  await guard();
  return index;
}
module.exports = { createCaptionTrack, validatePlan };
