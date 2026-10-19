import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import * as generator from '../webview-ui/src/lib/native-graphics/generate.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
const require=createRequire(import.meta.url),ts=require('../webview-ui/node_modules/typescript'),runtime=require('../cep/runtime.cjs');
const generation='a'.repeat(32),sourceContext={id:'seq-a',name:'Original',projectPath:'/project/edit.prproj',width:1920,height:1080,fps:30};
function source(context=sourceContext){return {sequenceId:context.id,projectPath:context.projectPath,captions:[{id:'a',text:'Native words',startTime:0,endTime:2,words:[{text:'Native',startTime:0,endTime:1,isActive:false},{text:'words',startTime:1,endTime:2,isActive:false}]}],style:structuredClone(DEFAULT_STYLE),animation:structuredClone(DEFAULT_ANIMATION),transcriptJson:null};}

test('generation uses captured host settings and retains rich authoring data without accepting paths or XML',()=>{
 const input=source(),before=structuredClone(input),output=generator.prepareNativeGraphicsGeneration(input,{mode:'save-only'},sourceContext,generation);
 assert.deepEqual(input,before);assert.deepEqual(output.manifest.sourcePlan.source.style,input.style);assert.deepEqual(output.manifest.sourcePlan.source.animation,input.animation);
 assert.equal(output.manifest.sourcePlan.sequence.frameWidth,1920);assert.equal(output.manifest.sourcePlan.sequence.frameHeight,1080);assert.deepEqual(output.manifest.sourcePlan.sequence.frameRate,{numerator:30,denominator:1});
 assert.equal(output.manifest.output.sequenceName,'Better Captions graphics '+generation);assert.equal(output.manifest.output.nativeImportVerified,false);
 for(const extra of [{xml:'<arbitrary/>'},{output:'/elsewhere'},{sequence:{frameRate:99}},{frameWidth:999}])assert.throws(()=>generator.prepareNativeGraphicsGeneration({...input,...extra},{mode:'save-only'},sourceContext,generation),/authoring data only/);
 for(const options of [undefined,{}, {mode:'auto'}, {mode:'save-only',path:'/elsewhere'}])assert.throws(()=>generator.prepareNativeGraphicsGeneration(input,options,sourceContext,generation),/explicitly/);
 for(const mismatch of [{sequenceId:'other'},{projectPath:'/other.prproj'}])assert.throws(()=>generator.prepareNativeGraphicsGeneration({...input,...mismatch},{mode:'save-only'},sourceContext,generation),/another project or sequence/);
});

