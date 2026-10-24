<script lang="ts">
  import { untrack } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import LucideIcon from './LucideIcon.svelte';
  interface Values { inline:number; block:number; lineHeight?:number; top:number; right:number; bottom:number; left:number; paddingTop?:number; paddingRight?:number; paddingBottom?:number; paddingLeft?:number; radiusTL?:number; radiusTR?:number; radiusBR?:number; radiusBL?:number; }
  let { variant='box', value, defaults, onReset, onChange }: {variant?:'box'|'neutral'|'cross'|'cross-leading'|'grid'|'rows'; value:Values; defaults?:Partial<Values>; onReset?:(key:keyof Values)=>void; onChange:(key:keyof Values,value:number)=>void} = $props();
  const initialDefaults = untrack(() => ({...value}));
  type LinkMode='all'|'opposites'|'none';
  let paddingMode=$state<LinkMode>('opposites'), marginMode=$state<LinkMode>('opposites'), radiusMode=$state<LinkMode>('all');
  const margins = [{key:'top',label:'Top'},{key:'right',label:'Right'},{key:'bottom',label:'Bottom'},{key:'left',label:'Left'}] as const;
  const corners = [{key:'radiusTL',label:'Top left'},{key:'radiusTR',label:'Top right'},{key:'radiusBR',label:'Bottom right'},{key:'radiusBL',label:'Bottom left'}] as const;
  const paddingKeys=['paddingTop','paddingRight','paddingBottom','paddingLeft'] as const;
  const radiusKeys=['radiusTL','radiusTR','radiusBR','radiusBL'] as const;
  function get(key:keyof Values) {
    if(key==='paddingTop'||key==='paddingBottom')return value[key]??value.block;
    if(key==='paddingLeft'||key==='paddingRight')return value[key]??value.inline;
    return value[key]??5;
  }
  function defaultFor(key: keyof Values) {
    const source = {...initialDefaults, ...defaults};
    if (key === 'paddingTop' || key === 'paddingBottom') return source[key] ?? source.block;
    if (key === 'paddingLeft' || key === 'paddingRight') return source[key] ?? source.inline;
    return source[key];
  }
  function reset(key: keyof Values) {
    const padding = key.startsWith('padding') || key === 'inline' || key === 'block';
    const radius = key.startsWith('radius');
    const mode = padding ? paddingMode : radius ? radiusMode : marginMode;
    const keys: readonly (keyof Values)[] = padding ? paddingKeys : radius ? radiusKeys : ['top','right','bottom','left'];
    const actual = key === 'inline' ? 'paddingLeft' : key === 'block' ? 'paddingTop' : key;
    const targets = key === 'lineHeight' ? [key] : mode === 'all' ? keys : mode === 'opposites' ? [actual,keys[(keys.indexOf(actual)+2)%4]] : [actual];
    for (const target of targets) {
      if (onReset) onReset(target);
      else { const next = defaultFor(target); if (next !== undefined) onChange(target, next); }
    }
  }
  function change(key:keyof Values,next:number) {
    const padding=key.startsWith('padding')||key==='inline'||key==='block';
    const radius=key.startsWith('radius');
    const mode=padding?paddingMode:radius?radiusMode:marginMode;
    const keys:readonly (keyof Values)[]=padding?paddingKeys:radius?radiusKeys:['top','right','bottom','left'];
    const actual=key==='inline'?'paddingLeft':key==='block'?'paddingTop':key;
    if(mode==='all')for(const target of keys)onChange(target,next);
    else if(mode==='opposites') {onChange(actual,next);onChange(keys[(keys.indexOf(actual)+2)%4],next);}
    else onChange(actual,next);
  }

