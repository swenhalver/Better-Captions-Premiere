<script lang="ts">
  import type { CaptionItem, StyleConfig, AnimationConfig, SequenceInfo,MotionProfile } from '../lib/types';
  import { exportFrames, planCaptionFrames,motionScaleAt, type ExportProgress } from '../lib/export/exporter';
  import { refreshProgramMonitor } from '../lib/export/program-monitor';

  interface Props {
    captions: CaptionItem[]; style: StyleConfig; animation: AnimationConfig;
    frameWidth: number; frameHeight: number; frameRate: number; duration: number;
    sequenceName: string; sequenceId: string; tracks?: SequenceInfo['tracks']; hostApi: any;
    onUpdated?: (captions: CaptionItem[], sequenceId?: string) => void | Promise<void>;
    onApplied?: (captions: CaptionItem[], sequenceId?: string,options?:{captionIds?:string[]}) => void | Promise<void>;
    currentTime?: number; selectedId?: string | null;
    onBusy?: (busy: boolean) => void; disabled?: boolean;
  }
  let { captions, style, animation, frameWidth, frameHeight, frameRate, duration, sequenceName, sequenceId, tracks = [], hostApi, onUpdated, onApplied, currentTime, selectedId, onBusy, disabled = false }: Props = $props();
  const hasLinkedCaptions = $derived(captions.some(caption => !!caption.clipNodeId));
  let isExporting = $state(false), selectedTrack = $state(-1);
  let progress = $state<ExportProgress | null>(null), error = $state<string | null>(null), status = $state<string | null>(null);
  let controller: AbortController | null = null;
  $effect(() => {
    if (!tracks.some(track => track.index === selectedTrack && !track.locked)) {
      const empty = tracks.filter(track => !track.locked && track.clips === 0);
      selectedTrack = empty.at(-1)?.index ?? tracks.find(track => !track.locked)?.index ?? -1;
    }
  });
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const sourceKey = () => JSON.stringify({ captions, style, animation, frameWidth, frameHeight, frameRate, duration, sequenceId });

  async function captureProfiles(items:CaptionItem[],id:string):Promise<CaptionItem[]>{
    const linked=items.filter(item=>item.clipNodeId);
    if(!linked.length)return items;
    const result=await hostApi.readCaptionMotion(linked,id);
    if(!result?.ok||!Array.isArray(result.cues))throw new Error('Premiere could not confirm the caption Motion profiles. Select the correct sequence and retry.');
    return items.map(item=>{
      if(!item.clipNodeId)return item;
      const found=result.cues?.find((cue:any)=>cue.id===item.id);
      if(!found?.motionProfile||found.clipNodeId!==item.clipNodeId||found.projectItemId!==item.projectItemId||found.path!==item.mediaPath)throw new Error('A caption timeline link changed while reading Motion. Pull timeline changes before updating it.');
      if(typeof found.motionProfile.signature!=='string'||!found.motionProfile.signature||!Array.isArray(found.motionProfile.samples)||!found.motionProfile.samples.length)throw new Error('Premiere returned an incomplete caption Motion profile. Update after selecting the correct caption clip.');
      return {...item,motionProfile:found.motionProfile};
    });
  }
  const curveMatches=(expected:MotionProfile|undefined,actual:MotionProfile)=>actual.samples.every(sample=>{const value=motionScaleAt(expected,sample.time);return Math.abs(value.scaleX-sample.scaleX)<1e-6&&Math.abs(value.scaleY-sample.scaleY)<1e-6;});
  export async function apply(options:{captionIds?:string[]}={}): Promise<CaptionItem[]> {
    if (isExporting) throw new Error('Caption generation is already running.');
    if (disabled) throw new Error('Wait for the current transcript or timeline operation to finish.');
    if (!captions.length) throw new Error('Transcribe or load captions first.');
    if (hostApi.isDemo) throw new Error('Open the Better Captions panel in Premiere to generate timeline clips.');
    if (selectedTrack < 0) throw new Error('Add an unlocked video track in Premiere and refresh the panel.');
    isExporting = true; onBusy?.(true); error = null; progress = null; controller = new AbortController();
    const source = clone(captions), exportStyle = clone(style), exportAnimation = clone(animation);
    const id = sequenceId, track = selectedTrack, key = sourceKey(), notify = onUpdated;
    try {
      const requested=options.captionIds?new Set(options.captionIds):null;
      if(requested&&(!requested.size||[...requested].some(captionId=>!source.some(caption=>caption.id===captionId))))throw new Error('Choose an existing caption to update.');
      const aligned = planCaptionFrames(source, frameRate, duration).map(cue => cue.caption).filter(caption=>!requested||requested.has(caption.id));
      const captured=await captureProfiles(aligned,id);
      status = 'Checking timeline space…';
      await hostApi.preflightCaptionClips(captured, track, id);
      status = 'Rendering transparent caption clips…';
      const rendered = await exportFrames(captured, exportStyle, exportAnimation, frameWidth, frameHeight, frameRate, duration, {
        begin: captionId => hostApi.beginCaption(captionId, id),
        write: (folder, frames, start) => hostApi.saveCaptionFrames(folder, frames, start, id),
        finish: (folder, fps, count,bounds) => hostApi.finishCaption(folder, fps, count, id,bounds),
      }, value => { progress = value; }, controller.signal);
      if (controller.signal.aborted) throw new Error('Caption generation cancelled before timeline changes.');
      if (key !== sourceKey()) throw new Error('The captions, style, or active sequence changed while rendering. Apply again with the current edits.');
      const checked=await captureProfiles(captured,id);
      if(checked.some(caption=>caption.motionProfile?.signature!==captured.find(old=>old.id===caption.id)?.motionProfile?.signature))throw new Error('The caption box size or its keyframes changed while rendering. Stop resizing, then update again.');
      if(controller.signal.aborted)throw new Error('Caption generation cancelled before timeline changes.');
      status = 'Applying clips to Premiere…'; progress = null;
      const applied = await hostApi.applyCaptionClips(rendered, track, id, source);
      if (!applied?.ok || applied.cues?.length !== rendered.length) throw new Error('Premiere did not confirm every caption clip. Review the timeline before retrying.');
      let changed = rendered.map(caption => {
        const clip = applied.cues.find((entry: any) => entry.id === caption.id);
        if (!clip) throw new Error('A caption timeline link was missing from Premiere readback.');
        return { ...caption, clipNodeId: clip.clipNodeId, projectItemId: clip.projectItemId, mediaPath: clip.path, startTime: clip.start, endTime: clip.end,
          motionProfile:clip.motionProfile&&curveMatches(caption.motionProfile,clip.motionProfile)?clip.motionProfile:caption.motionProfile };
      });
      const merge=()=>source.map(caption=>changed.find(update=>update.id===caption.id)??caption);
      let updated=merge();
      // Save links immediately, so an interrupted later readback cannot cause duplicate inserts.
      await notify?.(updated, id);
      status = 'Verifying timeline clips…';
      const readback = await hostApi.readTimeline(changed, id);
      for (const caption of changed) {
        const clip = readback.cues.find((entry: any) => entry.id === caption.id);
        if (!clip || clip.missing || clip.path !== caption.mediaPath || Math.abs(clip.start - caption.startTime) > 1e-6 || Math.abs(clip.end - caption.endTime) > 1e-6) throw new Error('A caption clip changed during verification. Pull timeline changes before applying again.');
      }
      const liveProfiles=await captureProfiles(changed,id);
      changed=changed.map(caption=>{
        const live=liveProfiles.find(item=>item.id===caption.id)?.motionProfile;
        if(!live||!curveMatches(caption.motionProfile,live))throw new Error('The caption clips were applied and saved, but their native box size changed again. Finish resizing, then update the Program Monitor.');
        return {...caption,motionProfile:live};
      });
      updated=merge();await notify?.(updated,id);
      await onApplied?.(updated, id,options);
      status = 'Refreshing Premiere Program Monitor…';
      try {
        const selection=options.captionIds&&typeof hostApi.readCaptionSelection==='function'?await hostApi.readCaptionSelection(updated,id):null;
        if(selection&&!selection.ok)throw new Error('Premiere could not confirm its current caption selection.');
        const selected=selection?changed.find(caption=>caption.id===selection.captionId):changed.find(caption=>caption.id===selectedId)??changed[0];
        // An automatic reflow must not take selection back if the user moved
        // to another native clip while the replacement movie was rendering.
        if(selected){
          await refreshProgramMonitor(hostApi, [selected], id, { currentTime, selectedId:selected.id, frameRate, duration });
          if(typeof hostApi.selectCaptionClip==='function')await hostApi.selectCaptionClip(selected,id);
        }
      }
      catch (problem) { throw new Error('The captions were applied and saved, but the Program Monitor could not be refreshed. ' + (problem instanceof Error ? problem.message : String(problem))); }
      status = `${changed.length} caption ${changed.length === 1 ? 'clip' : 'clips'} updated in the Program Monitor for ${sequenceName}.`;
      return updated;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Caption generation failed.';
      status = null; throw failure;
    } finally { isExporting = false; progress = null; controller = null; onBusy?.(false); }
  }
  async function handleApply() { try { await apply(); } catch { /* Display the actionable error below. */ } }
  function cancel() { controller?.abort(); }
