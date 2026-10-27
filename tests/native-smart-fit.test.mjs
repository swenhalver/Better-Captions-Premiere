import test from 'node:test';
import assert from 'node:assert/strict';
import { smartFitCharacterCapacity, smartFitDisplayText, createCanvasWordMeasure } from '../webview-ui/src/lib/native-effect/smart-fit.ts';
import { nativeLineFitCharacterCapacity, deriveNativePanelPhrases, rehydrateNativePanel, prepareNativePanelUpdate } from '../webview-ui/src/lib/native-effect/panel.ts';
import { DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { defaultNativeStyle, NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeTransportText } from '../webview-ui/src/lib/native-effect/encode.ts';
import { confirmLineControls } from '../webview-ui/src/lib/native-effect/line-controls.ts';
const appearances=()=>['upcomingWord','activeWord','spokenWord'].map(key=>({...resolveAppearance(DEFAULT_STYLE,key),fontSize:10,bubble:false,padding:8}));
function caption(text,id='one'){const words=text.split(' ').map((text,i)=>({text,startTime:i,endTime:i+.5,isActive:false,endOfSentence:false}));return{id,text,words,startTime:0,endTime:words.at(-1).endTime};}
const rows=caption=>caption.renderSegments.map(s=>s.words.map(w=>w.text));
function bound(text='one two three four'){
 const c=caption(text),style=defaultNativeStyle();for(const key of ['current','upcoming','spoken']){style[key].fontSize=10;style[key].bubble=false;style[key].sizeScale=1;style[key].padding=8;}style.wordSpacing=5;
 const document={version:1,binaryVersion:3,animationAuthority:'premiere-effect',sequenceId:'sequence',timeOriginSeconds:0,style,captions:[{id:c.id,start:0,end:c.endTime,manualSplit:false,words:c.words.map(w=>({text:w.text,start:w.startTime,end:w.endTime,endOfSentence:false}))}]};
 const documentText=encodeNativeTransportText(document),ticks=String(Math.round(c.endTime*254016000000)),locator={projectPath:'/project/edit.prproj',sequenceId:'sequence',clipNodeId:'native',trackIndex:2,clipIndex:0,componentIndex:0,documentParamIndex:0};
 const entry={kind:'native-effect',clipNodeId:'native',projectItemId:'item',trackIndex:2,clipIndex:0,startTicks:'0',endTicks:ticks,inTicks:'0',outTicks:ticks,selected:false,locator,matchName:NATIVE_EFFECT_MATCH_NAME,documentText,maxChars:1,lineFitWidth:50,lineFitFontScale:1};
 entry.revision=JSON.stringify({projectPath:locator.projectPath,sequenceId:'sequence',clipNodeId:'native',adjustmentLayer:true,start:'0',end:ticks,inPoint:'0',outPoint:ticks,components:[NATIVE_EFFECT_MATCH_NAME],documentIndex:0,documentText});
 return {entry,...rehydrateNativePanel(entry,{id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20})};
}

test('line fit capacity uses 95% width and measures displayed case across all three states',()=>{
 const c=caption('mixed'),states=appearances();states.forEach(s=>s.textTransform='uppercase');const seen=[];
 smartFitCharacterCapacity([c],{width:50,wordSpacing:5,appearances:states},(text,s)=>{seen.push([text,s.fontSize]);return 10;});assert.deepEqual(seen,[['MIXED',10],['MIXED',10],['MIXED',10]]);assert.equal(c.words[0].text,'mixed');
 const plain=appearances().map(s=>({...s,paddingLeft:0,paddingRight:0}));
 assert.equal(smartFitCharacterCapacity([caption('abcd')],{width:40,wordSpacing:0,appearances:plain},()=>40),3,'four characters in 40 pixels fit 3 characters in 95% of width 40');
 assert.equal(smartFitDisplayText('hELLo-world éCOLE','titlecase'),'hELLo-World éCOLE');assert.equal(smartFitDisplayText('NASA visits JunkYourVehicle.Net','titlecase'),'NASA Visits JunkYourVehicle.Net');assert.equal(smartFitDisplayText('visit junkyourvehicle.net','titlecase'),'Visit Junkyourvehicle.Net');assert.equal(smartFitDisplayText('straße','uppercase'),'STRASSE');
 for(const invalid of [NaN,Infinity,-1,1e10])assert.throws(()=>smartFitCharacterCapacity([c],{width:50,wordSpacing:5,appearances:states},()=>invalid),/measurement failed/);
});
test('canvas adapter selects family/weight/italic/effective size and includes synthetic slant overhang without guessed metrics',()=>{
 const context={font:'',measureText:()=>({width:20,actualBoundingBoxLeft:2,actualBoundingBoxRight:25})},measure=createCanvasWordMeasure(context),style={...appearances()[0],fontFamily:'Font "Quoted"',fontWeight:600,fontSize:32,italic:true};
 assert.equal(measure('hello',style),27);assert.equal(context.font,'italic 600 32px "Font \\"Quoted\\""');assert.equal(createCanvasWordMeasure(null),null);
});
test('native panel phrase rows group only by Characters per line, whatever the line fit metadata',()=>{
 const {session,binding,entry}=bound();
 assert.deepEqual(rows(session.captions[0]),[['one'],['two'],['three'],['four']]);
 const derived=deriveNativePanelPhrases(binding,session);assert.deepEqual(rows(derived[0]),rows(session.captions[0]));
 binding.clip.lineFitWidth=8192;binding.clip.lineFitFontScale=.1;assert.deepEqual(rows(deriveNativePanelPhrases(binding,session)[0]),[['one'],['two'],['three'],['four']]);
 const wide={...session,style:{...session.style,maxChars:56}};assert.deepEqual(rows(deriveNativePanelPhrases(binding,wide)[0]),[['one','two','three','four']]);
 const edited=structuredClone(binding.baseline);edited.captions=derived;assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,edited)),entry.documentText,'derived phrase rows never become native document fields');
 assert.ok(!rehydrateNativePanel(entry,{id:'sequence',name:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:20}).warnings.some(w=>/Smart line fit/.test(w)));
});