</script>
{#snippet number(key:keyof Values,label:string)}
  <ScrubbableNumber defaultValue={defaultFor(key)} onReset={() => reset(key)} label={label} value={get(key)} min={key==='top'||key==='right'||key==='bottom'||key==='left'?-100:0} max={100} onChange={next=>change(key,next)}/>
{/snippet}
{#snippet field(key:keyof Values,label:string)}
  <label class="spacing-inspector__field"><span>{label}</span>{@render number(key,`${key.startsWith('radius')?'Radius':key.startsWith('padding')||key==='inline'||key==='block'?'Padding':'Margin'} ${label.toLowerCase()}, px`)}</label>
{/snippet}
{#snippet lock(group:'Padding'|'Margin'|'Radius',mode:LinkMode,set:(mode:LinkMode)=>void)}
  {@const states=[{mode:'all' as const,label:'All linked',icon:'link' as const},{mode:'opposites' as const,label:'Opposites linked',icon:'link-2' as const},{mode:'none' as const,label:'Independent',icon:'link-2-off' as const}]}
  {@const index=states.findIndex(item=>item.mode===mode)}
  {@const current=states[index]}
  {@const next=states[(index+1)%states.length]}
  <button type="button" class="spacing-inspector__link" class:spacing-inspector__link--linked={mode!=='none'} aria-label={`${group}: ${current.label}. Switch to ${next.label.toLowerCase()}`} title={`${group}: ${current.label} — click for ${next.label.toLowerCase()}`} onclick={()=>set(next.mode)}><LucideIcon name={current.icon}/></button>
{/snippet}
<div class="spacing-inspector" class:spacing-inspector--rows={variant==='rows'} class:spacing-inspector--neutral={variant==='neutral'}>
  <div class="spacing-inspector__locks">
    <span>Margin {@render lock('Margin',marginMode,next=>marginMode=next)}</span>
    <span>Padding {@render lock('Padding',paddingMode,next=>paddingMode=next)}</span>
    <span>Radius {@render lock('Radius',radiusMode,next=>radiusMode=next)}</span>
  </div>
  {#if variant==='cross'||variant==='cross-leading'}
    <div class="spacing-inspector__open-margin" aria-label="Margins around padding and radius">
      {#each margins as edge}<div class={`spacing-inspector__outer-edge spacing-inspector__outer-edge--${edge.key}`}>{@render number(edge.key,`Margin ${edge.label.toLowerCase()}, px`)}</div>{/each}
      <div class="spacing-inspector__cross" class:spacing-inspector__cross--leading={variant==='cross-leading'} aria-label="Padding and corner radius inputs">
        {#each corners as corner}<div class={`spacing-inspector__cross-corner spacing-inspector__cross-corner--${corner.key}`} title={`${corner.label} radius`}>{@render number(corner.key,`Radius ${corner.label.toLowerCase()}, px`)}</div>{/each}
        <div class="spacing-inspector__cross-edge spacing-inspector__cross-edge--top">{@render number('paddingTop','Padding above, px')}</div>
        <div class="spacing-inspector__middle-pair"><div>{@render number('paddingLeft','Padding left, px')}</div>{#if variant==='cross-leading'}<div class="spacing-inspector__lineheight" title="Line height"><LucideIcon name="line-height"/><ScrubbableNumber defaultValue={defaultFor('lineHeight')} onReset={() => reset('lineHeight')} label="Line height" value={value.lineHeight??1.2} min={.6} max={3} step={.05} onChange={next=>onChange('lineHeight',next)}/></div>{/if}<div>{@render number('paddingRight','Padding right, px')}</div></div>
        <div class="spacing-inspector__cross-edge spacing-inspector__cross-edge--bottom">{@render number('paddingBottom','Padding below, px')}</div>
      </div>
    </div>
  {:else if variant==='box'||variant==='neutral'}
    <div class="spacing-inspector__margin" aria-label="Margin box">
      <span class="spacing-inspector__zone-name">margin</span>
      {#each margins as edge}<div class={`spacing-inspector__margin-value spacing-inspector__margin-value--${edge.key}`}>{@render number(edge.key,`Margin ${edge.label.toLowerCase()}, px`)}</div>{/each}
      <div class="spacing-inspector__background" aria-label="Background and corner radius">
        {#each corners as corner}<div class={`spacing-inspector__corner spacing-inspector__corner--${corner.key}`} title={`${corner.label} radius`}>{@render number(corner.key,`Radius ${corner.label.toLowerCase()}, px`)}</div>{/each}
        <div class="spacing-inspector__padding" aria-label="Padding box">
          <div class="spacing-inspector__padding-top">{@render number('paddingTop','Padding above, px')}</div>
          <div class="spacing-inspector__padding-left">{@render number('paddingLeft','Padding left, px')}</div>
          <div class="spacing-inspector__content">Text</div>
          <div class="spacing-inspector__padding-right">{@render number('paddingRight','Padding right, px')}</div>
          <div class="spacing-inspector__padding-bottom">{@render number('paddingBottom','Padding below, px')}</div>
        </div>
      </div>
    </div>
  {:else}
    <div class="spacing-inspector__section"><h3>Padding</h3><div class="spacing-inspector__pair">{@render field('paddingTop','Above')}{@render field('paddingRight','Right')}{@render field('paddingBottom','Below')}{@render field('paddingLeft','Left')}</div></div>
    <div class="spacing-inspector__section"><h3>Margin</h3><div class="spacing-inspector__pair">{#each margins as edge}{@render field(edge.key,edge.label)}{/each}</div></div>
    <div class="spacing-inspector__section"><h3>Corner radius</h3><div class="spacing-inspector__pair">{#each corners as corner}{@render field(corner.key,corner.label)}{/each}</div></div>
  {/if}
</div>
<style>
  .spacing-inspector {color:var(--color-panel-text);font-size:.9rem;min-inline-size:0;}
  .spacing-inspector__locks {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;box-sizing:border-box;block-size:var(--ribbon-height,2.65rem);padding:0;margin:0 0 .75rem;border:1px solid var(--color-panel-border);border-radius:.4rem;background:var(--color-surface-raised);&>span {display:flex;align-items:center;justify-content:space-between;gap:0;min-inline-size:0;padding:0 calc(.1rem + 4px) 0 calc(.35rem + 4px);font-size:.8rem;}&>span+span {border-inline-start:1px solid var(--color-panel-border);}}
  .spacing-inspector__link {display:grid;place-items:center;inline-size:1.8rem;block-size:1.8rem;padding:.25rem;border:0;border-radius:.3rem;background:transparent;color:var(--color-panel-secondary);cursor:pointer;&.spacing-inspector__link--linked {background:transparent;color:var(--color-accent);}&:focus-visible {outline:2px solid var(--color-accent);outline-offset:2px;}& :global(svg) {inline-size:1.1rem;block-size:1.1rem;}}
  .spacing-inspector__margin {position:relative;display:grid;grid-template-columns:2.3rem minmax(0,1fr) 2.3rem;grid-template-rows:2.2rem auto 2.2rem;gap:.15rem;padding:.35rem;border:1px dashed #b69a68;background:color-mix(in srgb,#b69a68 15%,var(--color-panel-bg));}
  .spacing-inspector__zone-name {position:absolute;inset-block-start:.45rem;inset-inline-start:.5rem;font-size:.72rem;color:var(--color-panel-secondary);pointer-events:none;}
  .spacing-inspector__margin-value {align-self:center;min-inline-size:0;}
  .spacing-inspector__margin-value--top {grid-column:2;grid-row:1;justify-self:center;inline-size:3rem;}
  .spacing-inspector__margin-value--right {grid-column:3;grid-row:2;}
  .spacing-inspector__margin-value--bottom {grid-column:2;grid-row:3;justify-self:center;inline-size:3rem;}
  .spacing-inspector__margin-value--left {grid-column:1;grid-row:2;}
  .spacing-inspector__background {position:relative;grid-column:2;grid-row:2;display:grid;grid-template-columns:3rem minmax(0,1fr) 3rem;grid-template-rows:2rem 2.2rem 2rem;row-gap:.15rem;padding:.35rem;border:1px solid #a4b6c9;border-radius:.55rem;background:color-mix(in srgb,#a4b6c9 13%,var(--color-panel-bg));min-inline-size:0;}
  .spacing-inspector__corner {min-inline-size:0;position:relative;align-self:center;}
  .spacing-inspector__corner--radiusTL {grid-column:1;grid-row:1;}
  .spacing-inspector__corner--radiusTR {grid-column:3;grid-row:1;}
  .spacing-inspector__corner--radiusBR {grid-column:3;grid-row:3;}
  .spacing-inspector__corner--radiusBL {grid-column:1;grid-row:3;}
  .spacing-inspector__padding {display:contents;}
  .spacing-inspector__padding-top {grid-column:2;grid-row:1;align-self:center;}
  .spacing-inspector__padding-bottom {grid-column:2;grid-row:3;align-self:center;}
  .spacing-inspector__padding-left {grid-column:1;grid-row:2;align-self:center;}
  .spacing-inspector__padding-right {grid-column:3;grid-row:2;align-self:center;}
  .spacing-inspector__content {grid-column:2;grid-row:2;display:grid;place-items:center;background:var(--color-selection);border:1px solid var(--color-accent);font-size:.8rem;}
  .spacing-inspector__margin :global(.scrubbable-number) {inline-size:100%;min-inline-size:0;}
  .spacing-inspector__margin :global(.scrubbable-number__value),.spacing-inspector__margin :global(.scrubbable-number__input) {inline-size:100%;min-block-size:1.9rem;padding:.2rem .15rem;border:1px solid var(--color-panel-border);border-radius:.25rem;background:var(--color-input);color:var(--color-panel-text);font-size:.9rem;text-align:center;}
  .spacing-inspector__margin :global(.scrubbable-number__value:hover:enabled) {border-color:var(--color-panel-secondary);}
  .spacing-inspector__margin :global(.scrubbable-number__value:focus-visible),.spacing-inspector__margin :global(.scrubbable-number__input:focus-visible) {outline:2px solid var(--color-accent);outline-offset:1px;}
  .spacing-inspector__open-margin {position:relative;background:color-mix(in srgb,var(--color-panel-bg),white 4%);box-sizing:border-box;padding:.35rem;display:grid;grid-template-columns:2.6rem minmax(0,1fr) 2.6rem;grid-template-rows:var(--ribbon-height,2.65rem) auto var(--ribbon-height,2.65rem);gap:.5rem .35rem;align-items:center;& :global(.scrubbable-number) {inline-size:100%;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {inline-size:100%;padding:.2rem .1rem;min-block-size:var(--ribbon-height,2.65rem);block-size:var(--ribbon-height,2.65rem);background:var(--color-input);border:1px solid var(--color-panel-border);border-radius:.25rem;text-align:center;}}
  .spacing-inspector__open-margin::before {content:'';position:absolute;inset:0;pointer-events:none;border:1px dashed var(--color-panel-secondary);}
  .spacing-inspector__outer-edge--top {grid-column:2;grid-row:1;inline-size:2.6rem;justify-self:center;}
  .spacing-inspector__outer-edge--right {grid-column:3;grid-row:2;}
  .spacing-inspector__outer-edge--bottom {grid-column:2;grid-row:3;inline-size:2.6rem;justify-self:center;}
  .spacing-inspector__outer-edge--left {grid-column:1;grid-row:2;}
  .spacing-inspector__open-margin>.spacing-inspector__cross {grid-column:2;grid-row:2;}
  .spacing-inspector__middle-pair {grid-column:1 / -1;grid-row:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;}
  .spacing-inspector__cross {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2.2fr) minmax(0,1fr);grid-template-rows:repeat(3,var(--ribbon-height,2.65rem));gap:.4rem;& :global(.scrubbable-number) {min-inline-size:0;inline-size:100%;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {inline-size:100%;min-block-size:var(--ribbon-height,2.65rem);block-size:var(--ribbon-height,2.65rem);padding:.2rem;border:1px solid var(--color-panel-border);border-radius:.3rem;background:var(--color-input);color:var(--color-panel-text);text-align:center;font-size:.95rem;}}
  .spacing-inspector__cross--leading {grid-template-rows:repeat(3,var(--ribbon-height,2.65rem));& .spacing-inspector__middle-pair {grid-template-columns:minmax(0,1fr) 5rem minmax(0,1fr);align-items:center;}& .spacing-inspector__cross-edge--top,& .spacing-inspector__cross-edge--bottom {inline-size:calc((100% - 5rem - 1rem)/2);}}
  .spacing-inspector__lineheight {display:flex;align-items:center;justify-content:center;box-sizing:border-box;inline-size:5rem;block-size:2.65rem;gap:.2rem;padding-inline:.25rem;border:0;border-radius:var(--ribbon-radius,.6rem);background:var(--ribbon-control,var(--color-surface-raised));color:var(--color-panel-text);& :global(svg) {inline-size:1.5rem;block-size:1.5rem;flex-shrink:0;color:inherit;}& :global(.scrubbable-number) {flex:0 0 2.2rem;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {block-size:2.65rem;padding-inline:.2rem;border:0;background:transparent;font-size:1rem;text-align:center;}}
  .spacing-inspector__cross-edge--top {grid-column:1 / -1;grid-row:1;inline-size:calc((100% - .5rem)/2);justify-self:center;}
  .spacing-inspector__cross-edge--bottom {grid-column:1 / -1;grid-row:3;inline-size:calc((100% - .5rem)/2);justify-self:center;}
  .spacing-inspector__cross-corner--radiusTL {grid-column:1;grid-row:1;}
  .spacing-inspector__cross-corner--radiusTR {grid-column:3;grid-row:1;}
  .spacing-inspector__cross-corner--radiusBR {grid-column:3;grid-row:3;}
  .spacing-inspector__cross-corner--radiusBL {grid-column:1;grid-row:3;}
  .spacing-inspector__cross-corner {position:relative;&::before {content:'';position:absolute;inset:-.15rem;inline-size:.9rem;block-size:.9rem;border:solid var(--color-panel-secondary);border-width:0;pointer-events:none;z-index:1;}}
  .spacing-inspector__cross-corner--radiusTL::before {border-top-width:1px;border-left-width:1px;border-top-left-radius:.5rem;}
  .spacing-inspector__cross-corner--radiusTR::before {inset-inline-start:auto;border-top-width:1px;border-right-width:1px;border-top-right-radius:.5rem;}
  .spacing-inspector__cross-corner--radiusBR::before {inset-block-start:auto;inset-inline-start:auto;border-bottom-width:1px;border-right-width:1px;border-bottom-right-radius:.5rem;}
  .spacing-inspector__cross-corner--radiusBL::before {inset-block-start:auto;border-bottom-width:1px;border-left-width:1px;border-bottom-left-radius:.5rem;}
  .spacing-inspector__cross-corner {& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {background:var(--color-surface-raised);}}
  .spacing-inspector__section {margin-block-start:1.15rem;& h3 {font-size:.85rem;font-weight:600;margin:0 0 .6rem;color:var(--color-panel-secondary);}}
  .spacing-inspector__pair {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem 1rem;}
  .spacing-inspector__field {display:grid;gap:.35rem;min-inline-size:0;&>span {font-size:.8rem;}& :global(.scrubbable-number) {min-inline-size:0;inline-size:100%;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {min-block-size:2.2rem;inline-size:100%;padding:.4rem .55rem;background:var(--color-input);color:var(--color-accent);font-size:.95rem;text-align:center;}}
  .spacing-inspector--neutral {
    & .spacing-inspector__margin {background:var(--color-panel-bg);border-color:var(--color-panel-secondary);}
    & .spacing-inspector__background {background:var(--color-surface-raised);border-color:var(--color-panel-secondary);}
    & .spacing-inspector__padding {background:transparent;border:0;}
    & .spacing-inspector__content {background:var(--color-surface-raised);border-color:var(--color-panel-secondary);}
  }
  .spacing-inspector--rows {& .spacing-inspector__pair {grid-template-columns:1fr;}& .spacing-inspector__field {grid-template-columns:minmax(0,1fr) 5.5rem;align-items:center;gap:1rem;}}
</style>
