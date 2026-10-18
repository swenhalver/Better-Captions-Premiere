import type { CaptionItem } from '../types';

export type DeletedCaptionLink = Required<Pick<CaptionItem, 'id' | 'clipNodeId' | 'projectItemId' | 'mediaPath'>>;
interface TimelineCue { id: string; clipNodeId?: string; projectItemId?: string; path?: string; missing?: boolean; }

/** Detach only links whose complete absence Premiere has positively confirmed. */
export function restoreDeletedCaptionLinks(captions: CaptionItem[], result: { ok: boolean; cues: TimelineCue[] }) {
  if (result?.ok !== true || !Array.isArray(result.cues) || result.cues.length !== captions.filter(caption => caption.clipNodeId).length) throw new Error('Premiere could not confirm which caption clips are on the timeline.');
  const deletedLinks: DeletedCaptionLink[] = [];
  const restored = captions.map(caption => {
    if (!caption.clipNodeId) return caption;
    const matches = result.cues.filter(cue => cue?.id === caption.id), cue = matches[0];
    if (matches.length !== 1 || !caption.projectItemId || !caption.mediaPath || cue.clipNodeId !== caption.clipNodeId || cue.projectItemId !== caption.projectItemId || cue.path !== caption.mediaPath) throw new Error('A caption timeline link changed. Sync timing from Premiere before updating it.');
    if (cue.missing !== true) return caption;
    deletedLinks.push({ id: caption.id, clipNodeId: caption.clipNodeId, projectItemId: caption.projectItemId, mediaPath: caption.mediaPath });
    // Deleted native animation no longer exists. Do not render using its old
    // inverse-scale compensation or keep IDs that could relink unrelated media.
    const { clipNodeId, projectItemId, mediaPath, motionProfile, renderBounds, ...draft } = caption;
    return draft;
  });
  return { captions: restored, deletedLinks };
}
