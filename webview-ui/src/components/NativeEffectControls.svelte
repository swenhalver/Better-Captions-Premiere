<script lang="ts">
  import { onMount } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import LucideIcon from './LucideIcon.svelte';
  import { createNativeGeometryController, canSeekGeometryKeyframe, nativeGeometryLayer, type GeometryParameter } from '../lib/native-effect/geometry-controller';
  import type { NativeCaptionSnapshot, NativeCaptionControls, NativeCaptionControlEdit, NativeCaptionKeyframeSeek } from '../cep-api';
  interface Props {
    snapshot:NativeCaptionSnapshot;sequenceId:string;frameWidth:number;frameHeight:number;currentTime:number;visible:boolean;disabled?:boolean;
    read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;
    edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;
    seek:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;onTimeChange?:(seconds:number)=>void;onInteracting?:(active:boolean)=>void;
    onControlsChange?:(controls:NativeCaptionControls|null)=>void;
  }
  let {snapshot,sequenceId,frameWidth,frameHeight,currentTime,visible,disabled=false,read,edit,seek,onTimeChange=()=>{},onInteracting=()=>{},onControlsChange=()=>{}}:Props=$props();
  let controls=$state.raw<NativeCaptionControls|null>(null),error=$state(''),dragging=$state(false);
  const identity=()=>JSON.stringify([sequenceId,snapshot.locator,snapshot.revision]);
  const controller=createNativeGeometryController({current:()=>({key:identity(),layer:nativeGeometryLayer(sequenceId,snapshot),sequenceId,snapshot,visible,disabled}),read:(s,id)=>read(s,id),edit:(s,r,id)=>edit(s,r,id),seek:(s,r,id)=>seek(s,r,id),state:value=>{controls=value;onControlsChange(value);},error:message=>error=message,interacting:active=>onInteracting(active)});
  let readTimer:ReturnType<typeof setTimeout>|undefined;
  $effect(()=>{void currentTime;void snapshot;void visible;void disabled;
    if(!visible||disabled){if(readTimer!==undefined)clearTimeout(readTimer);readTimer=undefined;return;}
    // Throttle instead of debouncing: values refresh during a timeline scrub.
    if(readTimer===undefined)readTimer=setTimeout(()=>{readTimer=undefined;void controller.read();},80);
  });
  onMount(()=>{const timer=setInterval(()=>{void controller.read();},1200);return()=>{clearInterval(timer);if(readTimer!==undefined)clearTimeout(readTimer);controller.dispose();};});
  function drag(value:boolean){dragging=value;controller.setDragging(value);}
  function axis(index:0|1,value:number){if(!controls)return;controller.queuePositionAxis(index,value/(index===0?frameWidth:frameHeight));}
  function resetAxis(index:0|1){if(!controls)return;controller.queuePositionAxis(index,(controls.position.defaultValue as [number,number])[index]);}
  function scalar(parameter:'width'|'height'|'rollUpLines'|'rollUpCurrentLine',value:number){controller.queue(parameter,parameter==='rollUpLines'||parameter==='rollUpCurrentLine'?Math.round(value):value);}
  async function navigate(parameter:GeometryParameter,direction:'previous'|'next'){const next=await controller.seek(parameter,direction);if(next)onTimeChange(Number(next.timelineTicks)/254016000000);}
  const rows=['position','width','height','rollUpLines','rollUpCurrentLine'] as const;
  const labels={position:'Position',width:'Width',height:'Height',rollUpLines:'Visible lines',rollUpCurrentLine:'Current line'};
</script>

