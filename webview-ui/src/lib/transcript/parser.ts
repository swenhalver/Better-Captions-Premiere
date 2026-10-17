import type {TranscriptJSON,CaptionItem,CaptionWord} from '../types';
let nextCaptionId=0;
export function parseTranscript(json:TranscriptJSON,maxWords=6,maxChars=56):CaptionItem[]{
  const words:CaptionWord[]=[],sentenceEnds=new Set<CaptionWord>();
  for(const segment of json.segments||[]){
    const segmentWords:CaptionWord[]=[];let prefix='';
    for(const w of segment.words||[]){
      if(typeof w.text!=='string'||!w.text.trim())continue;
      const text=w.text.trim();
      if(w.type==='punctuation'){
        if(/^[“‘([{]+$/.test(text)||!segmentWords.length&&/^["']+$/.test(text))prefix+=text;
        else if(segmentWords.length)segmentWords[segmentWords.length-1].text+=text;
        continue;
      }
      if(!Number.isFinite(w.start)||w.start<0||!Number.isFinite(w.duration)||w.duration<=0||!Number.isFinite(w.start+w.duration))continue;
      const word={text:prefix+text,startTime:w.start,endTime:w.start+w.duration,isActive:false};prefix='';
      segmentWords.push(word);if(w.eos)sentenceEnds.add(word);
    }
    words.push(...segmentWords);
  }
  words.sort((a,b)=>a.startTime-b.startTime);
  for(let i=1;i<words.length;i++)words[i-1].endTime=Math.min(words[i-1].endTime,words[i].startTime);
  return groupCaptionWords(words.filter(w=>w.endTime>w.startTime),maxWords,maxChars,sentenceEnds);
}
export function groupCaptionWords(words:CaptionWord[],maxWords=6,maxChars=56,sentenceEnds=new Set<CaptionWord>()):CaptionItem[]{
  const out:CaptionItem[]=[];let group:CaptionWord[]=[];
  function flush(){if(!group.length)return;out.push({id:'caption-'+Date.now().toString(36)+'-'+nextCaptionId++,words:group.map(w=>({...w})),text:group.map(w=>w.text).join(' '),startTime:group[0].startTime,endTime:group[group.length-1].endTime});group=[];}
  for(const w of words){const last=group[group.length-1];if(last&&(w.startTime-last.endTime>=.5||group.length>=maxWords||group.concat(w).map(x=>x.text).join(' ').length>maxChars||w.endTime-group[0].startTime>5.5))flush();group.push(w);if(sentenceEnds.has(w)||/[.!?]["'”’)]*$/.test(w.text)&&!/^(Mr|Mrs|Ms|Dr|St|vs)\.$/i.test(w.text))flush();}flush();
  for(let i=0;i<out.length;i++)out[i].endTime=Math.min(out[i].endTime+.12,out[i+1]?.startTime??Infinity);
  return out;
}
export function getCaptionAtTime(captions:CaptionItem[],time:number){return captions.find(c=>time>=c.startTime&&time<c.endTime)??null;}
export function formatTime(seconds:number){const ticks=Math.round(Math.max(0,Number.isFinite(seconds)?seconds:0)*100),min=Math.floor(ticks/6000);return String(min).padStart(2,'0')+':'+((ticks%6000)/100).toFixed(2).padStart(5,'0');}
