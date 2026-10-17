import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const root = path.resolve(import.meta.dirname, '..');
function loadTypeScript(file, replacements = {}, context = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}, sandbox = { exports, console, setTimeout, ...context, require: name => replacements[name] ?? loadTypeScript(path.resolve(path.dirname(file), name + '.ts'), replacements, context) };
  vm.runInNewContext(code, sandbox, { filename: file }); return exports;
}
const planner = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class {} } });
function cue(id, start, end) { return { id, text: id, startTime: start, endTime: end, words: [{ text: id, startTime: start, endTime: end, isActive: false }], position: { x: .23, y: .72 } }; }
for (const fps of [24, 30000 / 1001, 31]) test(`frame alignment covers phrases without overlaps at ${fps} fps`, () => {
  const plan = planner.planCaptionFrames([cue('a', .017, .801), cue('b', .801, 1.999)], fps, 3);
  assert.equal(plan[0].startFrame, 0); assert.equal(plan[0].endFrame, plan[1].startFrame);
  assert.ok(plan.every(c => c.frames > 0 && c.caption.words[0].endTime <= c.caption.endTime));
  assert.equal(plan[0].caption.position.x, .23); assert.equal(plan[0].caption.position.y, .72);
  assert.equal(plan[1].endFrame, Math.ceil(1.999 * fps));
});
test('full frame dimensions preserve caption location and reject sub-frame phrases', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(planner.calculateExportDimensions({}, 1920, 1080))), { width: 1920, height: 1080 });
  assert.throws(() => planner.planCaptionFrames([cue('a', .001, .002), cue('b', .003, 1)], 24, 2), /one sequence frame/);
});
test('a saved native final phrase trims its generated reading tail while retaining spoken timing', () => {
  const duration = 110 / 24;
  const first = cue('first-native-phrase', .1, 1.8);
  const last = { ...cue('last-native-phrase', 2.2, 4.68), words: [
    { text: 'Native', startTime: 2.2, endTime: 3.1, isActive: false },
    { text: 'caption.', startTime: 3.2, endTime: 4.56, isActive: false },
  ], text: 'Native caption.' };
  const plan = planner.planCaptionFrames([first, last], 24, duration);
  assert.equal(plan[1].endFrame, 110); assert.equal(plan[1].caption.endTime, duration);
  assert.equal(plan[1].caption.words[1].endTime, 4.56); assert.equal(plan[1].caption.words[0].startTime, 2.2);
  assert.equal(last.endTime, 4.68, 'planning leaves the saved input untouched until successful apply persists its aligned result');
});
test('final phrase trimming still rejects spoken overruns and longer caption overruns', () => {
  const duration = 110 / 24;
  const speechOverrun = { ...cue('speech-overrun', 3, 4.8), words: [{ text: 'overrun', startTime: 3, endTime: 4.7, isActive: false }] };
  const extendedCaption = { ...cue('caption-overrun', 3, 4.9), words: [{ text: 'fits', startTime: 3, endTime: 4.56, isActive: false }] };
  assert.throws(() => planner.planCaptionFrames([speechOverrun], 24, duration), /extends beyond the sequence/);
  assert.throws(() => planner.planCaptionFrames([extendedCaption], 24, duration), /extends beyond the sequence/);
});
test('native sub-nanosecond end rounding fits the sequence frame exactly', () => {
  const duration = 110 / 24, finalWordEnd = 4.583333334;
  const phrase = { ...cue('rounded-native-end', 4, finalWordEnd + .12), words: [{ text: 'caption.', startTime: 4, endTime: finalWordEnd, isActive: false }] };
  const [plan] = planner.planCaptionFrames([phrase], 24, duration);
  assert.equal(plan.endFrame, 110); assert.equal(plan.caption.words[0].endTime, duration);
});
test('export streams at most 32 frames per batch and retains only completed media paths', async () => {
  const batches = [], renders = [], bounds = [], context = { clearRect() {},save(){},restore(){},scale(){} };
  const exporter = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class { resize(){} renderFrame(caption, time, style, animation,area) { if(!area?.measureOnly)renders.push({ caption, time, style });return {width:500,height:160}; } } } }, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,AAAA' }) } });
  const style = { fontFamily: 'Arial', fontWeight: 700, fontSize: 50, activeWord: {}, spokenWord: {}, positionX: .5, positionY: .8,maxWidth:.8 };
  const result = await exporter.exportFrames([cue('a', 0, 2), cue('b', 2.1, 3)], style, {}, 1920, 1080, 31, 3, {
    begin: async id => '/output/' + id,
    write: async (folder, frames, start) => { batches.push({ folder, length: frames.length, start }); },
    finish: async (folder,fps,count,geometry) => {bounds.push(geometry);return folder + '/caption.mov';},
  });
  assert.ok(batches.every(b => b.length <= 32));
  assert.equal(batches.filter(b => b.folder === '/output/a').reduce((sum, b) => sum + b.length, 0), 62);
  assert.equal(result[0].mediaPath, '/output/a/caption.mov'); assert.equal(renders[0].caption.position.x, .23); assert.equal(renders[0].style.positionY, .8);
  assert.equal(renders.length, 90);
  assert.equal(bounds[0].width,1536);assert.equal(bounds[0].height,432);assert.equal(bounds[0].x,Math.round(1920*.23-768));
  assert.equal(result[0].renderBounds.width,1536);assert.equal(result[0].layoutOverflow,false);
});
test('native width and height keyframes reflow per frame while compensating font scale and retaining the stable box', async () => {
  const transforms = [], layouts = [], frames = [];
  const context = { save(){}, restore(){}, scale(x,y){transforms.push([x,y]);} };
  const exporter = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class {
    resize(width,height){this.width=width;this.height=height;}
    renderFrame(caption,time,style,animation,area){layouts.push({ time, width:this.width, height:this.height, area });return {width:80,height:area.width<300?260:120};}
  } } }, { document: { createElement: () => ({ width:0,height:0,getContext:()=>context,toDataURL:()=> 'data:image/png;base64,AAAA' }) } });
  const phrase = { ...cue('keys',0,1), renderBounds:{x:72,y:700,width:576,height:512,frameWidth:720,frameHeight:1280}, motionProfile:{signature:'native-keys',samples:[{time:.25,scaleX:.5,scaleY:2},{time:.75,scaleX:1,scaleY:.5}]} };
  const [rendered] = await exporter.exportFrames([phrase], { fontFamily:'Arial',fontWeight:700,fontSize:64,maxWidth:.8,positionX:.5,positionY:.8,activeWord:{},spokenWord:{} }, {}, 720,1280,2,1,{begin:async()=>'/output/keys',write:async(_folder,values)=>frames.push(...values),finish:async()=>'/output/keys/caption.mov'});
  const final = layouts.filter(entry=>!entry.area.measureOnly);
  assert.deepEqual(transforms,[[2,.5],[1,2]],'inverse compensation cancels the XY scale applied by native Motion');
  assert.deepEqual(final.map(entry=>[entry.width,entry.height,entry.area.width,entry.area.height]),[[360,2560,288,1024],[720,640,576,256]]);
  assert.equal(frames.length,2);assert.equal(rendered.renderBounds.height,512);assert.equal(rendered.renderBounds.width,576);assert.equal(rendered.motionProfile.signature,'native-keys');
  assert.equal(rendered.layoutOverflow,false);
});
test('text overflow is reported instead of growing or shrinking a previously sized native paragraph box', async () => {
  const context={save(){},restore(){},scale(){}};
  const exporter = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class {resize(){}renderFrame(){return {width:100,height:900};}} } }, {document:{createElement:()=>({width:0,height:0,getContext:()=>context,toDataURL:()=> 'data:image/png;base64,AAAA'})}});
  const phrase={...cue('overflow',0,1),renderBounds:{x:72,y:832,width:576,height:512,frameWidth:720,frameHeight:1280}};
  const [rendered]=await exporter.exportFrames([phrase],{fontFamily:'Arial',fontWeight:700,fontSize:64,maxWidth:.8,positionX:.5,positionY:.8,activeWord:{},spokenWord:{}},{},720,1280,1,1,{begin:async()=>'/output/overflow',write:async()=>{},finish:async()=>'/output/overflow/caption.mov'});
  assert.equal(rendered.layoutOverflow,true);assert.equal(rendered.renderBounds.height,512);
});
test('CEP save uses its own sequence directory when a different sequence becomes active', async () => {
  let active = 'a'; const saved = [], contexts = { a: { id: 'a', projectPath: '/project/a.prproj', width: 1920, height: 1080, fps: 24 }, b: { id: 'b', projectPath: '/project/b.prproj', width: 1920, height: 1080, fps: 24 } };
  const runtime = { directory: context => '/data/' + context.id, save: (dir, data) => saved.push({ dir, data }) };
  const window = { __adobe_cep__: { getSystemPath: () => '/extension', evalScript: (expression, callback) => { const args = JSON.parse('[' + expression.slice(expression.indexOf('(') + 1, -1) + ']'); callback(JSON.stringify(args[0] && args[0] !== active ? { error: 'The active sequence changed.' } : contexts[active])); } }, require: name => name === 'node:path' ? path : runtime };
  const api = loadTypeScript(path.join(root, 'webview-ui/src/cep-api.ts'), {}, { window }).createHostAPI();
  await api.getActiveSequenceInfo(); active = 'b'; await api.getActiveSequenceInfo(); await api.saveSession({ sequenceId: 'a', text: 'Keep my original sequence' });
  assert.equal(saved[0].dir, '/data/a'); await assert.rejects(api.saveSession({ sequenceId: 'unknown' }), /Refresh/); await assert.rejects(api.beginCaption('caption-a', 'a'), /changed/);
});
test('polling jobs are removed after successful and failed native read callbacks', async () => {
  const pending=new Map(),disposed=[],ctx={id:'a',projectPath:'/media/project.prproj',width:720,height:1280,fps:24};let fail=false,index=0;
  const runtime={directory:()=>'/media/Better Captions/a',readJob:data=>{const file='/private/service/jobs/read-'+index++ +'.json';pending.set(file,data);return file;},disposeReadJob:file=>{disposed.push(file);pending.delete(file);},writeJSON:()=>assert.fail('polling must not write jobs beside the media project')};
  const window={require:name=>name==='node:path'?path:runtime,__adobe_cep__:{getSystemPath:()=>'/extension',evalScript:(expression,callback)=>{
    const name=expression.slice('BetterCaptionsHost.'.length,expression.indexOf('('));
    if(name==='context')return callback(JSON.stringify(ctx));
    const [file]=JSON.parse('['+expression.slice(expression.indexOf('(')+1,-1)+']');assert.ok(pending.has(file));
    callback(JSON.stringify(fail?{error:'Read failed'}:{ok:true,cues:[]}));
  }}};
  const api=loadTypeScript(path.join(root,'webview-ui/src/cep-api.ts'),{}, {window}).createHostAPI();await api.getActiveSequenceInfo();
  await api.readCaptionMotion([], 'a');assert.equal(pending.size,0);
  fail=true;await assert.rejects(api.readCaptionSelection([], 'a'),/Read failed/);assert.equal(pending.size,0);assert.equal(disposed.length,2);
});