<section class="native-geometry" aria-label="Native caption position and size">
  {#each rows as parameter}
    {@const descriptor=controls?.[parameter]}
    {#if parameter!=='rollUpCurrentLine'||descriptor}
    <div class="native-geometry__row" title={parameter==='rollUpCurrentLine' ? "Which visible line holds the line being spoken, counted from the top. 1 is the top line; when lines scroll up, higher numbers show upcoming lines below it." : undefined}>
      <span class="native-geometry__animation" class:native-geometry__animation--enabled={descriptor?.animated} role="img" aria-label={descriptor?.animated ? `${labels[parameter]} keyframing enabled in Effect Controls` : `${labels[parameter]} keyframing off`} title={descriptor?.animated ? 'Keyframing enabled in Effect Controls. Edits change the value at the playhead.' : 'Keyframing is off. Enable it in Effect Controls.'}>
        <LucideIcon name="timer"/>
      </span>
      <span class="native-geometry__label">{labels[parameter]}</span>
      <div class="native-geometry__values">
        {#if parameter==='position'}
          <ScrubbableNumber label="Caption Position X" value={descriptor ? (descriptor.value as [number,number])[0]*frameWidth : null} min={-frameWidth*10} max={frameWidth*10} step={1} decimals={1} variant="hot" disabled={disabled||!controls?.insideClip||!descriptor} onChange={value=>axis(0,value)} onReset={()=>resetAxis(0)} onDragState={drag}/>
          <ScrubbableNumber label="Caption Position Y" value={descriptor ? (descriptor.value as [number,number])[1]*frameHeight : null} min={-frameHeight*10} max={frameHeight*10} step={1} decimals={1} variant="hot" disabled={disabled||!controls?.insideClip||!descriptor} onChange={value=>axis(1,value)} onReset={()=>resetAxis(1)} onDragState={drag}/>
        {:else}
          <ScrubbableNumber label={`Caption ${labels[parameter]}`} value={descriptor?.value as number ?? null} min={1} max={parameter==='rollUpCurrentLine'?(controls?.rollUpLines?.value as number ?? 8):parameter==='rollUpLines'?8:8192} step={1} decimals={parameter==='rollUpLines'||parameter==='rollUpCurrentLine'?0:1} variant="hot" disabled={disabled||!controls?.insideClip||!descriptor} onChange={value=>scalar(parameter,value)} onReset={()=>controller.queue(parameter)} onDragState={drag}/>
        {/if}
      </div>
      <div class="native-geometry__navigation">
        {#if descriptor?.animated}
          <button class="native-geometry__key" aria-label={`Previous ${labels[parameter]} keyframe`} title="Previous keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,parameter,'previous')} onclick={()=>navigate(parameter,'previous')}><LucideIcon name="chevron-left"/></button>
          <button class="native-geometry__key" aria-label={`Next ${labels[parameter]} keyframe`} title="Next keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,parameter,'next')} onclick={()=>navigate(parameter,'next')}><LucideIcon name="chevron-right"/></button>
        {/if}
      </div>
      <button class="native-geometry__reset" aria-label={`Reset caption ${labels[parameter]}`} title={`Reset ${labels[parameter]}${descriptor?.animated ? ' at playhead; keeps keyframing' : ''}`} disabled={disabled||!controls?.insideClip||!descriptor||dragging} onclick={()=>controller.queue(parameter as GeometryParameter)}><LucideIcon name="reset"/></button>
    </div>
    {/if}
  {/each}
  {#if error}<p class="native-geometry__error" role="alert">{error}</p>{:else if controls&&!controls.insideClip}<p class="native-geometry__hint">Move the playhead inside this caption clip to edit.</p>{/if}
</section>

<style>
  .native-geometry { display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:var(--caption-space-xs) var(--caption-space-s); }
  .native-geometry__row { display:grid;grid-template-columns:1.25rem minmax(4rem,.7fr) minmax(5.5rem,1fr) auto 1.8rem;align-items:center;gap:var(--caption-space-xs);min-block-size:2.1rem;border-block-end:1px solid var(--color-panel-border);font-size:var(--caption-type-s); }
  .native-geometry__animation { display:grid;place-items:center;color:var(--color-panel-secondary);& :global(svg) {inline-size:1.1rem;block-size:1.1rem;} }
  .native-geometry__animation--enabled { color:var(--color-accent); }
  .native-geometry__label { color:var(--color-panel-secondary); }
  .native-geometry__values { display:flex;align-items:center;min-inline-size:0;gap:var(--caption-space-xs);& > :global(*) { flex:1;min-inline-size:0; } }
  .native-geometry__navigation {display:flex;align-items:center;}
  .native-geometry__key {display:grid;place-items:center;inline-size:1.2rem;block-size:1.8rem;padding:0;border:0;background:transparent;color:var(--color-accent);cursor:pointer;& :global(svg) {inline-size:1rem;block-size:1rem;}&:disabled {color:var(--color-panel-secondary);opacity:.4;cursor:default;}&:focus-visible {outline:1px solid var(--color-accent);}}
  .native-geometry__reset { display:grid;place-items:center;inline-size:1.8rem;block-size:1.8rem;border:0;background:transparent;color:var(--color-panel-secondary);cursor:pointer;& :global(svg) {inline-size:1.2rem;block-size:1.2rem;}&:hover:enabled {color:var(--color-panel-text);}&:focus-visible {outline:1px solid var(--color-accent);outline-offset:1px;}&:disabled {opacity:.45;cursor:default;} }
  .native-geometry__error,.native-geometry__hint { grid-column:1/-1;margin-block:var(--caption-space-xs);font-size:var(--caption-type-xs);color:var(--color-panel-secondary); }
  .native-geometry__error { color:var(--color-error); }
</style>
