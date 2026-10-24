import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {resolveAppearance} from '../webview-ui/src/lib/appearance.ts';
import {DEFAULT_STYLE,DEFAULT_ANIMATION} from '../webview-ui/src/lib/types.ts';
import {applyNativeFitState,smartFitCharacterCapacity} from '../webview-ui/src/lib/native-effect/smart-fit.ts';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript');
function load(file,replacements={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>replacements[name]});return exports;}
const {CaptionRenderer}=load('../webview-ui/src/lib/canvas/engine.ts',{'../appearance.ts':load('../webview-ui/src/lib/appearance.ts',{'./font-catalog.ts':load('../webview-ui/src/lib/font-catalog.ts')}),'../typography.ts':load('../webview-ui/src/lib/typography.ts')});
const stateKeys=['upcomingWord','activeWord','spokenWord'];
const cue={id:'three-states',text:'Past Current Next',startTime:0,endTime:3,words:['Past','Current','Next'].map((text,i)=>({text,startTime:i,endTime:i+1,isActive:false}))};
const paddingFixtures=[{}, {padding:19}, {padding:7,bubblePaddingInline:29,bubblePaddingBlock:11}, {paddingTop:31,paddingRight:5,paddingBottom:13,paddingLeft:43}];
function styleFor(padding){const style=structuredClone(DEFAULT_STYLE);Object.assign(style,{fontSize:20,backgroundEnabled:false,shadowEnabled:false,strokeEnabled:false});stateKeys.forEach((key,index)=>style[key]={...style[key],fontSize:20+index*3,sizeScale:1,bubble:false,shadowEnabled:false,strokeEnabled:false,marginLeft:index?7:-3,marginRight:index?2:9,marginTop:2,marginBottom:5,...padding});return style;}
function paint(style){
 const text=[],moves=[],ctx={font:'',clearRect(){},save(){},restore(){},translate(x,y){moves.push([x,y]);},scale(){},measureText(value){const size=Number(this.font.match(/ ([0-9.]+)px/)?.[1]||20);return{width:value.length*size/2,actualBoundingBoxAscent:size*.6,actualBoundingBoxDescent:size*.3};},fillText(value,x,y){text.push([value,x,y,this.font]);},strokeText(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){}};
 const renderer=new CaptionRenderer(ctx,720,1280);const layout=renderer.renderFrame(cue,1.5,style,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width:210,height:500});return{text,moves,layout};
}
test('all-state background paint toggles retain canvas text geometry with every saved padding fallback and spacing mode',()=>{
 for(const padding of paddingFixtures)for(const wordSpacing of [undefined,0,100,250]){
  const style=styleFor(padding);style.wordSpacing=wordSpacing;const baseline=paint(style),before=structuredClone(style);
  for(let mask=1;mask<8;mask++){
   const painted=structuredClone(style);stateKeys.forEach((key,index)=>Object.assign(painted[key],{bubble:!!(mask&(1<<index)),bubbleOpacity:index?1:0,bubbleFillSpaces:true}));
   assert.deepEqual(paint(painted),baseline,`paint-only mask ${mask}, spacing ${wordSpacing}, padding ${JSON.stringify(padding)}`);
  }
  assert.deepEqual(style,before,'rendering cannot rewrite authored padding or margins');
 }
});
test('native forced background modes preserve line fit capacity while native padding scales remain effective',()=>{
 for(const padding of paddingFixtures){
  const style=styleFor(padding),appearances=stateKeys.map(key=>resolveAppearance(style,key));
  const options={width:220,wordSpacing:10,appearances},measure=(text,state)=>text.length*state.fontSize/2;
  const derive=bubbleMode=>appearances.map(a=>applyNativeFitState(a,1.5,{sizeScale:1.2,paddingScale:1.7,bubbleMode}));
  const off={...options,appearances:derive(3)},on={...options,appearances:derive(2)};
  assert.equal(smartFitCharacterCapacity([cue],on,measure),smartFitCharacterCapacity([cue],off,measure));
  for(let i=0;i<appearances.length;i++){
   assert.equal(off.appearances[i].paddingLeft,appearances[i].paddingLeft*1.7);assert.equal(off.appearances[i].paddingRight,appearances[i].paddingRight*1.7);
   assert.equal(off.appearances[i].marginLeft,appearances[i].marginLeft);assert.equal(on.appearances[i].marginRight,appearances[i].marginRight);
  }
  const noPadding={...options,appearances:appearances.map(a=>applyNativeFitState(a,1.5,{sizeScale:1.2,paddingScale:0,bubbleMode:3}))};
  assert.ok(smartFitCharacterCapacity([cue],noPadding,measure)>smartFitCharacterCapacity([cue],off,measure),'padding affects available capacity even while background is forced off');
 }
});
