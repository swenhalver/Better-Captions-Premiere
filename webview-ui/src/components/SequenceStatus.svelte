<script lang="ts">
  import type { SessionState } from "../lib/types";

  interface Props {
    session: SessionState | null;
    onRefresh: () => void;
  }

  let { session, onRefresh }: Props = $props();
</script>

<div class="flex items-center justify-between px-3 py-2.5 border-b border-panel-border bg-surface">
  {#if session}
    <div class="flex items-center gap-2 min-w-0">
      <div class="w-2.5 h-2.5 rounded-full shrink-0"
        class:bg-success={session.hasTranscript}
        class:bg-warning={!session.hasTranscript && !session.isLoading}
        class:bg-accent={session.isLoading}
      ></div>
      <span class="truncate text-panel-text font-medium text-[13px]">
        {session.sequenceName}
      </span>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if session.hasTranscript}
        <span class="text-[12px] text-success">Transcript ready</span>
      {:else if session.isLoading}
        <span class="text-[12px] text-accent">Loading...</span>
      {:else}
        <span class="text-[12px] text-panel-secondary">No transcript</span>
      {/if}
      <button
        onclick={onRefresh}
        class="p-1.5 rounded hover:bg-panel-hover-bg text-panel-secondary hover:text-panel-hover-text transition-colors"
        title="Refresh transcript"
        aria-label="Refresh transcript"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
        </svg>
      </button>
    </div>
  {:else}
    <div class="flex items-center gap-2">
      <div class="w-2.5 h-2.5 rounded-full bg-panel-secondary shrink-0"></div>
      <span class="text-panel-secondary text-[13px]">No active sequence</span>
    </div>
  {/if}
</div>
