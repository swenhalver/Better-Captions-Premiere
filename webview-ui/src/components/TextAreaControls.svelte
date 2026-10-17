<script lang="ts">
  import {untrack} from 'svelte';
  import type {CaptionItem} from '../lib/types';
  import {sampleArea,sampleAt,editSample,type TextAreaState,type TextAreaEdit,type AreaTrack} from '../lib/text-area';
  import MotionIcon from './MotionIcon.svelte';
  interface Props {caption:CaptionItem;sequenceId:string;frameRate:number;frameWidth:number;frameHeight:number;currentTime:number;visible:boolean;isDemo:boolean;read:(caption:CaptionItem,id:string,frame:number)=>Promise<TextAreaState>;edit:(caption:CaptionItem,id:string,request:TextAreaEdit)=>Promise<TextAreaState>;onSeek:(time:number)=>void;onBusy:(busy:boolean)=>void;onChanged:()=>void;}
  let {caption,sequenceId,frameRate,frameWidth,frameHeight,currentTime,visible,isDemo,read,edit,onSeek,onBusy,onChanged}:Props=$props();
  let area=$state<TextAreaState|null>(null),busy=$state(false),problem=$state(''),notice=$state('');
  let sampleUndo:TextAreaState|null=null,generation=0;
  const samples=new Map<string,TextAreaState>();
  const names=[{key:'position',label:'Position'},{key:'width',label:'Width'},{key:'height',label:'Height'}] as const;
  const identity=$derived(JSON.stringify([sequenceId,caption.id,caption.clipNodeId,caption.mediaPath,caption.renderBounds]));
  const frame=$derived(Math.max(0,Math.round((currentTime-caption.startTime)*frameRate)));
  $effect(()=>{const key=identity;const show=visible;if(!show)return;untrack(()=>{generation++;area=null;sampleUndo=null;void refresh(frame,key);});});
  async function refresh(at=frame,key=identity){
    if(busy)return;
    if(!isDemo&&!caption.clipNodeId){area=null;return;}
    const token=generation,selected=JSON.parse(JSON.stringify(caption)),id=sequenceId;
    busy=true;problem='';if(!isDemo)onBusy(true);
    try {
      const next=isDemo?sampleAt(samples.get(key)??sampleArea(frameWidth,frameHeight,frameRate,caption.startTime,caption.endTime),at):await read(selected,id,at);
      if(token===generation&&key===identity)area=next;
    }catch(e){if(token===generation)problem=e instanceof Error?e.message:String(e);}
    finally{busy=false;if(!isDemo)onBusy(false);if(token!==generation&&visible)void refresh(frame,identity);}
  }
  async function seek(at:number){
    if(!Number.isFinite(at)||busy)return;
    const bounded=Math.max(0,Math.min((area?.count??1)-1,Math.round(at)));
    onSeek((area?.startTime??caption.startTime)+bounded/frameRate);
    await refresh(bounded);
  }
  async function change(request:Omit<TextAreaEdit,'signature'|'frame'>){
    if(!area||busy)return;
    const previous=JSON.parse(JSON.stringify(area)),token=generation,key=identity,selected=JSON.parse(JSON.stringify(caption)),id=sequenceId;
    busy=true;problem='';if(!isDemo)onBusy(true);
    try{
      let next:TextAreaState;
      const action={...request,signature:previous.signature,frame:previous.frame};
      if(isDemo){next=request.operation==='undo'&&sampleUndo?sampleUndo:editSample(previous,action);sampleUndo=previous;samples.set(key,next);}
      else next=await edit(selected,id,action);
      if(token===generation&&key===identity){area=next;notice=isDemo?'Sample keyframes updated.':'Motion updated in Premiere. Width and height reflow after the edit.';await onChanged();}
    }catch(e){if(token===generation)problem=e instanceof Error?e.message:String(e);}
    finally{busy=false;if(!isDemo)onBusy(false);}
  }
  function setValue(name:AreaTrack,index:number,value:number){
    if(!area||!Number.isFinite(value)||(name!=='position'&&value<=0)){problem='Enter a valid pixel value. Width and height must be greater than zero.';return;}
    const values=[...area.tracks[name].value];values[index]=value;void change({track:name,operation:'set',value:values});
  }
</script>

