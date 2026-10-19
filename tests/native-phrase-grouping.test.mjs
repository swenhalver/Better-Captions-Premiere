import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { rehydrateNativePanel, prepareNativePanelUpdate } from '../webview-ui/src/lib/native-effect/panel.ts';
import { captionSegmentRange, replaceCaptionSegment } from '../webview-ui/src/lib/transcript/segments.ts';

function caption(text) {
 const words=text.split(' ').map((text,i)=>({text,startTime:i*.3,endTime:(i+1)*.3,isActive:false}));
 return {id:'one-clip',text,startTime:0,endTime:words.at(-1).endTime,words};
}
function nativeEntry(text,maxChars) {
 const c=caption(text),document={version:1,binaryVersion:3,animationAuthority:'premiere-effect',sequenceId:'sequence',timeOriginSeconds:0,style:defaultNativeStyle(),captions:[{id:c.id,start:0,end:c.endTime,manualSplit:false,words:c.words.map(w=>({text:w.text,start:w.startTime,end:w.endTime,endOfSentence:false}))}]};
 const documentText=encodeNativeTransportText(document),locator={projectPath:'/project/edit.prproj',sequenceId:'sequence',clipNodeId:'native',trackIndex:2,clipIndex:0,componentIndex:0,documentParamIndex:0},ticks=String(Math.round(c.endTime*254016000000));
 const entry={kind:'native-effect',clipNodeId:'native',projectItemId:'item',trackIndex:2,clipIndex:0,startTicks:'0',endTicks:ticks,inTicks:'0',outTicks:ticks,selected:false,locator,matchName:NATIVE_EFFECT_MATCH_NAME,documentText,maxChars};
 entry.revision=JSON.stringify({projectPath:locator.projectPath,sequenceId:'sequence',clipNodeId:'native',adjustmentLayer:true,start:'0',end:ticks,inPoint:'0',outPoint:ticks,components:[NATIVE_EFFECT_MATCH_NAME],documentIndex:0,documentText});
 return {entry,document};
}
test('a long bundled native transcript opens as character-limited phrase rows while retaining one clip and every timed word',()=>{
 const text="All right, this thing's finally going. It hasn't started in months. I've just been putting it off. Got a quote from Junkyard vehicle.net and booked a pickup. All right, that's done.";
 const c=caption(text),before=structuredClone(c),[grouped]=nativeCaptionPhrases([c],56);
 assert.equal(grouped.id,c.id);assert.deepEqual(c,before);assert.ok(grouped.renderSegments.length>4);
 assert.deepEqual(grouped.renderSegments.flatMap(s=>s.words),c.words);
 for(const row of grouped.renderSegments){assert.ok(Array.from(row.text).length<=56);assert.ok(captionSegmentRange(grouped,row));}
 const {entry,document}=nativeEntry(text,56),{session,binding}=rehydrateNativePanel(entry,{id:'sequence',name:'Portrait',frameWidth:720,frameHeight:1280,frameRate:24,duration:60});
 assert.equal(session.captions.length,1);assert.ok(session.captions[0].renderSegments.length>4);
 assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,session)),entry.documentText);
 const edited=structuredClone(session),row=edited.captions[0].renderSegments[1],replacement={...edited.captions[0],...row,text:row.text.replace('months','weeks'),words:row.words.map(w=>({...w,text:w.text.replace('months','weeks')}))};
 edited.captions[0]=replaceCaptionSegment(edited.captions[0],row,replacement);
 edited.captions=nativeCaptionPhrases(edited.captions,56);
 const next=prepareNativePanelUpdate(binding,edited);assert.equal(next.captions.length,1);assert.equal(next.captions[0].words.length,document.captions[0].words.length);assert.ok(next.captions[0].words.some(w=>w.text==='weeks.'));
});
test('native phrase boundaries use native punctuation, exact pause threshold, Unicode scalars and whole long words',()=>{
 const c=caption('Hello , world. next words later Supercalifragilistic');
 c.words[4].startTime=c.words[3].endTime+.6;c.words[4].endTime=c.words[4].startTime+.2;
 c.words[5].startTime=c.words[4].endTime+.61;c.words[5].endTime=c.words[5].startTime+.2;
 c.words[6].startTime=c.words[5].endTime;c.words[6].endTime=c.words[6].startTime+.2;
 const [out]=nativeCaptionPhrases([c],20);
 assert.deepEqual(out.renderSegments.map(s=>s.words.map(w=>w.text)),[['Hello',',','world.'],['next','words'],['later'],['Supercalifragilistic']]);
 assert.equal(nativeCaptionPhrases([caption('😀 😀 😀')],3)[0].renderSegments.length,2);
 assert.throws(()=>nativeCaptionPhrases([c],0));assert.throws(()=>nativeCaptionPhrases([c],501));
});
test('the effect character limit controls derived rows and native adoption rejects malformed limits',()=>{
 const {entry}=nativeEntry('one two three four five six seven eight nine ten.',12),info={id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20};
 const narrow=rehydrateNativePanel(entry,info).session,wide=rehydrateNativePanel({...entry,maxChars:56},info).session;
 assert.equal(narrow.style.maxChars,12);assert.ok(narrow.captions[0].renderSegments.length>wide.captions[0].renderSegments.length);
 for(const maxChars of [0,501,NaN,'12'])assert.throws(()=>rehydrateNativePanel({...entry,maxChars},info));
});
test('panel regrouping changes only the native effect limit and confirms the readback before retaining it',async()=>{
 const {confirmNativePanelUpdate}=await import('../webview-ui/src/lib/native-effect/panel.ts');
 const {entry}=nativeEntry('one two three four five six seven eight nine ten.',56),info={id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20};
 const {session,binding}=rehydrateNativePanel(entry,info),edited=structuredClone(session);
 edited.style.maxChars=12;edited.captions=nativeCaptionPhrases(edited.captions,12);
 const prepared=prepareNativePanelUpdate(binding,edited);
 assert.equal(encodeNativeTransportText(prepared),entry.documentText,'regroup never rewrites the source words or style');
 assert.throws(()=>confirmNativePanelUpdate(binding,prepared,edited,{revision:entry.revision,documentText:entry.documentText}),/character limit/);
 const confirmed=confirmNativePanelUpdate(binding,prepared,edited,{revision:entry.revision,documentText:entry.documentText,maxChars:12});
 assert.equal(confirmed.clip.maxChars,12);assert.equal(confirmed.baseline.style.maxChars,12);
 assert.equal(confirmed.baseline.captions.length,1);assert.ok(confirmed.baseline.captions[0].renderSegments.length>session.captions[0].renderSegments.length);
});
