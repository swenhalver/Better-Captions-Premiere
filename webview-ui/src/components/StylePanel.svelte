<script lang="ts">
  import type { StyleConfig } from "../lib/types";
  interface Props { style: StyleConfig; fonts?: string[]; section?: "base" | "effects"; onUpdate: (updates: Partial<StyleConfig>) => void; }
  let { style, fonts = ["Arial", "Helvetica", "Georgia", "Verdana", "Impact"], onUpdate, section = "base" }: Props = $props();
  function value(event: Event) { return (event.target as HTMLInputElement).value; }
  function number(event: Event) { return Number(value(event)); }
  function checked(event: Event) { return (event.target as HTMLInputElement).checked; }
</script>

<details class="caption-section style-panel" open={section === "base"}>
  <summary class="caption-section__heading">{section === "base" ? "Base text & upcoming words" : "Outline, shadow & background"}</summary>
  <div class="caption-section__body">
    {#if section === "base"}
    <p class="caption-help">Upcoming words use the base style. Size, alignment and line width set the caption layout.</p>
    <div class="caption-controls">
      <label class="caption-field caption-field--wide"><span>Font family</span><input list="base-fonts" value={style.fontFamily} onchange={(event) => onUpdate({ fontFamily: value(event) })} /><datalist id="base-fonts">{#each fonts as font}<option value={font}></option>{/each}</datalist></label>
      <label class="caption-field"><span>Size, frame px</span><input type="number" min="8" max="400" step="1" value={style.fontSize} onchange={(event) => onUpdate({ fontSize: Math.max(8, Math.min(400, number(event))) })} /></label>
      <label class="caption-field"><span>Weight</span><select value={style.fontWeight} onchange={(event) => onUpdate({ fontWeight: number(event) })}>{#each [100, 200, 300, 400, 500, 600, 700, 800, 900] as weight}<option value={weight}>{weight}</option>{/each}</select></label>
      <label class="caption-field"><span>Text color</span><input type="color" value={style.textColor} oninput={(event) => onUpdate({ textColor: value(event) })} /></label>
      <label class="caption-field"><span>Capitalization</span><select value={style.textTransform} onchange={(event) => onUpdate({ textTransform: value(event) as StyleConfig["textTransform"] })}><option value="none">As transcribed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option></select></label>
      <label class="caption-field"><span>Alignment</span><select value={style.textAlign} onchange={(event) => onUpdate({ textAlign: value(event) as CanvasTextAlign })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label class="caption-field"><span>Line height</span><input type="number" min=".8" max="3" step=".05" value={style.lineHeight} onchange={(event) => onUpdate({ lineHeight: Math.max(.8, Math.min(3, number(event))) })} /></label>
      <label class="caption-field caption-field--wide"><span>Maximum line width — {Math.round(style.maxWidth * 100)}% of frame</span><input type="range" min=".1" max="1" step=".01" value={style.maxWidth} oninput={(event) => onUpdate({ maxWidth: number(event) })} /></label>
    </div>
    {:else}
    <label class="caption-check"><input type="checkbox" checked={style.strokeEnabled} onchange={(event) => onUpdate({ strokeEnabled: checked(event) })} /><span>Text outline</span></label>
    {#if style.strokeEnabled}
      <div class="caption-controls">
        <label class="caption-field"><span>Outline color</span><input type="color" value={style.strokeColor} oninput={(event) => onUpdate({ strokeColor: value(event) })} /></label>
        <label class="caption-field"><span>Width, frame px</span><input type="number" min="0" max="30" step=".5" value={style.strokeWidth} onchange={(event) => onUpdate({ strokeWidth: Math.max(0, Math.min(30, number(event))) })} /></label>
        <label class="caption-field"><span>Outline opacity, %</span><input type="number" min="0" max="100" value={Math.round(style.strokeOpacity * 100)} onchange={(event) => onUpdate({ strokeOpacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
      </div>
    {/if}
    <label class="caption-check"><input type="checkbox" checked={style.shadowEnabled} onchange={(event) => onUpdate({ shadowEnabled: checked(event) })} /><span>Text shadow</span></label>
    {#if style.shadowEnabled}
      <div class="caption-controls">
        <label class="caption-field"><span>Shadow color</span><input type="color" value={style.shadowColor} oninput={(event) => onUpdate({ shadowColor: value(event) })} /></label>
        <label class="caption-field"><span>Shadow opacity, %</span><input type="number" min="0" max="100" value={Math.round(style.shadowOpacity * 100)} onchange={(event) => onUpdate({ shadowOpacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
        <label class="caption-field"><span>Blur, frame px</span><input type="number" min="0" max="100" value={style.shadowBlur} onchange={(event) => onUpdate({ shadowBlur: Math.max(0, Math.min(100, number(event))) })} /></label>
        <label class="caption-field"><span>Offset X, frame px</span><input type="number" min="-100" max="100" value={style.shadowOffsetX} onchange={(event) => onUpdate({ shadowOffsetX: Math.max(-100, Math.min(100, number(event))) })} /></label>
        <label class="caption-field"><span>Offset Y, frame px</span><input type="number" min="-100" max="100" value={style.shadowOffsetY} onchange={(event) => onUpdate({ shadowOffsetY: Math.max(-100, Math.min(100, number(event))) })} /></label>
      </div>
    {/if}
    <label class="caption-check"><input type="checkbox" checked={style.backgroundEnabled} onchange={(event) => onUpdate({ backgroundEnabled: checked(event) })} /><span>Whole caption background</span></label>
    {#if style.backgroundEnabled}
      <div class="caption-controls">
        <label class="caption-field"><span>Background color</span><input type="color" value={style.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: value(event) })} /></label>
        <label class="caption-field"><span>Background opacity, %</span><input type="number" min="0" max="100" value={Math.round(style.backgroundOpacity * 100)} onchange={(event) => onUpdate({ backgroundOpacity: Math.max(0, Math.min(1, number(event) / 100)) })} /></label>
        <label class="caption-field"><span>Padding, frame px</span><input type="number" min="0" max="100" value={style.backgroundPadding} onchange={(event) => onUpdate({ backgroundPadding: Math.max(0, Math.min(100, number(event))) })} /></label>
        <label class="caption-field"><span>Corner radius, px</span><input type="number" min="0" max="200" value={style.backgroundRadius} onchange={(event) => onUpdate({ backgroundRadius: Math.max(0, Math.min(200, number(event))) })} /></label>
      </div>
    {/if}
    {/if}
  </div>
</details>
