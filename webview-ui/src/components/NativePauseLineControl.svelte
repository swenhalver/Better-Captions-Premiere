<script lang="ts">
  import { onMount } from 'svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  import LucideIcon from './LucideIcon.svelte';
  import { createNativeGeometryController, canSeekGeometryKeyframe, nativeGeometryLayer } from '../lib/native-effect/geometry-controller';
  import type { NativeCaptionSnapshot, NativeCaptionControls, NativeCaptionControlEdit, NativeCaptionKeyframeSeek } from '../cep-api';
  interface Props {
    snapshot:NativeCaptionSnapshot;sequenceId:string;currentTime:number;visible:boolean;disabled?:boolean;
    read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;
    edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;
    seek:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;
    onControlsChange?:(controls:NativeCaptionControls|null)=>void;onTimeChange?:(seconds:number)=>void;onInteracting?:(active:boolean)=>void;
  }
  let {snapshot,sequenceId,currentTime,visible,disabled=false,read,edit,seek,onControlsChange=()=>{},onTimeChange=()=>{},onInteracting=()=>{}}:Props=$props();
  let controls=$state.raw<NativeCaptionControls|null>(null),error=$state(''),dragging=$state(false);
  const parameter='rollUpBlankLineSeconds';
  const help="Seconds of silence that make one blank (pause) line in scrolling captions. A pause gets one blank line for every full length of silence, up to Visible lines; a shorter pause adds none. Example: at 2 s, a 1 s pause adds nothing and a 4.5 s pause adds 2 blank lines. 0 = Auto (uses the clip's average line length).";
  const controller=createNativeGeometryController({current:()=>({key:JSON.stringify([sequenceId,snapshot.locator,snapshot.revision]),layer:nativeGeometryLayer(sequenceId,snapshot),sequenceId,snapshot,visible,disabled}),read:(s,id)=>read(s,id),edit:(s,r,id)=>edit(s,r,id),seek:(s,r,id)=>seek(s,r,id),state:value=>{controls=value;onControlsChange(value);},error:value=>error=value,interacting:active=>onInteracting(active)});
  let readTimer:ReturnType<typeof setTimeout>|undefined;
  $effect(()=>{void currentTime;void snapshot;void visible;void disabled;
    if(!visible||disabled){clearTimeout(readTimer);readTimer=undefined;return;}
    if(readTimer===undefined)readTimer=setTimeout(()=>{readTimer=undefined;void controller.read();},80);
  });
  onMount(()=>{const timer=setInterval(()=>{void controller.read();},1200);return()=>{clearInterval(timer);clearTimeout(readTimer);controller.dispose();};});
  function drag(active:boolean){dragging=active;controller.setDragging(active);}
  async function navigate(direction:'previous'|'next'){const next=await controller.seek(parameter,direction);if(next)onTimeChange(Number(next.timelineTicks)/254016000000);}
  let descriptor=$derived(controls?.rollUpBlankLineSeconds);
</script>

{#if descriptor}
  <div class="pause-line" title={help}>
    <div class="caption-field">
      <span title={help}>Pause Line Length</span>
      <div class="pause-line__controls">
        <ScrubbableNumber label="Pause Line Length" value={descriptor.value as number} min={0} max={30} step={0.1} decimals={1} zeroLabel="Auto" title={help} disabled={disabled||!controls?.insideClip} onChange={value=>controller.queue(parameter,value)} onReset={()=>controller.queue(parameter)} onDragState={drag}/>
        <span class="pause-line__animation" class:pause-line__animation--enabled={descriptor.animated} role="img" aria-label={descriptor.animated?'Pause Line Length keyframing enabled in Effect Controls':'Pause Line Length keyframing off'} title={descriptor.animated?'Keyframing enabled in Effect Controls. Edits change the value at the playhead.':'Keyframing is off. Enable it in Effect Controls.'}><LucideIcon name="timer"/></span>
        {#if descriptor.animated}
          <button class="pause-line__button" aria-label="Previous Pause Line Length keyframe" title="Previous keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,parameter,'previous')} onclick={()=>navigate('previous')}><LucideIcon name="chevron-left"/></button>
          <button class="pause-line__button" aria-label="Next Pause Line Length keyframe" title="Next keyframe" disabled={disabled||dragging||!canSeekGeometryKeyframe(controls,parameter,'next')} onclick={()=>navigate('next')}><LucideIcon name="chevron-right"/></button>
        {/if}
        <button class="pause-line__button" aria-label="Reset Pause Line Length" title={`Reset Pause Line Length${descriptor.animated?' at playhead; keeps keyframing':''}`} disabled={disabled||!controls?.insideClip||dragging} onclick={()=>controller.queue(parameter)}><LucideIcon name="reset"/></button>
      </div>
    </div>
    <span class="pause-line__help" role="tooltip">{help}</span>
    {#if !controls?.insideClip}<p class="pause-line__hint">Move the playhead inside this caption clip to edit.</p>{/if}
  </div>
{/if}
{#if error}<p class="pause-line__error" role="alert">{error}</p>{/if}

<style>
  .pause-line {
    position:relative;
    &:hover, &:focus-within {
      & .pause-line__help { visibility:visible; }
    }
  }
  .pause-line__controls { display:flex;align-items:center;gap:var(--caption-space-xs);& > :global(.scrubbable-number) {flex:1;min-inline-size:0;} }
  .pause-line__animation { display:grid;place-items:center;color:var(--color-panel-secondary);inline-size:1.8rem;& :global(svg) {inline-size:1.1rem;block-size:1.1rem;} }
  .pause-line__animation--enabled {color:var(--color-accent);}
  .pause-line__button { display:grid;place-items:center;inline-size:1.8rem;block-size:2.25rem;padding:0;border:0;background:transparent;color:var(--color-panel-secondary);cursor:pointer;& :global(svg) {inline-size:1.2rem;block-size:1.2rem;}&:hover:enabled {color:var(--color-panel-text);}&:disabled {opacity:.45;cursor:default;} }
  .pause-line__help { position:absolute;z-index:10;inset-inline:0;inset-block-start:calc(100% + var(--caption-space-xs));box-sizing:border-box;visibility:hidden;padding:var(--caption-space-m);border-radius:var(--caption-radius);background:var(--color-surface-overlay);color:var(--color-panel-text);font-size:var(--caption-type-s);font-weight:400;line-height:1.5;white-space:normal;overflow-wrap:anywhere;pointer-events:none; }
  .pause-line__hint,.pause-line__error {margin-block:var(--caption-space-xs);font-size:var(--caption-type-xs);color:var(--color-panel-secondary);}
  .pause-line__error {color:var(--color-error);}
</style>
