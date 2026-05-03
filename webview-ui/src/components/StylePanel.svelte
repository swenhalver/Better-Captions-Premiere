<script lang="ts">
  import { onMount } from "svelte";
  import type { StyleConfig } from "../lib/types";

  interface Props {
    style: StyleConfig;
    onUpdate: (updates: Partial<StyleConfig>) => void;
  }

  let { style, onUpdate }: Props = $props();

  let localStyle = $state<StyleConfig>({ ...style });

  $effect(() => {
    localStyle = { ...style };
  });

  function handleUpdate(updates: Partial<StyleConfig>) {
    localStyle = { ...localStyle, ...updates };
    onUpdate(updates);
  }

  let isOpen = $state(true);
  let isBgOpen = $state(true);
  let isShadowOpen = $state(true);

  let systemFonts = $state<string[]>([]);

  const fallbackFonts = [
    "Arial",
    "Helvetica",
    "Inter",
    "Roboto",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Verdana",
    "Impact",
    "Comic Sans MS",
    "Montserrat",
    "Oswald",
    "Bebas Neue",
  ];

  onMount(async () => {
    try {
      if ("queryLocalFonts" in window) {
        const fonts = await (window as any).queryLocalFonts();
        const families = new Set<string>();
        for (const font of fonts) {
          families.add(font.family);
        }
        systemFonts = [...families].sort((a, b) => a.localeCompare(b));
      }
    } catch {
      systemFonts = [];
    }
  });

  let availableFonts = $derived(systemFonts.length > 0 ? systemFonts : fallbackFonts);

  const textTransforms = [
    { value: "none", label: "Aa" },
    { value: "uppercase", label: "AA" },
    { value: "lowercase", label: "aa" },
  ] as const;
</script>