function adapterFixture(t,options={}){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bc-graphics-api-'));t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
 const context={...sourceContext,projectPath:path.join(temporary,'edit.prproj')};fs.writeFileSync(context.projectPath,'untouched project');
 let live={...context};const jobs=new Map(),calls=[],saved=[];
 const actualRuntime={...runtime,readJob(data){const file=path.join(temporary,'job-'+jobs.size+'.json');jobs.set(file,data);return file;},disposeReadJob:file=>jobs.delete(file),
  saveNativeGraphics(c,id,output){const artifacts=runtime.saveNativeGraphics(c,id,output);saved.push(artifacts);options.afterSave?.({artifacts,live,setLive:value=>{live=value;}});return artifacts;}};
 const window={require:name=>name==='node:path'?path:actualRuntime,__adobe_cep__:{getSystemPath:()=>temporary,evalScript(expression,callback){
  if(expression==='"BC_NATIVE_EVAL_V1"')return callback('BC_NATIVE_EVAL_V1');
  if(expression.includes('/*better-captions-host-ready-v1*/'))return callback('{"version":1,"ok":true,"loaded":false}');
  if(expression.includes('/*better-captions-host-global-v1*/'))return callback('BC_HOST_GLOBAL_READY_V1');
  const method=expression.slice('BetterCaptionsHost.'.length,expression.indexOf('(')),args=JSON.parse('['+expression.slice(expression.indexOf('(')+1,-1)+']');calls.push({method,args});
  if(method==='context')return callback(JSON.stringify(live));
  assert.equal(method,'importNativeGraphics');const p=jobs.get(args[0]);calls.at(-1).payload=p;
  const receipt=options.receipt?.(p)??{ok:true,version:1,generationId:p.generationId,sequenceId:p.sequenceId,projectPath:p.projectPath,status:'imported',importAttempted:true,nativeSequence:{id:'new-sequence',name:p.sequenceName},warnings:[]};
  callback(options.rawResponse??JSON.stringify(receipt));
 }}};
 const exports={},code=ts.transpileModule(fs.readFileSync(new URL('../webview-ui/src/cep-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,window,console,JSON,require:name=>name.includes('native-graphics/generate')?generator:{}});
 return {api:exports.createHostAPI(),context,calls,saved,jobs,temporary,setLive:value=>{live=value;}};
}

test('save-only writes unique exclusive artifacts and an honest receipt without importing or altering source data',async t=>{
 const f=adapterFixture(t);await f.api.getActiveSequenceInfo();const input=source(f.context),before=JSON.stringify(input);
 const sessionPath=path.join(runtime.directory(f.context),'captions.better-captions.json');fs.writeFileSync(sessionPath,'preserved saved authoring session');
 const result=await f.api.generateNativeGraphics(input,{mode:'save-only'},f.context.id);
 assert.equal(result.status,'saved');assert.equal(result.importAttempted,false);assert.equal(result.automaticRetryAllowed,false);assert.equal(result.verification,'artifacts-only');assert.equal(result.nativeSequence,undefined);
 assert.equal(JSON.stringify(input),before);assert.equal(fs.readFileSync(f.context.projectPath,'utf8'),'untouched project');assert.equal(f.calls.filter(call=>call.method==='importNativeGraphics').length,0);
 assert.equal(fs.readFileSync(sessionPath,'utf8'),'preserved saved authoring session');
 for(const file of [result.artifacts.xml,result.artifacts.manifest,result.artifacts.srt,path.join(result.artifacts.directory,'import-result.json')])assert.equal(fs.statSync(file).isFile(),true);
 const manifest=JSON.parse(fs.readFileSync(result.artifacts.manifest,'utf8'));assert.equal(manifest.generationId,result.generationId);assert.deepEqual(manifest.sourcePlan.source.style,input.style);assert.equal(manifest.reconnection.status,'unbound');
 const second=await f.api.generateNativeGraphics(input,{mode:'save-only'},f.context.id);assert.notEqual(second.artifacts.directory,result.artifacts.directory);assert.notEqual(second.generationId,result.generationId);
});

test('artifact creation refuses existing generation directories instead of overwriting prior output',t=>{
 const f=adapterFixture(t),context={...f.context,dir:runtime.directory(f.context)},output=generator.prepareNativeGraphicsGeneration(source(f.context),{mode:'save-only'},context,generation);
 const artifacts=runtime.saveNativeGraphics(context,generation,output),original=fs.readFileSync(artifacts.xml,'utf8');
 assert.throws(()=>runtime.saveNativeGraphics(context,generation,output),{code:'EEXIST'});assert.equal(fs.readFileSync(artifacts.xml,'utf8'),original);
 runtime.saveNativeGraphicsResult(artifacts,{status:'saved'});
 assert.throws(()=>runtime.nativeGraphicsImportPayload(context,generation,artifacts,output.manifest.output.sequenceName),/Only this generated/,'a completed generation cannot be replayed through the runtime');
});

test('explicit import sends only generated owned XML and confirms only a new sequence identity',async t=>{
 const f=adapterFixture(t);await f.api.getActiveSequenceInfo();const result=await f.api.generateNativeGraphics(source(f.context),{mode:'import-new-sequence'},f.context.id);
 assert.equal(result.status,'imported');assert.equal(result.importAttempted,true);assert.equal(result.verification,'new-sequence-identity-and-settings');assert.equal(result.nativeSequence.name,'Better Captions graphics '+result.generationId);
 const imports=f.calls.filter(call=>call.method==='importNativeGraphics');assert.equal(imports.length,1);assert.equal(imports[0].payload.xmlPath,result.artifacts.xml);assert.equal(imports[0].payload.xmlText,fs.readFileSync(result.artifacts.xml,'utf8'));
 assert.equal(imports[0].payload.width,1920);assert.equal(imports[0].payload.height,1080);assert.equal(imports[0].payload.fps,30);assert.equal(f.jobs.size,0);
 assert.equal(JSON.parse(fs.readFileSync(result.artifacts.manifest,'utf8')).output.nativeImportVerified,false,'sequence inventory is not native text/style fidelity verification');
});

test('stale context fails before generation, and later source changes preserve saved artifacts without importing',async t=>{
 const stale=adapterFixture(t);await stale.api.getActiveSequenceInfo();stale.setLive({...stale.context,width:1280});
 await assert.rejects(stale.api.generateNativeGraphics(source(stale.context),{mode:'import-new-sequence'},stale.context.id),/settings changed/);assert.equal(stale.saved.length,0);
 const changed=adapterFixture(t,{afterSave:({live,setLive})=>setLive({...live,projectPath:path.join(changed.temporary,'other.prproj')})});await changed.api.getActiveSequenceInfo();
 const result=await changed.api.generateNativeGraphics(source(changed.context),{mode:'import-new-sequence'},changed.context.id);
 assert.equal(result.status,'saved');assert.equal(result.importAttempted,false);assert.equal(changed.calls.filter(call=>call.method==='importNativeGraphics').length,0);assert.match(result.warnings.join('\n'),/settings changed/);assert.equal(fs.existsSync(result.artifacts.xml),true);
});

test('changed or redirected XML artifacts are never sent to Premiere',async t=>{
 for(const kind of ['content','junction']){
  const f=adapterFixture(t,{afterSave:({artifacts})=>{
   if(kind==='content')fs.writeFileSync(artifacts.xml,'<xmeml>foreign</xmeml>');
   else {const moved=artifacts.directory+'-moved';fs.renameSync(artifacts.directory,moved);fs.symlinkSync(moved,artifacts.directory,process.platform==='win32'?'junction':'dir');}
  }});await f.api.getActiveSequenceInfo();
  const result=await f.api.generateNativeGraphics(source(f.context),{mode:'import-new-sequence'},f.context.id);
  assert.equal(result.status,'saved');assert.equal(result.importAttempted,false);assert.equal(f.calls.filter(call=>call.method==='importNativeGraphics').length,0);assert.match(result.warnings.join('\n'),/changed|ownership/);
 }
});

test('lost or mismatched import receipts remain unconfirmed with no retry or invented native identity',async t=>{
 for(const options of [
  {rawResponse:'EvalScript error.'},
  {receipt:p=>({ok:true,version:1,generationId:p.generationId,sequenceId:p.sequenceId,projectPath:p.projectPath,status:'imported',importAttempted:true,nativeSequence:{id:p.sequenceId,name:p.sequenceName},warnings:[]})},
  {receipt:p=>({ok:true,version:1,generationId:p.generationId,sequenceId:p.sequenceId,projectPath:p.projectPath,status:'imported',importAttempted:true,nativeSequence:{id:'new',name:'Some unrelated sequence'},warnings:[]})},
 ]){
  const f=adapterFixture(t,options);await f.api.getActiveSequenceInfo();const result=await f.api.generateNativeGraphics(source(f.context),{mode:'import-new-sequence'},f.context.id);
  assert.equal(result.status,'import-unconfirmed');assert.equal(result.automaticRetryAllowed,false);assert.equal(result.verification,'artifacts-only');assert.equal(result.nativeSequence,undefined);assert.equal(f.calls.filter(call=>call.method==='importNativeGraphics').length,1);assert.match(result.warnings.join('\n'),/will not retry automatically/);
 }
});

function hostFixture(options={}){
 const context={...sourceContext,projectPath:options.projectPath??sourceContext.projectPath};
 const p={version:1,sequenceId:context.id,projectPath:context.projectPath,generatedRoot:context.projectPath.replaceAll('\\','/').replace(/\/[^/]*$/,'')+'/Better Captions/seq-a',generationId:generation,sequenceName:'Better Captions graphics '+generation,width:1920,height:1080,fps:30};
 p.xmlPath=p.generatedRoot+'/native-graphics-'+generation+'/graphics.xml';p.xmlText=generator.prepareNativeGraphicsGeneration(source(context),{mode:'import-new-sequence'},context,generation).xml;
 const files=new Map([[p.xmlPath,p.xmlText]]),imports=[],clips=[{id:'original-clip',start:0,end:20}],original={sequenceID:'seq-a',name:'Original',frameSizeHorizontal:1920,frameSizeVertical:1080,timebase:String(254016000000/30),clips};
 const sequences=[original];Object.defineProperty(sequences,'numSequences',{get:()=>sequences.length});
 const project={path:p.projectPath,activeSequence:original,sequences,rootItem:{name:'Project root'},importFiles(paths,suppress,target,stills){
  imports.push({paths,suppress,target,stills});
  if(options.onImport)return options.onImport({project,sequences,original,p});
  sequences.push({...original,sequenceID:'generated-native-id',name:p.sequenceName,clips:[]});return true;
 }};
 if(options.unavailable)delete project.importFiles;
 class File {constructor(file){this.file=file;this.exists=files.has(file);this.alias=false;this.length=Buffer.byteLength(files.get(file)??'');}open(){return this.exists;}read(){return files.get(this.file);}close(){}}
 const sandbox={app:{project},File,JSON:undefined};vm.runInNewContext(fs.readFileSync(new URL('../cep/host/bridge.jsx',import.meta.url),'utf8'),sandbox);
 return {project,original,sequences,imports,p,files,invoke(patch={}){files.set('/job.json',JSON.stringify({...p,...patch}));return JSON.parse(sandbox.BetterCaptionsHost.importNativeGraphics('/job.json'));}};
}

test('the public XML import adds one separate sequence and leaves original timeline objects untouched',()=>{
 const h=hostFixture(),before=JSON.stringify(h.original),result=h.invoke();
 assert.equal(result.status,'imported');assert.equal(result.importAttempted,true);assert.equal(result.nativeSequence.id,'generated-native-id');assert.equal(result.nativeSequence.name,h.p.sequenceName);assert.equal(JSON.stringify(h.original),before);
 assert.equal(h.project.activeSequence,h.original);assert.equal(h.imports.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.imports[0].paths)),[h.p.xmlPath]);assert.equal(h.imports[0].target,h.project.rootItem);assert.equal(h.imports[0].stills,false);
 const repeat=h.invoke();assert.equal(repeat.status,'saved');assert.equal(repeat.importAttempted,false);assert.equal(h.imports.length,1);assert.match(repeat.warnings.join(' '),/already has a sequence/);
});

test('native graphics imports share normalized host drive identity and preserve the source and canonical receipt',()=>{
 const ordinary='C:\\Project Data\\Edit.prproj',h=hostFixture({projectPath:ordinary});
 h.project.path='\\\\?\\'+ordinary;
 const before=JSON.stringify(h.original),result=h.invoke();
 assert.equal(result.status,'imported');assert.equal(result.importAttempted,true);assert.equal(result.projectPath,ordinary);assert.equal(h.imports.length,1);assert.equal(JSON.stringify(h.original),before);assert.equal(h.project.activeSequence,h.original);
 const foreign=hostFixture({projectPath:ordinary});foreign.project.path='\\\\?\\C:\\Other\\Edit.prproj';
 assert.equal(foreign.invoke().status,'saved');assert.equal(foreign.imports.length,0);
 const raw=hostFixture({projectPath:ordinary});raw.project.path='\\\\?\\'+ordinary;
 assert.equal(raw.invoke({projectPath:raw.project.path}).status,'saved');assert.equal(raw.imports.length,0,'request paths are not normalized');
});

test('Save As during a native import remains unconfirmed after host prefix normalization',()=>{
 const ordinary='C:\\Project Data\\Edit.prproj',h=hostFixture({projectPath:ordinary,onImport:({project,sequences,original,p})=>{
  sequences.push({...original,sequenceID:'new',name:p.sequenceName});project.path='\\\\?\\C:\\Saved As\\Edit.prproj';return true;
 }});
 h.project.path='\\\\?\\'+ordinary;
 const before=JSON.stringify(h.original),result=h.invoke();
 assert.equal(result.status,'import-unconfirmed');assert.equal(result.importAttempted,true);assert.equal(result.projectPath,ordinary);assert.equal(result.nativeSequence,undefined);assert.equal(h.imports.length,1);assert.equal(JSON.stringify(h.original),before);
 assert.match(result.warnings.join(' '),/active project changed.*Do not automatically retry/);
});

test('unavailable import, foreign paths/content, and changed source identity return saved artifacts without mutation',()=>{
 const unavailable=hostFixture({unavailable:true});assert.equal(unavailable.invoke().status,'saved');assert.equal(unavailable.imports.length,0);
 for(const patch of [{xmlPath:'/outside/graphics.xml'},{generatedRoot:'/other'},{sequenceName:'User sequence'},{sequenceId:'other'},{fps:24},{xmlText:'<xmeml version="5"><sequence id="foreign"/></xmeml>'}]){
  const h=hostFixture(),result=h.invoke(patch);assert.equal(result.status,'saved');assert.equal(result.importAttempted,false);assert.equal(h.imports.length,0);
 }
 const changed=hostFixture();changed.project.path='/other/project.prproj';assert.equal(changed.invoke().status,'saved');assert.equal(changed.imports.length,0);
});

test('partial or ambiguous native imports are preserved and reported once as unconfirmed',()=>{
 for(const onImport of [
  ()=>false,
  ({sequences,original,p})=>{sequences.push({...original,sequenceID:'new',name:p.sequenceName});throw new Error('native response lost');},
  ({sequences,original})=>{sequences.push({...original,sequenceID:'new',name:'Wrong generation'});return true;},
  ({sequences,original,p})=>{sequences.push({...original,sequenceID:'new',name:p.sequenceName,frameSizeHorizontal:720});return true;},
  ({sequences,original,p})=>{sequences.push({...original,sequenceID:'new-a',name:p.sequenceName},{...original,sequenceID:'new-b',name:'extra'});return true;},
 ]){
  const h=hostFixture({onImport}),before=JSON.stringify(h.original),result=h.invoke();
  assert.equal(result.status,'import-unconfirmed');assert.equal(result.importAttempted,true);assert.equal(h.imports.length,1);assert.equal(result.nativeSequence,undefined);assert.equal(JSON.stringify(h.original),before);assert.match(result.warnings.join(' '),/Do not automatically retry/);
 }
});
