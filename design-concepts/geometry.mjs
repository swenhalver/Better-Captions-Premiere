export const FRAME = {width:1920, height:1080};
export const AREA_TRACKS = {
  position:{label:'Position', fields:[['x','Position X, px',-1920,3840],['y','Position Y, px',-1080,2160]], initial:[960,918]},
  width:{label:'Width', fields:[['width','Text area width, px',96,3840]], initial:[1536]},
  height:{label:'Height', fields:[['height','Text area height, px',24,2160]], initial:[216]},
};
export function createArea(){
  return {tracks:Object.fromEntries(Object.entries(AREA_TRACKS).map(([id,p])=>[id,{value:[...p.initial],enabled:false,keys:[]}]))};
}
export function valueAt(track,frame){
  const keys=track.keys;
  if(!track.enabled||!keys.length)return [...track.value];
  if(frame<=keys[0].frame)return [...keys[0].value];
  if(frame>=keys.at(-1).frame)return [...keys.at(-1).value];
  const right=keys.findIndex(k=>k.frame>frame),a=keys[right-1],b=keys[right];
  const t=(frame-a.frame)/(b.frame-a.frame);
  const progress=a.interpolation==='hold'?0:a.interpolation==='ease'?t*t*(3-2*t):t;
  return a.value.map((v,i)=>v+(b.value[i]-v)*progress);
}
export function setAreaValue(area,id,component,raw,frame,start,end){
  const numeric=Number(raw);
  if(String(raw).trim()===''||!Number.isFinite(numeric))return {invalid:true};
  const track=area.tracks[id],spec=AREA_TRACKS[id].fields[component];
  const value=Math.round(Math.max(spec[2],Math.min(spec[3],numeric)));
  const values=valueAt(track,frame);values[component]=value;
  if(track.enabled)putKey(track,frame,values,start,end);else track.value=values;
  return {value,limited:value!==numeric};
}
export function putKey(track,frame,value,start,end,interpolation){
  frame=Math.max(start,Math.min(end-1,Math.round(frame)));
  const existing=track.keys.find(k=>k.frame===frame);
  if(existing){existing.value=[...value];if(interpolation)existing.interpolation=interpolation;}
  else {const prior=track.keys.filter(k=>k.frame<frame).at(-1);track.keys.push({frame,value:[...value],interpolation:interpolation||prior?.interpolation||'linear'});track.keys.sort((a,b)=>a.frame-b.frame);}
  track.enabled=true;
}
export function toggleAnimation(track,frame,start,end){
  const value=valueAt(track,frame);
  if(track.enabled){track.value=value;track.keys=[];track.enabled=false;}
  else putKey(track,frame,value,start,end);
}
export function toggleKey(track,frame,start,end){
  const i=track.keys.findIndex(k=>k.frame===frame),value=valueAt(track,frame);
  if(i<0)putKey(track,frame,value,start,end);
  else {track.keys.splice(i,1);if(!track.keys.length){track.value=value;track.enabled=false;}}
}
// Caption edits retain the evaluated geometry at every frame, including across
// a split or merge. Frame samples are only used when caption ranges change.
export function remapArea(captions,start,end){
  const result=createArea();
  const at=frame=>captions.find(c=>c.start<=frame&&c.end>frame)||captions.filter(c=>c.start<=frame).at(-1)||captions[0];
  for(const id of Object.keys(AREA_TRACKS)){
    const track=result.tracks[id],samples=[];
    for(let frame=start;frame<end;frame++){
      const owner=at(frame),source=owner.area?.tracks[id]||createArea().tracks[id];
      samples.push({frame,value:valueAt(source,frame),interpolation:'linear'});
    }
    track.value=[...samples[0].value];
    if(samples.some(k=>k.value.some((v,i)=>Math.abs(v-track.value[i])>.0001))){track.enabled=true;track.keys=samples;}
  }
  return result;
}
