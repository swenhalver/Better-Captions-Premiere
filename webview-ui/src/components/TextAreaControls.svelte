<script module lang="ts">
  import type {CaptionItem} from '../lib/types';
  import type {TextAreaState,TextAreaEdit,AreaTrack} from '../lib/text-area';
  export interface AreaContext {
    key:string;caption:CaptionItem;sequenceId:string;frameRate:number;currentTime:number;visible:boolean;disabled:boolean;
  }
  interface AreaControllerOptions {
    current:()=>AreaContext;
    read:(context:AreaContext,frame:number)=>Promise<TextAreaState>;
    edit:(context:AreaContext,request:TextAreaEdit)=>Promise<TextAreaState>;
    seek:(context:AreaContext,time:number)=>Promise<void>;
    getTime:(context:AreaContext)=>Promise<number>;
    state:(next:TextAreaState|null)=>void;busy:(value:boolean)=>void;error:(message:string)=>void;
    changed:(context:AreaContext)=>Promise<void>;
  }
  const snapshot=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
  export function captionFrame(context:AreaContext,time=context.currentTime,reference?:Pick<TextAreaState,'startTime'|'frameRate'|'count'>|null):number {
    const rate=reference?.frameRate??context.frameRate,start=reference?.startTime??context.caption.startTime;
    const count=reference?.count??Math.max(1,Math.round((context.caption.endTime-context.caption.startTime)*rate));
    return Math.max(0,Math.min(count-1,Math.round((time-start)*rate)));
  }
  /** One native operation at a time; only the latest settled playhead read is retained. */
  export function createTextAreaController(options:AreaControllerOptions) {
    let alive=true,active:Promise<void>|null=null,generation=0,desired:string|null=null,identity='',queued=false,blocked=false;
    let state:TextAreaState|null=null;
    const enabled=(context:AreaContext)=>context.visible&&!context.disabled;
    const stamp=(context:AreaContext)=>JSON.stringify([context.key,captionFrame(context,context.currentTime,state)]);
    function publish(next:TextAreaState|null){state=next;if(alive)options.state(next);}
    function current(context:AreaContext,token:number){const live=options.current();return alive&&generation===token&&enabled(live)&&live.key===context.key&&live.currentTime===context.currentTime;}
    async function readAt(context:AreaContext,time:number,token:number){
      if(!current(context,token))return null;
      let next=await options.read(context,captionFrame(context,time,state));
      if(!current(context,token))return null;
      // Pending transcript timing may differ from the still-applied native clip.
      const nativeFrame=captionFrame(context,time,next);
      if(next.frame!==nativeFrame)next=await options.read(context,nativeFrame);
      return current(context,token)?next:null;
    }
    function run(context:AreaContext,token:number,work:()=>Promise<void>){
      const operation=Promise.resolve().then(work).catch(error=>{
        if(!current(context,token))return;
        blocked=true;queued=false;
        if(alive)options.error(error instanceof Error?error.message:String(error));
      }).finally(()=>{active=null;options.busy(false);if(alive&&queued&&!blocked)drain();});
      active=operation;options.busy(true);return operation;
    }
    function drain(){
      if(!alive||active||blocked||!queued)return;
      const context=snapshot(options.current());
      if(!enabled(context)){queued=false;return;}
      queued=false;const token=generation,expected=stamp(context);
      return run(context,token,async()=>{
        const next=await readAt(context,context.currentTime,token);
        if(next&&current(context,token)&&stamp(options.current())===expected){publish(next);desired=stamp(options.current());}
      });
    }
    function sync(){
      const context=options.current(),next=enabled(context)?stamp(context):null;
      if(next===desired)return;
      generation++;desired=next;
      if(identity!==context.key){identity=context.key;blocked=false;publish(null);}
      if(next===null){queued=false;publish(null);return;}
      queued=!blocked;return drain();
    }
    function refresh(){
      const context=options.current();if(!alive||!enabled(context))return;
      generation++;desired=stamp(context);blocked=false;queued=true;return drain();
    }
    function change(request:Omit<TextAreaEdit,'signature'|'frame'>,field?:{index:number;value:number}){
      const context=snapshot(options.current());if(!alive||active||!state||!enabled(context))return;
      const token=++generation;queued=false;blocked=false;desired=stamp(context);
      return run(context,token,async()=>{
        if(!current(context,token))return;
        const time=await options.getTime(context);
        if(!Number.isFinite(time))throw new Error('Premiere did not confirm the current playhead. Refresh Position & size.');
        if(!current(context,token))return;
        const fresh=await readAt(context,time,token);
        if(!fresh||!current(context,token))return;
        publish(fresh);
        const action:TextAreaEdit={...request,signature:fresh.signature,frame:fresh.frame};
        if(field&&request.track){action.value=[...fresh.tracks[request.track].value];action.value[field.index]=field.value;}
        const next=await options.edit(context,action);
        if(!current(context,token))return;
        publish(next);await options.changed(context);
      });
    }
    function seek(frame:number){
      const context=snapshot(options.current());if(!alive||active||!enabled(context)||!Number.isFinite(frame))return;
      const token=++generation;queued=false;blocked=false;
      const rate=state?.frameRate??context.frameRate,start=state?.startTime??context.caption.startTime;
      const bounded=captionFrame(context,start+Math.round(frame)/rate,state);
      return run(context,token,async()=>{
        if(!alive||!enabled(options.current())||options.current().key!==context.key)return;
        await options.seek(context,start+bounded/rate);
        if(!alive||!enabled(options.current())||options.current().key!==context.key)return;
        desired=stamp(options.current());queued=true;
      });
    }
    return {sync,refresh,change,seek,stop(){alive=false;generation++;queued=false;}};
  }
