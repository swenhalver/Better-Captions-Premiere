<script lang="ts">
  import { onMount } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import { createNativeGeometryController, canSeekGeometryKeyframe, type GeometryParameter } from '../lib/native-effect/geometry-controller';
  import type { NativeCaptionSnapshot, NativeCaptionControls, NativeCaptionControlEdit, NativeCaptionKeyframeSeek } from '../cep-api';
  interface Props {
    snapshot:NativeCaptionSnapshot;sequenceId:string;frameWidth:number;frameHeight:number;currentTime:number;visible:boolean;disabled?:boolean;
    read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;
    edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;
    seek:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;
    onTimeChange?:(seconds:number)=>void;
  }
  let {snapshot,sequenceId,currentTime,visible,disabled=false,read,edit,seek,onTimeChange=()=>{}}:Props=$props();
  let controls=$state.raw<NativeCaptionControls|null>(null),error=$state(''),dragging=$state(false),expanded=$state(false),boundariesExpanded=$state(true);
  const identity=()=>JSON.stringify([sequenceId,snapshot.locator,snapshot.revision]);
  const controller=createNativeGeometryController({current:()=>({key:identity(),sequenceId,snapshot,visible:visible&&(expanded||boundariesExpanded),disabled}),read:(s,id)=>read(s,id),edit:(s,r,id)=>edit(s,r,id),seek:(s,r,id)=>seek(s,r,id),state:value=>controls=value,error:message=>error=message});
  const mode=$derived(Number(controls?.rollUp?.value??0)>=.5),fade=$derived(Number(controls?.rollUpFade?.value??0)>=.5),independent=$derived(Number(controls?.boundaryMode?.value??1)===2);
  type ControlRow={key:GeometryParameter;label:string;type:'toggle'|'transition'|'direction'|'number'|'curve'|'boundaryMode';min?:number;max?:number;step?:number;decimals?:number;factor?:number;integer?:boolean;boundary?:boolean};
  const rows:ControlRow[]=[
    {key:'rollUp',label:'Enabled',type:'toggle'},
    {key:'rollUpTransition',label:'Line transition',type:'transition'},
    {key:'rollUpDirection',label:'Scroll direction',type:'direction'},
    {key:'rollUpSpeed',label:'Scroll speed, ×',type:'number',min:.1,max:10,step:.1,decimals:1},
    {key:'rollUpWait',label:'Wait for line to finish',type:'toggle'},
    {key:'rollUpDuration',label:'Transition duration, s',type:'number',min:0,max:2,step:.01,decimals:2},
  ];
  const directionalRows:ControlRow[]=[
    {key:'rollUpFade',label:'Soft fade',type:'toggle'},
    {key:'rollUpFadePosition',label:'Boundary position, %',type:'number',min:0,max:100,step:1,decimals:1,factor:100,boundary:true},
    {key:'rollUpFadeThickness',label:'Transition thickness, %',type:'number',min:0,max:100,step:1,decimals:1,factor:100,boundary:true},
    {key:'rollUpFadeAmount',label:'Fade amount, %',type:'number',min:0,max:100,step:1,decimals:1,factor:100,boundary:true},
    {key:'rollUpFadeCurve',label:'Transition curve',type:'curve',boundary:true},
  ];
  const sides=['Top','Bottom','Left','Right'] as const;
  const edgeRows=(side:typeof sides[number]):ControlRow[]=>[
    {key:`boundary${side}Inset`,label:'Crop inset, %',type:'number',min:0,max:100,step:1,decimals:1},
    {key:`boundary${side}Fade`,label:'Fade enabled',type:'toggle'},
    {key:`boundary${side}Width`,label:'Fade width, %',type:'number',min:0,max:100,step:1,decimals:1},
    {key:`boundary${side}Amount`,label:'Fade amount, %',type:'number',min:0,max:100,step:1,decimals:1},
    {key:`boundary${side}Curve`,label:'Fade curve',type:'curve'},
  ];
  let readTimer:ReturnType<typeof setTimeout>|undefined;
  $effect(()=>{void currentTime;void snapshot;void visible;void disabled;void expanded;void boundariesExpanded;
    if(!visible||disabled||!(expanded||boundariesExpanded)){if(readTimer!==undefined)clearTimeout(readTimer);readTimer=undefined;return;}
    if(readTimer===undefined)readTimer=setTimeout(()=>{readTimer=undefined;void controller.read();},80);
  });
  onMount(()=>{const timer=setInterval(()=>{void controller.read();},1200);return()=>{clearInterval(timer);if(readTimer!==undefined)clearTimeout(readTimer);controller.dispose();};});
  function drag(value:boolean){dragging=value;controller.setDragging(value);}
  function scalar(parameter:GeometryParameter,value:number,integer=false,factor=1){controller.queue(parameter,(integer?Math.round(value):value)/factor);}
  async function navigate(parameter:GeometryParameter,direction:'previous'|'next'){const next=await controller.seek(parameter,direction);if(next)onTimeChange(Number(next.timelineTicks)/254016000000);}
