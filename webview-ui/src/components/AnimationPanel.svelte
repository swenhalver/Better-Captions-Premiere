<script lang="ts">
  import type { AnimationConfig, AnimationPreset } from "../lib/types";

  interface Props {
    animation: AnimationConfig;
    onUpdate: (updates: Partial<AnimationConfig>) => void;
  }

  let { animation, onUpdate }: Props = $props();

  let localAnim = $state<AnimationConfig>({ ...animation });

  $effect(() => {
    localAnim = { ...animation };
  });

  function handleUpdate(updates: Partial<AnimationConfig>) {
    localAnim = { ...localAnim, ...updates };
    onUpdate(updates);
  }

  let isOpen = $state(true);

  const presets: { value: AnimationPreset; label: string; description: string }[] = [
    { value: "fade", label: "Fade", description: "Smooth opacity transition" },
    { value: "pop", label: "Pop", description: "Scale bounce per word" },
    { value: "typewriter", label: "Type", description: "Words appear sequentially" },
    { value: "karaoke", label: "Karaoke", description: "Highlight active word" },
    { value: "bounce", label: "Bounce", description: "Words bounce in" },
  ];
</script>

<div class="border-b border-panel-border">
  <button
    onclick={() => (isOpen = !isOpen)}
    class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-panel-secondary font-semibold bg-surface hover:bg-panel-hover-bg transition-colors cursor-pointer border-none"
  >
    <span>Animation</span>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="transition-transform"
      class:rotate-180={isOpen}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if isOpen}
    <div class="px-3 py-2.5 space-y-2.5">
      <div class="grid grid-cols-5 gap-1.5">
        {#each presets as preset}
          <button
            onclick={() => handleUpdate({ preset: preset.value })}
            class="flex flex-col items-center gap-0.5 py-2 px-1 rounded border cursor-pointer transition-colors"
            style="border-color:{localAnim.preset === preset.value ? 'var(--color-accent)' : 'var(--color-panel-border)'};background:{localAnim.preset === preset.value ? 'rgba(75,156,245,0.15)' : 'var(--color-surface-raised)'}"
            title={preset.description}
          >
            <span
              class="text-[12px] font-medium"
              style="color:{localAnim.preset === preset.value ? 'var(--color-accent)' : 'var(--color-panel-text)'}"
            >
              {preset.label}
            </span>
          </button>
        {/each}
      </div>

      <div class="text-[12px] text-panel-secondary px-0.5">
        {presets.find((p) => p.value === localAnim.preset)?.description}
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Fade In (s)</span>
          <input
            type="number"
            value={localAnim.fadeInDuration}
            min={0}
            max={2}
            step={0.05}
            onchange={(e) =>
              handleUpdate({ fadeInDuration: Number((e.target as HTMLInputElement).value) })}
            class="bg-surface-raised text-panel-text text-[13px] px-2 py-1.5 rounded border border-panel-border focus:border-accent outline-none w-full"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Fade Out (s)</span>
          <input
            type="number"
            value={localAnim.fadeOutDuration}
            min={0}
            max={2}
            step={0.05}
            onchange={(e) =>
              handleUpdate({ fadeOutDuration: Number((e.target as HTMLInputElement).value) })}
            class="bg-surface-raised text-panel-text text-[13px] px-2 py-1.5 rounded border border-panel-border focus:border-accent outline-none w-full"
          />
        </label>
      </div>

      {#if localAnim.preset === "karaoke"}
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Highlight Color</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              value={localAnim.highlightColor}
              oninput={(e) =>
                handleUpdate({ highlightColor: (e.target as HTMLInputElement).value })}
              class="w-7 h-7 rounded border border-panel-border cursor-pointer p-0"
            />
            <span class="text-[12px] text-panel-secondary">{localAnim.highlightColor}</span>
          </div>
        </label>
      {/if}
    </div>
  {/if}
</div>
