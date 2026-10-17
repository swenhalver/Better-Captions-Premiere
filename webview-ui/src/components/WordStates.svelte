<script lang="ts">
  import type { StyleConfig, WordAppearance } from "../lib/types";
  interface Props {
    style: StyleConfig;
    fonts?: string[];
    onUpdate: (updates: Partial<StyleConfig>) => void;
  }
  let { style, fonts = [], onUpdate }: Props = $props();
  const states = [
    { key: "activeWord", title: "Currently spoken word", description: "Highlight the word being spoken, with an optional rounded bubble." },
    { key: "spokenWord", title: "Previously spoken words", description: "Style words after their individual end time. Upcoming words use the base style." },
  ] as const;
  function update(key: "activeWord" | "spokenWord", patch: Partial<WordAppearance>) {
    onUpdate({ [key]: { ...style[key], ...patch } });
  }
  function value(event: Event) { return (event.target as HTMLInputElement).value; }
  function number(event: Event) { return Number(value(event)); }
</script>

{#each states as state}
  {@const appearance = style[state.key]}
  <details class="caption-section word-states" open>
    <summary class="caption-section__heading">{state.title}</summary>
    <div class="caption-section__body">
      <p class="caption-help">{state.description}</p>
      <div class="caption-controls">
        <label class="caption-field caption-field--wide">
          <span>Font family</span>
          <input list="{state.key}-fonts" value={appearance.fontFamily} placeholder="Use base font" onchange={(event) => update(state.key, { fontFamily: value(event) })} />
          <datalist id="{state.key}-fonts">{#each fonts as font}<option value={font}></option>{/each}</datalist>
        </label>
        <label class="caption-field">
          <span>Size, % of base</span>
          <input type="number" min="40" max="300" step="5" value={Math.round(appearance.sizeScale * 100)} onchange={(event) => update(state.key, { sizeScale: Math.max(.4, Math.min(3, number(event) / 100)) })} />
        </label>
        <label class="caption-field">
          <span>Weight</span>
          <select value={appearance.fontWeight} onchange={(event) => update(state.key, { fontWeight: number(event) })}>
            {#each [100, 200, 300, 400, 500, 600, 700, 800, 900] as weight}<option value={weight}>{weight}</option>{/each}
          </select>
        </label>
        <label class="caption-field"><span>Text color</span><input type="color" value={appearance.color} oninput={(event) => update(state.key, { color: value(event) })} /></label>
        <label class="caption-field"><span>Text opacity, %</span><input type="number" min="0" max="100" step="5" value={Math.round(appearance.opacity * 100)} onchange={(event) => update(state.key, { opacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
      </div>
      <label class="caption-check"><input type="checkbox" checked={appearance.bubble} onchange={(event) => update(state.key, { bubble: (event.target as HTMLInputElement).checked })} /><span>Word background bubble</span></label>
      {#if appearance.bubble}
        <div class="caption-controls">
          <label class="caption-field"><span>Bubble color</span><input type="color" value={appearance.bubbleColor} oninput={(event) => update(state.key, { bubbleColor: value(event) })} /></label>
          <label class="caption-field"><span>Bubble opacity, %</span><input type="number" min="0" max="100" step="5" value={Math.round(appearance.bubbleOpacity * 100)} onchange={(event) => update(state.key, { bubbleOpacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
          <label class="caption-field"><span>Padding, frame px</span><input type="number" min="0" max="100" step="1" value={appearance.padding} onchange={(event) => update(state.key, { padding: Math.max(0, Math.min(100, number(event))) })} /></label>
          <label class="caption-field"><span>Corner radius, px</span><input type="number" min="0" max="200" step="1" value={appearance.radius} onchange={(event) => update(state.key, { radius: Math.max(0, Math.min(200, number(event))) })} /></label>
        </div>
      {/if}
    </div>
  </details>
{/each}
