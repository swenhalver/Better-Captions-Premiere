'use strict';
const { localPath } = require('./paths.js');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const ticks = value => typeof value==='string' && /^(0|[1-9]\d{0,23})$/.test(value);
const key = value => String(value).replace(/[{}]/g,'').toLowerCase();
const samePath = (left,right) => {
  const a=localPath(left),b=localPath(right);
  return /^[a-z]:/i.test(a)?a.toLowerCase()===b.toLowerCase():a===b;
};

/** Remove only the proven legacy clips, together in one non-ripple transaction. */
async function removeLegacyClips(ppro, project, sequence, plan, verify) {
  if (!plan || plan.version!==1 || !Array.isArray(plan.clips) || plan.clips.length<2 || plan.clips.length>64 || typeof verify!=='function') throw new Error('Invalid legacy caption conversion receipt.');
  const seen=new Set(), selected=[];
  for (const part of plan.clips) {
    if (!part || typeof part.clipNodeId!=='string' || !part.clipNodeId || seen.has(part.clipNodeId) || !Number.isInteger(part.track) || part.track<0 || ![part.startTicks,part.endTicks,part.inTicks,part.outTicks].every(ticks) || typeof part.path!=='string') throw new Error('Invalid legacy caption identity.');
    seen.add(part.clipNodeId);localPath(part.path);
    const track=await sequence.getVideoTrack(part.track), matches=[];
    for(const clip of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)) {
      const actual=[String((await clip.getStartTime()).ticks),String((await clip.getEndTime()).ticks),String((await clip.getInPoint()).ticks),String((await clip.getOutPoint()).ticks)];
      if(!same(actual,[part.startTicks,part.endTicks,part.inTicks,part.outTicks]))continue;
      const item=ppro.ClipProjectItem.cast(await clip.getProjectItem());
      if(samePath(await item.getMediaFilePath(),part.path))matches.push(clip);
    }
    if(matches.length!==1 || selected.includes(matches[0]))throw new Error('A legacy caption changed before conversion. No original clips were removed.');
    selected.push(matches[0]);
  }
  const editor=await ppro.SequenceEditor.getEditor(sequence), active=await ppro.Project.getActiveProject();
  if(!active || active.path!==plan.projectPath || project.path!==plan.projectPath || key((await active.getActiveSequence())?.guid)!==key(plan.sequenceId) || key(sequence.guid)!==key(plan.sequenceId))throw new Error('The active project or sequence changed before caption conversion.');
  // This is the final asynchronous check. CEP proves exact node IDs, paths,
  // Motion and replacement holds immediately before the synchronous transaction.
  const receipt=await verify();
  if(!receipt?.ok || receipt.complete!==false || !same(receipt.clips,plan.clips))throw new Error('Legacy caption conversion could not be freshly verified.');
  let committed=false;
  project.lockedAccess(()=>{
    const selectionStatus=ppro.TrackItemSelection.createEmptySelection(selection=>{
      for(const clip of selected)if(selection.addItem(clip)===false)throw new Error('Premiere could not select the exact legacy clips.');
      committed=project.executeTransaction(compound=>{
        if(compound.addAction(editor.createRemoveItemsAction(selection,false,ppro.Constants.MediaType.VIDEO,false))===false)throw new Error('Premiere refused the legacy caption conversion.');
      },'S-Captions: Combine legacy caption clips');
    });
    if(selectionStatus===false)throw new Error('Premiere could not prepare the legacy caption conversion.');
  });
  if(!committed)throw new Error('Premiere did not commit the legacy caption conversion.');
  const complete=await verify();
  if(!complete?.ok || complete.complete!==true)throw new Error('Premiere did not confirm every legacy clip removal. Review Premiere Undo before continuing.');
}
module.exports={removeLegacyClips};
