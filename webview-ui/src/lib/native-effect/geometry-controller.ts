import type { NativeCaptionSnapshot, NativeCaptionControls, NativeCaptionControlEdit, NativeCaptionKeyframeSeek, NativeBoundaryControlKey } from '../../cep-api.ts';
import { transientNativeRead } from '../live-output.ts';
export type GeometryParameter = NativeBoundaryControlKey|'position'|'width'|'height'|'groups'|'rollUp'|'rollUpLines'|'rollUpCurrentLine'|'rollUpBlankLineSeconds'|'rollUpDuration'|'rollUpFade'|'rollUpFadePosition'|'rollUpFadeThickness'|'rollUpFadeAmount'|'rollUpFadeCurve'|'rollUpDirection'|'rollUpSpeed'|'rollUpWait'|'rollUpTransition'|'alignment';
export interface GeometryContext { key:string; sequenceId:string; snapshot:NativeCaptionSnapshot; visible:boolean; disabled:boolean; }
interface Options {
 current:()=>GeometryContext; read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;
 edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;
 seek?:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;
 state:(value:NativeCaptionControls|null)=>void; error:(message:string)=>void; now?:()=>number; interacting?:(active:boolean)=>void;
}
/** One host call at a time. Scrubbing keeps only the latest intent, bound to
 * the original clip/document/clock; stale replies never enter a new session.
 * A read discarded mid-scrub keeps the last confirmed values on screen but
 * marks their clock stale: no edit or keyframe step uses it, and the next
 * scheduled read (playhead debounce or poll) fetches a fresh one. */
