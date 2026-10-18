<script lang="ts">
  import type { StyleConfig } from "../lib/types";
  interface Props { style: StyleConfig; fonts?: string[]; section?: "base" | "effects"; onUpdate: (updates: Partial<StyleConfig>) => void; }
  let { style, fonts = ["Arial", "Helvetica", "Georgia", "Verdana", "Impact"], onUpdate, section = "base" }: Props = $props();
  function value(event: Event) { return (event.target as HTMLInputElement).value; }
  function number(event: Event) { return Number(value(event)); }
  function checked(event: Event) { return (event.target as HTMLInputElement).checked; }
  function wordSpacing(event: Event) { const spacing = (event.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(spacing)) onUpdate({ wordSpacing: Math.max(0, Math.min(300, spacing)) }); }
</script>

<details class="caption-section style-panel" >
  <summary class="caption-section__heading">Caption layout & background</summary>
  <div class="caption-section__body">
    <div class="caption-controls">
      <label class="caption-field"><span>Alignment</span><select value={style.textAlign} onchange={(event) => onUpdate({ textAlign: value(event) as CanvasTextAlign })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label class="caption-field"><span>Line height</span><input type="number" min=".8" max="3" step=".05" value={style.lineHeight} onchange={(event) => onUpdate({ lineHeight: Math.max(.8, Math.min(3, number(event))) })} /></label>
      <label class="caption-field"><span>Word spacing, %</span><input type="number" min="0" max="300" step="5" value={style.wordSpacing ?? 100} title="100% uses the font’s normal space. Bubble and outline clearance is preserved." oninput={wordSpacing} /></label>
      <label class="caption-field"><span>Default case</span><select value={style.textTransform} onchange={(event) => onUpdate({ textTransform: value(event) as StyleConfig['textTransform'] })}><option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="titlecase">Title Case</option></select></label>
      {#if style.wordSpacing === undefined}<button type="button" onclick={() => onUpdate({ wordSpacing: 100 })}>Use normal spacing</button>{/if}
      <label class="caption-field caption-field--wide"><span>Maximum line width — {Math.round(style.maxWidth * 100)}% of frame</span><input type="range" min=".1" max="1" step=".01" value={style.maxWidth} oninput={(event) => onUpdate({ maxWidth: number(event) })} /></label>
    </div>
    <label class="caption-check"><input type="checkbox" checked={style.backgroundEnabled} onchange={(event) => onUpdate({ backgroundEnabled: checked(event) })} /><span>Whole caption background</span></label>
    {#if style.backgroundEnabled}
      <div class="caption-controls">
        <label class="caption-field"><span>Background color</span><input type="color" value={style.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: value(event) })} /></label>
        <label class="caption-field"><span>Background opacity, %</span><input type="number" min="0" max="100" value={Math.round(style.backgroundOpacity * 100)} onchange={(event) => onUpdate({ backgroundOpacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
        <label class="caption-field"><span>Padding, frame px</span><input type="number" min="0" max="100" value={style.backgroundPadding} onchange={(event) => onUpdate({ backgroundPadding: Math.max(0, Math.min(100, number(event))) })} /></label>
        <label class="caption-field"><span>Corner radius, px</span><input type="number" min="0" max="200" value={style.backgroundRadius} onchange={(event) => onUpdate({ backgroundRadius: Math.max(0, Math.min(200, number(event))) })} /></label>
      </div>
    {/if}
  </div>
</details>