test('native state Size/Bubble/Padding overrides mirror render_style in the line fit measurement without scaling padding by global size',()=>{
 const {session,binding,entry}=bound(),before=structuredClone(session);
 const neutral={sizeScale:1,bubbleMode:1,paddingScale:1};
 binding.clip.lineFitStates={upcoming:{...neutral},current:{sizeScale:2,bubbleMode:2,paddingScale:2},spoken:{...neutral}};binding.clip.lineFitFontScale=2;const measured=[];
 nativeLineFitCharacterCapacity(binding,session,(_text,s)=>{measured.push([s.fontSize,s.bubble,s.padding]);return s.fontSize;});
 assert.deepEqual(measured.slice(0,3),[[20,false,8],[40,true,16],[20,false,8]]);assert.deepEqual(session,before,'effective EC overrides never mutate saved panel document styles');
 assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,session)),entry.documentText);
});
test('absent state metadata uses neutral overrides; malformed or partial metadata refuses',()=>{
 const {session,binding}=bound(),neutral={sizeScale:1,bubbleMode:1,paddingScale:1},measure=(_text,s)=>s.fontSize;
 const original=nativeLineFitCharacterCapacity(binding,session,measure);binding.clip.lineFitStates={upcoming:{...neutral},current:{...neutral},spoken:{...neutral}};
 assert.equal(nativeLineFitCharacterCapacity(binding,session,measure),original);
 for(const patch of [{sizeScale:0},{sizeScale:4.1},{paddingScale:-1},{paddingScale:4.1},{bubbleMode:0},{bubbleMode:4},{paddingScale:NaN},{extra:1}]){
  binding.clip.lineFitStates.current={...neutral,...patch};assert.throws(()=>nativeLineFitCharacterCapacity(binding,session,()=>10),/state overrides/);
 }
 for(const metadata of [null,{},[],{current:neutral},{current:undefined,upcoming:neutral,spoken:neutral},{current:null,upcoming:neutral,spoken:neutral},{current:neutral,upcoming:neutral,spoken:neutral,extra:neutral}]){binding.clip.lineFitStates=metadata;assert.throws(()=>nativeLineFitCharacterCapacity(binding,session,()=>10),/state overrides/);}
 binding.clip.lineFitStates=undefined;for(const patch of [{lineFitWidth:NaN},{lineFitFontScale:0}])assert.throws(()=>nativeLineFitCharacterCapacity({...binding,clip:{...binding.clip,...patch}},session,()=>10),/geometry/);
});


