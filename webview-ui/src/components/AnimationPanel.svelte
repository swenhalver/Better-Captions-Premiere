<script lang="ts">
  import type { AnimationConfig, AnimationPreset } from "../lib/types";
  interface Props { animation: AnimationConfig; onUpdate: (updates: Partial<AnimationConfig>) => void; }
  let { animation, onUpdate }: Props = $props();
  const presets: { value: AnimationPreset; label: string; description: string }[] = [
    { value: "karaoke", label: "Word highlight", description: "Show the whole caption and follow the spoken word." },
    { value: "pop", label: "Word pop", description: "Reveal words as they are spoken, with a brief scale-in." },
    { value: "typewriter", label: "Word reveal", description: "Reveal each word when its timing starts." },
    { value: "fade", label: "Full caption", description: "Show the whole caption with the current word styling." },
  ];
  function number(event: Event) { return Number((event.target as HTMLInputElement).value); }
</script>
<details class="caption-section animation-panel">
  <summary class="caption-section__heading">Animation & fades</summary>
  <div class="caption-section__body">
    <label class="caption-field"><span>Animation</span><select value={animation.preset} onchange={(event) => onUpdate({ preset: (event.target as HTMLSelectElement).value as AnimationPreset })}>{#each presets as preset}<option value={preset.value}>{preset.label}</option>{/each}</select></label>
    <p class="caption-help">{presets.find((preset) => preset.value === animation.preset)?.description}</p>
    <div class="caption-controls">
      <label class="caption-field"><span>Fade in, seconds</span><input type="number" min="0" max="2" step=".05" value={animation.fadeInDuration} onchange={(event) => onUpdate({ fadeInDuration: Math.max(0, Math.min(2, number(event))) })} /></label>
      <label class="caption-field"><span>Fade out, seconds</span><input type="number" min="0" max="2" step=".05" value={animation.fadeOutDuration} onchange={(event) => onUpdate({ fadeOutDuration: Math.max(0, Math.min(2, number(event))) })} /></label>
    </div>
  </div>
</details>
