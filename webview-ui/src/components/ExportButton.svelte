<script lang="ts">
  import type { CaptionItem, StyleConfig, AnimationConfig } from "../lib/types";
  import { exportFrames, type ExportProgress } from "../lib/export/exporter";

  interface Props {
    captions: CaptionItem[];
    style: StyleConfig;
    animation: AnimationConfig;
    frameWidth: number;
    frameHeight: number;
    frameRate: number;
    duration: number;
    sequenceName: string;
    hostApi: any;
  }

  let {
    captions,
    style,
    animation,
    frameWidth,
    frameHeight,
    frameRate,
    duration,
    sequenceName,
    hostApi,
  }: Props = $props();

  let isExporting = $state(false);
  let progress = $state<ExportProgress | null>(null);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);

  const BATCH_SIZE = 30;

  async function handleExport() {
    if (isExporting || captions.length === 0) return;
    isExporting = true;
    error = null;
    status = "Rendering frames...";
    progress = { current: 0, total: 0, percent: 0 };

    try {
      const safeName = sequenceName.replace(/[^a-zA-Z0-9-_]/g, "_");
      const folderName = `${safeName}_captions`;

      status = "Preparing output folder...";
      const folderResult = await hostApi.getOutputFolder(folderName);
      if (!folderResult || !folderResult.success) {
        throw new Error(folderResult?.error || "Failed to create output folder");
      }
      const outputFolderPath = folderResult.path;

      status = "Rendering frames...";
      const result = await exportFrames(
        captions,
        style,
        animation,
        frameWidth,
        frameHeight,
        frameRate,
        duration,
        (p) => (progress = p),
      );
      const { frames, exportWidth, exportHeight } = result;

      status = `Saving ${exportWidth}x${exportHeight} frames...`;

      for (let i = 0; i < frames.length; i += BATCH_SIZE) {
        const batch = frames.slice(i, i + BATCH_SIZE);
        const result = await hostApi.saveFrameBatch(batch, outputFolderPath, i, safeName);

        if (!result || !result.success) {
          throw new Error(result?.error || "Failed to save frames to disk");
        }

        progress = {
          current: Math.min(i + BATCH_SIZE, frames.length),
          total: frames.length,
          percent: Math.round((Math.min(i + BATCH_SIZE, frames.length) / frames.length) * 100),
        };
      }

      progress = null;

      status = "Importing to Premiere...";
      const importResult = await hostApi.importImageSequence(outputFolderPath, frameRate, safeName);
      if (importResult && importResult.success) {
        status = "Imported to project!";
        setTimeout(() => (status = null), 4000);
      } else {
        error = importResult?.error || "Import failed";
      }
    } catch (e: any) {
      console.error("[ExportButton] Export failed:", e);
      error = e instanceof Error ? e.message : "Export failed";
    } finally {
      isExporting = false;
      progress = null;
    }
  }
</script>

<div class="px-3 py-3">
  <button
    onclick={handleExport}
    disabled={isExporting || captions.length === 0}
    class="w-full py-2.5 px-4 rounded-md text-[13px] font-semibold transition-all border-none cursor-pointer
      {isExporting
        ? 'bg-panel-border text-panel-secondary cursor-wait'
        : captions.length === 0
          ? 'bg-panel-border text-panel-secondary cursor-not-allowed opacity-50'
          : 'bg-accent hover:bg-accent-hover text-white active:scale-[0.98]'}"
  >
    {#if isExporting && progress}
      <div class="flex items-center justify-center gap-2">
        <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
          <path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>{status} {progress.percent}%</span>
      </div>
    {:else if isExporting}
      <div class="flex items-center justify-center gap-2">
        <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25" />
          <path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>{status || "Processing..."}</span>
      </div>
    {:else}
      Export Captions
    {/if}
  </button>

  {#if error}
    <p class="text-[12px] text-red-400 mt-1.5 px-1">{error}</p>
  {/if}

  {#if status && !isExporting}
    <p class="text-[12px] text-green-400 mt-1.5 px-1 text-center">{status}</p>
  {/if}

</div>