test('line fit character number follows width, actual letter widths and largest highlighted appearance',()=>{
 const states=appearances(),options={width:200,wordSpacing:10,appearances:states};
 const measure=(text,s)=>Array.from(text).reduce((sum,c)=>sum+(c==='i'?2:12),0)*s.fontSize/10;
 const narrow=smartFitCharacterCapacity([caption('iiii iiii')],options,measure),wide=smartFitCharacterCapacity([caption('WWWW WWWW')],options,measure);
 assert.ok(narrow>wide);
 assert.ok(smartFitCharacterCapacity([caption('WWWW WWWW')],{...options,width:100},measure)<wide);
 states[1].fontSize=20;assert.ok(smartFitCharacterCapacity([caption('WWWW WWWW')],options,measure)<wide);
 states[1].bubble=true;states[1].padding=20;assert.ok(smartFitCharacterCapacity([caption('WWWW WWWW')],options,measure)<wide);
 assert.equal(smartFitCharacterCapacity([],options,measure),null);
});
test('displayed line fit capacity tracks native overrides while retaining manual limit and carrier bytes',()=>{
 const {binding,session,entry}=bound(),before=structuredClone(session),measure=(text,s)=>text.length*s.fontSize;
 const first=nativeLineFitCharacterCapacity(binding,session,measure);
 binding.clip.lineFitWidth*=2;assert.ok(nativeLineFitCharacterCapacity(binding,session,measure)>first);
 binding.clip.lineFitFontScale=2;assert.ok(nativeLineFitCharacterCapacity(binding,session,measure)>=first,'fixed padding does not scale with global font size');
 assert.equal(session.style.maxChars,before.style.maxChars);assert.equal(encodeNativeTransportText(prepareNativePanelUpdate(binding,session)),entry.documentText);
 assert.equal(nativeLineFitCharacterCapacity(binding,session,null),null);
 const width=binding.clip.lineFitWidth;binding.clip.lineFitWidth=undefined;assert.equal(nativeLineFitCharacterCapacity(binding,session,measure),null);
 binding.clip.lineFitWidth=width;binding.clip.lineFitFontScale=undefined;assert.equal(nativeLineFitCharacterCapacity(binding,session,measure),null);
});


test('line fit counts inline bubble padding while block padding leaves width capacity unchanged',()=>{
 const states=appearances();for(const state of states){state.bubble=true;state.bubblePaddingInline=4;state.bubblePaddingBlock=4;state.paddingLeft=4;state.paddingRight=4;}
 const input=[caption('AA BB CC DD')],options={width:100,wordSpacing:5,appearances:states},measure=()=>20;
 const before=smartFitCharacterCapacity(input,options,measure);
 for(const state of states)state.bubblePaddingBlock=100;assert.equal(smartFitCharacterCapacity(input,options,measure),before);
 for(const state of states){state.bubblePaddingInline=25;state.paddingLeft=25;state.paddingRight=25;}assert.ok(smartFitCharacterCapacity(input,options,measure)<before);
});


test('background visibility never changes line fit capacity with asymmetric padding and margins',()=>{
 const states=appearances();states.forEach((state,i)=>Object.assign(state,{paddingLeft:9+i*3,paddingRight:27-i*2,marginLeft:4,marginRight:7}));
 const input=[caption('one two three four five six')],options={width:170,wordSpacing:12,appearances:states},measure=text=>text.length*7;
 const capacity=smartFitCharacterCapacity(input,options,measure);
 for(let mask=1;mask<8;mask++){states.forEach((state,i)=>state.bubble=!!(mask&(1<<i)));assert.equal(smartFitCharacterCapacity(input,options,measure),capacity);}
});

