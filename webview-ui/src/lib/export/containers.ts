import type { CaptionItem } from '../types';
import { validateCaptions } from '../transcript/edit.ts';
import { refreshCaptionGroups, validateCharacterLimit } from '../transcript/parser.ts';

/** New captions share one native clip; explicit splits and existing native clips retain their identities. */
export function bundleCaptionContainers(captions: CaptionItem[], maxChars: number, restoreContainers = false): CaptionItem[] {
  validateCharacterLimit(maxChars);
  validateCaptions(captions);
  if (captions.some(caption => caption.clipNodeId || caption.manualSplit)) return refreshCaptionGroups(captions);
  const first = captions[0], last = captions[captions.length - 1];
  if (captions.some(caption => caption.position?.x !== first.position?.x || caption.position?.y !== first.position?.y)) {
    // Restoring deleted legacy clips must preserve their distinct saved
    // placements even though native geometry is no longer available to merge.
    if (restoreContainers) return refreshCaptionGroups(captions);
    throw new Error('These captions use different frame positions. Give them one position or split them explicitly before applying one caption clip.');
  }
  const words = captions.flatMap((caption, index) => caption.words.map((word, wordIndex) => ({ ...word,
    // A shared native container must retain speaker boundaries when regrouped.
    ...(wordIndex === caption.words.length - 1 && captions[index + 1] && caption.speaker !== captions[index + 1].speaker ? { endOfSentence: true } : {}),
  })));
  return refreshCaptionGroups([{ ...first, words, text: words.map(word => word.text).join(' '),
    startTime: first.startTime, endTime: last.endTime, groupingMaxChars: maxChars, captionBundle: true,
    timingEstimated: captions.some(caption => caption.timingEstimated),
  }], maxChars);
}

export function needsLegacyConsolidation(captions:CaptionItem[]):boolean {
  return captions.length>1 && captions.every(caption=>caption.clipNodeId && !caption.captionBundle && !caption.manualSplit);
}

/** Native links are cleared only in the render draft; old clips survive until verified replacement. */
export function consolidationDraft(captions:CaptionItem[],maxChars:number,plan:{bounds:NonNullable<CaptionItem['renderBounds']>;motionProfile:NonNullable<CaptionItem['motionProfile']>}):CaptionItem[] {
  if(!needsLegacyConsolidation(captions))throw new Error('These captions are not an unmodified legacy clip set.');
  const draft=captions.map(({clipNodeId,projectItemId,mediaPath,position,renderBounds,motionProfile,...caption})=>caption);
  const [bundle]=bundleCaptionContainers(draft,maxChars),b=plan.bounds;
  return [{...bundle,renderBounds:{...b},motionProfile:plan.motionProfile,position:{x:(b.x+b.width/2)/b.frameWidth,y:(b.y+b.height/2)/b.frameHeight}}];
}