</script>

{#snippet controlRow(row:ControlRow,scope='Scrolling text')}
        {@const descriptor=controls?.[row.key]}
        <div class="native-rollup__row">
          <span class="native-rollup__animation" class:native-rollup__animation--enabled={descriptor?.animated} role="img" aria-label={`${scope} ${row.label} keyframing ${descriptor?.animated?'enabled in Effect Controls':'off'}`} title={descriptor?.animated?'Keyframing enabled in Effect Controls. Edits change the value at the playhead.':'Enable keyframing in Effect Controls.'}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 2h6M10 2v3m4.5.5 1.3-1.3"/><circle cx="10" cy="12" r="6.5"/><path d="M10 8v4l2 1.5"/></svg>
          </span>
          <span class="native-rollup__label">{row.label}</span>
          <div class="native-rollup__value">
            {#if row.type==='toggle'}
              <input type="checkbox" aria-label={row.key==='rollUp'?'Enable scrolling text':`${scope} ${row.label}`} checked={Number(descriptor?.value??0)>=.5} disabled={disabled||!controls?.insideClip||!descriptor} onchange={event=>scalar(row.key,event.currentTarget.checked?1:0)}/>
            {:else if row.type==='boundaryMode'}
              <select aria-label="Text box boundary mode" value={descriptor?.value as number??1} disabled={disabled||!controls?.insideClip||!descriptor} onchange={event=>scalar(row.key,Number(event.currentTarget.value),true)}><option value={1}>Directional edge</option><option value={2}>All four sides</option></select>
            {:else if row.type==='transition'}
              <select aria-label="Scrolling text line transition" value={descriptor?.value as number??1} disabled={disabled||!controls?.insideClip||!descriptor} onchange={event=>scalar(row.key,Number(event.currentTarget.value),true)}><option value={1}>Scroll</option><option value={2}>Fade</option><option value={3}>Slide</option><option value={4}>Pop</option></select>
            {:else if row.type==='direction'}
              <select aria-label="Scrolling text direction" value={descriptor?.value as number??1} disabled={disabled||!controls?.insideClip||!descriptor} onchange={event=>scalar(row.key,Number(event.currentTarget.value),true)}><option value={1}>Up</option><option value={2}>Down</option><option value={3}>Left</option><option value={4}>Right</option></select>
            {:else if row.type==='curve'}
              <select aria-label={`${scope} ${row.label}`} value={descriptor?.value as number??2} disabled={disabled||!controls?.insideClip||!descriptor} onchange={event=>scalar(row.key,Number(event.currentTarget.value),true)}><option value={2}>Smooth</option><option value={1}>Linear</option><option value={3}>Gentle start</option><option value={4}>Gentle finish</option></select>
            {:else}
              <ScrubbableNumber label={`${scope} ${row.label}`} value={descriptor?Number(descriptor.value)*(row.factor??1):null} min={row.min??0} max={row.max??100} step={row.step??1} decimals={row.decimals??1} variant="hot" disabled={disabled||!controls?.insideClip||!descriptor} onChange={value=>scalar(row.key,value,row.integer??false,row.factor??1)} onReset={()=>controller.queue(row.key)} onDragState={drag}/>
            {/if}
          </div>
          <div class="native-rollup__navigation">
            {#if descriptor?.animated}
              <button class="native-rollup__key" aria-label={`Previous ${scope} ${row.label} keyframe`} title="Previous keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,row.key,'previous')} onclick={()=>navigate(row.key,'previous')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m10 3-5 5 5 5"/></svg></button>
              <button class="native-rollup__key" aria-label={`Next ${scope} ${row.label} keyframe`} title="Next keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,row.key,'next')} onclick={()=>navigate(row.key,'next')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>
            {/if}
          </div>
          <button class="native-rollup__reset" aria-label={`Reset ${scope} ${row.label}`} title={`Reset ${row.label}${descriptor?.animated?' at playhead; keeps keyframing':''}`} disabled={disabled||!controls?.insideClip||!descriptor||dragging} onclick={()=>controller.queue(row.key)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 9a7 7 0 1 1 1 6M3 3v6h6"/></svg></button>
        </div>
{/snippet}

<details class="caption-section native-rollup" bind:open={expanded}>
  <summary class="caption-section__heading">Scrolling text</summary>
  <div class="caption-section__body native-rollup__body">
    {#each rows as row}
      {#if row.key==='rollUp'||mode}
        {@render controlRow(row)}
      {/if}
    {/each}
    {#if error}<p class="native-rollup__message native-rollup__message--error" role="alert">{error}</p>{:else if controls&&!controls.rollUp}<p class="native-rollup__message">Update the native caption effect to enable scrolling text.</p>{:else if controls&&!controls.insideClip}<p class="native-rollup__message">Move the playhead inside this caption clip to edit.</p>{/if}
  </div>
</details>

<details class="caption-section native-rollup" bind:open={boundariesExpanded}>
  <summary class="caption-section__heading">Text box boundaries</summary>
  <div class="caption-section__body native-rollup__body">
    <p class="native-rollup__message">Crop and fade the edges while scrolling. Insets and fade widths are percentages of the text box.</p>
    {@render controlRow({key:'boundaryMode',label:'Boundaries',type:'boundaryMode'},'Text box')}
    {#if controls&&!controls.boundaryMode}
      <p class="native-rollup__message">Update the native caption effect to use independent boundaries.</p>
    {:else if independent}
      {#each sides as side}
        <fieldset class="native-rollup__edge">
          <legend class="native-rollup__edge-label">{side}</legend>
          {#each edgeRows(side) as row}
            {@render controlRow(row,`${side} boundary`)}
          {/each}
        </fieldset>
      {/each}
    {:else}
      <p class="native-rollup__message">Directional edge keeps the existing fade settings. Choose All four sides for separate top, bottom, left and right controls.</p>
      {#each directionalRows as row}
        {#if !row.boundary||fade}{@render controlRow(row,'Directional boundary')}{/if}
      {/each}
    {/if}
    {#if !mode}<p class="native-rollup__message">Enable scrolling text to see these boundaries in the video.</p>{/if}
    {#if error}<p class="native-rollup__message native-rollup__message--error" role="alert">{error}</p>{:else if controls&&!controls.insideClip}<p class="native-rollup__message">Move the playhead inside this caption clip to edit.</p>{/if}
  </div>
</details>

<style>
  .native-rollup__edge { min-inline-size:0;margin:0;padding:var(--caption-space-xs) 0 var(--caption-space-s);border:0; }
  .native-rollup__edge-label { padding:var(--caption-space-s) 0 var(--caption-space-xs);font-size:var(--caption-type-s);font-weight:600;color:var(--color-panel-text); }
  .native-rollup__body { gap:var(--caption-space-xs); }
  .native-rollup__row { display:grid;grid-template-columns:1.25rem minmax(5rem,1fr) minmax(4.5rem,.7fr) auto 1.8rem;align-items:center;gap:var(--caption-space-xs);min-block-size:2.1rem;border-block-end:1px solid var(--color-panel-border);font-size:var(--caption-type-s); }
  .native-rollup__animation { display:grid;place-items:center;color:var(--color-panel-secondary);& svg {inline-size:1.1rem;block-size:1.1rem;} }
  .native-rollup__animation--enabled { color:var(--color-accent); }
  .native-rollup__label { color:var(--color-panel-secondary); }
  .native-rollup__value { min-inline-size:0;& input[type="checkbox"] {inline-size:1rem;block-size:1rem;accent-color:var(--color-accent);}& select {inline-size:100%;min-inline-size:0;padding:var(--caption-space-xs);border:1px solid var(--color-panel-border);border-radius:var(--caption-radius);background:var(--color-input);color:var(--color-panel-text);font-size:var(--caption-type-xs);}& :disabled {opacity:.5;} }
  .native-rollup__navigation { display:flex;align-items:center; }
  .native-rollup__key,.native-rollup__reset { display:grid;place-items:center;block-size:1.8rem;padding:0;border:0;background:transparent;color:var(--color-panel-secondary);cursor:pointer;&:hover:enabled {color:var(--color-panel-text);}&:focus-visible {outline:1px solid var(--color-accent);outline-offset:1px;}&:disabled {opacity:.45;cursor:default;} }
  .native-rollup__key { inline-size:1.2rem;color:var(--color-accent);& svg {inline-size:1rem;block-size:1rem;} }
  .native-rollup__reset { inline-size:1.8rem;& svg {inline-size:1.2rem;block-size:1.2rem;} }
  .native-rollup__message { margin-block:var(--caption-space-xs);font-size:var(--caption-type-xs);color:var(--color-panel-secondary); }
  .native-rollup__message--error { color:var(--color-error); }
</style>