test('smaller fonts on all active positions increase fitted characters without inactive or unpositioned fonts', () => {
 const { session, binding } = bound();
 binding.clip.lineFitWidth = 200;
 const measure = (text, state) => text.length * state.fontSize;
 const plain = nativeLineFitCharacterCapacity(binding, session, measure, 2);
 session.style.lineStyles = { '1': { fontSize: 4 }, '2': { fontSize: 6 }, '8': { fontSize: 400 } };
 const small = nativeLineFitCharacterCapacity(binding, session, measure, 2);
 assert.ok(small > plain, `${small} characters with smaller active fonts must exceed ${plain}`);
 assert.equal(nativeLineFitCharacterCapacity(binding, session, measure, 3), plain, 'an unstyled active position inherits the larger state font');
 assert.ok(nativeLineFitCharacterCapacity(binding, session, measure, 8) < plain, 'the large stored position only matters when active');
});

test('fit candidates are active positions crossed with each resolved state, with position fields taking precedence', () => {
 const { session, binding } = bound();
 session.style.upcomingWord.fontSize = 10;
 session.style.activeWord.fontSize = 20;
 session.style.spokenWord.fontSize = 30;
 session.style.activeWord.italic = true;
 session.style.lineStyles = {
  '1': { fontSize: 4, paddingLeft: 0, italic: false },
  '2': { fontFamily: 'Georgia', paddingRight: 3, marginRight: -1 },
 };
 binding.clip.lineFitFontScale = 1.5;
 binding.clip.lineFitStates = {
  upcoming: { sizeScale: 1, paddingScale: 1, bubbleMode: 1 },
  current: { sizeScale: 2, paddingScale: 2, bubbleMode: 2 },
  spoken: { sizeScale: 3, paddingScale: .5, bubbleMode: 1 },
 };
 const before = structuredClone(session), seen = [];
 nativeLineFitCharacterCapacity(binding, session, (_text, s) => {
  seen.push([s.fontSize, s.paddingLeft, s.paddingRight, s.italic, s.fontFamily, s.marginRight]);
  return s.fontSize;
 }, 2);
 const family = resolveAppearance(session.style, 'upcomingWord').fontFamily;
 const expected = [
  [6, 0, 8, false, family, 0], [6, 0, 16, false, family, 0], [6, 0, 4, false, family, 0],
  [15, 8, 3, false, 'Georgia', -1], [60, 16, 3, true, 'Georgia', -1], [135, 4, 3, false, 'Georgia', -1],
 ];
 assert.deepEqual(seen.slice(0, 6), expected);
 assert.equal(seen.length, session.captions[0].words.length * 6, 'exactly three state candidates per active position');
 assert.deepEqual(session, before, 'measuring resolved positions never changes saved styles');
});

test('transient control reads preserve the active fit count; unknown counts never measure hidden positions', () => {
 const { session, binding } = bound();
 session.style.lineStyles = { '1': { fontSize: 4 }, '2': { fontSize: 4 }, '8': { fontSize: 400 } };
 const measure = (text, s) => text.length * s.fontSize;
 const confirmed = confirmLineControls({ clipKey: null, count: null }, 'clip', { rollUp: { value: 1 }, rollUpLines: { value: 2 } });
 const capacity = nativeLineFitCharacterCapacity(binding, session, measure, confirmed.count);
 const refreshed = confirmLineControls(confirmed, 'clip', null);
 assert.equal(refreshed.count, 2);
 assert.equal(nativeLineFitCharacterCapacity(binding, session, measure, refreshed.count), capacity);
 const changed = confirmLineControls(refreshed, 'other-clip', null);
 for (const count of [changed.count, 0]) {
  assert.equal(nativeLineFitCharacterCapacity(binding, session, () => assert.fail('unconfirmed slots must not be measured'), count), null);
 }
});
