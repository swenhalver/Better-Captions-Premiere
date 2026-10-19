<script lang="ts">
  import { untrack } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import { hexToHsla, hslaToHex, type HslaColor } from '../lib/hsla-color';
  interface Props { value: string; opacity: number; label: string; disabled?: boolean; onChange: (value: { color: string; opacity: number }) => void; }
  let { value, opacity, label, disabled = false, onChange }: Props = $props();
  let channels = $state<HslaColor>(untrack(() => hexToHsla(value, opacity)));
  let publishedColor = untrack(() => value), publishedOpacity = untrack(() => opacity);
  $effect(() => {
    if (value !== publishedColor || opacity !== publishedOpacity) {
      channels = hexToHsla(value, opacity);
      publishedColor = value;
      publishedOpacity = opacity;
    }
  });
  const rows = [{key:'h',short:'H',name:'Hue',max:360,unit:'°'}, {key:'s',short:'S',name:'Saturation',max:100,unit:'%'}, {key:'l',short:'L',name:'Lightness',max:100,unit:'%'}, {key:'a',short:'A',name:'Opacity',max:100,unit:'%'}] as const;
  function change(key: keyof HslaColor, next: number) {
    channels[key] = key === 'a' ? next / 100 : next;
    const result = hslaToHex(channels);
    publishedColor = result.color;
    publishedOpacity = result.opacity;
    onChange(result);
  }
</script>

<div class="hsla-picker" role="group" aria-label={label} style:--picker-hue={channels.h} style:--picker-saturation={`${channels.s}%`} style:--picker-lightness={`${channels.l}%`} style:--picker-color={value}>
  <div class="hsla-picker__preview"><span class="hsla-picker__sample" aria-hidden="true"><span style:background={value} style:opacity={opacity}></span></span><span class="hsla-picker__hex">{value.toUpperCase()}</span><span class="hsla-picker__alpha">{Math.round(opacity * 100)}%</span></div>
  {#each rows as row}
    <div class="hsla-picker__row">
      <span class="hsla-picker__label" title={row.name}>{row.short}</span>
      <input class="hsla-picker__slider" class:hsla-picker__slider--hue={row.key==='h'} class:hsla-picker__slider--saturation={row.key==='s'} class:hsla-picker__slider--lightness={row.key==='l'} class:hsla-picker__slider--alpha={row.key==='a'} type="range" min="0" max={row.max} step="1" value={row.key === 'a' ? channels.a * 100 : channels[row.key]} {disabled} aria-label={`${label} ${row.name.toLowerCase()}`} oninput={event => change(row.key, Number(event.currentTarget.value))}/>
      <div class="hsla-picker__number"><ScrubbableNumber label={`${label} ${row.name.toLowerCase()}, ${row.unit === '°' ? 'degrees' : '%'}`} min={0} max={row.max} step={1} decimals={0} value={row.key === 'a' ? channels.a * 100 : channels[row.key]} {disabled} onChange={next => change(row.key, next)}/><span aria-hidden="true">{row.unit}</span></div>
    </div>
  {/each}
</div>

<style>
  .hsla-picker {display:flex;flex-direction:column;gap:.4rem;min-inline-size:0;color:var(--color-panel-text);font-size:var(--caption-type-s);}
  .hsla-picker__preview {display:flex;align-items:center;gap:.5rem;padding-block-end:.25rem;font-variant-numeric:tabular-nums;}
  .hsla-picker__sample {display:block;inline-size:1.8rem;block-size:1.5rem;overflow:hidden;border:1px solid var(--color-panel-border);border-radius:.2rem;background:repeating-conic-gradient(#888 0% 25%,#ccc 0% 50%) 0 0 / .5rem .5rem;& span {display:block;inline-size:100%;block-size:100%;}}
  .hsla-picker__hex {font-size:var(--caption-type-xs);}
  .hsla-picker__alpha {margin-inline-start:auto;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);}
  .hsla-picker__row {display:grid;grid-template-columns:1rem minmax(3rem,1fr) 4.4rem;gap:.5rem;align-items:center;min-inline-size:0;}
  .hsla-picker__label {font-weight:500;font-size:var(--caption-type-xs);}
  .hsla-picker__slider {appearance:none;inline-size:100%;block-size:.65rem;min-inline-size:0;margin:0;border:1px solid var(--color-panel-border);border-radius:1rem;cursor:pointer;&::-webkit-slider-thumb {appearance:none;inline-size:.9rem;block-size:.9rem;border:2px solid var(--color-panel-text);border-radius:50%;background:var(--color-panel-bg);box-shadow:0 1px 2px #0008;}&:focus-visible {outline:2px solid var(--color-accent);outline-offset:3px;}&:disabled {opacity:.5;cursor:default;}}
  .hsla-picker__slider--hue {background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);}
  .hsla-picker__slider--saturation {background:linear-gradient(to right,hsl(var(--picker-hue) 0% var(--picker-lightness)),hsl(var(--picker-hue) 100% var(--picker-lightness)));}
  .hsla-picker__slider--lightness {background:linear-gradient(to right,#000,hsl(var(--picker-hue) var(--picker-saturation) 50%),#fff);}
  .hsla-picker__slider--alpha {background:linear-gradient(to right,transparent,var(--picker-color)),repeating-conic-gradient(#888 0% 25%,#ccc 0% 50%) 0 0 / .5rem .5rem;}
  .hsla-picker__number {display:flex;align-items:center;min-inline-size:0;& :global(.scrubbable-number) {flex:1;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {min-block-size:1.8rem;padding:.2rem .25rem;border:0;background:var(--color-input);color:var(--color-accent);font-size:var(--caption-type-xs);text-align:end;}&>span {padding-inline-start:.15rem;inline-size:.6rem;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);}}
</style>
