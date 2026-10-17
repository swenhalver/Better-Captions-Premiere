<script lang="ts">
  import type { CaptionItem, StyleConfig, AnimationConfig, SequenceInfo } from '../lib/types';
  import { exportFrames, planCaptionFrames, type ExportProgress } from '../lib/export/exporter';

  interface Props {
    captions: CaptionItem[]; style: StyleConfig; animation: AnimationConfig;
    frameWidth: number; frameHeight: number; frameRate: number; duration: number;
    sequenceName: string; sequenceId: string; tracks?: SequenceInfo['tracks']; hostApi: any;
    onUpdated?: (captions: CaptionItem[], sequenceId?: string) => void | Promise<void>;
    onBusy?: (busy: boolean) => void; disabled?: boolean;
  }
  let { captions, style, animation, frameWidth, frameHeight, frameRate, duration, sequenceName, sequenceId, tracks = [], hostApi, onUpdated, onBusy, disabled = false }: Props = $props();
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

  export async function apply(): Promise<CaptionItem[]> {
    if (isExporting) throw new Error('Caption generation is already running.');
    if (disabled) throw new Error('Wait for the current transcript or timeline operation to finish.');
    if (!captions.length) throw new Error('Transcribe or load captions first.');
    if (hostApi.isDemo) throw new Error('Open the Better Captions panel in Premiere to generate timeline clips.');
    if (selectedTrack < 0) throw new Error('Add an unlocked video track in Premiere and refresh the panel.');
    isExporting = true; onBusy?.(true); error = null; progress = null; controller = new AbortController();
    const source = clone(captions), exportStyle = clone(style), exportAnimation = clone(animation);
    const id = sequenceId, track = selectedTrack, key = sourceKey(), notify = onUpdated;
    try {
      const aligned = planCaptionFrames(source, frameRate, duration).map(cue => cue.caption);
      status = 'Checking timeline space…';
      await hostApi.preflightCaptionClips(aligned, track, id);
      status = 'Rendering transparent caption clips…';
      const rendered = await exportFrames(source, exportStyle, exportAnimation, frameWidth, frameHeight, frameRate, duration, {
        begin: captionId => hostApi.beginCaption(captionId, id),
        write: (folder, frames, start) => hostApi.saveCaptionFrames(folder, frames, start, id),
        finish: (folder, fps, count) => hostApi.finishCaption(folder, fps, count, id),
      }, value => { progress = value; }, controller.signal);
      if (controller.signal.aborted) throw new Error('Caption generation cancelled before timeline changes.');
      if (key !== sourceKey()) throw new Error('The captions, style, or active sequence changed while rendering. Apply again with the current edits.');
      status = 'Applying clips to Premiere…'; progress = null;
      const applied = await hostApi.applyCaptionClips(rendered, track, id, source);
      if (!applied?.ok || applied.cues?.length !== rendered.length) throw new Error('Premiere did not confirm every caption clip. Review the timeline before retrying.');
      const updated = rendered.map(caption => {
        const clip = applied.cues.find((entry: any) => entry.id === caption.id);
        if (!clip) throw new Error('A caption timeline link was missing from Premiere readback.');
        return { ...caption, clipNodeId: clip.clipNodeId, projectItemId: clip.projectItemId, mediaPath: clip.path, startTime: clip.start, endTime: clip.end };
      });
      // Save links immediately, so an interrupted later readback cannot cause duplicate inserts.
      await notify?.(updated, id);
      status = 'Verifying timeline clips…';
      const readback = await hostApi.readTimeline(updated, id);
      for (const caption of updated) {
        const clip = readback.cues.find((entry: any) => entry.id === caption.id);
        if (!clip || clip.missing || clip.path !== caption.mediaPath || Math.abs(clip.start - caption.startTime) > 1e-6 || Math.abs(clip.end - caption.endTime) > 1e-6) throw new Error('A caption clip changed during verification. Pull timeline changes before applying again.');
      }
      status = `${updated.length} caption ${updated.length === 1 ? 'clip' : 'clips'} applied to ${sequenceName}.`;
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
  <label class="caption-field">
    New captions on video track
    <select bind:value={selectedTrack} disabled={disabled || isExporting || hostApi.isDemo}>
      {#if tracks.length === 0}<option value={-1}>Refresh to load Premiere tracks</option>{/if}
      {#each tracks as track}
        <option value={track.index} disabled={track.locked}>V{track.index + 1} · {track.name}{track.locked ? ' · locked' : track.clips === 0 ? ' · empty' : ` · ${track.clips} clips`}</option>
      {/each}
    </select>
  </label>
  <button class="caption-button caption-button--primary caption-export__apply" onclick={handleApply} disabled={disabled || isExporting || !captions.length || hostApi.isDemo || selectedTrack < 0}>
    {isExporting ? `${status ?? 'Generating…'}${progress ? ` ${progress.percent}%` : ''}` : 'Apply captions to Premiere'}
  </button>
  {#if isExporting && progress}
    <progress class="caption-export__progress" value={progress.current} max={progress.total} aria-label="Caption rendering progress"></progress>
    <button class="caption-button" onclick={cancel}>Cancel before applying</button>
  {/if}
  <p class="caption-help">Each phrase becomes a transparent clip. Edit its text, word timing, and frame position here, then apply again. Existing clips keep their Premiere Motion settings.</p>
  {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
  {#if status && !isExporting}<p class="caption-message" role="status">{status}</p>{/if}
</div>

<style>
  .caption-export { display: flex; flex-direction: column; gap: var(--caption-space-s); padding: var(--caption-space-m); }
  .caption-export__apply { min-block-size: 2.5rem; }
  .caption-export__progress { inline-size: 100%; block-size: .35rem; accent-color: var(--color-accent); }
</style>
