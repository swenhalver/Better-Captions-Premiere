import type { NativeCaptionSnapshot, NativeCaptionControls, NativeCaptionControlEdit, NativeCaptionKeyframeSeek } from '../../cep-api.ts';
export type GeometryParameter = 'position'|'width'|'height'|'groups';
export interface GeometryContext { key:string; sequenceId:string; snapshot:NativeCaptionSnapshot; visible:boolean; disabled:boolean; }
interface Options {
 current:()=>GeometryContext; read:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionControls>;
 edit:(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,id:string)=>Promise<NativeCaptionControls>;
 seek?:(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,id:string)=>Promise<NativeCaptionControls>;
 state:(value:NativeCaptionControls|null)=>void; error:(message:string)=>void;
}
/** One host call at a time. Scrubbing keeps only the latest intent, bound to
 * the original clip/document/clock; stale replies never enter a new session. */
export function createNativeGeometryController(options:Options){
 let alive=true,generation=0,key='',active=false,dragging=false,blocked=false;
 let state:NativeCaptionControls|null=null,pending:{parameter:GeometryParameter;operation:'set'|'reset';value?:number|[number,number]}|null=null;
 const enabled=(c:GeometryContext)=>alive&&c.visible&&!c.disabled;
 const current=(c:GeometryContext,g:number)=>alive&&generation===g&&options.current().key===c.key;
 function publish(next:NativeCaptionControls|null){state=next;if(alive)options.state(next);}
 function sync(){const c=options.current();if(c.key!==key){key=c.key;generation++;pending=null;blocked=false;publish(null);}return c;}
 async function read(){const c=sync(),g=generation;if(!enabled(c)){pending=null;return;}if(active||dragging||pending||blocked)return;active=true;
  try{const next=await options.read(c.snapshot,c.sequenceId);if(current(c,g)&&enabled(options.current())){if(next.clipNodeId!==c.snapshot.locator.clipNodeId)throw new Error('The native caption clip changed.');publish(next);options.error('');}}
  catch(e){if(current(c,g))options.error(e instanceof Error?e.message:String(e));}finally{active=false;if(pending)void flush();}}
 async function flush(){const c=sync(),g=generation;if(active||!pending||!enabled(c)||blocked)return;
  const next=pending;pending=null;if(!state){options.error('Wait for Position & size to finish loading.');return;}
  const receipt=state;if(!receipt.insideClip){options.error('Move the Premiere playhead inside this caption clip.');return;}
  active=true;
  try{const result=await options.edit(c.snapshot,{...next,revision:receipt.revision,atTicks:receipt.timelineTicks},c.sequenceId);
   if(current(c,g)){if(!result.readbackVerified||result.clipNodeId!==c.snapshot.locator.clipNodeId)throw Object.assign(new Error('Premiere did not confirm this geometry change.'),{code:'BC_OUTPUT_UNCONFIRMED'});publish(result);options.error('');}}
  catch(e){if(current(c,g)){pending=null;blocked=(e as {code?:string})?.code==='BC_OUTPUT_UNCONFIRMED';options.error(blocked?'Premiere could not confirm this change. Check Effect Controls before trying again.':e instanceof Error?e.message:String(e));}}
  finally{active=false;if(pending)void flush();}}
 function queue(parameter:GeometryParameter,value?:number|[number,number]){const c=sync();if(blocked||!enabled(c))return;pending={parameter,operation:value===undefined?'reset':'set',...(value===undefined?{}:{value:Array.isArray(value)?[...value] as [number,number]:value})};void flush();}
 async function seek(parameter:GeometryParameter,direction:'previous'|'next'){
  const c=sync(),g=generation,receipt=state;if(!enabled(c)||active||pending||dragging||blocked||!receipt||!options.seek)return null;active=true;
  try{const next=await options.seek(c.snapshot,{revision:receipt.revision,parameter,direction,atTicks:receipt.timelineTicks},c.sequenceId);if(current(c,g)){if(!next.readbackVerified||next.clipNodeId!==c.snapshot.locator.clipNodeId)throw new Error('Premiere did not confirm the keyframe position.');publish(next);options.error('');return next;}}
  catch(e){if(current(c,g))options.error(e instanceof Error?e.message:String(e));}finally{active=false;}return null;
 }
 return {read,queue,seek,setDragging(value:boolean){dragging=value;},dispose(){alive=false;generation++;pending=null;},get active(){return active;}};
}

export function canSeekGeometryKeyframe(state:NativeCaptionControls|null,parameter:GeometryParameter,direction:'previous'|'next'):boolean{
 if(!state?.[parameter]?.animated)return false;
 const at=BigInt(state.timelineTicks),start=BigInt(state.startTicks),end=BigInt(state.endTicks),offset=start-BigInt(state.inTicks);
 return state[parameter].keys.some(key=>{const tick=BigInt(key.ticks)+offset;return tick>=start&&tick<end&&(direction==='previous'?tick<at:tick>at);});
}
