import type {CaptionItem,CaptionWord} from '../types';
let nextSplitId=0;
export function validateCaptions(captions:CaptionItem[]){
  if(!captions.length)throw new Error('Transcribe or load captions first.');
  const ids=new Set<string>();
  captions.forEach((c,i)=>{
    if(ids.has(c.id))throw new Error('Duplicate caption ID.');ids.add(c.id);
    if(!Number.isFinite(c.startTime)||!Number.isFinite(c.endTime)||c.startTime<0||c.endTime<=c.startTime)throw new Error(`Caption ${i+1}: end must be after start.`);
    if(i&&c.startTime<captions[i-1].endTime-.0001)throw new Error(`Caption ${i+1} overlaps the previous caption.`);
    if(!c.words.length)throw new Error(`Caption ${i+1} needs at least one word.`);
    c.words.forEach((w,j)=>{if(!w.text.trim()||!Number.isFinite(w.startTime)||!Number.isFinite(w.endTime)||w.startTime<c.startTime-.0001||w.endTime>c.endTime+.0001||w.endTime<=w.startTime)throw new Error(`Caption ${i+1}, word ${j+1}: keep word timing inside the caption.`);if(j&&w.startTime<c.words[j-1].endTime-.0001)throw new Error(`Caption ${i+1}: word timings overlap.`);});
  });return true;
}
export function replaceText(c:CaptionItem,text:string):CaptionItem{
  const tokens=text.trim().split(/\s+/).filter(Boolean);if(!tokens.length)throw new Error('A line cannot be empty.');
  const keepLine=(words:CaptionWord[]):CaptionWord[]=>{
    const removed=c.words[0]?.pauseLinesRemoved;
    // Pause deletion belongs to the boundary before this line, including when
    // its first spoken word is replaced, removed or preceded by new typing.
    const bounded=words.map((word,index)=>{
      const next={...word};
      if(removed!==undefined){
        if(index===0)next.pauseLinesRemoved=removed;
        else if(word.startTime===c.words[0].startTime)delete next.pauseLinesRemoved;
      }
      return next;
    });
    const first=c.words[0]?.lineBreakBefore;
    return (first==='break'||first==='edge')&&c.words.slice(1).every(word=>word.lineBreakBefore==='join')?bounded.map((word,index)=>({...word,lineBreakBefore:index===0?first:'join'})):bounded;
  };
  if(tokens.length===c.words.length)return {...c,text:tokens.join(' '),words:c.words.map((w,i)=>({...w,text:tokens[i]}))};
  const last=c.words[c.words.length-1]?.endTime??c.endTime;
  const estimate=(items:string[],start:number,end:number):CaptionWord[]=>{
    let cursor=start;const total=items.reduce((n,w)=>n+w.length,0);
    return items.map((text,i)=>{const startTime=cursor;cursor+=(end-start)*text.length/total;return {text,startTime,endTime:i===items.length-1?end:cursor,isActive:false};});
  };
  // Match surviving words in order so an inserted or deleted word does not
  // throw away accurate transcription timings for the rest of the sentence.
  const key=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const oldKeys=c.words.map(w=>key(w.text)),newKeys=tokens.map(key);
  const matches=Array.from({length:c.words.length+1},()=>Array(tokens.length+1).fill(0));
  for(let i=c.words.length-1;i>=0;i--)for(let j=tokens.length-1;j>=0;j--)matches[i][j]=oldKeys[i]&&oldKeys[i]===newKeys[j]?matches[i+1][j+1]+1:Math.max(matches[i+1][j],matches[i][j+1]);
  const anchors:{index:number;word:CaptionWord}[]=[];
  for(let i=0,j=0;i<c.words.length&&j<tokens.length;){
    if(oldKeys[i]&&oldKeys[i]===newKeys[j]){anchors.push({index:j,word:{...c.words[i],text:tokens[j]}});i++;j++;}
    else if(matches[i+1][j]>=matches[i][j+1])i++;else j++;
  }
  const words:CaptionWord[]=[];let tokenIndex=0,cursor=c.startTime,canPreserve=true;
  for(const anchor of [...anchors,{index:tokens.length,word:{text:'',startTime:last,endTime:last,isActive:false}}]){
    if(anchor.index>tokenIndex){
      if(anchor.word.startTime<=cursor){canPreserve=false;break;}
      words.push(...estimate(tokens.slice(tokenIndex,anchor.index),cursor,anchor.word.startTime));
    }
    if(anchor.index<tokens.length)words.push(anchor.word);
    tokenIndex=anchor.index+1;cursor=anchor.word.endTime;
  }
  // Inserting speech into a gap with no duration necessarily changes timing.
  // Mark estimates visibly, and let the timing editor provide exact corrections.
  return {...c,text:tokens.join(' '),timingEstimated:true,words:keepLine(canPreserve?words:estimate(tokens,c.startTime,last))};
}
export function retime(c:CaptionItem,start:number,end:number):CaptionItem{
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('Line end must be after its nonnegative start.');
  validateCaptions([c]);const scale=(end-start)/(c.endTime-c.startTime);
  const updated={...c,startTime:start,endTime:end,words:c.words.map(w=>({...w,startTime:start+(w.startTime-c.startTime)*scale,endTime:start+(w.endTime-c.startTime)*scale}))};
  validateCaptions([updated]);return updated;
}
export function split(c:CaptionItem,index:number):CaptionItem[]{
  if(!Number.isInteger(index)||index<1||index>=c.words.length)throw new Error('Select an interior word to split.');
  const make=(words:CaptionWord[],id:string)=>({...c,id,manualSplit:true,clipNodeId:undefined,projectItemId:undefined,mediaPath:undefined,position:c.position?{...c.position}:undefined,words:words.map(w=>({...w})),text:words.map(w=>w.text).join(' '),startTime:words[0].startTime,endTime:words[words.length-1].endTime});
  return [make(c.words.slice(0,index),c.id),make(c.words.slice(index),c.id+'-'+Date.now().toString(36)+'-'+nextSplitId++)];
}
