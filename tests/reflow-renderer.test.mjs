import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript');
function load(file,replacements={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>replacements[name]});return exports;}
const {CaptionRenderer}=load('../webview-ui/src/lib/canvas/engine.ts',{'../appearance.ts':load('../webview-ui/src/lib/appearance.ts',{'./font-catalog.ts':load('../webview-ui/src/lib/font-catalog.ts')}),'../typography.ts':load('../webview-ui/src/lib/typography.ts')});
const {DEFAULT_STYLE,DEFAULT_ANIMATION}=load('../webview-ui/src/lib/types.ts');
function context(){const texts=[],scales=[];return {texts,scales,font:'',clearRect(){},save(){},restore(){},translate(){},scale(x,y){scales.push([x,y]);},measureText(text){const size=Number(this.font.match(/ ([0-9.]+)px/)?.[1]||64);return {width:Array.from(text).length*size*.5,actualBoundingBoxAscent:size*.6,actualBoundingBoxDescent:size*.3};},fillText(text,x,y){texts.push({text,x,y,font:this.font});},strokeText(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){}};}
const caption={id:'long',startTime:0,endTime:3,words:[{text:'extraordinary',startTime:0,endTime:3,isActive:false}],text:'extraordinary'};

test('a narrow text area wraps a long word at graphemes without shrinking its font',()=>{
 const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),style={...DEFAULT_STYLE,strokeEnabled:false,backgroundEnabled:false};
 const layout=renderer.renderFrame(caption,1,style,{...DEFAULT_ANIMATION,fadeInDuration:0,fadeOutDuration:0},{width:160,height:512});
 assert.equal(ctx.texts.map(t=>t.text).join(''),'extraordinary');assert.ok(new Set(ctx.texts.map(t=>t.y)).size>1);
 assert.ok(ctx.texts.every(t=>t.font.includes('73.6px')),'the active font retains 64px times its1.15 word size');
 assert.ok(ctx.scales.every(([x,y])=>x===1&&y===1),'text-area rendering disables all legacy auto-fit scaling');
 assert.ok(layout.height>0);
});
test('text that exceeds the paragraph height keeps its font and reports its full layout height',()=>{
 const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),words='one two three four five six seven eight'.split(' ').map((text,i)=>({text,startTime:i*.2,endTime:(i+1)*.2,isActive:false}));
 const layout=renderer.renderFrame({...caption,words},1,DEFAULT_STYLE,DEFAULT_ANIMATION,{width:180,height:40});
 assert.ok(layout.height>40);assert.ok(ctx.scales.every(([x,y])=>x===1&&y===1));
});


test('bubble space filling reaches the next visible word without shifting text or filling trailing or wrapped gaps',()=>{
 const words=[{text:'AA',startTime:0,endTime:1,isActive:false},{text:'BB',startTime:1,endTime:2,isActive:false}];
 const cue={id:'spaces',text:'AA BB',startTime:0,endTime:2,words};
 const style=structuredClone(DEFAULT_STYLE);Object.assign(style,{fontSize:20,strokeEnabled:false,shadowEnabled:false,backgroundEnabled:false,wordSpacing:200});
 for(const key of ['activeWord','spokenWord','upcomingWord'])style[key]={...style[key],fontSize:key==='upcomingWord'?30:20,bubble:true,padding:0,radius:0,bubbleOpacity:.4,opacity:.6,sizeScale:1,strokeEnabled:false,shadowEnabled:false};
 const paint=(config,width=400)=>{const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),rects=[];renderer.roundRect=(...rect)=>rects.push(rect);const layout=renderer.renderFrame(cue,.5,config,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width,height:300});return{ctx,rects,layout};};
 const baseline=paint(style);style.activeWord.bubbleFillSpaces=true;const filled=paint(style);
 assert.deepEqual(filled.ctx.texts,baseline.ctx.texts,'glyph positions and state fonts remain unchanged');assert.deepEqual(filled.layout,baseline.layout,'line fitting must not use background fill extensions');
 assert.equal(filled.rects[0][0]+filled.rects[0][2],filled.rects[1][0],'filled background reaches the next bubble start');assert.ok(filled.rects[0][2]>baseline.rects[0][2]);assert.deepEqual(filled.rects[1],baseline.rects[1],'line trailing background remains unchanged');
 const wrapped=paint(style,40),without=structuredClone(style);without.activeWord.bubbleFillSpaces=false;assert.deepEqual(wrapped.rects,paint(without,40).rects,'space fill cannot bridge a wrapped line');
});
