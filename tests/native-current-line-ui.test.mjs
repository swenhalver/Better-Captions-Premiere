import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const require=createRequire(new URL('../webview-ui/package.json',import.meta.url));
const {compile}=require('svelte/compiler');
const folder=mkdtempSync(join(tmpdir(),'better-captions-current-line-'));
after(()=>rmSync(folder,{recursive:true,force:true}));
symlinkSync(fileURLToPath(new URL('../webview-ui/node_modules',import.meta.url)),join(folder,'node_modules'),'dir');
for(const name of ['LucideIcon','ScrubbableNumber','NativeEffectControls','NativePauseLineControl']){
 const url=new URL(`../webview-ui/src/components/${name}.svelte`,import.meta.url);
 let source=readFileSync(url,'utf8');
 // SSR has no mounted controller. Seed its initial readback from the fixture
 // while compiling the real markup and real child controls unchanged.
 if(name==='NativeEffectControls'||name==='NativePauseLineControl'){
  const initial='controls=$state.raw<NativeCaptionControls|null>(null)';
  assert.ok(source.includes(initial));
  source=source.replace("import { onMount }","import { onMount, untrack }").replace(initial,'controls=$state.raw<NativeCaptionControls|null>(untrack(()=>JSON.parse(snapshot.revision)))');
 }
 const compiled=compile(source,{generate:'server',filename:`${name}.svelte`});
 assert.deepEqual(compiled.warnings,[]);
 const code=compiled.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,quote,specifier)=>{
  const target=specifier.endsWith('.svelte')?pathToFileURL(join(folder,specifier.replace('./','').replace('.svelte','.mjs'))).href:new URL(/\.[a-z]+$/i.test(specifier)?specifier:`${specifier}.ts`,url).href;
  return `from ${quote}${target}${quote}`;
 });
 writeFileSync(join(folder,`${name}.mjs`),code);
}
const {default:NativeEffectControls}=await import(pathToFileURL(join(folder,'NativeEffectControls.mjs')));
const {default:NativePauseLineControl}=await import(pathToFileURL(join(folder,'NativePauseLineControl.mjs')));
const {render}=await import(pathToFileURL(require.resolve('svelte/server')));
const descriptor=(value,animated=false)=>({value,defaultValue:1,animated,keyframesSupported:true,hasKey:true,keys:[{ticks:'0',value},{ticks:'508032000000',value}]});
const controls=()=>({ok:true,clipNodeId:'clip',revision:'controls',timelineTicks:'254016000000',sourceTicks:'254016000000',startTicks:'0',endTicks:'2540160000000',inTicks:'0',outTicks:'2540160000000',clock:'clip-source',insideClip:true,position:descriptor([.5,.9]),width:descriptor(600),height:descriptor(300),rollUpLines:descriptor(3),rollUpCurrentLine:descriptor(2)});
const view=receipt=>render(NativeEffectControls,{props:{snapshot:{locator:{clipNodeId:'clip'},revision:JSON.stringify(receipt)},sequenceId:'seq',frameWidth:1920,frameHeight:1080,currentTime:1,visible:true,read:async()=>receipt,edit:async()=>receipt,seek:async()=>receipt}}).body;
const pauseView=(receipt,extra={})=>render(NativePauseLineControl,{props:{snapshot:{locator:{clipNodeId:'clip'},revision:JSON.stringify(receipt)},sequenceId:'seq',currentTime:1,visible:true,read:async()=>receipt,edit:async()=>receipt,seek:async()=>receipt,...extra}}).body;
const input=html=>html.match(/<button\b[^>]*aria-label="Caption Current line"[^>]*>/)?.[0];

test('Current line renders after Visible lines, with integer bounds, reset and its explanation',()=>{
 const html=view(controls()),field=input(html);
 assert.ok(html.indexOf('Visible lines')<html.indexOf('Current line'));
 assert.ok(field);assert.match(field,/aria-valuemin="1"/);assert.match(field,/aria-valuemax="3"/);assert.match(field,/role="spinbutton"/);assert.match(field,/aria-valuenow="2"/);
 assert.match(html,/Which visible line holds the line being spoken, counted from the top/);
 assert.match(html,/higher numbers show upcoming lines ahead of it/);
 assert.match(html,/aria-label="Reset caption Current line"/);
 assert.doesNotMatch(html,/aria-label="Previous Current line keyframe"/);
});

