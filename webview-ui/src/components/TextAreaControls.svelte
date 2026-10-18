<script module lang="ts">
  import type {CaptionItem} from '../lib/types';
  import type {TextAreaState,TextAreaEdit,AreaTrack,AreaKey} from '../lib/text-area';
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
    changed:(context:AreaContext,state:TextAreaState)=>Promise<void>;
  }
  const snapshot=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
  export function captionFrame(context:AreaContext,time=context.currentTime,reference?:Pick<TextAreaState,'startTime'|'frameRate'|'count'>|null):number {
    const rate=reference?.frameRate??context.frameRate,start=reference?.startTime??context.caption.startTime;
    const count=reference?.count??Math.max(1,Math.round((context.caption.endTime-context.caption.startTime)*rate));
    return Math.max(0,Math.min(count-1,Math.round((time-start)*rate)));
  }
  /** One native operation at a time; only the latest settled playhead read is retained. */
  export function createTextAreaController(options:AreaControllerOptions) {
    let alive=true,active:Promise<unknown>|null=null,generation=0,desired:string|null=null,identity='',queued=false,blocked=false;
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
    function run<T,>(context:AreaContext,token:number,work:()=>Promise<T>){
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
        if(!current(context,token))return;
        const time=await options.getTime(context);
        if(!Number.isFinite(time))throw new Error('Premiere did not confirm the current playhead. Refresh Position & size.');
        if(!current(context,token))return;
        const next=await readAt(context,time,token);
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
        const selected=request.keyTicks!==undefined&&request.track?fresh.tracks[request.track].keys.find(key=>key.ticks===request.keyTicks):undefined;
        if(request.keyTicks!==undefined&&!selected)throw new Error('The selected keyframe changed. Refresh Position & size.');
        if(request.operation==='move-key'&&(typeof request.targetFrame!=='number'||!Number.isInteger(request.targetFrame)||request.targetFrame<0||request.targetFrame>=fresh.count))throw new Error('Keep the keyframe inside the caption.');
        if(field&&request.track){action.value=[...(selected?.value??fresh.tracks[request.track].value)];action.value[field.index]=field.value;}
        const next=await options.edit(context,action);
        if(!current(context,token))return;
        publish(next);await options.changed(context,next);return next;
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
  interface Props {caption:CaptionItem;sequenceId:string;frameRate:number;frameWidth:number;frameHeight:number;currentTime:number;visible:boolean;disabled?:boolean;refreshRevision?:string|number;isDemo:boolean;read:(caption:CaptionItem,id:string,frame:number)=>Promise<TextAreaState>;edit:(caption:CaptionItem,id:string,request:TextAreaEdit)=>Promise<TextAreaState>;getCurrentTime:()=>Promise<number>;onSeek:(time:number)=>void|Promise<void>;onSelect:()=>void|Promise<void>;onBusy:(busy:boolean)=>void;onChanged:(state?:TextAreaState)=>void|Promise<void>;}
  let {caption,sequenceId,frameRate,frameWidth,frameHeight,currentTime,visible,disabled=false,refreshRevision=0,isDemo,read,edit,getCurrentTime,onSeek,onSelect,onBusy,onChanged}:Props=$props();
  let area=$state<TextAreaState|null>(null),busy=$state(false),problem=$state(''),notice=$state(''),expanded=$state(false);
  let cachedArea=$state<{key:string;identity:string;value:TextAreaState}|null>(null);
  let selectedKey=$state<{scope:string;track:AreaTrack;ticks:string}|null>(null),keyZoom=$state(1);
  let refreshReady=false,lastRefreshRevision:string|number;
  const sampleHistory=new Map<string,{undo:TextAreaState[];redo:TextAreaState[]}>();
  const samples=new Map<string,TextAreaState>();
  const names=[{key:'position',label:'Position'},{key:'width',label:'Width'},{key:'height',label:'Height'}] as const;
  const identity=$derived(JSON.stringify([sequenceId,caption.id,caption.clipNodeId,caption.mediaPath,caption.renderBounds,caption.startTime,caption.endTime,frameRate]));
  const displayIdentity=$derived(JSON.stringify([sequenceId,caption.id,caption.clipNodeId]));
  const shownArea=$derived(visible&&expanded&&cachedArea?.key===displayIdentity?(area??cachedArea.value):null);
  const readOnly=$derived(busy||disabled||!area||!!problem||cachedArea?.identity!==identity);
  const selectedTrack=$derived(selectedKey?.scope===displayIdentity?selectedKey.track:null);
  const selected=$derived(selectedTrack&&shownArea?shownArea.tracks[selectedTrack].keys.find(key=>key.ticks===selectedKey?.ticks):undefined);
  const controller=createTextAreaController({
    current:()=>({key:identity,caption,sequenceId,frameRate,currentTime,visible:visible&&expanded&&(isDemo||!!caption.clipNodeId),disabled}),
    read:async(context,at)=>isDemo?sampleAt(samples.get(context.key)??sampleArea(frameWidth,frameHeight,context.frameRate,context.caption.startTime,context.caption.endTime),at):read(context.caption,context.sequenceId,at),
    edit:async(context,request)=>{
      if(!isDemo)return edit(context.caption,context.sequenceId,request);
      const previous=sampleAt(samples.get(context.key)??sampleArea(frameWidth,frameHeight,context.frameRate,context.caption.startTime,context.caption.endTime),request.frame);
      const history=sampleHistory.get(context.key)??{undo:[],redo:[]};let next:TextAreaState;
      if(request.operation==='undo'||request.operation==='redo'){
        const from=request.operation==='undo'?history.undo:history.redo,to=request.operation==='undo'?history.redo:history.undo,restored=from.pop();
        if(!restored)throw new Error(`No sample edit to ${request.operation}.`);
        to.push(previous);next=sampleAt(restored,request.frame);
      }else{next=editSample(previous,request);history.undo.push(previous);if(history.undo.length>50)history.undo.shift();history.redo=[];}
      next.canUndo=!!history.undo.length;next.canRedo=!!history.redo.length;sampleHistory.set(context.key,history);samples.set(context.key,next);return next;
    },
    seek:async(_context,time)=>{await onSeek(time);},getTime:async()=>isDemo?currentTime:getCurrentTime(),
    state:next=>{area=next;if(next)cachedArea={key:displayIdentity,identity,value:next};},busy:value=>{busy=value;if(value){problem='';notice='';}if(!isDemo)onBusy(value);},error:message=>{problem=message;},
    changed:async(_context,next)=>{notice=isDemo?'Sample keyframes updated.':'';await onChanged(next);},
  });
  $effect(()=>{identity;currentTime;visible;expanded;disabled;untrack(()=>{void controller.sync();});});
  $effect(()=>{if(!visible||!expanded||cachedArea?.key!==displayIdentity)cachedArea=null;});
  $effect(()=>{
    const revision=refreshRevision;
    if(!refreshReady){refreshReady=true;lastRefreshRevision=revision;return;}
    if(revision!==lastRefreshRevision){lastRefreshRevision=revision;untrack(()=>{void controller.refresh();});}
  });
  $effect(()=>{
    if(!selectedKey)return;
    if(!visible||!expanded||selectedKey.scope!==displayIdentity||area&&!area.tracks[selectedKey.track].keys.some(key=>key.ticks===selectedKey!.ticks))selectedKey=null;
  });
  onDestroy(()=>{controller.stop();cachedArea=null;selectedKey=null;});
  const refresh=()=>controller.refresh();
  const seek=(at:number)=>controller.seek(at);
  const change=(request:Omit<TextAreaEdit,'signature'|'frame'>)=>controller.change(request);
  function setValue(name:AreaTrack,index:number,value:number){
    if(!area||!Number.isFinite(value)||(name!=='position'&&value<=0)){problem='Enter a valid pixel value. Width and height must be greater than zero.';return;}
    void controller.change({track:name,operation:'set'},{index,value});
  }
  function chooseKey(track:AreaTrack,key:AreaKey){
    if(readOnly||typeof key.ticks!=='string')return;
    selectedKey={scope:displayIdentity,track,ticks:key.ticks};void seek(key.frame);
  }
  function keyNavigation(event:KeyboardEvent,track:AreaTrack,key:AreaKey){
    if(!shownArea||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const keys=shownArea.tracks[track].keys.filter(item=>item.frame>=0&&item.frame<shownArea!.count),index=keys.findIndex(item=>item.ticks===key.ticks);
    const target=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[index+(event.key==='ArrowRight'?1:-1)];
    if(target){
      const buttons=(event.currentTarget as HTMLButtonElement).parentElement?.querySelectorAll<HTMLButtonElement>('.text-area__key');
      [...(buttons??[])].find(button=>button.dataset.keyTicks===target.ticks)?.focus();chooseKey(track,target);
    }
  }
  function setKeyValue(index:number,value:number){
    if(!selectedKey||!selectedTrack||!selected||readOnly)return;
    if(!Number.isFinite(value)||(selectedTrack!=='position'&&value<=0)){problem='Enter a valid pixel value. Width and height must be greater than zero.';return;}
    void controller.change({track:selectedTrack,operation:'set-key',keyTicks:selectedKey.ticks},{index,value});
  }
  async function moveKey(frame:number){
    if(!selectedKey||!selectedTrack||!selected||readOnly)return;
    if(!Number.isInteger(frame)||!shownArea||frame<0||frame>=shownArea.count){problem='Keep the keyframe inside the caption.';return;}
    const chosen={...selectedKey};
    const next=await controller.change({track:chosen.track,operation:'move-key',keyTicks:chosen.ticks,targetFrame:frame});
    if(next&&chosen.scope===displayIdentity&&visible&&expanded){
      const moved=next.tracks[chosen.track].keys.find(key=>Math.abs(key.frame-frame)<.001);
      selectedKey=moved?{...chosen,ticks:moved.ticks}:null;
    }
  }
  function editSelected(operation:'remove-key'|'interpolation',interpolation?:string){
    if(!selectedKey||!selectedTrack||!selected||readOnly)return;
    void controller.change({track:selectedTrack,operation,keyTicks:selectedKey.ticks,...(interpolation?{interpolation}:{})});
  }
  async function keyAtPlayhead(track:AreaTrack){
    const scope=displayIdentity,next=await change({track,operation:'key'});
    if(next&&scope===displayIdentity&&visible&&expanded){const key=next.tracks[track].keys.find(item=>Math.abs(item.frame-next.frame)<.001);if(key)selectedKey={scope,track,ticks:key.ticks};}
  }
</script>

<details class="caption-section text-area" bind:open={expanded}>
  <summary class="caption-section__heading">Position & size <span>Selected caption</span></summary>
  <div class="caption-section__body">
    <p class="caption-help">All word states · {frameWidth} × {frameHeight} px</p>
    {#if !isDemo&&!caption.clipNodeId}<p class="caption-help">Apply this caption to the Program Monitor first to edit its native Motion keyframes.</p>{/if}
    <div class="text-area__toolbar"><button class="caption-button" disabled={busy||disabled||(!isDemo&&!caption.clipNodeId)} onclick={()=>refresh()}>Refresh from {isDemo?'sample':'playhead'}</button><button class="caption-button" disabled={busy||disabled||isDemo||!caption.clipNodeId} onclick={onSelect}>Select in Program Monitor</button><button class="caption-button" disabled={readOnly||!area?.canUndo} onclick={()=>change({operation:'undo'})}>Undo</button><button class="caption-button" disabled={readOnly||!area?.canRedo} onclick={()=>change({operation:'redo'})}>Redo</button></div>
    {#if busy&&!shownArea}<p class="caption-help" role="status">Reading caption Motion…</p>{/if}
    {#if shownArea}
      <fieldset disabled={readOnly}>
        <label class="caption-field"><span>Playhead, caption frame</span><input type="number" aria-label="Text area playhead frame" min="0" max={shownArea.count-1} step="1" value={shownArea.frame} onchange={(e)=>seek(e.currentTarget.valueAsNumber)}/></label>
        <input class="text-area__scrub" type="range" aria-label="Text area playhead" min="0" max={shownArea.count-1} step="1" value={shownArea.frame} onchange={(e)=>seek(e.currentTarget.valueAsNumber)}/>
        <p class="caption-help">Sequence time · {(shownArea.startTime+shownArea.frame/shownArea.frameRate).toFixed(3)}s</p>
        <div class="text-area__overview-heading"><strong>Keyframes</strong><label>Zoom <select aria-label="Keyframe lane zoom" bind:value={keyZoom}><option value={1}>100%</option><option value={2}>200%</option><option value={4}>400%</option></select></label></div>
        <div class="text-area__overview" role="group" aria-label="Caption keyframe overview">
          <div class="text-area__lane-labels" aria-hidden="true"><span></span>{#each names as item}<span>{item.label}</span>{/each}</div>
          <div class="text-area__lane-scroll" role="region" aria-label="Position and size keyframes; scroll horizontally">
            <div class="text-area__lanes" style:width="{Math.max(240,shownArea.count*3)*keyZoom}px">
              <div class="text-area__ruler"><span>0f</span><span>{Math.round((shownArea.count-1)/2)}f</span><span>{shownArea.count-1}f</span></div>
              {#each names as item}<div class="text-area__lane" role="group" aria-label="{item.label} keyframes">
                <span class="text-area__playhead" style:left="{shownArea.frame/Math.max(1,shownArea.count-1)*100}%" aria-hidden="true"></span>
                {#each shownArea.tracks[item.key].keys.filter(key=>key.frame>=0&&key.frame<shownArea!.count) as key (key.ticks)}<button class="text-area__key" data-key-ticks={key.ticks} aria-label="{item.label} keyframe at frame {Number(key.frame.toFixed(3))}" aria-pressed={selectedTrack===item.key&&selected?.ticks===key.ticks} title="{item.label} · frame {Number(key.frame.toFixed(3))}" style:left="{key.frame/Math.max(1,shownArea.count-1)*100}%" onclick={()=>chooseKey(item.key,key)} onkeydown={(event)=>keyNavigation(event,item.key,key)}><MotionIcon name="key"/></button>{/each}
              </div>{/each}
            </div>
          </div>
        </div>
        {#if selected&&selectedTrack}
          <div class="text-area__key-editor" role="group" aria-label="Selected {selectedTrack} keyframe">
            <div class="text-area__key-heading"><strong>{names.find(item=>item.key===selectedTrack)?.label} keyframe</strong><button class="caption-button" onclick={()=>editSelected('remove-key')}>Delete key</button></div>
            <div class="text-area__key-time"><label class="caption-field"><span>Selected key, frame</span><input type="number" aria-label="Selected keyframe frame" min="0" max={shownArea.count-1} step="1" value={Number(selected.frame.toFixed(3))} onchange={(event)=>moveKey(event.currentTarget.valueAsNumber)}/></label><button class="caption-button" aria-label="Move selected keyframe earlier one frame" disabled={Math.round(selected.frame)<=0} onclick={()=>moveKey(Math.round(selected!.frame)-1)}>−1f</button><button class="caption-button" aria-label="Move selected keyframe later one frame" disabled={Math.round(selected.frame)>=shownArea.count-1} onclick={()=>moveKey(Math.round(selected!.frame)+1)}>+1f</button></div>
            <div class="caption-controls">
              {#each selected.value as value,index}<label class="caption-field" class:caption-field--wide={selectedTrack!=='position'}><span>{selectedTrack==='position'?(index===0?'X':'Y'):'Size'}, px</span><input type="number" step="1" aria-label="Selected {selectedTrack} {selectedTrack==='position'?(index===0?'X':'Y'):'size'}, px" value={Number(value.toFixed(3))} onchange={(event)=>setKeyValue(index,event.currentTarget.valueAsNumber)}/></label>{/each}
              <label class="caption-field caption-field--wide"><span>Selected key interpolation</span><select aria-label="Selected keyframe interpolation" value={selected.interpolation} onchange={(event)=>editSelected('interpolation',event.currentTarget.value)}><option value="native" disabled>Native / unchanged</option><option value="linear">Linear</option><option value="bezier">Bezier</option><option value="hold">Hold</option></select></label>
            </div>
          </div>
        {/if}
        <h3 class="text-area__values-heading">At playhead</h3>
        {#each names as item}
          {@const track=shownArea.tracks[item.key]}
          {@const atKey=track.keys.find(k=>Math.abs(k.frame-shownArea!.frame)<.001)}
          {@const previous=[...track.keys].reverse().find(k=>k.frame<shownArea!.frame&&k.frame>=0)}
          {@const next=track.keys.find(k=>k.frame>shownArea!.frame&&k.frame<shownArea!.count)}
          <div class="text-area__track">
            <div class="text-area__track-heading">
              <button class="caption-button caption-button--icon" aria-label="{item.label} keyframes" aria-pressed={track.animated} title="{track.animated?'Disable':'Enable'} {item.label.toLowerCase()} animation" onclick={()=>change({track:item.key,operation:'toggle'})}><MotionIcon name="clock"/></button>
              <strong>{item.label}</strong><span>{track.animated?`${track.keys.length} keys`:'Static'}</span>
              <button class="caption-button caption-button--icon" aria-label="Previous {item.label.toLowerCase()} keyframe" disabled={!previous} onclick={()=>previous&&chooseKey(item.key,previous)}><MotionIcon name="previous"/></button>
              <button class="caption-button caption-button--icon" aria-label="Add or remove {item.label.toLowerCase()} keyframe at playhead" aria-pressed={!!atKey} disabled={!track.animated} onclick={()=>keyAtPlayhead(item.key)}><MotionIcon name="key"/></button>
              <button class="caption-button caption-button--icon" aria-label="Next {item.label.toLowerCase()} keyframe" disabled={!next} onclick={()=>next&&chooseKey(item.key,next)}><MotionIcon name="next"/></button>
            </div>
            <div class="caption-controls">
              {#each track.value as value,i}<label class="caption-field" class:caption-field--wide={item.key!=='position'}><span>{item.key==='position'?(i===0?'X':'Y'):'Size'}, px</span><input type="number" step="1" aria-label="{item.label} {item.key==='position'?(i===0?'X':'Y'):'size'}, px" value={Number(value.toFixed(3))} onchange={(e)=>setValue(item.key,i,e.currentTarget.valueAsNumber)}/></label>{/each}
            </div>
          </div>
        {/each}
      </fieldset>
      <p class="caption-help">Width reflows text at the same font size; height is independent.</p>
    {/if}
    {#if problem}<p class="caption-message caption-message--error" role="alert">{problem}</p>{:else if notice}<p class="caption-help" role="status">{notice}</p>{/if}
  </div>
</details>
<style>
  .text-area {
    & summary span { float:right;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);font-weight:400; }
    & fieldset { border:0;padding:0;min-inline-size:0; }
    & input[type=number] { font-variant-numeric:tabular-nums; }
  }
  .text-area__toolbar {
    display:flex;flex-wrap:wrap;gap:var(--caption-space-xs);
    & button { font-size:var(--caption-type-xs);padding-inline:var(--caption-space-s); }
  }
  .text-area__scrub { inline-size:100%;accent-color:var(--color-accent);margin-block:var(--caption-space-s); }
  .text-area__overview-heading {
    display:flex;align-items:center;justify-content:space-between;gap:var(--caption-space-s);margin-block:var(--caption-space-m) var(--caption-space-xs);font-size:var(--caption-type-xs);
    & label { display:flex;align-items:center;gap:var(--caption-space-xs);color:var(--color-panel-secondary); }
    & select { min-block-size:1.8rem;padding:.2rem; }
  }
  .text-area__overview { display:grid;grid-template-columns:4.4rem minmax(0,1fr);border:1px solid var(--color-panel-border); }
  .text-area__lane-labels {
    display:grid;grid-template-rows:1.5rem repeat(3,2.1rem);font-size:var(--caption-type-xs);color:var(--color-panel-secondary);
    & span { display:flex;align-items:center;padding-inline:var(--caption-space-xs);border-block-end:1px solid var(--color-panel-border); }
    & span:last-child { border-block-end:0; }
  }
  .text-area__lane-scroll { overflow-x:auto;min-inline-size:0;border-inline-start:1px solid var(--color-panel-border); }
  .text-area__lanes { min-inline-size:100%;padding-inline:.9rem;box-sizing:border-box; }
  .text-area__ruler { display:flex;justify-content:space-between;align-items:center;block-size:1.5rem;font-size:var(--caption-type-xs);font-variant-numeric:tabular-nums;color:var(--color-panel-secondary); }
  .text-area__lane { position:relative;block-size:2.1rem;border-block-start:1px solid var(--color-panel-border); }
  .text-area__playhead { position:absolute;inset-block:0;inline-size:1px;background:var(--color-accent);pointer-events:none; }
  .text-area__key {
    display:flex;align-items:center;justify-content:center;position:absolute;inset-block-start:.15rem;inline-size:1.8rem;block-size:1.8rem;padding:0;transform:translateX(-50%);color:var(--color-panel-secondary);background:var(--color-surface);border:1px solid transparent;border-radius:var(--caption-radius);cursor:pointer;
    &:hover { color:var(--color-panel-text);background:var(--color-surface-raised); }
    &[aria-pressed=true] { color:var(--color-accent);background:var(--color-selection);border-color:var(--color-accent);z-index:1; }
    &:disabled { opacity:.5;cursor:default; }
  }
  .text-area__key-editor { border-block-end:1px solid var(--color-panel-border);padding-block:var(--caption-space-m); }
  .text-area__key-heading {
    display:flex;align-items:center;justify-content:space-between;gap:var(--caption-space-s);font-size:var(--caption-type-s);margin-block-end:var(--caption-space-s);
    & button { font-size:var(--caption-type-xs);padding-inline:var(--caption-space-s); }
  }
  .text-area__key-time {
    display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:end;gap:var(--caption-space-xs);margin-block-end:var(--caption-space-s);
    & button { min-inline-size:0;padding-inline:var(--caption-space-s); }
  }
  .text-area__values-heading { font-size:var(--caption-type-s);font-weight:600;margin-block:var(--caption-space-m) 0; }
  .text-area__track { border-block-start:1px solid var(--color-panel-border);margin-block-start:var(--caption-space-m);padding-block-start:var(--caption-space-s); }
  .text-area__track-heading {
    display:flex;align-items:center;gap:var(--caption-space-xs);margin-block-end:var(--caption-space-s);font-size:var(--caption-type-s);
    & span { margin-inline-start:auto;font-size:var(--caption-type-xs);color:var(--color-panel-secondary); }
    & .caption-button--icon { inline-size:1.8rem;min-block-size:1.8rem;padding:.25rem; }
    & [aria-pressed=true] { background:var(--color-selection);color:var(--color-accent); }
  }
</style>
