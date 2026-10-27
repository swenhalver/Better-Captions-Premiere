import type {TranscriptJSON,CaptionItem,CaptionWord} from '../types';
import { DEFAULT_MAX_CHARS, MAX_CAPTION_CHARS } from '../types.ts';
let nextCaptionId=0;
const characters = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function captionCharacterCount(text: string): number {
  return characters ? Array.from(characters.segment(text)).length : Array.from(text.normalize('NFC')).length;
}
export function validateCharacterLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CAPTION_CHARS) throw new Error(`Enter a whole-number character limit from 1 to ${MAX_CAPTION_CHARS}.`);
  return value;
}
export function parseTranscript(json:TranscriptJSON,maxChars=DEFAULT_MAX_CHARS):CaptionItem[]{
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
      const word={text:prefix+text,startTime:w.start,endTime:w.start+w.duration,isActive:false,...(w.eos ? {endOfSentence:true} : {})};prefix='';
      segmentWords.push(word);if(w.eos)sentenceEnds.add(word);
    }
    words.push(...segmentWords);
  }
  words.sort((a,b)=>a.startTime-b.startTime);
  for(let i=1;i<words.length;i++)words[i-1].endTime=Math.min(words[i-1].endTime,words[i].startTime);
  return groupCaptionWords(words.filter(w=>w.endTime>w.startTime),maxChars,sentenceEnds);
}
export function groupCaptionWords(words:CaptionWord[],maxChars=DEFAULT_MAX_CHARS,sentenceEnds=new Set<CaptionWord>()):CaptionItem[]{
  validateCharacterLimit(maxChars);
  const out:CaptionItem[]=[];let group:CaptionWord[]=[],length=0;
  function flush(){if(!group.length)return;out.push({id:'caption-'+Date.now().toString(36)+'-'+nextCaptionId++,words:group.map(w=>({...w})),text:group.map(w=>w.text).join(' '),startTime:group[0].startTime,endTime:group[group.length-1].endTime});group=[];length=0;}
  for(let index=0;index<words.length;index++){
    const w=words[index], next=words[index+1];
    const last=group[group.length-1],wordLength=captionCharacterCount(w.text);
    if(last&&(w.lineBreakBefore==='break'||w.lineBreakBefore==='edge'||w.lineBreakBefore!=='join'&&(w.startTime-last.endTime>=.5||length+1+wordLength>maxChars||w.endTime-group[0].startTime>5.5)))flush();
    length+=wordLength+(group.length?1:0);group.push(w);
    if(next?.lineBreakBefore!=='join'&&(w.endOfSentence||sentenceEnds.has(w)||/[.!?]["'”’)]*$/.test(w.text)&&!/^(Mr|Mrs|Ms|Dr|St|vs)\.$/i.test(w.text)))flush();
  }flush();
  for(let i=0;i<out.length;i++)out[i].endTime=Math.min(out[i].endTime+.12,out[i+1]?.startTime??Infinity);
  return out;
}
/** Group logical sentences independently of the Premiere clips containing them. */
function sentenceGroups(captions: CaptionItem[], maxChars: number): CaptionItem[] {
  validateCharacterLimit(maxChars);
  const result: CaptionItem[] = [], owners = new Map<number, CaptionItem>();
  let run: CaptionItem[] = [];
  function flush() {
    for (const group of groupCaptionWords(run.flatMap(c => c.words), maxChars)) {
      const sources = group.words.map(w => owners.get(w.startTime)!);
      const first = sources[0], last = sources[sources.length - 1];
      result.push({ ...group, id: group.startTime === first.words[0].startTime ? first.id : group.id,
        endTime: Math.min(group.endTime, last.endTime), speaker: first.speaker,
        ...(first.position ? { position: { ...first.position } } : {}),
        timingEstimated: sources.some(c => c.timingEstimated) });
    }
    run = [];
  }
  for (const caption of captions) {
    const previous = run[run.length - 1];
    if (previous && caption.words[0]?.lineBreakBefore !== 'join' && (previous.speaker !== caption.speaker || previous.position?.x !== caption.position?.x || previous.position?.y !== caption.position?.y)) flush();
    for (const word of caption.words) owners.set(word.startTime, caption);
    run.push(caption);
  }
  flush();
  return result;
}

/** Rebuild derived sentence text after edits without changing native link identities. */
export function refreshCaptionGroups(captions: CaptionItem[], maxChars?: number): CaptionItem[] {
  const limit = maxChars ?? captions.find(caption => caption.groupingMaxChars !== undefined)?.groupingMaxChars;
  if (limit === undefined) return captions;
  const origins = new Map(captions.flatMap(caption => caption.words.map((word, index) => [word.startTime, { id: caption.id, index }] as const)));
  const groups = sentenceGroups(captions, limit).map(group => ({
    id: 'phrase-' + origins.get(group.words[0].startTime)!.id + '-' + origins.get(group.words[0].startTime)!.index,
    text: group.text, words: group.words, startTime: group.startTime, endTime: group.endTime,
  }));
  // A group may cross an old automatic clip boundary. Keep the complete word
  // context in both containers, so the sentence and spoken-word states remain
  // continuous at the cut. The native clip still gates its own visible range.
  return captions.map(caption => ({ ...caption, groupingMaxChars: limit,
    renderSegments: groups.filter(group => group.startTime < caption.endTime && group.endTime > caption.startTime)
      .map(group => ({ ...group, words: group.words.map(word => ({ ...word })) })),
  }));
}

/** Split/join sentences; applied clips remain native timing/keyframe containers. */
export function regroupCaptions(captions: CaptionItem[], maxChars: number): CaptionItem[] {
  validateCharacterLimit(maxChars);
  if (captions.some(caption => caption.clipNodeId || caption.manualSplit || caption.groupingMaxChars !== undefined)) return refreshCaptionGroups(captions, maxChars);
  return sentenceGroups(captions, maxChars);
}

export function captionSentenceCount(captions: CaptionItem[]): number {
  return new Set(captions.flatMap(caption => caption.renderSegments?.map(group => group.id) ?? [caption.id])).size;
}
export function getCaptionAtTime(captions:CaptionItem[],time:number){return captions.find(c=>time>=c.startTime&&time<c.endTime)??null;}
export function formatTime(seconds:number){const ticks=Math.round(Math.max(0,Number.isFinite(seconds)?seconds:0)*100),min=Math.floor(ticks/6000);return String(min).padStart(2,'0')+':'+((ticks%6000)/100).toFixed(2).padStart(5,'0');}
