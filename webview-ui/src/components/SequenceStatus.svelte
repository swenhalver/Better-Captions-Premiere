<script lang="ts">
  import type { SessionState } from "../lib/types";
  interface Props {
    session: SessionState | null; onRefresh: () => void; onTranscribe: () => void;
    isDemo?: boolean; isBusy?: boolean; saveStatus?: string;
  }
  let { session, onRefresh, onTranscribe, isDemo = false, isBusy = false, saveStatus = "" }: Props = $props();
  let linked = $derived(session?.captions.some((caption) => caption.clipNodeId) ?? false);
</script>
<header class="sequence-status">
  <div class="sequence-status__identity"><span class="sequence-status__dot" class:sequence-status__dot--ready={session?.hasTranscript} aria-hidden="true"></span><div class="sequence-status__name">{session?.sequenceName ?? "No active sequence"}<span class="sequence-status__detail">{session ? `${session.frameWidth} × ${session.frameHeight} · ${Number(session.frameRate.toFixed(3))} fps` : "Open a sequence in Premiere Pro"}</span></div></div>
  <div class="sequence-status__actions"><button class="caption-button" onclick={onRefresh} disabled={isBusy} title="Refresh sequence information without replacing edited captions">Refresh</button><button class="caption-button caption-button--primary" onclick={onTranscribe} disabled={isDemo || isBusy || !session || linked} title={isDemo ? "Native transcription is available in the Premiere panel" : linked ? "Existing timeline captions are linked. Edit the transcription below." : session?.hasTranscript ? "Create or import Premiere’s native timed transcript for this sequence" : "Use Premiere’s built-in Speech to Text for the current sequence"}>{session?.isLoading ? "Transcribing…" : session?.hasTranscript ? "Native transcript" : "Transcribe in Premiere"}</button></div>
  <p class="sequence-status__state" role="status">{isDemo ? "Interactive preview · open the installed panel for transcription and timeline actions" : session?.isLoading ? "Creating or importing Premiere’s native timed transcript…" : saveStatus || (session?.hasTranscript ? "Transcript ready" : "Ready for Premiere Speech to Text")}</p>
</header>
<style>
  .sequence-status { flex-shrink: 0; padding: var(--caption-space-m); background: var(--color-surface); border-block-end: 1px solid var(--color-panel-border); }
  .sequence-status__identity { display: flex; align-items: center; gap: var(--caption-space-s); margin-block-end: var(--caption-space-m); }
  .sequence-status__dot { inline-size: .55rem; block-size: .55rem; flex-shrink: 0; border-radius: 50%; background: var(--color-panel-secondary); }
  .sequence-status__dot--ready { background: var(--color-success); }
  .sequence-status__name { font-size: .95rem; font-weight: 600; min-inline-size: 0; overflow-wrap: anywhere; }
  .sequence-status__detail { display: block; font-size: .75rem; font-weight: 400; color: var(--color-panel-secondary); margin-block-start: var(--caption-space-xs); }
  .sequence-status__actions { display: flex; gap: var(--caption-space-s); & > button { flex: 1; } }
  .sequence-status__state { font-size: .75rem; color: var(--color-panel-secondary); margin-block-start: var(--caption-space-s); }
</style>
