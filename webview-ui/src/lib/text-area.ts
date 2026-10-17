export type AreaTrack = 'position' | 'width' | 'height';
export interface AreaKey { ticks:string; frame:number; value:number[]; interpolation:string; }
export interface AreaCurve { animated:boolean; value:number[]; keys:AreaKey[]; }
export interface TextAreaState { signature:string; frame:number; count:number; startTime:number; frameRate:number; frameWidth:number; frameHeight:number; tracks:Record<AreaTrack,AreaCurve>; canUndo:boolean; canRedo?:boolean; }
export interface TextAreaEdit { signature:string; frame:number; track?:AreaTrack; operation:'set'|'toggle'|'key'|'interpolation'|'set-key'|'move-key'|'remove-key'|'undo'|'redo'; keyTicks?:string; targetFrame?:number; value?:number[]; interpolation?:string; }
const sampleTicks=(frame:number,rate:number)=>String(Math.round(frame*254016000000/rate));
export function sampleArea(width:number,height:number,fps:number,start:number,end:number):TextAreaState {
  return {signature:'sample',frame:0,count:Math.max(1,Math.round((end-start)*fps)),startTime:start,frameRate:fps,frameWidth:width,frameHeight:height,canUndo:false,canRedo:false,tracks:{position:{animated:false,value:[width*.5,height*.85],keys:[]},width:{animated:false,value:[width*.8],keys:[]},height:{animated:false,value:[height*.4],keys:[]}}};
}
export function sampleAt(state:TextAreaState,frame:number):TextAreaState {
  const next=structuredClone(state);next.frame=Math.max(0,Math.min(next.count-1,Math.round(frame)));
  for(const track of Object.values(next.tracks)) if(track.animated&&track.keys.length){
    const a=[...track.keys].reverse().find(k=>k.frame<=next.frame)??track.keys[0],b=track.keys.find(k=>k.frame>next.frame)??a;
    let progress=a===b?0:Math.max(0,(next.frame-a.frame)/(b.frame-a.frame));
    if(a.interpolation==='hold')progress=0;else if(a.interpolation==='bezier')progress=progress*progress*(3-2*progress);
    track.value=a.value.map((n,i)=>n+(b.value[i]-n)*progress);
  }
  return next;
}
export function editSample(state:TextAreaState,request:TextAreaEdit):TextAreaState {
  const next=sampleAt(state,request.frame),track=next.tracks[request.track!];if(!track)return next;
  const existing=request.keyTicks!==undefined?track.keys.find(k=>k.ticks===request.keyTicks):track.keys.find(k=>k.frame===next.frame);
  if(request.keyTicks!==undefined&&!existing)throw new Error('The selected keyframe changed. Refresh Position & size.');
  if(request.operation==='set-key'){
    if(!existing||!request.value||request.value.length!==existing.value.length||!request.value.every(Number.isFinite))throw new Error('Enter a valid keyframe value.');
    existing.value=[...request.value];
  }
  else if(request.operation==='move-key'){
    const frame=request.targetFrame;
    if(!existing||typeof frame!=='number'||!Number.isInteger(frame)||frame<0||frame>=next.count)throw new Error('Keep the keyframe inside the caption.');
    if(track.keys.some(k=>k!==existing&&Math.abs(k.frame-frame)<.001))throw new Error('A keyframe already occupies that frame.');
    existing.frame=frame;existing.ticks=sampleTicks(frame,next.frameRate);track.keys.sort((a,b)=>a.frame-b.frame);
  }
  else if(request.operation==='remove-key'){
    if(!existing)throw new Error('Select a keyframe to remove.');
    track.keys=track.keys.filter(k=>k!==existing);if(!track.keys.length)track.animated=false;
  }
  else {
    if(request.operation==='toggle'&&track.animated||request.operation==='key'&&existing&&track.keys.length===1){track.animated=false;track.keys=[];}
    else if(request.operation==='key'&&existing)track.keys=track.keys.filter(k=>k!==existing);
    else if(request.operation==='interpolation'){
      if(!existing||!['linear','bezier','hold'].includes(request.interpolation??''))throw new Error('Select a keyframe and an interpolation mode.');
      existing.interpolation=request.interpolation!;
    }
    else {
      if(request.operation==='set'&&request.value?.every(Number.isFinite))track.value=[...request.value];
      if(track.animated||request.operation==='toggle'||request.operation==='key'){
        track.animated=true;if(existing)existing.value=[...track.value];else track.keys.push({ticks:sampleTicks(next.frame,next.frameRate),frame:next.frame,value:[...track.value],interpolation:'linear'});track.keys.sort((a,b)=>a.frame-b.frame);
      }
    }
  }
  next.canUndo=true;return sampleAt(next,request.frame);
}
