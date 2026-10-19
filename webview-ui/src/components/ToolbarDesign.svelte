<script lang="ts">
  import FontPicker from './FontPicker.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  let { variant }: {variant:'ribbon'|'inspector'|'shelf'} = $props();
  const fonts=['Arial','Avenir Next','Georgia','Helvetica Neue','Menlo','Times New Roman','Verdana'];
  let font=$state('Helvetica Neue'), weight=$state(400), size=$state(60), bold=$state(false), italic=$state(false), color=$state('#ffffff');
  let align=$state<'left'|'center'|'right'>('center'), scope=$state('All words'), textCase=$state('none');
  let tab=$state('Spacing'), more=$state(false), spacing=$state(5), leading=$state(1.2), opacity=$state(100);
  let outline=$state(true), stroke=$state(2), shadow=$state(false), blur=$state(8), bubble=$state(true), padding=$state(6), radius=$state(4), width=$state(674), height=$state(500);
  const id=$props.id();
  const tabs=['Spacing','Outline','Shadow','Bubble','Layout'];
  const sentence='Every word has its own style.';
  const displayed=$derived(textCase==='uppercase'?sentence.toUpperCase():textCase==='lowercase'?sentence.toLowerCase():textCase==='titlecase'?sentence.replace(/\b\w/g,c=>c.toUpperCase()):sentence);
  const shownWeight=$derived(bold?Math.min(900,weight+100):weight);
  function tabKey(e:KeyboardEvent,index:number){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?4:(index+(e.key==='ArrowRight'?1:4))%5;tab=tabs[n];document.getElementById(`${id}-${n}`)?.focus();}
</script>

