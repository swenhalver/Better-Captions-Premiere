<script lang="ts">
  import {onMount} from 'svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import {createNativeGeometryController,canSeekGeometryKeyframe} from '../lib/native-effect/geometry-controller';
  import type {NativeCaptionSnapshot,NativeCaptionControls,NativeCaptionControlEdit,NativeCaptionKeyframeSeek} from '../cep-api';
  interface Props {snapshot:NativeCaptionSnapshot;sequenceId:string;currentTime:number;visible:boolean;disabled?:boolean;
    read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;seek:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;onTimeChange?:(seconds:number)=>void;}
  let {snapshot,sequenceId,currentTime,visible,disabled=false,read,edit,seek,onTimeChange=()=>{}}:Props=$props();
  let controls=$state.raw<NativeCaptionControls|null>(null),error=$state('');
  const controller=createNativeGeometryController({current:()=>({key:JSON.stringify([sequenceId,snapshot.locator,snapshot.revision]),sequenceId,snapshot,visible,disabled}),read:(s,id)=>read(s,id),edit:(s,r,id)=>edit(s,r,id),seek:(s,r,id)=>seek(s,r,id),state:value=>controls=value,error:value=>error=value});
  let readTimer:ReturnType<typeof setTimeout>|undefined;
  $effect(()=>{void currentTime;void snapshot;void visible;void disabled;if(!visible||disabled){clearTimeout(readTimer);readTimer=undefined;return;}if(readTimer===undefined)readTimer=setTimeout(()=>{readTimer=undefined;void controller.read();},80);});
  onMount(()=>{const timer=setInterval(()=>{void controller.read();},1200);return()=>{clearInterval(timer);clearTimeout(readTimer);controller.dispose();};});
  let value:'left'|'center'|'right'|null=$derived(controls?.alignment?.value===1?'left':controls?.alignment?.value===2?'center':controls?.alignment?.value===3?'right':null);
  async function navigate(direction:'previous'|'next'){const next=await controller.seek('alignment',direction);if(next)onTimeChange(Number(next.timelineTicks)/254016000000);}
</script>
<div class="native-alignment" title={error||(!controls?.alignment?'Update the native caption effect to use alignment.':controls.alignment.animated?'Alignment keyframing enabled in Effect Controls. Edits change the value at the playhead.':'Caption alignment')}>
  <AlignmentButtons {value} disabled={disabled||!controls?.alignment||!controls.insideClip} onChange={value=>controller.queue('alignment',value==='left'?1:value==='center'?2:3)}/>
  {#if controls?.alignment?.animated}<span class="native-alignment__animated" role="img" aria-label="Alignment keyframing enabled in Effect Controls"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 2h6M10 2v3"/><circle cx="10" cy="12" r="6.5"/><path d="M10 8v4l2 1.5"/></svg></span>
    {#each ['previous','next'] as direction}<button class="native-alignment__key" aria-label={`${direction==='previous'?'Previous':'Next'} Alignment keyframe`} disabled={disabled||!canSeekGeometryKeyframe(controls,'alignment',direction as 'previous'|'next')} onclick={()=>navigate(direction as 'previous'|'next')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d={direction==='previous'?'m10 3-5 5 5 5':'m6 3 5 5-5 5'}/></svg></button>{/each}
  {/if}
  {#if error}<span class="native-alignment__error" role="alert">{error}</span>{/if}
</div>
<style>
  .native-alignment {display:flex;align-items:center;position:relative;}
  .native-alignment__animated {display:grid;place-items:center;color:var(--color-accent);& svg {inline-size:1rem;block-size:1rem;}}
  .native-alignment__key {display:grid;place-items:center;inline-size:1.2rem;block-size:2.25rem;border:0;background:transparent;color:var(--color-accent);cursor:pointer;& svg {inline-size:1rem;block-size:1rem;}&:disabled {opacity:.45;cursor:default;}&:focus-visible {outline:1px solid var(--color-accent);}}
  .native-alignment__error {position:absolute;inset-block-start:100%;inset-inline-end:0;max-inline-size:20rem;padding:var(--caption-space-xs);background:var(--color-surface-raised);color:var(--color-error);font-size:var(--caption-type-xs);z-index:1;}
</style>
