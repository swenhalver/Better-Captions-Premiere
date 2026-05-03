<script lang="ts">
  import * as webviewAPI from "./webview-api";
  import { setSequenceCallbacks } from "./webview-api";
  import { initWebview } from "./webview-setup";
  import { sessionManager } from "./lib/session/manager.svelte";
  import type { TranscriptJSON, SequenceInfo } from "./lib/types";

  import SequenceStatus from "./components/SequenceStatus.svelte";
  import TranscriptPreview from "./components/TranscriptPreview.svelte";
  import CanvasPreview from "./components/CanvasPreview.svelte";
  import StylePanel from "./components/StylePanel.svelte";
  import AnimationPanel from "./components/AnimationPanel.svelte";
  import ExportButton from "./components/ExportButton.svelte";

  const { api, page } = initWebview(webviewAPI);

  setSequenceCallbacks(
    () => refreshSequence(),
    () => sessionManager.deactivateSequence(),
  );

  refreshSequence();

  async function refreshSequence() {
    try {
      const info = await api.getActiveSequenceInfo();
      if (info) {
        sessionManager.activateSequence(info as SequenceInfo);
        await fetchTranscript();
      } else {
        sessionManager.deactivateSequence();
      }
    } catch (e) {
      console.error("refreshSequence failed:", e);
    }
  }

  async function fetchTranscript() {
    const session = sessionManager.current;
    if (!session) return;

    sessionManager.setLoading(true);
    try {
      const json = await api.fetchTranscriptJSON();
      if (json) {
        const parsed: TranscriptJSON = JSON.parse(json as string);
        sessionManager.setTranscript(parsed);
      } else {
        sessionManager.clearTranscript();
      }
    } catch (e) {
      console.error("fetchTranscript failed:", e);
      sessionManager.clearTranscript();
    }
    sessionManager.setLoading(false);
  }

  function handleTimeChange(time: number) {
    sessionManager.setCurrentTime(time);
  }
</script>

<div class="flex flex-col h-screen overflow-hidden">
  <SequenceStatus session={sessionManager.current} onRefresh={refreshSequence} />

  {#if sessionManager.current}
    {@const session = sessionManager.current}
    <div class="sticky top-0 z-10">
      <CanvasPreview
        captions={session.captions}
        currentTime={session.currentTime}
        duration={session.duration}
        style={session.style}
        animation={session.animation}
        frameWidth={session.frameWidth}
        frameHeight={session.frameHeight}
        onTimeChange={handleTimeChange}
      />
    </div>

    <div class="flex-1 overflow-y-auto">
      <TranscriptPreview
        captions={session.captions}
        currentTime={session.currentTime}
        maxWords={session.style.maxWords}
        onSeek={handleTimeChange}
        onMaxWordsChange={(val) => sessionManager.updateStyle({ maxWords: val })}
      />

      <StylePanel
        style={session.style}
        onUpdate={(updates) => sessionManager.updateStyle(updates)}
      />

      <AnimationPanel
        animation={session.animation}
        onUpdate={(updates) => sessionManager.updateAnimation(updates)}
      />

      <ExportButton
        captions={session.captions}
        style={session.style}
        animation={session.animation}
        frameWidth={session.frameWidth}
        frameHeight={session.frameHeight}
        frameRate={session.frameRate}
        duration={session.duration}
        sequenceName={session.sequenceName}
        hostApi={api}
      />
    </div>
  {:else}
    <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="text-panel-secondary mb-3 opacity-40">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      <p class="text-[12px] text-panel-secondary mb-1">No Active Sequence</p>
      <p class="text-[10px] text-panel-secondary/60">
        Open a sequence in Premiere Pro to get started
      </p>
    </div>
  {/if}
</div>