export function createNativeGeometryController(options:Options){
 let alive=true,generation=0,key='',active=false,dragging=false,blocked=false,stale=false;
 const now=options.now??Date.now;let receiptAt=-Infinity,lastInteraction=false;
 let activeKind:'read'|'edit'|'seek'|null=null;
 let pendingSeek:{parameter:GeometryParameter;direction:'previous'|'next';context:GeometryContext;generation:number;identity:string;receipt:NativeCaptionControls;resolve:(value:NativeCaptionControls|null)=>void}|null=null;
 let state:NativeCaptionControls|null=null,pending:{parameter:GeometryParameter;operation:'set'|'reset';value?:number|[number,number];axes?:Partial<Record<0|1,number>>}|null=null;
 const enabled=(c:GeometryContext)=>alive&&c.visible&&!c.disabled;
 const current=(c:GeometryContext,g:number)=>alive&&generation===g&&options.current().key===c.key;
 function publish(next:NativeCaptionControls|null){state=next;stale=false;receiptAt=next?now():-Infinity;if(alive)options.state(next);}
 function cancelSeek(){const queued=pendingSeek;pendingSeek=null;queued?.resolve(null);}
 function notifyInteraction(){const next=alive&&(dragging||!!pending||activeKind==='edit'||activeKind==='seek');if(next!==lastInteraction){lastInteraction=next;options.interacting?.(next);}}
 function drain(){if(pending){cancelSeek();void flush();}else if(pendingSeek)void flushSeek();notifyInteraction();}
 function sync(){const c=options.current();if(c.key!==key){key=c.key;generation++;pending=null;cancelSeek();blocked=false;publish(null);}return c;}
 async function read(){const c=sync(),g=generation;if(!enabled(c)){pending=null;cancelSeek();if(!c.visible)dragging=false;notifyInteraction();return;}if(active||(dragging||pending)&&!stale)return;active=true;activeKind='read';
  // Uncertain writes block further writes, not observation. A fresh read adopts
  // Premiere's actual state without replaying the failed or discarded edits.
  try{const next=await options.read(c.snapshot,c.sequenceId);if(current(c,g)&&enabled(options.current())){if(next.clipNodeId!==c.snapshot.locator.clipNodeId)throw new Error('The native caption clip changed.');publish(next);blocked=false;options.error('');}}
  catch(e){if(current(c,g)&&transientNativeRead(e)){stale=true;receiptAt=-Infinity;}
   else{cancelSeek();if(current(c,g)){pending=null;receiptAt=-Infinity;options.error(e instanceof Error?e.message:String(e));}}}
  finally{active=false;activeKind=null;drain();}}
 async function flush(){const c=sync(),g=generation;if(active||!pending||!enabled(c)||blocked||stale)return;
  const intent=pending;pending=null;if(!state){options.error('Wait for Position & size to finish loading.');notifyInteraction();return;}
  const receipt=state;if(!receipt.insideClip){options.error('Move the Premiere playhead inside this caption clip.');notifyInteraction();return;}
  const next={parameter:intent.parameter,operation:intent.operation,...(intent.value===undefined?{}:{value:intent.value})};
  if(intent.axes){const point=[...(receipt.position.value as [number,number])] as [number,number];for(const axis of [0,1] as const)if(intent.axes[axis]!==undefined)point[axis]=intent.axes[axis]!;next.value=point;}
  active=true;activeKind='edit';notifyInteraction();
  try{const result=await options.edit(c.snapshot,{...next,revision:receipt.revision,atTicks:receipt.timelineTicks},c.sequenceId);
   if(current(c,g)){if(!result.readbackVerified||result.clipNodeId!==c.snapshot.locator.clipNodeId)throw Object.assign(new Error('Premiere did not confirm this geometry change.'),{code:'BC_OUTPUT_UNCONFIRMED'});publish(result);options.error('');}}
  catch(e){if(current(c,g)){pending=null;blocked=(e as {code?:string})?.code==='BC_OUTPUT_UNCONFIRMED';const detail=e instanceof Error?e.message:String(e);options.error(blocked?`Premiere could not confirm this change. ${detail} Syncing the current values from Premiere…`:detail);}}
  finally{active=false;activeKind=null;drain();}}
 function enqueue(intent:NonNullable<typeof pending>){const c=sync();if(blocked||!enabled(c))return;cancelSeek();
  // Typed edits after a scrub also need a fresh clock. Pointer gestures take
  // one fresh read at their start, then stream confirmed/coalesced edits.
  if(!active&&(!dragging||stale)&&now()-receiptAt>250)void read();pending=intent;notifyInteraction();void flush();}
 function queue(parameter:GeometryParameter,value?:number|[number,number]){enqueue({parameter,operation:value===undefined?'reset':'set',...(value===undefined?{}:{value:Array.isArray(value)?[...value] as [number,number]:value})});}
 function queuePositionAxis(axis:0|1,value:number){sync();if(!Number.isFinite(value))return;
  if(pending?.parameter==='position'&&Array.isArray(pending.value)){const point=[...pending.value] as [number,number];point[axis]=value;queue('position',point);return;}
  const axes=pending?.parameter==='position'?{...pending.axes}:{};axes[axis]=value;enqueue({parameter:'position',operation:'set',axes});}

 async function flushSeek(){
  if(active||!pendingSeek)return;
  const intent=pendingSeek;pendingSeek=null;
  const c=sync(),g=generation,receipt=state;
  if(!enabled(c)||pending||dragging||blocked||stale||!receipt||!options.seek||!current(intent.context,intent.generation)||intent.identity!==JSON.stringify([c.sequenceId,c.snapshot])||receipt.revision!==intent.receipt.revision||receipt.timelineTicks!==intent.receipt.timelineTicks){
   if(enabled(c)&&current(intent.context,intent.generation))options.error('The playhead or caption controls changed. Click the keyframe arrow again at the current position.');
   intent.resolve(null);return;
  }
  active=true;activeKind='seek';notifyInteraction();
  try{const next=await options.seek(c.snapshot,{revision:receipt.revision,parameter:intent.parameter,direction:intent.direction,atTicks:receipt.timelineTicks},c.sequenceId);if(current(c,g)){if(!next.readbackVerified||next.clipNodeId!==c.snapshot.locator.clipNodeId)throw new Error('Premiere did not confirm the keyframe position.');publish(next);options.error('');intent.resolve(next);return;}}
  catch(e){if(current(c,g))options.error(e instanceof Error?e.message:String(e));}finally{active=false;activeKind=null;intent.resolve(null);drain();}
 }
 function seek(parameter:GeometryParameter,direction:'previous'|'next'):Promise<NativeCaptionControls|null>{
  const c=sync(),g=generation,receipt=state;
  if(!enabled(c)||pending||dragging||blocked||!receipt||!options.seek||active&&activeKind!=='read')return Promise.resolve(null);
  cancelSeek();
  // A stale clock takes one fresh read first; the step runs after it if nothing moved.
  return new Promise(resolve=>{pendingSeek={parameter,direction,context:c,generation:g,identity:JSON.stringify([c.sequenceId,c.snapshot]),receipt,resolve};if(!active)void(stale?read():flushSeek());});
 }
 return {read,queue,queuePositionAxis,seek,setDragging(value:boolean){if(value&&!dragging)void read();dragging=value;notifyInteraction();},dispose(){alive=false;generation++;pending=null;cancelSeek();if(lastInteraction){lastInteraction=false;options.interacting?.(false);}},get active(){return active;}};
}

export function canSeekGeometryKeyframe(state:NativeCaptionControls|null,parameter:GeometryParameter,direction:'previous'|'next'):boolean{
 if(!state?.[parameter]?.animated)return false;
 const at=BigInt(state.timelineTicks),start=BigInt(state.startTicks),end=BigInt(state.endTicks),offset=start-BigInt(state.inTicks);
 return state[parameter].keys.some(key=>{const tick=BigInt(key.ticks)+offset;return tick>=start&&tick<end&&(direction==='previous'?tick<at:tick>at);});
}