<details class="caption-section text-area">
  <summary class="caption-section__heading">Position & size <span>Selected caption</span></summary>
  <div class="caption-section__body">
    <p class="caption-help">All word states · {frameWidth} × {frameHeight} px</p>
    {#if !isDemo&&!caption.clipNodeId}<p class="caption-help">Apply this caption to the Program Monitor first to edit its native Motion keyframes.</p>{/if}
    <div class="text-area__toolbar"><button class="caption-button" disabled={busy||(!isDemo&&!caption.clipNodeId)} onclick={()=>refresh()}>Refresh from {isDemo?'sample':'playhead'}</button><button class="caption-button" disabled={busy||!area?.canUndo} onclick={()=>change({operation:'undo'})}>Undo area edit</button></div>
    {#if busy&&!area}<p class="caption-help" role="status">Reading caption Motion…</p>{/if}
    {#if area}
      <fieldset disabled={busy}>
        <label class="caption-field"><span>Playhead, caption frame</span><input type="number" aria-label="Text area playhead frame" min="0" max={area.count-1} step="1" value={area.frame} onchange={(e)=>seek(e.currentTarget.valueAsNumber)}/></label>
        <input class="text-area__scrub" type="range" aria-label="Text area playhead" min="0" max={area.count-1} step="1" value={area.frame} onchange={(e)=>seek(e.currentTarget.valueAsNumber)}/>
        <p class="caption-help">Sequence time · {(area.startTime+area.frame/area.frameRate).toFixed(3)}s</p>
        {#each names as item}
          {@const track=area.tracks[item.key]}
          {@const atKey=track.keys.find(k=>Math.abs(k.frame-area!.frame)<.001)}
          {@const previous=[...track.keys].reverse().find(k=>k.frame<area!.frame&&k.frame>=0)}
          {@const next=track.keys.find(k=>k.frame>area!.frame&&k.frame<area!.count)}
          <div class="text-area__track">
            <div class="text-area__track-heading">
              <button class="caption-button caption-button--icon" aria-label="{item.label} keyframes" aria-pressed={track.animated} title="{track.animated?'Disable':'Enable'} {item.label.toLowerCase()} animation" onclick={()=>change({track:item.key,operation:'toggle'})}><MotionIcon name="clock"/></button>
              <strong>{item.label}</strong><span>{track.animated?`${track.keys.length} keys`:'Static'}</span>
              <button class="caption-button caption-button--icon" aria-label="Previous {item.label.toLowerCase()} keyframe" disabled={!previous} onclick={()=>previous&&seek(previous.frame)}><MotionIcon name="previous"/></button>
              <button class="caption-button caption-button--icon" aria-label="Add or remove {item.label.toLowerCase()} keyframe" aria-pressed={!!atKey} disabled={!track.animated} onclick={()=>change({track:item.key,operation:'key'})}><MotionIcon name="key"/></button>
              <button class="caption-button caption-button--icon" aria-label="Next {item.label.toLowerCase()} keyframe" disabled={!next} onclick={()=>next&&seek(next.frame)}><MotionIcon name="next"/></button>
            </div>
            <div class="caption-controls">
              {#each track.value as value,i}<label class="caption-field" class:caption-field--wide={item.key!=='position'}><span>{item.key==='position'?(i===0?'X':'Y'):'Size'}, px</span><input type="number" step="1" aria-label="{item.label} {item.key==='position'?(i===0?'X':'Y'):'size'}, px" value={Number(value.toFixed(3))} onchange={(e)=>setValue(item.key,i,e.currentTarget.valueAsNumber)}/></label>{/each}
              <label class="caption-field caption-field--wide"><span>Keyframe interpolation</span><select aria-label="{item.label} keyframe interpolation" disabled={!atKey} value={atKey?.interpolation??'native'} onchange={(e)=>change({track:item.key,operation:'interpolation',interpolation:e.currentTarget.value})}><option value="native" disabled>Native / between keys</option><option value="linear">Linear</option><option value="bezier">Bezier</option><option value="hold">Hold</option></select></label>
            </div>
          </div>
        {/each}
      </fieldset>
      <p class="caption-help">Enable a stopwatch, move the playhead, then change a value. Width reflows text at the same font size; height is independent.</p>
      {#if !isDemo}<p class="caption-help">Each edit also appears in Premiere’s Undo history. Refresh after editing in Effect Controls.</p>{/if}
    {/if}
    {#if problem}<p class="caption-message caption-message--error" role="alert">{problem}</p>{:else if notice}<p class="caption-help" role="status">{notice}</p>{/if}
  </div>
</details>
<style>
  .text-area summary span{float:right;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);font-weight:400}.text-area fieldset{border:0;padding:0;min-inline-size:0}.text-area__toolbar{display:flex;flex-wrap:wrap;gap:.4rem}.text-area__toolbar button{font-size:var(--caption-type-xs);padding-inline:.5rem}.text-area__scrub{inline-size:100%;accent-color:var(--color-accent);margin-block:var(--caption-space-s)}.text-area__track{border-block-start:1px solid var(--color-panel-border);margin-block-start:var(--caption-space-m);padding-block-start:var(--caption-space-s)}.text-area__track-heading{display:flex;align-items:center;gap:.25rem;margin-block-end:var(--caption-space-s);font-size:var(--caption-type-s)}.text-area__track-heading span{margin-inline-start:auto;font-size:var(--caption-type-xs);color:var(--color-panel-secondary)}.text-area__track-heading .caption-button--icon{inline-size:1.8rem;min-block-size:1.8rem;padding:.25rem}.text-area__track-heading [aria-pressed=true]{background:var(--color-selection);color:var(--color-accent)}.text-area input[type=number]{font-variant-numeric:tabular-nums}
</style>
