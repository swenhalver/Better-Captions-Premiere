<script lang="ts">
  import type { CaptionItem } from "../lib/types";
  import { formatTime } from "../lib/transcript/parser";

  interface Props {
    captions: CaptionItem[];
    currentTime: number;
    maxWords: number;
    onSeek: (time: number) => void;
    onMaxWordsChange: (maxWords: number) => void;
  }

  let { captions, currentTime, maxWords, onSeek, onMaxWordsChange }: Props = $props();

  let activeId = $derived(
    captions.find((c) => currentTime >= c.startTime && currentTime <= c.endTime)?.id ?? null,
  );

  let listEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (activeId && listEl) {
      const el = listEl.querySelector(`[data-id="${activeId}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
</script>

<div class="flex flex-col border-b border-panel-border">
  <div class="px-3 py-2 flex items-center justify-between bg-surface">
    <span class="text-[11px] uppercase tracking-wider text-panel-secondary font-semibold">
      Transcript ({captions.length} captions)
    </span>
    <label class="flex items-center gap-1.5">
      <span class="text-[11px] text-panel-secondary">Max Words</span>
      <input
        type="number"
        value={maxWords}
        min={1}
        max={20}
        step={1}
        onchange={(e) => onMaxWordsChange(Number((e.target as HTMLInputElement).value))}
        class="bg-surface-raised text-panel-text text-[12px] px-1.5 py-0.5 rounded border border-panel-border focus:border-accent outline-none w-12"
      />
    </label>
  </div>
  <div bind:this={listEl} class="max-h-[140px] overflow-y-auto">
    {#each captions as caption (caption.id)}
      <button
        data-id={caption.id}
        onclick={() => onSeek(caption.startTime)}
        class="w-full text-left px-3 py-1.5 grid grid-cols-[auto_1fr] gap-3 hover:bg-panel-hover-bg transition-colors cursor-pointer border-none bg-transparent {caption.id === activeId ? 'bg-accent/15' : ''}"
      >
        <span class="text-[11px] text-panel-secondary font-mono shrink-0 mt-0.5 whitespace-nowrap">
          {formatTime(caption.startTime)}
        </span>
        <span
          class="text-[13px] leading-snug truncate"
          class:text-accent={caption.id === activeId}
          class:font-medium={caption.id === activeId}
          class:text-panel-text={caption.id !== activeId}
        >
          {caption.text}
        </span>
      </button>
    {/each}
    {#if captions.length === 0}
      <div class="px-3 py-4 text-center text-[13px] text-panel-secondary">
        No captions available. Generate a transcript in Premiere Pro first.
      </div>
    {/if}
  </div>
</div>
