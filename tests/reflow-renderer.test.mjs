import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript');
function load(file,replacements={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>replacements[name]});return exports;}
const {CaptionRenderer}=load('../webview-ui/src/lib/canvas/engine.ts',{'../appearance.ts':load('../webview-ui/src/lib/appearance.ts')});
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
