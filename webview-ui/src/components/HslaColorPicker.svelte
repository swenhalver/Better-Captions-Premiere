<script lang="ts">
  import { untrack } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import { hexToHsla, hslaToHex, type HslaColor } from '../lib/hsla-color';
  interface Props { value: string; opacity: number; label: string; disabled?: boolean; defaultOpacity?: number; onOpacityReset?: () => void; onChange: (value: { color: string; opacity: number }) => void; }
  let { value, opacity, label, disabled = false, defaultOpacity = 1, onOpacityReset, onChange }: Props = $props();
  let channels = $state<HslaColor>(untrack(() => hexToHsla(value, opacity)));
  let publishedColor = untrack(() => value), publishedOpacity = untrack(() => opacity);
  let dragging = $state(false);
  function fieldValue(color: HslaColor) {
    const v = color.l / 100 + color.s / 100 * Math.min(color.l / 100, 1 - color.l / 100);
    return { v, s: v === 0 ? 0 : 2 * (1 - color.l / 100 / v) };
  }
  let brightness = $state(untrack(() => fieldValue(channels).v));
  let saturation = $state(untrack(() => fieldValue(channels).s));
  $effect(() => {
    if (value !== publishedColor || opacity !== publishedOpacity) {
      channels = hexToHsla(value, opacity);
      brightness = fieldValue(channels).v;
      saturation = fieldValue(channels).s;
      publishedColor = value;
      publishedOpacity = opacity;
    }
  });
  function publish() {
    const result = hslaToHex(channels);
    publishedColor = result.color;
    publishedOpacity = result.opacity;
    onChange(result);
  }
  function change(key: 'h' | 'a', next: number) {
    channels[key] = key === 'a' ? next / 100 : next;
    publish();
  }
  function setField(s: number, v: number) {
    saturation = s;
    brightness = v;
    const lightness = v * (1 - s / 2);
    channels.l = lightness * 100;
    channels.s = lightness === 0 || lightness === 1 ? 0 : (v - lightness) / Math.min(lightness, 1 - lightness) * 100;
    publish();
  }
  function point(event: PointerEvent) {
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!rect || disabled) return;
    setField(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)));
  }
  function key(event: KeyboardEvent) {
    if (disabled || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? .1 : .01;
    setField(Math.max(0, Math.min(1, saturation + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))), Math.max(0, Math.min(1, brightness + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))));
  }
  function hex(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const next = input.value.trim().replace(/^#/, '');
    if (/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(next)) {
      channels = hexToHsla(`#${next}`, channels.a);
      brightness = fieldValue(channels).v;
      saturation = fieldValue(channels).s;
      publish();
    } else input.value = value.toUpperCase();
  }
</script>

<div class="hsla-picker" role="group" aria-label={label} style:--picker-hue={channels.h} style:--picker-color={value}>
  <div class="hsla-picker__field" role="slider" tabindex={disabled ? -1 : 0} aria-label={`${label} saturation and brightness`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(saturation*100)} aria-valuetext={`${Math.round(saturation*100)}% saturation, ${Math.round(brightness*100)}% brightness`} aria-disabled={disabled} onkeydown={key}
    onpointerdown={event => {if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); dragging = true; point(event);}}
    onpointermove={event => {if (dragging) point(event);}} onpointerup={() => dragging = false} onpointercancel={() => dragging = false} onlostpointercapture={() => dragging = false}>
    <span class="hsla-picker__cursor" style:left={`${saturation*100}%`} style:top={`${(1-brightness)*100}%`}></span>
  </div>
  <input class="hsla-picker__slider hsla-picker__slider--hue" type="range" min="0" max="360" step="1" value={channels.h} {disabled} aria-label={`${label} hue`} oninput={event => change('h', Number(event.currentTarget.value))}/>
  <div class="hsla-picker__row">
    <span class="hsla-picker__label">Alpha</span>
    <input class="hsla-picker__slider hsla-picker__slider--alpha" type="range" min="0" max="100" step="1" value={channels.a*100} {disabled} aria-label={`${label} opacity`} oninput={event => change('a', Number(event.currentTarget.value))}/>
    <div class="hsla-picker__number"><ScrubbableNumber defaultValue={defaultOpacity*100} onReset={onOpacityReset} label={`${label} opacity, %`} min={0} max={100} step={1} decimals={0} value={channels.a*100} {disabled} onChange={next => change('a', next)}/><span aria-hidden="true">%</span></div>
  </div>
  <div class="hsla-picker__preview"><span class="hsla-picker__sample" aria-hidden="true"><span style:background={value} style:opacity={opacity}></span></span><input class="hsla-picker__hex" aria-label={`${label} hex`} value={value.toUpperCase()} maxlength="7" spellcheck="false" {disabled} onblur={hex} onkeydown={event => {if (event.key === 'Enter') {event.preventDefault(); hex(event);}}}/></div>