</script>
<script lang="ts">
  import {onDestroy,untrack} from 'svelte';
  import {sampleArea,sampleAt,editSample} from '../lib/text-area';
  import MotionIcon from './MotionIcon.svelte';
  interface Props {caption:CaptionItem;sequenceId:string;frameRate:number;frameWidth:number;frameHeight:number;currentTime:number;visible:boolean;disabled?:boolean;isDemo:boolean;read:(caption:CaptionItem,id:string,frame:number)=>Promise<TextAreaState>;edit:(caption:CaptionItem,id:string,request:TextAreaEdit)=>Promise<TextAreaState>;getCurrentTime:()=>Promise<number>;onSeek:(time:number)=>void|Promise<void>;onBusy:(busy:boolean)=>void;onChanged:()=>void|Promise<void>;}
  let {caption,sequenceId,frameRate,frameWidth,frameHeight,currentTime,visible,disabled=false,isDemo,read,edit,getCurrentTime,onSeek,onBusy,onChanged}:Props=$props();
  let area=$state<TextAreaState|null>(null),busy=$state(false),problem=$state(''),notice=$state(''),expanded=$state(false);
  const sampleUndos=new Map<string,TextAreaState>();
  const samples=new Map<string,TextAreaState>();
  const names=[{key:'position',label:'Position'},{key:'width',label:'Width'},{key:'height',label:'Height'}] as const;
  const identity=$derived(JSON.stringify([sequenceId,caption.id,caption.clipNodeId,caption.mediaPath,caption.renderBounds,caption.startTime,caption.endTime,frameRate]));
  const controller=createTextAreaController({
    current:()=>({key:identity,caption,sequenceId,frameRate,currentTime,visible:visible&&expanded&&(isDemo||!!caption.clipNodeId),disabled}),
    read:async(context,at)=>isDemo?sampleAt(samples.get(context.key)??sampleArea(frameWidth,frameHeight,context.frameRate,context.caption.startTime,context.caption.endTime),at):read(context.caption,context.sequenceId,at),
    edit:async(context,request)=>{
      if(!isDemo)return edit(context.caption,context.sequenceId,request);
      const previous=sampleAt(samples.get(context.key)??sampleArea(frameWidth,frameHeight,context.frameRate,context.caption.startTime,context.caption.endTime),request.frame);
      const next=request.operation==='undo'&&sampleUndos.has(context.key)?sampleUndos.get(context.key)!:editSample(previous,request);sampleUndos.set(context.key,previous);samples.set(context.key,next);return next;
    },
    seek:async(_context,time)=>{await onSeek(time);},getTime:async()=>isDemo?currentTime:getCurrentTime(),
    state:next=>{area=next;},busy:value=>{busy=value;if(value){problem='';notice='';}if(!isDemo)onBusy(value);},error:message=>{problem=message;},
    changed:async()=>{notice=isDemo?'Sample keyframes updated.':'Motion updated in Premiere. Width and height reflow after the edit.';await onChanged();},
  });
  $effect(()=>{identity;currentTime;visible;expanded;disabled;untrack(()=>{void controller.sync();});});
  onDestroy(()=>controller.stop());
  const refresh=()=>controller.refresh();
  const seek=(at:number)=>controller.seek(at);
  const change=(request:Omit<TextAreaEdit,'signature'|'frame'>)=>controller.change(request);
  function setValue(name:AreaTrack,index:number,value:number){
    if(!area||!Number.isFinite(value)||(name!=='position'&&value<=0)){problem='Enter a valid pixel value. Width and height must be greater than zero.';return;}
    void controller.change({track:name,operation:'set'},{index,value});
  }
</script>

<details class="caption-section text-area" bind:open={expanded}>
  <summary class="caption-section__heading">Position & size <span>Selected caption</span></summary>
  <div class="caption-section__body">
    <p class="caption-help">All word states · {frameWidth} × {frameHeight} px</p>
    {#if !isDemo&&!caption.clipNodeId}<p class="caption-help">Apply this caption to the Program Monitor first to edit its native Motion keyframes.</p>{/if}
    <div class="text-area__toolbar"><button class="caption-button" disabled={busy||disabled||(!isDemo&&!caption.clipNodeId)} onclick={()=>refresh()}>Refresh from {isDemo?'sample':'playhead'}</button><button class="caption-button" disabled={busy||disabled||!area?.canUndo} onclick={()=>change({operation:'undo'})}>Undo area edit</button></div>
    {#if busy&&!area}<p class="caption-help" role="status">Reading caption Motion…</p>{/if}
    {#if area}
      <fieldset disabled={busy||disabled}>
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