<div class="border-b border-panel-border">
  <button
    onclick={() => (isOpen = !isOpen)}
    class="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-panel-secondary font-semibold bg-surface hover:bg-panel-hover-bg transition-colors cursor-pointer border-none"
  >
    <span>Font & Style</span>
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
    <div class="px-3 py-2.5 space-y-3">
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Font</span>
          <select
            value={localStyle.fontFamily}
            onchange={(e) => handleUpdate({ fontFamily: (e.target as HTMLSelectElement).value })}
            class="bg-surface-raised text-panel-text text-[13px] px-2 py-1.5 rounded border border-panel-border focus:border-accent outline-none"
          >
            {#each availableFonts as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Size</span>
          <input
            type="number"
            value={localStyle.fontSize}
            min={8}
            max={500}
            step={1}
            onchange={(e) => handleUpdate({ fontSize: Number((e.target as HTMLInputElement).value) })}
            class="bg-surface-raised text-panel-text text-[13px] px-2 py-1.5 rounded border border-panel-border focus:border-accent outline-none w-full"
          />
        </label>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Weight</span>
          <select
            value={localStyle.fontWeight}
            onchange={(e) => handleUpdate({ fontWeight: Number((e.target as HTMLSelectElement).value) })}
            class="bg-surface-raised text-panel-text text-[13px] px-2 py-1.5 rounded border border-panel-border focus:border-accent outline-none"
          >
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={600}>Semi Bold</option>
            <option value={700}>Bold</option>
            <option value={800}>Extra Bold</option>
            <option value={900}>Black</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-[12px] text-panel-secondary">Transform</span>
          <div class="flex rounded border border-panel-border overflow-hidden">
            {#each textTransforms as tt}
              <button
                onclick={() => handleUpdate({ textTransform: tt.value })}
                class="flex-1 text-[13px] py-1.5 text-center border-none cursor-pointer transition-colors"
                class:bg-accent={localStyle.textTransform === tt.value}
                class:text-white={localStyle.textTransform === tt.value}
                class:bg-surface-raised={localStyle.textTransform !== tt.value}
                class:text-panel-text={localStyle.textTransform !== tt.value}
              >
                {tt.label}
              </button>
            {/each}
          </div>
        </label>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-[12px] text-panel-secondary">Text Color</span>
        <div class="flex items-center gap-1.5">
          <input
            type="color"
            value={localStyle.textColor}
            oninput={(e) => handleUpdate({ textColor: (e.target as HTMLInputElement).value })}
            class="w-7 h-7 rounded border border-panel-border cursor-pointer p-0"
          />
          <span class="text-[11px] text-panel-secondary">{localStyle.textColor}</span>
        </div>
      </label>

      <!-- Stroke Section -->
      <div class="border border-panel-border rounded overflow-hidden">
        <div class="flex items-center justify-between px-2.5 py-1.5 bg-surface">
          <span class="text-[11px] uppercase tracking-wider text-panel-secondary font-semibold">Stroke</span>
          <button
            onclick={() => handleUpdate({ strokeEnabled: !localStyle.strokeEnabled })}
            class="relative w-7 h-4 rounded-full cursor-pointer border-none"
            style="background:{localStyle.strokeEnabled ? 'var(--color-accent)' : 'var(--color-panel-border)'};transition:background 150ms"
          >
            <span
              class="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
              style="transform:translateX({localStyle.strokeEnabled ? '0.75rem' : '0'});transition:transform 150ms"
            ></span>
          </button>
        </div>
        {#if localStyle.strokeEnabled}
          <div class="px-2.5 py-2 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Color</span>
                <input
                  type="color"
                  value={localStyle.strokeColor}
                  oninput={(e) => handleUpdate({ strokeColor: (e.target as HTMLInputElement).value })}
                  class="w-7 h-7 rounded border border-panel-border cursor-pointer p-0"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Width</span>
                <input
                  type="number"
                  value={localStyle.strokeWidth}
                  min={0}
                  max={20}
                  step={0.5}
                  onchange={(e) => handleUpdate({ strokeWidth: Number((e.target as HTMLInputElement).value) })}
                  class="bg-surface-raised text-panel-text text-[12px] px-1.5 py-1 rounded border border-panel-border w-full outline-none"
                />
              </label>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] text-panel-secondary">Opacity — {Math.round((localStyle.strokeOpacity ?? 1) * 100)}%</span>
              <input
                type="range"
                value={localStyle.strokeOpacity ?? 1}
                min={0}
                max={1}
                step={0.01}
                oninput={(e) => handleUpdate({ strokeOpacity: Number((e.target as HTMLInputElement).value) })}
                class="w-full accent-accent"
              />
            </label>
          </div>
        {/if}
      </div>

      <!-- Background Section -->
      <div class="border border-panel-border rounded overflow-hidden">
        <div class="flex items-center justify-between px-2.5 py-1.5 bg-surface">
          <button
            onclick={() => (isBgOpen = !isBgOpen)}
            class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-panel-secondary font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="transition-transform"
              class:rotate-180={isBgOpen}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Background
          </button>
          <button
            onclick={() => handleUpdate({ backgroundEnabled: !localStyle.backgroundEnabled })}
            class="relative w-7 h-4 rounded-full cursor-pointer border-none"
            style="background:{localStyle.backgroundEnabled ? 'var(--color-accent)' : 'var(--color-panel-border)'};transition:background 150ms"
          >
            <span
              class="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
              style="transform:translateX({localStyle.backgroundEnabled ? '0.75rem' : '0'});transition:transform 150ms"
            ></span>
          </button>
        </div>
        {#if isBgOpen && localStyle.backgroundEnabled}
          <div class="px-2.5 py-2 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Color</span>
                <input
                  type="color"
                  value={localStyle.backgroundColor.startsWith("rgba") ? "#000000" : localStyle.backgroundColor}
                  oninput={(e) => handleUpdate({ backgroundColor: (e.target as HTMLInputElement).value })}
                  class="w-7 h-7 rounded border border-panel-border cursor-pointer p-0"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Padding — {localStyle.backgroundPadding}px</span>
                <input
                  type="range"
                  value={localStyle.backgroundPadding}
                  min={0}
                  max={60}
                  step={1}
                  oninput={(e) => handleUpdate({ backgroundPadding: Number((e.target as HTMLInputElement).value) })}
                  class="w-full accent-accent"
                />
              </label>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] text-panel-secondary">Opacity — {Math.round((localStyle.backgroundOpacity ?? 0.6) * 100)}%</span>
              <input
                type="range"
                value={localStyle.backgroundOpacity ?? 0.6}
                min={0}
                max={1}
                step={0.01}
                oninput={(e) => handleUpdate({ backgroundOpacity: Number((e.target as HTMLInputElement).value) })}
                class="w-full accent-accent"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] text-panel-secondary">Roundness — {localStyle.backgroundRadius}px</span>
              <input
                type="range"
                value={localStyle.backgroundRadius}
                min={0}
                max={15}
                step={1}
                oninput={(e) => handleUpdate({ backgroundRadius: Number((e.target as HTMLInputElement).value) })}
                class="w-full accent-accent"
              />
            </label>
          </div>
        {/if}
      </div>

      <!-- Drop Shadow Section -->
      <div class="border border-panel-border rounded overflow-hidden">
        <div class="flex items-center justify-between px-2.5 py-1.5 bg-surface">
          <button
            onclick={() => (isShadowOpen = !isShadowOpen)}
            class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-panel-secondary font-semibold bg-transparent border-none cursor-pointer p-0"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="transition-transform"
              class:rotate-180={isShadowOpen}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Drop Shadow
          </button>
          <button
            onclick={() => handleUpdate({ shadowEnabled: !localStyle.shadowEnabled })}
            class="relative w-7 h-4 rounded-full cursor-pointer border-none"
            style="background:{localStyle.shadowEnabled ? 'var(--color-accent)' : 'var(--color-panel-border)'};transition:background 150ms"
          >
            <span
              class="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
              style="transform:translateX({localStyle.shadowEnabled ? '0.75rem' : '0'});transition:transform 150ms"
            ></span>
          </button>
        </div>
        {#if isShadowOpen && localStyle.shadowEnabled}
          <div class="px-2.5 py-2 space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Color</span>
                <input
                  type="color"
                  value={localStyle.shadowColor.startsWith("rgba") ? "#000000" : localStyle.shadowColor}
                  oninput={(e) => handleUpdate({ shadowColor: (e.target as HTMLInputElement).value })}
                  class="w-7 h-7 rounded border border-panel-border cursor-pointer p-0"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Blur</span>
                <input
                  type="number"
                  value={localStyle.shadowBlur}
                  min={0}
                  max={30}
                  step={1}
                  onchange={(e) => handleUpdate({ shadowBlur: Number((e.target as HTMLInputElement).value) })}
                  class="bg-surface-raised text-panel-text text-[12px] px-1.5 py-1 rounded border border-panel-border w-full outline-none"
                />
              </label>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-[11px] text-panel-secondary">Opacity — {Math.round((localStyle.shadowOpacity ?? 0.5) * 100)}%</span>
              <input
                type="range"
                value={localStyle.shadowOpacity ?? 0.5}
                min={0}
                max={1}
                step={0.01}
                oninput={(e) => handleUpdate({ shadowOpacity: Number((e.target as HTMLInputElement).value) })}
                class="w-full accent-accent"
              />
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Offset X</span>
                <input
                  type="number"
                  value={localStyle.shadowOffsetX}
                  min={-20}
                  max={20}
                  step={1}
                  onchange={(e) => handleUpdate({ shadowOffsetX: Number((e.target as HTMLInputElement).value) })}
                  class="bg-surface-raised text-panel-text text-[12px] px-1.5 py-1 rounded border border-panel-border w-full outline-none"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[11px] text-panel-secondary">Offset Y</span>
                <input
                  type="number"
                  value={localStyle.shadowOffsetY}
                  min={-20}
                  max={20}
                  step={1}
                  onchange={(e) => handleUpdate({ shadowOffsetY: Number((e.target as HTMLInputElement).value) })}
                  class="bg-surface-raised text-panel-text text-[12px] px-1.5 py-1 rounded border border-panel-border w-full outline-none"
                />
              </label>
            </div>
          </div>
        {/if}
      </div>

    </div>
  {/if}
</div>
