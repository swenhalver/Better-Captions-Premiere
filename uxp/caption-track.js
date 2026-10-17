'use strict';
const { localPath } = require('./paths.js');
const key = value => String(value).replace(/[{}]/g, '').toLowerCase();
const ticks = value => typeof value === 'string' && /^(0|[1-9]\d{0,23})$/.test(value);
function samePath(left, right) {
  const a = localPath(left), b = localPath(right);
  return /^[a-z]:/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
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
async function createCaptionTrack(ppro, project, sequence, prepared) {
  const { destination, seed } = validatePlan(prepared), index = destination.trackIndex;
  if (!ppro.SequenceEditor?.getEditor || !ppro.TrackItemSelection?.createEmptySelection || !ppro.TickTime?.createWithTicks) {
    throw new Error('This Premiere version cannot create a caption track automatically. Update Premiere and retry.');
  }
  async function guard() {
    const activeProject = await ppro.Project.getActiveProject();
    const activeSequence = activeProject && await activeProject.getActiveSequence();
    if (!activeProject || activeProject.path !== prepared.projectPath || project.path !== prepared.projectPath
        || !activeSequence || key(activeSequence.guid) !== key(prepared.sequenceId) || key(sequence.guid) !== key(prepared.sequenceId)) {
      throw new Error('The active project or sequence changed before creating the caption track. Refresh Better Captions.');
    }
  }
  await guard();
  if (await sequence.getVideoTrackCount() !== destination.expectedVideoTrackCount) {
    throw new Error('Video tracks changed while the captions were rendered. Apply again to choose a fresh caption track.');
  }
  const sequenceItem = ppro.ClipProjectItem.cast(await sequence.getProjectItem());
  const found = await sequenceItem.findItemsMatchingMediaPath(seed.path, true);
  if (!Array.isArray(found) || found.length > 100) throw new Error('Premiere could not resolve the generated caption media.');
  const matches = [];
  for (const candidate of found) {
    const item = ppro.ClipProjectItem.cast(candidate);
    if (item && samePath(await item.getMediaFilePath(), seed.path)) matches.push(item);
  }
  if (matches.length !== 1 || await matches[0].isSequence()) throw new Error('The generated caption media is missing or ambiguous. No track was created.');
  const editor = await ppro.SequenceEditor.getEditor(sequence), media = matches[0];
  if (!editor?.createInsertProjectItemAction || !editor?.createRemoveItemsAction) throw new Error('Premiere did not expose automatic caption-track actions.');
  const audioCount = await sequence.getAudioTrackCount();
  await guard();
  if (await sequence.getVideoTrackCount() !== destination.expectedVideoTrackCount) throw new Error('Video tracks changed before creating the caption track. Apply again.');
  let insertionFailure = null, committed = false;
  try {
    project.lockedAccess(() => {
      committed = project.executeTransaction(compound => {
        // Adobe's insert action creates the next video track. Generated MOVs
        // are independently verified video-only; shift is limited to this new track.
        const action = editor.createInsertProjectItemAction(media, ppro.TickTime.createWithTicks(seed.startTicks), index, 0, true);
        if (compound.addAction(action) === false) throw new Error('Premiere refused the caption-track action.');
      }, 'Better Captions: Create caption track');
    });
    if (!committed) insertionFailure = new Error('Premiere did not commit the caption-track action.');
  } catch (error) { insertionFailure = error; }
  const count = await sequence.getVideoTrackCount();
  if (count !== destination.expectedVideoTrackCount + 1) throw insertionFailure || new Error('Premiere did not create exactly one new caption track. No caption update was applied.');
  const track = await sequence.getVideoTrack(index), items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  const owned = [];
  for (const item of items) {
    const source = ppro.ClipProjectItem.cast(await item.getProjectItem());
    if (samePath(await source.getMediaFilePath(), seed.path) && String((await item.getStartTime()).ticks) === seed.startTicks
        && String((await item.getEndTime()).ticks) === seed.endTicks) owned.push(item);
  }
  if (items.length !== 1 || owned.length !== 1) throw new Error('The new caption track changed during setup. No unrelated clips were removed; review the track before retrying.');
  // Remove only this verified setup instance. Keep its imported media item for
  // normal caption Apply; an empty top track is reused after a later failure.
  let removed = false, removalFailure = null;
  for (let attempt = 0; attempt < 2 && !removed; attempt++) {
    try {
      project.lockedAccess(() => {
        const selected = ppro.TrackItemSelection.createEmptySelection(selection => {
          if (selection.addItem(owned[0]) === false) throw new Error('Premiere could not select its caption setup clip.');
          removed = project.executeTransaction(compound => {
            if (compound.addAction(editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.VIDEO, false)) === false) throw new Error('Premiere refused caption setup cleanup.');
          }, 'Better Captions: Finish caption track');
        });
        if (selected === false) throw new Error('Premiere could not prepare caption setup cleanup.');
      });
    } catch (error) { removalFailure = error; }
    if ((await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)).length === 0) removed = true;
  }
  if (!removed || (await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)).length !== 0) {
    throw new Error('Premiere could not remove its generated setup clip on V' + (index + 1) + '. Use Premiere Undo before retrying. ' + (removalFailure?.message || ''));
  }
  if (insertionFailure) throw insertionFailure;
  if (await sequence.getVideoTrackCount() !== count || await sequence.getAudioTrackCount() !== audioCount) throw new Error('The track layout changed while creating the caption track. Apply again.');
  await guard();
  return index;
}
module.exports = { createCaptionTrack, validatePlan };
