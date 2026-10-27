import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNativeCreation, nativeOutputKind } from '../webview-ui/src/lib/native-effect/create.ts';
import { validTransparentCarrier } from '../webview-ui/src/lib/native-effect/carrier.ts';
import { decodeNativePanelDocument, rehydrateNativePanel, prepareNativePanelUpdate } from '../webview-ui/src/lib/native-effect/panel.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
import { NATIVE_EFFECT_MATCH_NAME } from '../webview-ui/src/lib/native-effect/contract.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';

const sequenceId = '12345678-1234-5678-abcd-123456789abc';
function session() {return {sequenceId,projectPath:'/project/test.prproj',sequenceName:'Native',frameWidth:720,frameHeight:1280,frameRate:24,duration:10,currentTime:0,style:structuredClone(DEFAULT_STYLE),animation:structuredClone(DEFAULT_ANIMATION),hasTranscript:true,isLoading:false,transcriptJson:null,
  captions:[{id:'one',text:'Hello world.',startTime:2,endTime:4,words:[{text:'Hello',startTime:2,endTime:3,isActive:false},{text:'world.',startTime:3,endTime:4,endOfSentence:true,isActive:false}]}]};}
const marker = () => JSON.stringify({version:1,owner:'com.swen.bettercaptions',kind:'transparent-video',projectItemId:'source',creationId:'12345678-1234-5678-abcd-123456789abc',width:720,height:1280});
function entry(documentText) {
 const ticks=String(4*254016000000),locator={projectPath:'/project/test.prproj',sequenceId,clipNodeId:'clip',trackIndex:2,clipIndex:0,componentIndex:2,documentParamIndex:6};
 const result={kind:'native-effect',clipNodeId:'clip',projectItemId:'source',trackIndex:2,clipIndex:0,startTicks:'0',endTicks:ticks,inTicks:'0',outTicks:ticks,selected:true,locator,matchName:'AE.'+NATIVE_EFFECT_MATCH_NAME,documentText};
 result.revision=JSON.stringify({projectPath:locator.projectPath,sequenceId,clipNodeId:'clip',adjustmentLayer:false,start:'0',end:ticks,inPoint:'0',outPoint:ticks,components:['AE.ADBE Opacity','AE.ADBE Motion',result.matchName],documentIndex:6,documentText,carrierKind:'transparent-video',carrierItemId:'source',carrierRevision:marker()});return result;
}
test('new transcript becomes one zero-origin native creation with measured spacing and three independent appearances',()=>{
 const input=session(),baseline=structuredClone(input);input.style.wordSpacing=125;const plan=prepareNativeCreation(input,16);
 assert.equal(plan.startFrame,0);assert.equal(plan.endFrame,96);assert.equal(plan.sourceInTicks,'0');assert.equal(plan.document.timeOriginSeconds,0);assert.equal(plan.document.style.wordSpacing,20);
 assert.equal(plan.document.style.current.bubble,true);assert.equal(plan.document.style.spoken.color.r,170/255);assert.equal(plan.document.style.current.fontSize,73.6);assert.equal(plan.document.style.current.sizeScale,1);
 assert.deepEqual(decodeNativePanelDocument(plan.documentText,sequenceId),plan.document);assert.equal(plan.geometry.width,576);assert.equal(plan.geometry.maxChars,56);
 assert.equal(plan.document.style.lineWrap,'pretty');
 assert.deepEqual({...input,style:baseline.style},baseline);assert.equal('mediaPath' in plan,false);
});
test('creation refuses unrepresentable formatting instead of silently changing existing movies',()=>{
 for(const change of [s=>s.style.backgroundEnabled=true,s=>s.style.textAlign='left',s=>s.style.activeWord.letterSpacing=1,s=>s.animation.preset='pop',s=>s.nativeClipId='already']) {
  const input=session();change(input);const before=structuredClone(input);assert.throws(()=>prepareNativeCreation(input,16));assert.deepEqual(input,before);
 }
});
test('owned transparent carrier rehydrates and edits without fabricated movie links or reset keyframes',()=>{
 const input=session(),plan=prepareNativeCreation(input,16),connection=entry(plan.documentText),info={id:sequenceId,name:'Native',duration:10,frameWidth:720,frameHeight:1280,frameRate:24};
 const recovered=rehydrateNativePanel(connection,info);assert.equal(recovered.session.captions[0].words[0].startTime,2);assert.equal(recovered.session.captions[0].clipNodeId,undefined);
 const edited=structuredClone(recovered.session);edited.captions[0].words[0].text='Hi';edited.captions[0].text='Hi world.';
 assert.equal(prepareNativePanelUpdate(recovered.binding,edited).captions[0].words[0].text,'Hi');
 const revision=JSON.parse(connection.revision);assert.equal(validTransparentCarrier(revision,'source'),true);
 for(const patch of [{carrierRevision:undefined},{carrierItemId:'other'},{adjustmentLayer:true},{carrierKind:'footage'},{carrierRevision:marker().replace('transparent-video','video')}])assert.equal(validTransparentCarrier({...revision,...patch},'source'),false);
 assert.throws(()=>rehydrateNativePanel({...connection,projectItemId:'other'},info));
});
test('opening existing movie captions does not automatically migrate or recreate them',()=>{
 const input=session();assert.equal(nativeOutputKind(input),'new-native');input.captions[0].clipNodeId='movie';assert.equal(nativeOutputKind(input),'generated-movie');input.nativeClipId='native';assert.equal(nativeOutputKind(input),'native-effect');
});