test('Current line follows available Visible lines and is omitted for a binary without the descriptor',()=>{
 const receipt=controls();receipt.rollUpLines.value=5;assert.match(input(view(receipt)),/aria-valuemax="5"/);
 delete receipt.rollUpLines;assert.match(input(view(receipt)),/aria-valuemax="8"/);
 delete receipt.rollUpCurrentLine;assert.doesNotMatch(view(receipt),/Caption Current line|Reset caption Current line/);
});

test('animated Current line exposes previous and next keyframe navigation',()=>{
 const receipt=controls();receipt.rollUpCurrentLine.animated=true;const html=view(receipt);
 for(const label of ['Current line keyframing enabled in Effect Controls','Previous Current line keyframe','Next Current line keyframe','Reset caption Current line'])assert.ok(html.includes(`aria-label="${label}"`));
});


test('Pause Line Length shows Auto, tenths, full hover help on label and field, and key navigation',()=>{
 const receipt=controls();receipt.rollUpBlankLineSeconds=descriptor(0);
 let html=pauseView(receipt);assert.match(html,/Pause Line Length/);assert.match(html,/aria-valuemin="0"/);assert.match(html,/aria-valuemax="30"/);assert.match(html,/>Auto<|>Auto<!--/);
 const help="Seconds of silence that make one blank (pause) line in scrolling captions. A pause gets one blank line for every full length of silence, up to Visible lines; a shorter pause adds none. Example: at 2 s, a 1 s pause adds nothing and a 4.5 s pause adds 2 blank lines. 0 = Auto (uses the clip's average line length).";
 assert.equal(html.split(`title="${help}"`).length-1,3,'row, label and numeric field carry the entire native hover help');
 assert.ok(html.includes(`role="tooltip">${help}</span>`),'the embedded panel renders the full wrapped hover bubble as well as native title help');
 receipt.rollUpBlankLineSeconds.value=2.5;receipt.rollUpBlankLineSeconds.animated=true;html=pauseView(receipt);assert.match(html,/>2.5<|>2.5<!--/);
 for(const label of ['Previous Pause Line Length keyframe','Next Pause Line Length keyframe','Reset Pause Line Length'])assert.ok(html.includes(`aria-label="${label}"`));
 delete receipt.rollUpBlankLineSeconds;assert.doesNotMatch(pauseView(receipt),/Pause Line Length/);
});


test('Pause Line Length is absent from Styling and disables edits outside the native clip',()=>{
 const receipt=controls();receipt.rollUpBlankLineSeconds=descriptor(3);
 assert.doesNotMatch(view(receipt),/Pause Line Length|Blank line length/);
 receipt.insideClip=false;const html=pauseView(receipt);
 assert.match(html,/<button[^>]*aria-label="Pause Line Length"[^>]*disabled/);
 assert.match(html,/Move the playhead inside this caption clip to edit/);
 const main=readFileSync(new URL('../webview-ui/src/main-webview.svelte',import.meta.url),'utf8');
 const transcript=readFileSync(new URL('../webview-ui/src/components/TranscriptPreview.svelte',import.meta.url),'utf8');
 assert.match(main,/snippet nativeGrouping\(\).*session.nativeClipId && nativeBinding.*<NativePauseLineControl/);
 assert.match(main,/visible=\{activeTab==='transcript'&&hostPanelVisible&&documentVisible\}/);
 assert.match(main,/<TranscriptPreview \{pauseSettings\} \{nativeGrouping\}/);
 assert.ok(transcript.indexOf('{@render nativeGrouping?.()}')>transcript.indexOf('aria-label="Caption grouping"'));
 assert.ok(transcript.indexOf('{@render nativeGrouping?.()}')<transcript.indexOf('class="transcript-editor__workspace"'));
});
