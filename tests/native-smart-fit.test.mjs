import test from 'node:test';
import assert from 'node:assert/strict';
import { smartFitCaptionPhrases, smartFitDisplayText, createCanvasWordMeasure } from '../webview-ui/src/lib/native-effect/smart-fit.ts';
import { deriveNativePanelPhrases, rehydrateNativePanel, prepareNativePanelUpdate } from '../webview-ui/src/lib/native-effect/panel.ts';
import { DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
const appearances=()=>['upcomingWord','activeWord','spokenWord'].map(key=>({...resolveAppearance(DEFAULT_STYLE,key),fontSize:10,bubble:false,padding:8}));
function caption(text,id='one'){const words=text.split(' ').map((text,i)=>({text,startTime:i,endTime:i+.5,isActive:false,endOfSentence:false}));return{id,text,words,startTime:0,endTime:words.at(-1).endTime};}
const rows=caption=>caption.renderSegments.map(s=>s.words.map(w=>w.text));
function bound(text='one two three four'){
 const c=caption(text),style=defaultNativeStyle();for(const key of ['current','upcoming','spoken']){style[key].fontSize=10;style[key].bubble=false;style[key].sizeScale=1;style[key].padding=8;}style.wordSpacing=5;
 const document={version:1,binaryVersion:3,animationAuthority:'premiere-effect',sequenceId:'sequence',timeOriginSeconds:0,style,captions:[{id:c.id,start:0,end:c.endTime,manualSplit:false,words:c.words.map(w=>({text:w.text,start:w.startTime,end:w.endTime,endOfSentence:false}))}]};
 const documentText=encodeNativeTransportText(document),ticks=String(Math.round(c.endTime*254016000000)),locator={projectPath:'/project/edit.prproj',sequenceId:'sequence',clipNodeId:'native',trackIndex:2,clipIndex:0,componentIndex:0,documentParamIndex:0};
 const entry={kind:'native-effect',clipNodeId:'native',projectItemId:'item',trackIndex:2,clipIndex:0,startTicks:'0',endTicks:ticks,inTicks:'0',outTicks:ticks,selected:false,locator,matchName:NATIVE_EFFECT_MATCH_NAME,documentText,maxChars:1,smartLineFit:true,lineFitWidth:50,lineFitFontScale:1};
 entry.revision=JSON.stringify({projectPath:locator.projectPath,sequenceId:'sequence',clipNodeId:'native',adjustmentLayer:true,start:'0',end:ticks,inPoint:'0',outPoint:ticks,components:[NATIVE_EFFECT_MATCH_NAME],documentIndex:0,documentText});
 return {entry,...rehydrateNativePanel(entry,{id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20})};
}

test('smart line fit uses 95% width, worst word-state advance and bubble padding without altering original words',()=>{
 const c=caption('one two three'),before=structuredClone(c),states=appearances();states[1].fontSize=20;
 const options={width:50,wordSpacing:5,appearances:states},out=smartFitCaptionPhrases([c],options,(_text,s)=>s.fontSize)[0];
 assert.deepEqual(rows(out),[['one','two'],['three']]);assert.deepEqual(c,before);assert.deepEqual(out.renderSegments.flatMap(s=>s.words),c.words);
 states[1].bubble=true;states[1].fontSize=10;
 assert.deepEqual(rows(smartFitCaptionPhrases([c],options,(_text,s)=>s.fontSize)[0]),[['one'],['two'],['three']]);
 const edge=smartFitCaptionPhrases([caption('one two')],{...options,width:40,wordSpacing:0,appearances:appearances()},()=>20)[0];assert.deepEqual(rows(edge),[['one'],['two']],'40 pixels does not fit in 95% of width 40');
});
test('group boundaries stay fixed across active-word changes, sentence/pause breaks and manual containers',()=>{
 const c=caption('one two. three four five');c.words[4].startTime=9;c.words[4].endTime=9.5;c.endTime=9.5;
 const opts={width:8192,wordSpacing:5,appearances:appearances()},first=smartFitCaptionPhrases([c],opts,()=>10)[0];
 assert.deepEqual(rows(first),[['one','two.'],['three','four'],['five']]);
 c.words[2].isActive=true;const second=smartFitCaptionPhrases([c],opts,()=>10)[0];assert.deepEqual(rows(second),rows(first));
 const split=smartFitCaptionPhrases([caption('one','left'),{...caption('two','right'),manualSplit:true}],opts,()=>10);assert.equal(split.length,2);assert.deepEqual(split.map(rows),[[['one']],[['two']]]);
});
test('punctuation attaches even when oversized and long words remain whole',()=>{
 const out=smartFitCaptionPhrases([caption('large , another extraordinarilylong')],{width:20,wordSpacing:10,appearances:appearances()},text=>text.length*10)[0];
 assert.deepEqual(rows(out),[['large',','],['another'],['extraordinarilylong']]);
});
test('measurement uses displayed case, supports all three states and rejects unsafe metric results',()=>{
 const c=caption('mixed'),states=appearances();states.forEach(s=>s.textTransform='uppercase');const seen=[];
 smartFitCaptionPhrases([c],{width:50,wordSpacing:5,appearances:states},(text,s)=>{seen.push([text,s.fontSize]);return 10;});assert.deepEqual(seen,[['MIXED',10],['MIXED',10],['MIXED',10]]);assert.equal(c.words[0].text,'mixed');
 assert.equal(smartFitDisplayText('hELLo-world éCOLE','titlecase'),'Hello-World école');assert.equal(smartFitDisplayText('straße','uppercase'),'STRASSE');
 for(const invalid of [NaN,Infinity,-1,1e10])assert.throws(()=>smartFitCaptionPhrases([c],{width:50,wordSpacing:5,appearances:states},()=>invalid),/measurement failed/);
});
test('canvas adapter selects family/weight/italic/effective size and includes synthetic slant overhang without guessed metrics',()=>{
 const context={font:'',measureText:()=>({width:20,actualBoundingBoxLeft:2,actualBoundingBoxRight:25})},measure=createCanvasWordMeasure(context),style={...appearances()[0],fontFamily:'Font "Quoted"',fontWeight:600,fontSize:32,italic:true};
 assert.equal(measure('hello',style),27);assert.equal(context.font,'italic 600 32px "Font \\"Quoted\\""');assert.equal(createCanvasWordMeasure(null),null);
});
test('native panel helper uses current edited styles/global font scale while preserving native fixed spacing/padding and byte-identical documents',()=>{
 const {session,binding,entry}=bound(),calls=[];binding.clip.lineFitFontScale=2;session.style.activeWord.bubble=true;
 const derived=deriveNativePanelPhrases(binding,session,(_text,s)=>{calls.push([s.fontSize,s.padding]);return s.fontSize;});assert.equal(derived.length,1);assert.equal(derived[0].id,session.captions[0].id);
 assert.ok(calls.every(([size,pad])=>size===20&&pad===8));assert.deepEqual(rows(derived[0]),[['one'],['two'],['three'],['four']]);
 const edited=structuredClone(binding.baseline);edited.captions=derived;assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,edited)),entry.documentText,'derived phrase rows never become native document fields');
 session.style.activeWord.bubble=false;binding.clip.lineFitFontScale=1;assert.deepEqual(rows(deriveNativePanelPhrases(binding,session,()=>10)[0]),[['one','two','three'],['four']],'smart mode ignores saved character limit1');
 const measuredOpen=rehydrateNativePanel(entry,{id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20},()=>10);assert.deepEqual(rows(measuredOpen.session.captions[0]),[['one','two','three'],['four']]);assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(measuredOpen.binding,measuredOpen.session)),entry.documentText);
 const fallback=deriveNativePanelPhrases(binding,session,null);assert.equal(fallback[0].renderSegments.length,4);assert.ok(rehydrateNativePanel(entry,{id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20}).warnings.some(w=>/measurement is unavailable/.test(w)));
 for(const patch of [{lineFitWidth:NaN},{lineFitFontScale:0},{smartLineFit:'true'}])assert.throws(()=>deriveNativePanelPhrases({...binding,clip:{...binding.clip,...patch}},session,()=>10));
});