test('native creation keeps upper/lower display modes separate from source words',()=>{
 for(const mode of ['uppercase','lowercase']){
  const input=session();input.style.textTransform=mode;const before=structuredClone(input);
  const plan=prepareNativeCreation(input,16),decoded=decodeNativePanelDocument(plan.documentText,sequenceId);
  assert.equal(decoded.style.letterCase,mode);assert.equal(decoded.binaryVersion,11);assert.equal(decoded.captions[0].words[0].text,'Hello');assert.deepEqual(input,before);
 }
});

test('native creation carries every wrap mode with and without position overrides', () => {
 for (const mode of ['fill', 'balance', 'pretty']) for (const positions of [undefined, { '1': { marginTop: 12 }, '4': { color: '#ff0000', fontWeightOffset: 100 } }]) {
  const input = session(); input.style.lineWrap = mode;
  if (positions) input.style.lineStyles = structuredClone(positions);
  const before = structuredClone(input), plan = prepareNativeCreation(input, 16);
  const decoded = decodeNativePanelDocument(plan.documentText, sequenceId);
  assert.equal(Buffer.from(plan.documentText.slice(7), 'hex').readUInt32LE(4), positions ? 12 : 11);
  assert.equal(plan.document.binaryVersion, positions ? 12 : 11);
  assert.equal(decoded.style.lineWrap ?? 'fill', mode);
  const restored=rehydrateNativePanel(entry(plan.documentText),{id:sequenceId,name:'Native',duration:10,frameWidth:720,frameHeight:1280,frameRate:24});
  assert.equal(restored.session.style.lineWrap,mode,'stored choices override the new-session Pretty default');
  assert.deepEqual(decoded.style.lineStyles, positions ? { '1': { marginTop: 12 }, '4': { color: { r: 1, g: 0, b: 0 }, fontWeight: 0, fontWeightOffset: 100 } } : undefined);
  assert.deepEqual(input, before);
 }
});


test('native creation retains explicit independent bubble padding and underline in the v9 document',()=>{
 const legacy=prepareNativeCreation(session(),16);assert.equal(decodeNativePanelDocument(legacy.documentText,sequenceId).binaryVersion,11);
 const input=session();Object.assign(input.style.activeWord,{bubblePaddingInline:22,bubblePaddingBlock:3,underline:true});input.style.spokenWord.underline=false;
 const plan=prepareNativeCreation(input,16),decoded=decodeNativePanelDocument(plan.documentText,sequenceId);assert.equal(decoded.binaryVersion,11);assert.equal(decoded.style.current.bubblePaddingInline,22);assert.equal(decoded.style.current.bubblePaddingBlock,3);assert.equal(decoded.style.current.padding,input.style.activeWord.padding);assert.equal(decoded.style.current.underline,true);assert.equal(decoded.style.spoken.underline,false);assert.equal(decoded.style.upcoming.bubblePaddingInline,undefined);assert.equal(decoded.style.upcoming.underline,undefined);
});

test('native creation writes explicit row boundaries without changing words or their storage', () => {
  const input = session();
  input.captions[0].words[0].lineBreakBefore = 'break';
  input.captions[0].words[1].lineBreakBefore = 'join';
  input.captions[0].words[0].pauseLinesRemoved = 3;
  input.captions[0].words[1].pauseLinesRemoved = 8;
  const before = structuredClone(input), plan = prepareNativeCreation(input, 16);
  assert.equal(plan.document.binaryVersion, 11);
  assert.deepEqual(decodeNativePanelDocument(plan.documentText, sequenceId).captions[0].words.map(word => word.lineBreakBefore), ['break', 'join']);
  assert.deepEqual(decodeNativePanelDocument(plan.documentText, sequenceId).captions[0].words.map(word => word.pauseLinesRemoved), [3, 8]);
  assert.deepEqual(input, before);
});

test('native creation seeds deliberate session splits once while preserving explicit joins and continuous automatic containers', () => {
  const input = session();
  input.captions = ['One', 'Two', 'Three', 'Four', 'Five'].map((text, index) => {
    const startTime = 1 + index * .2, endTime = startTime + .1;
    return { id: `caption-${index}`, text, startTime, endTime, manualSplit: index !== 2,
      words: [{ text, startTime, endTime, isActive: false, ...(index === 3 ? { lineBreakBefore: 'join' } : index === 4 ? { lineBreakBefore: 'break' } : {}) }] };
  });
  const before = structuredClone(input), plan = prepareNativeCreation(input, 16);
  const decoded = decodeNativePanelDocument(plan.documentText, sequenceId);
  assert.deepEqual(decoded.captions.map(caption => caption.manualSplit), [true, true, false, true, true]);
  assert.deepEqual(decoded.captions.map(caption => caption.words[0].lineBreakBefore), [undefined, 'break', undefined, 'join', 'break']);
  assert.deepEqual(decoded.captions.map(caption => [caption.id, caption.words[0].text, caption.words[0].start, caption.words[0].end]),
    input.captions.map(caption => [caption.id, caption.text, caption.startTime, caption.endTime]));
  const captions = decoded.captions.map(caption => ({ id: caption.id, manualSplit: caption.manualSplit,
    words: caption.words.map(word => ({ text: word.text, startTime: word.start, endTime: word.end, endOfSentence: word.endOfSentence, lineBreakBefore: word.lineBreakBefore })) }));
  const rows = nativeCaptionPhrases(captions, 56).flatMap(caption => caption.renderSegments);
  assert.deepEqual([...new Map(rows.map(row => [row.id, row.text])).values()], ['One', 'Two Three Four', 'Five']);
  assert.deepEqual(input, before);
});