</script>

<div class="caption-export">
  {#if !captions.length || captions.some(caption => !caption.clipNodeId)}
  <label class="caption-field">
    Caption track
    <select bind:value={selectedTrack} disabled={disabled || isExporting || hostApi.isDemo} title="Place new captions on a video track above the footage.">
      {#if tracks.length === 0}<option value={-1}>Refresh to load Premiere tracks</option>{/if}
      {#each tracks as track}
        <option value={track.index} disabled={track.locked}>V{track.index + 1} · {track.name}{track.locked ? ' · locked' : track.clips === 0 ? ' · empty' : ` · ${track.clips} clips`}</option>
      {/each}
    </select>
  </label>
  {/if}
  <button class="caption-button caption-button--primary caption-export__apply" onclick={handleApply} disabled={disabled || isExporting || !captions.length || hostApi.isDemo || selectedTrack < 0}>
    {isExporting ? `${status ?? 'Generating…'}${progress ? ` ${progress.percent}%` : ''}` : hasLinkedCaptions ? 'Update Program Monitor' : 'Show captions in Program Monitor'}
  </button>
  {#if isExporting && progress}
    <progress class="caption-export__progress" value={progress.current} max={progress.total} aria-label="Caption rendering progress"></progress>
    <button class="caption-button" onclick={cancel}>Cancel before applying</button>
  {/if}
  {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
</div>

<style>
  .caption-export { display: flex; flex-direction: column; gap: var(--caption-space-s); padding: var(--caption-space-m); }
  .caption-export__apply { min-block-size: 2.5rem; }
  .caption-export__progress { inline-size: 100%; block-size: .35rem; accent-color: var(--color-accent); }
</style>
