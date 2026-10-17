export type AreaTrack = 'position' | 'width' | 'height';
export interface AreaKey { frame:number; value:number[]; interpolation:string; }
export interface AreaCurve { animated:boolean; value:number[]; keys:AreaKey[]; }
export interface TextAreaState { signature:string; frame:number; count:number; startTime:number; frameRate:number; frameWidth:number; frameHeight:number; tracks:Record<AreaTrack,AreaCurve>; canUndo:boolean; }
export interface TextAreaEdit { signature:string; frame:number; track?:AreaTrack; operation:'set'|'toggle'|'key'|'interpolation'|'undo'; value?:number[]; interpolation?:string; }
export function sampleArea(width:number,height:number,fps:number,start:number,end:number):TextAreaState {
  return {signature:'sample',frame:0,count:Math.max(1,Math.round((end-start)*fps)),startTime:start,frameRate:fps,frameWidth:width,frameHeight:height,canUndo:false,tracks:{position:{animated:false,value:[width*.5,height*.85],keys:[]},width:{animated:false,value:[width*.8],keys:[]},height:{animated:false,value:[height*.4],keys:[]}}};
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
  const existing=track.keys.find(k=>k.frame===next.frame);
  if(request.operation==='toggle'&&track.animated||request.operation==='key'&&existing&&track.keys.length===1){track.animated=false;track.keys=[];}
  else if(request.operation==='key'&&existing)track.keys=track.keys.filter(k=>k!==existing);
  else if(request.operation==='interpolation'&&existing)existing.interpolation=request.interpolation!;
  else {
    if(request.operation==='set'&&request.value?.every(Number.isFinite))track.value=[...request.value];
    if(track.animated||request.operation==='toggle'||request.operation==='key'){
      track.animated=true;if(existing)existing.value=[...track.value];else track.keys.push({frame:next.frame,value:[...track.value],interpolation:'linear'});track.keys.sort((a,b)=>a.frame-b.frame);
    }
  }
  next.canUndo=true;return next;
}
