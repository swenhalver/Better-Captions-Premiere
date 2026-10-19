import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import path from 'node:path';
const require=createRequire(import.meta.url),runtime=require('../cep/runtime.cjs');
const row=(families,weight='80',slant='0',variable='False')=>`${weight}\t${slant}\t${variable}\t${JSON.stringify(families).replace(/\]$/,',]')}\n`;
const byFamily=(catalog,name)=>catalog.find(entry=>entry.family.normalize('NFC').toLocaleLowerCase()===name.normalize('NFC').toLocaleLowerCase());

test('fontconfig weights use real OpenType values including book, semilight and intermediate weights',()=>{
 const samples=[[0,100],[40,200],[50,300],[55,350],[75,380],[80,400],[100,500],[180,600],[200,700],[205,800],[210,900],[215,1000],[45,250],[190,650],[80.0888,400.444]];
 for(const [fontconfig,css] of samples)assert.equal(runtime.cssWeightFromFontconfig(fontconfig),css);
 for(const weight of [-1,216,NaN,Infinity,'80',null])assert.throws(()=>runtime.cssWeightFromFontconfig(weight),/invalid font weight/);
});
test('fontconfig catalog preserves comma-containing and long Unicode aliases, merges real faces and deduplicates case and NFC',()=>{
 const literal='La, Famille "Quoted" \\ Display',long='書体É'.repeat(120),aliases=['Cafe\u0301 Display',literal,long];
 const catalog=runtime.parseFontConfigCatalog(row(aliases)+row(['CAFÉ DISPLAY'], '200','110')+row([literal], '75','100')+row(['Single Regular']));
 assert.equal(catalog.length,4);
 assert.deepEqual(byFamily(catalog,'Café Display').weights,[400,700]);assert.equal(byFamily(catalog,'Café Display').italic,true);
 assert.equal(byFamily(catalog,literal).family,literal);assert.deepEqual(byFamily(catalog,literal).weights,[380,400]);assert.equal(byFamily(catalog,literal).italic,true);
 assert.equal(byFamily(catalog,long).family,long);assert.deepEqual(byFamily(catalog,'Single Regular'),{family:'Single Regular',weights:[400],italic:false});
 assert.equal(catalog.some(entry=>entry.family==='La'),false,'a comma inside one alias must not create an invented family');
 assert.deepEqual(runtime.parseFontConfigCatalog(row(['Zulu'])+row(['alpha'])).map(entry=>entry.family),['alpha','Zulu']);
});
test('variable ranges require real range metadata and never bridge unsupported gaps',()=>{
 const catalog=runtime.parseFontConfigCatalog(row(['Continuous'],'[40 200]','0','True')+row(['Continuous'],'100','100')+
  row(['Overlapping'],'[0 80]','0','True')+row(['Overlapping'],'[50 215]','0','True')+
  row(['Disconnected'],'[0 40]','0','True')+row(['Disconnected'],'[200 215]','0','True')+
  row(['Flag Only'],'80','0','True'));
 assert.deepEqual(byFamily(catalog,'Continuous'),{family:'Continuous',weights:[200,500,700],italic:true,variable:{min:200,max:700}});
 assert.deepEqual(byFamily(catalog,'Overlapping').variable,{min:100,max:1000});
 assert.equal(byFamily(catalog,'Disconnected').variable,undefined);assert.deepEqual(byFamily(catalog,'Disconnected').weights,[100,200,700,1000]);
 assert.deepEqual(byFamily(catalog,'Flag Only'),{family:'Flag Only',weights:[400],italic:false});
});
test('malformed, excessive or truncated fontconfig output fails explicitly without a fallback family list',()=>{
 const malformed=['',' ',row(['A']).trimEnd()+'\npartial',row(['A'],'NaN'),row(['A'],'-1'),row(['A'],'216'),row(['A'],'[80 40]','0','True'),row(['A'],'80','111'),row(['A'],'80','0','Maybe'),row([]),row(['\u0000hidden']),row(['\nline']),row(Array.from({length:257},(_,i)=>'alias'+i)),'x'.repeat(4*1024*1024+1),row(['A']).repeat(100001)];
 for(const text of malformed)assert.throws(()=>runtime.parseFontConfigCatalog(text),/font|Font|metadata|safe|famil/i);
});
test('Windows catalog contains only observed physical-face weights and keeps localized aliases',()=>{
 const text=JSON.stringify([{families:['Real Family','真實字體'],weight:380,italic:false},{families:['REAL FAMILY'],weight:617,italic:true},{families:['Only One'],weight:270,italic:false}]);
 const catalog=runtime.parseWindowsFontCatalog('\uFEFF'+text);
 assert.deepEqual(byFamily(catalog,'Real Family').weights,[380,617]);assert.equal(byFamily(catalog,'Real Family').italic,true);assert.equal(byFamily(catalog,'Real Family').variable,undefined);
 assert.deepEqual(byFamily(catalog,'真實字體').weights,[380]);assert.deepEqual(byFamily(catalog,'Only One').weights,[270]);
 assert.equal(catalog.flatMap(entry=>entry.weights).includes(700),false,'bold must not appear unless a real face supplies that weight');
 for(const value of [[],null,{},[{families:['A'],weight:0,italic:false}],[{families:['A'],weight:1001,italic:false}],[{families:['A'],weight:400.5,italic:false}],[{families:['A'],weight:400,italic:'true'}]])assert.throws(()=>runtime.parseWindowsFontCatalog(JSON.stringify(value)),/font|Windows/i);
});

