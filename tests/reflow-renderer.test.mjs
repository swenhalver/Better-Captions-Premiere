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
 const paint=(config,width=400)=>{const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),rects=[];renderer.bubbleRect=(...rect)=>rects.push(rect);const layout=renderer.renderFrame(cue,.5,config,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width,height:300});return{ctx,rects,layout};};
 const baseline=paint(style);style.activeWord.bubbleFillSpaces=true;const filled=paint(style);
 assert.deepEqual(filled.ctx.texts,baseline.ctx.texts,'glyph positions and state fonts remain unchanged');assert.deepEqual(filled.layout,baseline.layout,'line fitting must not use background fill extensions');
 assert.equal(filled.rects[0][0]+filled.rects[0][2],filled.rects[1][0],'filled background reaches the next bubble start');assert.ok(filled.rects[0][2]>baseline.rects[0][2]);assert.deepEqual(filled.rects[1].slice(0,5),baseline.rects[1].slice(0,5),'line trailing background geometry remains unchanged');
 assert.deepEqual(filled.rects.map(rect=>rect.slice(5)),[[false,true],[true,false]],'only interior touching corners are square');
 const wrapped=paint(style,40),without=structuredClone(style);without.activeWord.bubbleFillSpaces=false;assert.deepEqual(wrapped.rects,paint(without,40).rects,'space fill cannot bridge a wrapped line');
});


test('canvas bubble joins reset at each physical line and keep independent state colors/opacity',()=>{
 const words=['AA','BB','CC'].map((text,i)=>({text,startTime:i,endTime:i+1,isActive:false}));const cue={id:'joined',text:'AA BB CC',startTime:0,endTime:3,words};
 const style=structuredClone(DEFAULT_STYLE);Object.assign(style,{fontSize:20,strokeEnabled:false,shadowEnabled:false,backgroundEnabled:false,wordSpacing:100});
 for(const key of ['activeWord','spokenWord','upcomingWord'])style[key]={...style[key],fontSize:20,sizeScale:1,bubble:true,bubbleFillSpaces:true,padding:2,radius:10,bubbleOpacity:.4,opacity:.6,strokeEnabled:false,shadowEnabled:false};
 Object.assign(style.spokenWord,{bubbleColor:'#ff0000',bubbleOpacity:.25,opacity:.5});Object.assign(style.activeWord,{bubbleColor:'#0000ff',bubbleOpacity:.8,opacity:.75});
 const paint=width=>{const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),rects=[];renderer.bubbleRect=(...rect)=>rects.push({rect,fill:ctx.fillStyle,opacity:ctx.globalAlpha});renderer.renderFrame(cue,1.5,style,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width,height:300});return rects;};
 const wide=paint(300);assert.deepEqual(wide.map(({rect})=>rect.slice(5)),[[false,true],[true,true],[true,false]]);assert.equal(wide[0].fill,'rgba(255,0,0,0.25)');assert.equal(wide[0].opacity,.5);assert.equal(wide[1].fill,'rgba(0,0,255,0.8)');assert.equal(wide[1].opacity,.75);
 const wrapped=paint(60);assert.deepEqual(wrapped.map(({rect})=>rect.slice(5)),[[false,true],[true,false],[false,false]],'each wrapped line keeps its own rounded first/last end');
 style.activeWord.bubbleOpacity=0;const transparent=paint(300);assert.deepEqual(transparent.map(({rect})=>rect.slice(5)),[[false,false],[false,false],[false,false]],'invisible bubble cannot erase an outer rounded endpoint');
});


test('canvas independent bubble padding uses legacy fallback and changes only requested dimensions',()=>{
 const cue={id:'axes',text:'AA',startTime:0,endTime:2,words:[{text:'AA',startTime:0,endTime:2,isActive:false}]};const style=structuredClone(DEFAULT_STYLE);Object.assign(style,{fontSize:20,backgroundEnabled:false,shadowEnabled:false,strokeEnabled:false,wordSpacing:100});Object.assign(style.activeWord,{fontSize:20,sizeScale:1,padding:8,bubble:true,bubbleFillSpaces:false,shadowEnabled:false,strokeEnabled:false});
 const paint=()=>{const ctx=context(),renderer=new CaptionRenderer(ctx,720,1280),rects=[];renderer.bubbleRect=(...rect)=>rects.push(rect);renderer.renderFrame(cue,.5,style,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width:400,height:250});return rects[0];};
 const legacy=paint();style.activeWord.bubblePaddingInline=20;style.activeWord.bubblePaddingBlock=3;const axes=paint();assert.equal(axes[2],legacy[2]+24);assert.equal(axes[3],legacy[3]-10);
 style.activeWord.bubblePaddingBlock=30;const taller=paint();assert.equal(taller[2],axes[2]);assert.equal(taller[3],axes[3]+54);
 delete style.activeWord.bubblePaddingInline;assert.equal(paint()[2],legacy[2]);
});


test('canvas draws selected underline with word color/opacity without moving glyphs',()=>{
 const cue={id:'underline',text:'Hello',startTime:0,endTime:2,words:[{text:'Hello',startTime:0,endTime:2,isActive:false}]};const style=structuredClone(DEFAULT_STYLE);Object.assign(style.activeWord,{fontSize:30,sizeScale:1,bubble:false,color:'#336699',opacity:.4});const paint=()=>{const ctx=context(),rects=[];ctx.fillRect=(...rect)=>rects.push({rect,color:ctx.fillStyle,alpha:ctx.globalAlpha});new CaptionRenderer(ctx,720,1280).renderFrame(cue,.5,style,{...DEFAULT_ANIMATION,preset:'karaoke',fadeInDuration:0,fadeOutDuration:0},{width:400,height:200});return{ctx,rects};};
 const before=paint();assert.equal(before.rects.length,0);style.activeWord.underline=true;const underlined=paint();assert.deepEqual(underlined.ctx.texts,before.ctx.texts);assert.equal(underlined.rects.length,1);assert.equal(underlined.rects[0].color,'#336699');assert.equal(underlined.rects[0].alpha,.4);assert.equal(underlined.rects[0].rect[0],underlined.ctx.texts[0].x);assert.equal(underlined.rects[0].rect[2],75);
 style.activeWord.underline=false;assert.equal(paint().rects.length,0);
});
