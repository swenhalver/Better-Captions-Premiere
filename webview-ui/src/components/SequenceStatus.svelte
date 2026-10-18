<script lang="ts">
  import type { SessionState } from "../lib/types";
  interface Props { session: SessionState | null; onRefresh: () => void; onTranscribe: () => void; isDemo?: boolean; isBusy?: boolean; saveStatus?: string; }
  let { session, onRefresh, onTranscribe, isDemo = false, isBusy = false, saveStatus = "" }: Props = $props();
  let linked = $derived(session?.captions.some((caption) => caption.clipNodeId) ?? false);
</script>
<header class="sequence-status">
  <div class="sequence-status__title"><h1>Better Captions</h1>{#if isDemo}<span class="sequence-status__demo">Browser demo</span>{/if}</div>
  <div class="sequence-status__identity">
    <svg class="sequence-status__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="1"/><path d="M6 4.5v11M14 4.5v11M2.5 8h3.5M14 8h3.5M2.5 12h3.5M14 12h3.5"/></svg>
    <div class="sequence-status__name">{isDemo ? "A little more human · Sample sequence" : session?.sequenceName ?? "No active sequence"}<span class="sequence-status__detail">{session ? `${session.frameWidth} × ${session.frameHeight} · ${Number(session.frameRate.toFixed(3))} fps` : "Open a sequence in Premiere Pro"}</span></div>
    <button class="caption-button caption-button--icon" onclick={onRefresh} disabled={isBusy} aria-label="Refresh sequence" title="Refresh sequence without replacing caption edits"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .3 5M16 3v4h-4"/></svg></button>
  </div>
  <div class="sequence-status__actions">
    <button class="caption-button" onclick={onTranscribe} disabled={isDemo || isBusy || !session || linked} title={isDemo ? "Available in the installed Premiere panel" : linked ? "Edit the linked transcript below" : "Use Premiere’s built-in Speech to Text"}>{session?.isLoading ? "Transcribing…" : "Transcribe in Premiere"}</button>
    <span class="sequence-status__state" role="status">{session?.isLoading ? "Reading timed words…" : saveStatus === "Saving changes…" ? "Saving…" : saveStatus === "Save failed" ? "Save failed" : session?.hasTranscript ? `${session.captions.length} captions` : "No transcript"}</span>
  </div>
  {#if isDemo}<p class="sequence-status__notice">Synthetic captions. Native actions require Premiere.</p>{/if}
</header>
<style>
  .sequence-status { flex-shrink: 0; padding: var(--caption-space-m) var(--caption-space-l); border-block-end: 1px solid var(--color-panel-border); background: var(--color-surface); }
  .sequence-status__title { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-s); margin-block-end: var(--caption-space-s); }
  .sequence-status__title h1 { font-size: var(--caption-type-m); font-weight: 600; }
  .sequence-status__demo { font-size: var(--caption-type-xs); color: var(--color-panel-secondary); border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); padding: .1rem .4rem; }
  .sequence-status__identity { display: flex; align-items: center; gap: var(--caption-space-s); margin-block-end: var(--caption-space-m); }
  .sequence-status__icon { inline-size: 1.45rem; block-size: 1.45rem; color: var(--color-panel-secondary); flex-shrink: 0; }
  .sequence-status__name { flex: 1; font-weight: 600; min-inline-size: 0; overflow-wrap: anywhere; }
  .sequence-status__detail { display: block; font-size: var(--caption-type-xs); font-weight: 400; color: var(--color-panel-secondary); margin-block-start: .1rem; font-variant-numeric: tabular-nums; }
  .sequence-status__actions { display: flex; align-items: center; gap: var(--caption-space-s); }
  .sequence-status__actions > button { flex: 1; }
  .sequence-status__state { font-size: var(--caption-type-xs); color: var(--color-panel-secondary); white-space: nowrap; }
  .sequence-status__notice { margin-block-start: var(--caption-space-s); font-size: var(--caption-type-xs); color: var(--color-panel-secondary); }
</style>
