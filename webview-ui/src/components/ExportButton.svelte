<script lang="ts">
  import type { CaptionItem, StyleConfig, AnimationConfig, SequenceInfo,MotionProfile } from '../lib/types';
  import { exportFrames, planCaptionFrames,motionScaleAt, type ExportProgress } from '../lib/export/exporter';
  import { refreshProgramMonitor } from '../lib/export/program-monitor';
  import { bundleCaptionContainers, needsLegacyConsolidation, consolidationDraft } from '../lib/export/containers';
  import { restoreDeletedCaptionLinks } from '../lib/export/deleted-links';
  import { retryableNativeRead } from '../lib/live-output';
  import type { NativeGraphicsGenerationResult } from '../lib/native-graphics/generate';

  interface Props {
    captions: CaptionItem[]; style: StyleConfig; animation: AnimationConfig;
    frameWidth: number; frameHeight: number; frameRate: number; duration: number;
    sequenceName: string; sequenceId: string; tracks?: SequenceInfo['tracks']; hostApi: any;
    onUpdated?: (captions: CaptionItem[], sequenceId?: string) => void | Promise<void>;
    onApplied?: (captions: CaptionItem[], sequenceId?: string,options?:{captionIds?:string[]}) => void | Promise<void>;
    currentTime?: number; selectedId?: string | null;
    onBusy?: (busy: boolean) => void; disabled?: boolean;
    onPhase?: (phase: 'idle' | 'preparing' | 'rendering' | 'committing') => void;
    liveStatus?: { phase: string; message: string };
    transcriptJson?: unknown;
    nativeGraphics?: { exporting: boolean; result: NativeGraphicsGenerationResult | null; failure: string | null; attempted: boolean; projectReviewed: boolean };
    onCreateNativeGraphics?: (sequenceId: string) => Promise<void>;
    onNativeProjectReviewed?: (reviewed: boolean) => void;
  }
  let { captions, style, animation, frameWidth, frameHeight, frameRate, duration, sequenceName, sequenceId, tracks = [], hostApi, onUpdated, onApplied, currentTime, selectedId, onBusy, onPhase, liveStatus, disabled = false,
    nativeGraphics = { exporting: false, result: null, failure: null, attempted: false, projectReviewed: false }, onCreateNativeGraphics, onNativeProjectReviewed }: Props = $props();
  let isExporting = $state(false), selectedTrack = $state(-1);
  let nativeExporting = $derived(nativeGraphics.exporting);
  let nativeResult = $derived(nativeGraphics.result);
  let nativeFailure = $derived(nativeGraphics.failure);
  let nativeAttempted = $derived(nativeGraphics.attempted);
  let nativeNeedsReview = $derived(Boolean(nativeFailure) || nativeResult?.status === 'import-unconfirmed');
  let nativeNotes = $derived(nativeWarningSummaries(nativeResult?.warnings));
  let trackSequenceId = $state<string | null>(null);
  let progress = $state<ExportProgress | null>(null), error = $state<string | null>(null), status = $state<string | null>(null);
  let controller: AbortController | null = null;
  let phase = $state<'idle' | 'preparing' | 'rendering' | 'committing'>('idle'), superseded = false;
  const setPhase = (value: typeof phase) => { phase = value; onPhase?.(value); };
  const replaced = () => Object.assign(new Error('A newer caption edit replaced this render.'), { code: 'BC_RENDER_SUPERSEDED' });
  export function supersede() { if (isExporting && phase !== 'committing') { superseded = true; controller?.abort(); } }
  $effect(() => {
    if (trackSequenceId !== sequenceId) {
      trackSequenceId = sequenceId;
      selectedTrack = -1;
    } else if (selectedTrack >= 0 && !tracks.some(track => track.index === selectedTrack && !track.locked)) {
      selectedTrack = -1;
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
  export async function apply(options:{captionIds?:string[]; automatic?:boolean}={}): Promise<CaptionItem[]> {
    if (isExporting) throw new Error('Caption generation is already running.');
    if (disabled) throw new Error('Wait for the current transcript or timeline operation to finish.');
    if (!captions.length) throw new Error('Transcribe or load captions first.');
    if (hostApi.isDemo) throw new Error('Open the Better Captions panel in Premiere to generate timeline clips.');
    if (!Number.isInteger(selectedTrack) || selectedTrack < -1) throw new Error('Choose an automatic or unlocked caption track.');
    const exportStyle = clone(style), exportAnimation = clone(animation);
    const id = sequenceId, track = selectedTrack, key = sourceKey(), notify = onUpdated;
    let timelineWriteStarted = false, timelineWriteConfirmed = false;
    isExporting = true; superseded = false; setPhase('preparing'); onBusy?.(true); error = null; progress = null; controller = new AbortController();
    try {
      const snapshot=clone(captions);
      const linked=snapshot.filter(caption=>caption.clipNodeId);
      const recovery=!options.captionIds && linked.length
        ? restoreDeletedCaptionLinks(snapshot,await hostApi.readTimeline(linked,id))
        : {captions:snapshot,deletedLinks:[]};
      if(key!==sourceKey())throw options.automatic ? replaced() : new Error('The captions or active sequence changed while reading the timeline. Try again with the current edits.');
      const previous=recovery.captions, destination=recovery.deletedLinks.length?-1:track;
      // Automatic styling preserves existing native containers and animation.
      // Legacy conversion remains an explicit agent action, never a side effect of typing.
      const consolidate=!options.automatic && !options.captionIds && needsLegacyConsolidation(previous);
      const plan=consolidate?await hostApi.readCaptionConsolidation(previous,id):null;
      if(consolidate && (!plan?.ok || !plan.bounds || !plan.motionProfile))throw new Error('Premiere could not verify the legacy caption positions and sizes.');
      const source = clone(consolidate?consolidationDraft(previous,exportStyle.maxChars,plan):bundleCaptionContainers(previous, exportStyle.maxChars, recovery.deletedLinks.length > 0));
      if(consolidate)exportStyle.maxWidth=plan.bounds.width/frameWidth;
      const requested=options.captionIds?new Set(options.captionIds):null;
      if(requested&&(!requested.size||[...requested].some(captionId=>!source.some(caption=>caption.id===captionId))))throw new Error('Choose an existing caption to update.');
      const aligned = planCaptionFrames(source, frameRate, duration).map(cue => cue.caption).filter(caption=>!requested||requested.has(caption.id));
      const captured=await captureProfiles(aligned,id);
      status = 'Checking timeline space…';
      await hostApi.preflightCaptionClips(captured, consolidate?-1:destination, id, recovery.deletedLinks);
      status = 'Rendering transparent caption clips…';
      setPhase('rendering');
      const rendered = await exportFrames(captured, exportStyle, exportAnimation, frameWidth, frameHeight, frameRate, duration, {
        begin: captionId => hostApi.beginCaption(captionId, id),
        write: (folder, frames, start) => hostApi.saveCaptionFrames(folder, frames, start, id),
        finish: (folder, fps, count,bounds) => hostApi.finishCaption(folder, fps, count, id,bounds),
      }, value => { progress = value; }, controller.signal);
      if (superseded || options.automatic && key !== sourceKey()) throw replaced();
      if (controller.signal.aborted) throw new Error('Caption generation cancelled before timeline changes.');
      if (key !== sourceKey()) throw new Error('The captions, style, or active sequence changed while rendering. Try again with the current edits.');
      const checked=await captureProfiles(captured,id);
      if(checked.some(caption=>caption.motionProfile?.signature!==captured.find(old=>old.id===caption.id)?.motionProfile?.signature))throw new Error('The caption box size or its keyframes changed while rendering. Stop resizing, then update again.');
      if(superseded || options.automatic && key !== sourceKey())throw replaced();
      if(controller.signal.aborted)throw new Error('Caption generation cancelled before timeline changes.');
      status = 'Applying clips to Premiere…'; progress = null;
      setPhase('committing');
      timelineWriteStarted = true;
      const applied = consolidate?await hostApi.applyConsolidatedCaption(rendered[0],previous,plan,id):await hostApi.applyCaptionClips(rendered, destination, id, source, recovery.deletedLinks);
      if (!applied?.ok || applied.cues?.length !== rendered.length) throw new Error('Premiere did not confirm every caption clip. Review the timeline before retrying.');
      timelineWriteConfirmed = true;
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
          await refreshProgramMonitor(hostApi, [selected], id, { currentTime, selectedId:selected.id, frameRate, duration, preservePlayhead: options.automatic });
          if(!options.automatic && typeof hostApi.selectCaptionClip==='function')await hostApi.selectCaptionClip(selected,id);
        }
      }
      catch (problem) { throw new Error('The captions were applied and saved, but the Program Monitor could not be refreshed. ' + (problem instanceof Error ? problem.message : String(problem))); }
      status = `${changed.length} caption ${changed.length === 1 ? 'clip' : 'clips'} updated in the Program Monitor for ${sequenceName}.`;
      return updated;
    } catch (failure) {
      if (superseded && phase !== 'committing') throw replaced();
      if (timelineWriteStarted && (timelineWriteConfirmed || !retryableNativeRead(failure))) {
        const detail = failure instanceof Error ? failure.message : String(failure);
        const problem = Object.assign(new Error(timelineWriteConfirmed
          ? 'The captions were placed, but Premiere has not confirmed the final check. Automatic updates are paused to avoid repeating that change. Your edits are saved.'
          : 'Premiere has not confirmed the last caption update. Automatic updates are paused to prevent duplicate clips. Your edits are saved; check the timeline before reconnecting.'),
        { code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: timelineWriteConfirmed, detail: detail.slice(0, 1000) });
        error = options.automatic ? null : problem.message;
        status = null;
        throw problem;
      }
      error = options.automatic ? null : failure instanceof Error ? failure.message : 'Caption generation failed.';
      status = null; throw failure;
    } finally { isExporting = false; progress = null; controller = null; setPhase('idle'); onBusy?.(false); }
  }
  function cancel() { controller?.abort(); }

  function compactNativeMessage(message: string) {
    const text = message.replace(/^\s*Error:\s*/, '').replace(/\s+/g, ' ').trim();
    return text.length > 180 ? text.slice(0, 177).trimEnd() + '…' : text;
  }

  function nativeWarningSummaries(warnings: unknown) {
    if (!Array.isArray(warnings)) return { items: [], remaining: 0, receiptUnsaved: false };
    const notes = new Set<string>();
    let receiptUnsaved = false;
    // Runtime warnings follow the baseline disclosure; show those first.
    for (const warning of warnings.slice(-32).reverse()) {
      if (typeof warning !== 'string') continue;
      if (warning.includes('import-result.json')) receiptUnsaved = true;
      if (/^(Import graphics\.xml|Titles start at the center\.|Past\/current\/next|Native edits are independent\.|Import confirmed the new sequence identity|Do not automatically retry|The import outcome is uncertain\.)/.test(warning)) continue;
      const weight = /^Weight (\d+) is requested as (Bold|Regular)/.exec(warning);
      const note = warning.startsWith('Only phrase text,') ? 'Premiere may substitute missing fonts.'
        : warning.startsWith('Font-size normalization') ? 'Font size is calibrated for Premiere 26.5.2 at 1080p. Check other frame sizes and hosts.'
        : weight ? `Font weight ${weight[1]} uses ${weight[2]}.`
        : warning.includes('import-result.json') ? 'The import receipt could not be saved. Keep the saved XML path before closing this panel.'
        : compactNativeMessage(warning);
      if (note) notes.add(note);
    }
    const items = [...notes];
    return { items: items.slice(0, 4), remaining: Math.max(0, items.length - 4), receiptUnsaved };
  }

  async function createNativeGraphics() {
    if (disabled || isExporting || nativeExporting || !captions.length || hostApi.isDemo || typeof hostApi.generateNativeGraphics !== 'function' || nativeNeedsReview && !nativeGraphics.projectReviewed) return;
    await onCreateNativeGraphics?.(sequenceId);
  }
</script>

<div class="caption-export">
  {#if !captions.length || captions.some(caption => !caption.clipNodeId)}
  <label class="caption-field caption-export__track">
    Caption track
    <select bind:value={selectedTrack} disabled={disabled || isExporting || hostApi.isDemo} title="Automatic placement creates a track above the footage when needed.">
      <option value={-1}>{hostApi.isDemo ? 'Automatic · available in Premiere' : 'Automatic · above footage'}</option>
      {#each tracks as track}
        <option value={track.index} disabled={track.locked}>V{track.index + 1} · {track.name}{track.locked ? ' · locked' : track.clips === 0 ? ' · empty' : ` · ${track.clips} clips`}</option>
      {/each}
    </select>
  </label>
  {/if}
  {#if captions.length && liveStatus?.phase !== 'error'}<p class="caption-export__live" role="status" aria-live="polite">{hostApi.isDemo ? 'Live captions · available in Premiere' : nativeExporting ? 'Creating native graphics…' : isExporting ? `${phase === 'committing' ? 'Updating video…' : 'Rendering…'}${progress ? ` ${progress.percent}%` : ''}` : liveStatus?.message || 'Live captions'}</p>{/if}
  {#if isExporting && progress}
    <progress class="caption-export__progress" value={progress.current} max={progress.total} aria-label="Caption rendering progress"></progress>
    <button class="caption-button" onclick={cancel}>Cancel before applying</button>
  {/if}
  <details class="caption-export__native">
    <summary>Native graphics <span>Experimental</span></summary>
    <p>Creates a separate sequence with editable phrases, font, size and fill. Native edits are independent of live caption updates.</p>
    <p>Saved placement, box dimensions and wrapping are not transferred. Word styles, stroke, shadow, bubbles and animation stay in the source settings.</p>
    <p>Import checks only sequence identity and settings. Inspect text, timing and styling in Premiere before use.</p>
    {#if hostApi.isDemo}<p>Available in Premiere.</p>{:else if typeof hostApi.generateNativeGraphics !== 'function'}<p>Update the Better Captions service to enable native graphics.</p>{:else if !captions.length}<p>Transcribe or load captions first.</p>{/if}
    {#if nativeFailure}
      <p class="caption-export__warning" role="alert">The last creation could not be confirmed. A sequence may already exist in the Project panel. {nativeFailure}</p>
    {/if}
    {#if nativeResult}
      <p class:caption-export__warning={nativeResult.status === 'import-unconfirmed'} role="status" aria-live="polite">{nativeResult.status === 'imported' ? `Created “${nativeResult.nativeSequence?.name ?? 'Native graphics'}”. Sequence identity and settings confirmed; inspect the graphics visually before use.` : nativeResult.status === 'import-unconfirmed' ? 'The import is unconfirmed. A sequence may already exist in the Project panel. The XML and source settings are saved.' : 'The XML and source settings are saved. Import the XML through Premiere’s File menu.'}</p>
      {#if nativeNotes.items.length}
        <ul class="caption-export__notes" aria-label="Native graphics warnings">
          {#each nativeNotes.items as note}<li>{note}</li>{/each}
          {#if nativeNotes.remaining}<li>{nativeNotes.remaining} more warnings were returned. Inspect this sequence before use.</li>{/if}
        </ul>
      {/if}
      {#if nativeResult.status !== 'imported' || nativeNotes.receiptUnsaved}
        <label class="caption-field">Saved XML<input readonly value={nativeResult.artifacts.xml} title={nativeResult.artifacts.xml} onclick={(event) => event.currentTarget.select()} /></label>
      {/if}
    {/if}
    {#if nativeNeedsReview}
      <p class="caption-export__warning">Check the Project panel first. Creating another sequence may duplicate the previous attempt.</p>
      <label class="caption-export__review"><input type="checkbox" checked={nativeGraphics.projectReviewed} onchange={(event) => onNativeProjectReviewed?.(event.currentTarget.checked)} disabled={disabled || isExporting || nativeExporting} />I checked the Project panel.</label>
    {/if}
    <button class="caption-button" onclick={createNativeGraphics} disabled={disabled || isExporting || nativeExporting || !captions.length || hostApi.isDemo || typeof hostApi.generateNativeGraphics !== 'function' || !onCreateNativeGraphics || nativeNeedsReview && !nativeGraphics.projectReviewed}>{nativeExporting ? 'Creating native graphics…' : nativeAttempted ? 'Create another sequence' : 'Create native graphics'}</button>
  </details>
  {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
</div>

<style>
  .caption-export { display: flex; flex-direction: column; gap: var(--caption-space-s); padding: var(--caption-space-m) var(--caption-space-l); }
  .caption-export__live { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin: 0; }
  .caption-export__track { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--caption-space-m); }
  .caption-export__progress { inline-size: 100%; block-size: .35rem; accent-color: var(--color-accent); }
  .caption-export__native { border-block-start: 1px solid var(--color-panel-border); padding-block-start: var(--caption-space-s); }
  .caption-export__native summary { cursor: pointer; font-size: var(--caption-type-s); }
  .caption-export__native summary span { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin-inline-start: var(--caption-space-s); }
  .caption-export__native p { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin-block: var(--caption-space-s); overflow-wrap: anywhere; }
  .caption-export__native .caption-export__warning { color: var(--color-warning); }
  .caption-export__notes { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); padding-inline-start: var(--caption-space-l); margin-block: var(--caption-space-s); overflow-wrap: anywhere; }
  .caption-export__notes li + li { margin-block-start: var(--caption-space-xs); }
  .caption-export__review { display: flex; align-items: center; gap: var(--caption-space-s); font-size: var(--caption-type-xs); margin-block: var(--caption-space-s); }
  .caption-export__review input { flex: none; inline-size: auto; min-block-size: 0; margin: 0; }
  .caption-export__native .caption-button { inline-size: 100%; }
</style>