function mockedRuntime(platformName,stdout,exitCode=0){
 const calls=[],module={exports:{}};
 const platform={systemPowerShell:()=>'/fixed/system/powershell.exe',powerShellEnv:()=>({PSModulePath:'fixed'}),resolveTool:name=>{assert.equal(name,'fc-list');return '/fixed/fc-list';}};
 vm.runInNewContext(fs.readFileSync(new URL('../cep/runtime.cjs',import.meta.url),'utf8'),{module,exports:module.exports,Buffer,process:{platform:platformName},setTimeout,clearTimeout,require:name=>{
  if(name==='./platform.cjs')return platform;
  if(name==='node:child_process')return{spawn(exe,args,options){calls.push({exe,args,options});const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdout.setEncoding=child.stderr.setEncoding=()=>{};child.kill=()=>{};queueMicrotask(()=>{child.stdout.emit('data',stdout);child.emit('close',exitCode);});return child;}};
  return require(name);
 }});
 return{runtime:module.exports,calls};
}
test('catalog invokes a fixed metadata format without a command shell and getFonts remains a family-name array',async()=>{
 const h=mockedRuntime('darwin',row(['Literal $(never executes), Name'],'200','100'));
 const catalog=await h.runtime.fontCatalog();assert.equal(catalog[0].family,'Literal $(never executes), Name');assert.deepEqual(Array.from(catalog[0].weights),[700]);
 assert.equal(h.calls[0].exe,'/fixed/fc-list');assert.equal(h.calls[0].options.shell,false);assert.deepEqual(Array.from(h.calls[0].args),['--format',runtime.FONTCONFIG_FORMAT]);
 assert.deepEqual(Array.from(await h.runtime.fonts()),['Literal $(never executes), Name']);
 const failed=mockedRuntime('darwin','',1);await assert.rejects(failed.runtime.fontCatalog(),/process stopped/);await assert.rejects(failed.runtime.fonts(),/process stopped/);
});
test('Windows uses fixed WPF physical-face enumeration with no simulated face or variable-range invention',async()=>{
 const h=mockedRuntime('win32',JSON.stringify([{families:['Physical'],weight:550,italic:false}]));
 assert.equal((await h.runtime.fontCatalog())[0].weights[0],550);
 const call=h.calls[0],script=Buffer.from(call.args.at(-1),'base64').toString('utf16le');
 assert.equal(call.exe,'/fixed/system/powershell.exe');assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.equal(script,runtime.WINDOWS_FONT_SCRIPT);
 assert.match(script,/SystemFontFamilies/);assert.match(script,/GetTypefaces\(\)/);assert.match(script,/TryGetGlyphTypeface\(\[ref\]\$glyph\)/);assert.match(script,/IsBoldSimulated/);assert.match(script,/IsObliqueSimulated/);assert.match(script,/ToOpenTypeWeight\(\)/);assert.doesNotMatch(script,/100\.\.1000|100\.\.900|Invoke-Expression/);
});
test('strict process output limits reject even a successful child instead of parsing a truncated font catalog',async()=>{
 const h=mockedRuntime('darwin','x'.repeat(4*1024*1024+1));await assert.rejects(h.runtime.fontCatalog(),/safe size limit/);
 const direct=mockedRuntime('darwin','ééé');await assert.rejects(direct.runtime.run('/fixed/read',['literal'],{strictOutput:true,maxOutputBytes:5}),/safe size limit/);
});
test('CEP font catalog reads call the system runtime directly and preserve explicit failures without running host scripts',async()=>{
 const ts=require('../webview-ui/node_modules/typescript'),exports={},catalog=[{family:'Actual Face',weights:[350,617],italic:false}];let failing=false,reads=0;
 const nativeRuntime={fontCatalog:async()=>{reads++;if(failing)throw new Error('Local font metadata failed.');return catalog;},fonts:async()=>['Actual Face']};
 const code=ts.transpileModule(fs.readFileSync(new URL('../webview-ui/src/cep-api.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,console,require:()=>({}),window:{require:name=>name==='node:path'?path:nativeRuntime,__adobe_cep__:{getSystemPath:()=>path.resolve('font-catalog-fixture'),evalScript(){throw new Error('Font enumeration must not evaluate Premiere scripts.');}}}});
 const api=exports.createHostAPI();assert.deepEqual(await api.getFontCatalog(),catalog);assert.deepEqual(await api.getFonts(),['Actual Face']);
 failing=true;await assert.rejects(api.getFontCatalog(),/Local font metadata failed/);assert.equal(reads,2);
 const browser={};vm.runInNewContext(code,{exports:browser,require:()=>({}),window:{}});
 const demo=browser.createHostAPI(),fixture=await demo.getFontCatalog();assert.equal(demo.isDemo,true);
 assert.deepEqual(Array.from(fixture,entry=>entry.family),Array.from(await demo.getFonts()));
 assert.deepEqual(Array.from(fixture.find(entry=>entry.family==='Arial').weights),[400,700]);assert.deepEqual(Array.from(fixture.find(entry=>entry.family==='Impact').weights),[400]);
});
test('the real system font catalog has bounded supported weights and compatibility names',async()=>{
 const catalog=await runtime.fontCatalog();assert.ok(catalog.length>10);assert.ok(catalog.length<=20000);
 const keys=new Set();
 for(const entry of catalog){
  const key=entry.family.trim().normalize('NFC').toLocaleLowerCase();assert.equal(keys.has(key),false);keys.add(key);
  assert.ok(entry.weights.length>0&&entry.weights.length<=2000);assert.deepEqual(entry.weights,[...new Set(entry.weights)].sort((a,b)=>a-b));
  assert.ok(entry.weights.every(weight=>Number.isFinite(weight)&&weight>=1&&weight<=1000));assert.equal(typeof entry.italic,'boolean');
  if(entry.variable)assert.ok(entry.variable.min>=1&&entry.variable.max<=1000&&entry.variable.min<entry.variable.max);
 }
 assert.deepEqual(await runtime.fonts(),catalog.map(entry=>entry.family));
});