test('native state Size/Bubble/Padding overrides mirror render_style without scaling padding by global size',()=>{
 const {session,binding,entry}=bound(),before=structuredClone(session);
 const neutral={sizeScale:1,bubbleMode:1,paddingScale:1};
 binding.clip.lineFitStates={upcoming:{...neutral},current:{sizeScale:2,bubbleMode:1,paddingScale:1},spoken:{...neutral}};
 let out=deriveNativePanelPhrases(binding,session,(_text,s)=>s.fontSize);assert.deepEqual(rows(out[0]),[['one','two'],['three','four']]);
 binding.clip.lineFitStates.current={sizeScale:1,bubbleMode:2,paddingScale:2};
 out=deriveNativePanelPhrases(binding,session,(_text,s)=>s.fontSize);assert.deepEqual(rows(out[0]),[['one'],['two'],['three'],['four']]);
 binding.clip.lineFitStates.current.bubbleMode=3;assert.deepEqual(rows(deriveNativePanelPhrases(binding,session,(_text,s)=>s.fontSize)[0]),[['one','two','three'],['four']]);
 binding.clip.lineFitStates.current={sizeScale:2,bubbleMode:2,paddingScale:2};binding.clip.lineFitFontScale=2;const measured=[];
 deriveNativePanelPhrases(binding,session,(_text,s)=>{measured.push([s.fontSize,s.bubble,s.padding]);return s.fontSize;});
 assert.deepEqual(measured.slice(0,3),[[20,false,8],[40,true,16],[20,false,8]]);assert.deepEqual(session,before,'effective EC overrides never mutate saved panel document styles');
 const edited=structuredClone(session);edited.captions=out;assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,edited)),entry.documentText);
});
test('absent state metadata uses neutral overrides; malformed or partial metadata refuses even without canvas',()=>{
 const {session,binding}=bound(),neutral={sizeScale:1,bubbleMode:1,paddingScale:1};
 const original=deriveNativePanelPhrases(binding,session,(_text,s)=>s.fontSize);binding.clip.lineFitStates={upcoming:{...neutral},current:{...neutral},spoken:{...neutral}};
 assert.deepEqual(deriveNativePanelPhrases(binding,session,(_text,s)=>s.fontSize),original);
 for(const patch of [{sizeScale:0},{sizeScale:4.1},{paddingScale:-1},{paddingScale:4.1},{bubbleMode:0},{bubbleMode:4},{paddingScale:NaN},{extra:1}]){
  binding.clip.lineFitStates.current={...neutral,...patch};assert.throws(()=>deriveNativePanelPhrases(binding,session,()=>10),/state overrides/);assert.throws(()=>deriveNativePanelPhrases(binding,session,null),/state overrides/);
 }
 for(const metadata of [null,{},[],{current:neutral},{current:undefined,upcoming:neutral,spoken:neutral},{current:null,upcoming:neutral,spoken:neutral},{current:neutral,upcoming:neutral,spoken:neutral,extra:neutral}]){binding.clip.lineFitStates=metadata;assert.throws(()=>deriveNativePanelPhrases(binding,session,()=>10),/state overrides/);}
});