</div>

<style>
  .hsla-picker {display:flex;flex-direction:column;gap:.7rem;min-inline-size:0;color:var(--color-panel-text);font-size:var(--caption-type-s);}
  .hsla-picker__field {position:relative;block-size:9rem;border:1px solid var(--color-panel-border);border-radius:.3rem;background:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent),hsl(var(--picker-hue) 100% 50%);touch-action:none;cursor:crosshair;&:focus-visible {outline:2px solid var(--color-accent);outline-offset:3px;}&[aria-disabled="true"] {opacity:.5;cursor:default;}}
  .hsla-picker__cursor {position:absolute;inline-size:.65rem;block-size:.65rem;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px #000b;transform:translate(-50%,-50%);pointer-events:none;}
  .hsla-picker__preview {display:flex;align-items:center;gap:.5rem;font-variant-numeric:tabular-nums;}
  .hsla-picker__sample {display:block;inline-size:2rem;block-size:1.8rem;overflow:hidden;border:1px solid var(--color-panel-border);border-radius:.2rem;background:repeating-conic-gradient(#888 0% 25%,#ccc 0% 50%) 0 0 / .5rem .5rem;& span {display:block;inline-size:100%;block-size:100%;}}
  .hsla-picker__hex {flex:1;min-inline-size:0;min-block-size:1.8rem;padding:.2rem .4rem;border:1px solid var(--color-panel-border);border-radius:.2rem;background:var(--color-input);color:var(--color-panel-text);font:inherit;font-size:var(--caption-type-xs);&:focus-visible {outline:2px solid var(--color-accent);outline-offset:1px;}}
  .hsla-picker__row {display:grid;grid-template-columns:2.4rem minmax(3rem,1fr) 4.4rem;gap:.5rem;align-items:center;min-inline-size:0;}
  .hsla-picker__label {font-size:var(--caption-type-xs);}
  .hsla-picker__slider {appearance:none;inline-size:100%;block-size:.75rem;min-inline-size:0;margin:0;border:1px solid var(--color-panel-border);border-radius:1rem;cursor:pointer;&::-webkit-slider-thumb {appearance:none;inline-size:.95rem;block-size:.95rem;border:2px solid var(--color-panel-text);border-radius:50%;background:var(--color-panel-bg);box-shadow:0 1px 2px #0008;}&:focus-visible {outline:2px solid var(--color-accent);outline-offset:3px;}&:disabled {opacity:.5;cursor:default;}}
  .hsla-picker__slider--hue {background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);}
  .hsla-picker__slider--alpha {background:linear-gradient(to right,transparent,var(--picker-color)),repeating-conic-gradient(#888 0% 25%,#ccc 0% 50%) 0 0 / .5rem .5rem;}
  .hsla-picker__number {display:flex;align-items:center;min-inline-size:0;& :global(.scrubbable-number) {flex:1;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {min-block-size:1.8rem;padding:.2rem .25rem;border:0;background:var(--color-input);color:var(--color-accent);font-size:var(--caption-type-xs);text-align:end;}&>span {padding-inline-start:.15rem;inline-size:.6rem;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);}}
</style>