{#snippet emphasis()}
  <div class="toolbar-design__segment" role="group" aria-label="Text emphasis">
    <button class="toolbar-design__icon" title="One weight bolder" aria-label="Bold" aria-pressed={bold} onclick={()=>bold=!bold}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h7a4 4 0 0 1 0 8H6m7 0a4 4 0 0 1 0 8H6V4"/></svg></button>
    <button class="toolbar-design__icon" title="Italic" aria-label="Italic" aria-pressed={italic} onclick={()=>italic=!italic}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4h10M4 20h10M15 4 9 20"/></svg></button>
  </div>
{/snippet}
{#snippet swatch()}
  <label class="toolbar-design__swatch" title="Text color"><span class="toolbar-design__sr">Text color</span><input type="color" bind:value={color}/></label>
{/snippet}
{#snippet family()}
  <div class="toolbar-design__family"><FontPicker value={font} {fonts} onSelect={value=>font=value}/></div>
{/snippet}
{#snippet fontWeight()}
  <select class="toolbar-design__weight" aria-label="Font weight" bind:value={weight}>{#each [100,200,300,400,500,600,700,800,900] as w}<option value={w}>{w}</option>{/each}</select>
{/snippet}
{#snippet fontSize()}
  <div class="toolbar-design__size" title="Font size, px"><ScrubbableNumber label="Font size" value={size} min={8} max={400} onChange={v=>size=v}/></div>
{/snippet}
{#snippet casing()}
  <select class="toolbar-design__case" aria-label="Text case" title="Text case" bind:value={textCase}><option value="none">Aa</option><option value="uppercase">AA</option><option value="lowercase">aa</option><option value="titlecase">Ab</option></select>
{/snippet}
{#snippet alignment()}
  {#if scope==='All words'}<div class="toolbar-design__align"><AlignmentButtons value={align} onChange={v=>align=v}/></div>{/if}
{/snippet}
{#snippet opacityField()}
  <label class="toolbar-design__field"><span>Opacity %</span><ScrubbableNumber label="Text opacity" min={0} max={100} value={opacity} onChange={v=>opacity=v}/></label>
{/snippet}

<div class="toolbar-design toolbar-design--{variant}">
  <div class="toolbar-design__scope" role="group" aria-label="Words to style">
    {#each ['All words','Past','Current','Next'] as word}<button aria-pressed={scope===word} onclick={()=>scope=word}>{word}</button>{/each}
    <button class="toolbar-design__reset" title="Reset this design sample" onclick={()=>{font='Helvetica Neue';weight=400;size=60;bold=false;italic=false;color='#ffffff';align='center';textCase='none';spacing=5;leading=1.2;opacity=100;outline=true;stroke=2;shadow=false;bubble=true;padding=6;radius=4;width=674;height=500;}}>Reset</button>
  </div>
  {#if variant==='ribbon'}
    <div class="toolbar-design__ribbon" aria-label="Inline formatting toolbar">
      {@render casing()}{@render emphasis()}{@render swatch()}{@render family()}{@render fontWeight()}{@render fontSize()}{@render alignment()}
    </div>
  {:else if variant==='inspector'}
    <div class="toolbar-design__type-row">{@render family()}{@render fontWeight()}{@render fontSize()}</div>
    <div class="toolbar-design__format-row">{@render emphasis()}{@render swatch()}{@render casing()}{@render alignment()}{@render opacityField()}</div>
  {:else}
    <div class="toolbar-design__ribbon" aria-label="Essential formatting toolbar">{@render family()}{@render fontSize()}{@render emphasis()}{@render swatch()}{@render alignment()}
      <button class="toolbar-design__icon" aria-label="More formatting" aria-expanded={more} title="Weight, case and opacity" onclick={()=>more=!more}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
    </div>
    {#if more}<div class="toolbar-design__more"><label class="toolbar-design__field"><span>Weight</span>{@render fontWeight()}</label><label class="toolbar-design__field"><span>Case</span>{@render casing()}</label>{@render opacityField()}</div>{/if}
  {/if}
  <div class="toolbar-design__tabs" role="tablist" aria-label="Appearance details">
    {#each tabs as item,i}<button id={`${id}-${i}`} role="tab" aria-selected={tab===item} aria-controls={`${id}-details`} tabindex={tab===item?0:-1} onclick={()=>tab=item} onkeydown={e=>tabKey(e,i)}>{item}</button>{/each}
  </div>
  <div class="toolbar-design__details" id={`${id}-details`} role="tabpanel" aria-labelledby={`${id}-${tabs.indexOf(tab)}`} tabindex="0">
    {#if tab==='Spacing'}
      <label class="toolbar-design__field"><span>Word spacing, px</span><ScrubbableNumber label="Word spacing" value={spacing} min={0} max={100} onChange={v=>spacing=v}/></label>
      <label class="toolbar-design__field"><span>Line height</span><ScrubbableNumber label="Line height" value={leading} min={.6} max={3} step={.05} onChange={v=>leading=v}/></label>
      {#if variant!=='inspector'}{@render opacityField()}{/if}
    {:else if tab==='Outline'}
      <label class="toolbar-design__check"><input type="checkbox" bind:checked={outline}/>Outline</label><label class="toolbar-design__field"><span>Width, px</span><ScrubbableNumber label="Outline width" value={stroke} min={0} max={16} onChange={v=>stroke=v}/></label>
    {:else if tab==='Shadow'}
      <label class="toolbar-design__check"><input type="checkbox" bind:checked={shadow}/>Shadow</label><label class="toolbar-design__field"><span>Blur, px</span><ScrubbableNumber label="Shadow blur" value={blur} min={0} max={50} onChange={v=>blur=v}/></label>
    {:else if tab==='Bubble'}
      <label class="toolbar-design__check"><input type="checkbox" bind:checked={bubble}/>Word bubble</label><label class="toolbar-design__field"><span>Padding, px</span><ScrubbableNumber label="Bubble padding" value={padding} min={0} max={30} onChange={v=>padding=v}/></label><label class="toolbar-design__field"><span>Corners, px</span><ScrubbableNumber label="Bubble corners" value={radius} min={0} max={30} onChange={v=>radius=v}/></label>
    {:else}
      <label class="toolbar-design__field"><span>Width, px</span><ScrubbableNumber label="Caption width" value={width} min={100} max={1200} onChange={v=>width=v}/></label><label class="toolbar-design__field"><span>Height, px</span><ScrubbableNumber label="Caption height" value={height} min={100} max={1000} onChange={v=>height=v}/></label>
    {/if}
  </div>
  <div class="toolbar-design__sample" aria-label="Typography sample, synthetic text" style:font-family={font} style:font-size={`${size/2}px`} style:font-weight={shownWeight} style:font-style={italic?'italic':'normal'} style:color={color} style:text-align={align} style:word-spacing={`${spacing/2}px`} style:line-height={leading} style:opacity={opacity/100} style:text-shadow={shadow?`2px 3px ${blur/2}px #000`:'none'}>
    <div style:max-width={`${width/2}px`} style:min-height={`${Math.min(height/10,70)}px`}>
      {#each displayed.split(' ') as word,i}<span class="toolbar-design__word" class:toolbar-design__word--bubble={bubble&&i===2} style:padding={bubble&&i===2?`${padding/2}px`:undefined} style:border-radius={`${radius/2}px`}><span class="toolbar-design__stroke" aria-hidden="true" style:-webkit-text-stroke={outline?`${stroke}px #111`:'0'}>{word}</span><span class="toolbar-design__fill">{word}</span></span>{' '}{/each}
    </div>
  </div>
</div>

<style>
  .toolbar-design {container-type:inline-size; background:var(--color-panel-bg); border:1px solid var(--color-panel-border); --tool-height:2.35rem; --tool-radius:.5rem; --tool-gap:.35rem;}
  .toolbar-design__scope {display:flex;align-items:center;gap:.2rem;padding:.6rem .7rem;border-block-end:1px solid var(--color-panel-border); & button {padding:.35rem .65rem;color:var(--color-panel-secondary);background:transparent;border:0;border-radius:.3rem;cursor:pointer; &[aria-pressed="true"] {background:var(--color-selection);color:var(--color-accent);}} & .toolbar-design__reset {margin-inline-start:auto;font-size:.85rem;}}
  .toolbar-design__ribbon,.toolbar-design__type-row,.toolbar-design__format-row {display:flex;align-items:center;flex-wrap:wrap;gap:var(--tool-gap);padding:.75rem .7rem;}
  .toolbar-design__type-row {padding-block-end:.3rem;}
  .toolbar-design__format-row {padding-block-start:0; & .toolbar-design__field {display:flex;align-items:center;gap:.2rem;flex:1;min-inline-size:8rem;max-inline-size:11rem;}}
  .toolbar-design__family {flex:1 1 10rem;min-inline-size:7rem; & :global(.font-picker) {background:var(--color-surface-raised);border-color:transparent;border-radius:var(--tool-radius);min-block-size:var(--tool-height);} & :global(.font-picker__input) {font-size:1.12rem;min-block-size:var(--tool-height);padding-inline:.65rem;}}
  .toolbar-design__segment {display:flex;flex-shrink:0;overflow:hidden;background:var(--color-surface-raised);border-radius:var(--tool-radius); & button+button {border-inline-start:1px solid var(--color-panel-border);}}
  .toolbar-design__icon {display:grid;place-items:center;inline-size:2.5rem;block-size:var(--tool-height);border:0;background:var(--color-surface-raised);color:var(--color-panel-text);border-radius:var(--tool-radius);cursor:pointer; & svg {inline-size:1.6rem;block-size:1.6rem;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;} &[aria-pressed="true"],&[aria-expanded="true"] {background:var(--color-primary);color:white;}}
  .toolbar-design__swatch {inline-size:2.4rem;block-size:var(--tool-height);flex-shrink:0;border-radius:var(--tool-radius);overflow:hidden; & input {inline-size:100%;block-size:100%;padding:0;border:0;background:transparent;cursor:pointer; &::-webkit-color-swatch-wrapper {padding:0;} &::-webkit-color-swatch {border:0;}}}
  .toolbar-design__weight,.toolbar-design__case {block-size:var(--tool-height);padding:.2rem .5rem;color:var(--color-panel-text);background:var(--color-surface-raised);border:0;border-radius:var(--tool-radius);font:inherit;font-size:1.1rem;cursor:pointer;}
  .toolbar-design__weight {inline-size:5rem;}
  .toolbar-design__case {inline-size:4rem;}
  .toolbar-design__size {inline-size:4.1rem; & :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {background:var(--color-surface-raised);border:0;border-radius:var(--tool-radius);min-block-size:var(--tool-height);font-size:1.15rem;text-align:center;}}
  .toolbar-design__align { & :global(.alignment) {border-radius:var(--tool-radius);overflow:hidden;} & :global(.alignment__button) {inline-size:2.4rem;min-block-size:var(--tool-height);background:var(--color-surface-raised);border:0;color:var(--color-panel-text);} & :global(.alignment__button[aria-pressed="true"]) {background:var(--color-primary);color:white;}}
  .toolbar-design__tabs {display:flex;gap:1rem;padding-inline:.8rem;border-block-end:1px solid var(--color-panel-border);overflow-x:auto; & button {min-block-size:2.5rem;padding:0;border:0;border-block-end:2px solid transparent;background:transparent;color:var(--color-panel-secondary);cursor:pointer; &[aria-selected="true"] {border-block-end-color:var(--color-accent);color:var(--color-panel-text);}}}
  .toolbar-design__details,.toolbar-design__more {display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));align-items:center;gap:.7rem;padding:.65rem .8rem;}
  .toolbar-design__more {border-block-end:1px solid var(--color-panel-border);}
  .toolbar-design__field {display:grid;gap:.25rem;min-inline-size:0; &>span {color:var(--color-panel-secondary);font-size:.85rem;} & :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {min-block-size:2rem;padding:.2rem .4rem;}}
  .toolbar-design__check {display:flex;gap:.4rem;align-items:center;cursor:pointer;}
  .toolbar-design__sample {padding:1rem 1.2rem;background:var(--color-input);border-block-start:1px solid var(--color-panel-border); &>div {margin-inline:auto;}}
  .toolbar-design__word {position:relative;display:inline-block;}
  .toolbar-design__word--bubble {background:#e2bc56;color:#171717;}
  .toolbar-design__stroke {position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;}
  .toolbar-design__fill {position:relative;}
  .toolbar-design__sr {position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);}
  .toolbar-design--inspector {--tool-radius:.25rem;--tool-height:2.15rem; & .toolbar-design__family {flex-basis:14rem;} & .toolbar-design__scope {border-block-end:0;}}
  .toolbar-design--shelf {--tool-height:2.15rem;--tool-radius:.25rem; & .toolbar-design__tabs {gap:1.5rem;} & .toolbar-design__ribbon {padding-block:.6rem;}}
  .toolbar-design :global(button:focus-visible),.toolbar-design :global(select:focus-visible),.toolbar-design :global(input:focus-visible) {outline:2px solid var(--color-accent);outline-offset:2px;}
  .toolbar-design :global(button:hover) {filter:brightness(1.15);}
</style>
