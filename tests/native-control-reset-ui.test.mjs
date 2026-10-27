import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createNativeGeometryController} from '../webview-ui/src/lib/native-effect/geometry-controller.ts';
const require=createRequire(import.meta.url),{parse}=require('../webview-ui/node_modules/svelte/compiler'),ts=require('../webview-ui/node_modules/typescript');
function sourceComponent(name){
 const source=fs.readFileSync(new URL(`../webview-ui/src/components/${name}.svelte`,import.meta.url),'utf8'),ast=parse(source,{modern:true}),inputs=[];
 const walk=node=>{if(!node||typeof node!=='object')return;if(node.type==='Component'&&node.name==='ScrubbableNumber')inputs.push(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);};walk(ast.fragment);
 const callback=input=>{const attr=input.attributes.find(a=>a.name==='onReset');assert.ok(attr,`${name} numeric field must provide native reset`);const expression=(Array.isArray(attr.value)?attr.value[0]:attr.value).expression;return source.slice(expression.start,expression.end);};
 return {source,ast,callbacks:inputs.map(callback)};
}
const descriptor=value=>({value,defaultValue:value,animated:false,keyframesSupported:true,hasKey:false,keys:[]});
const receipt=()=>({ok:true,clipNodeId:'clip',revision:'controls',timelineTicks:'254016000000',sourceTicks:'254016000000',startTicks:'0',endTicks:'2540160000000',inTicks:'0',outTicks:'2540160000000',clock:'clip-source',insideClip:true,position:{...descriptor([.2,.7]),defaultValue:[.5,.9]},width:{...descriptor(400),defaultValue:648},height:{...descriptor(210),defaultValue:1152}});
async function fixture(){
 const requests=[];let controls;const controller=createNativeGeometryController({current:()=>({key:'clip',sequenceId:'sequence',snapshot:{locator:{clipNodeId:'clip'},revision:'doc'},visible:true,disabled:false}),read:async()=>receipt(),edit:async(s,r)=>{requests.push(r);return {...receipt(),readbackVerified:true};},state:value=>controls=value,error:message=>assert.equal(message,'')});await controller.read();return{controller,requests,get controls(){return controls;}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('double-click geometry resets request native defaults and reset position axes independently',async()=>{
 const component=sourceComponent('NativeEffectControls');assert.equal(component.callbacks.length,3);
 const declaration=component.ast.instance.content.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='resetAxis');assert.ok(declaration);const resetSource=ts.transpileModule(component.source.slice(declaration.start,declaration.end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [axis,expected] of [[0,[.5,.7]],[1,[.2,.9]]]) {
  const f=await fixture(),context={controller:f.controller,controls:f.controls};vm.createContext(context);vm.runInContext(resetSource,context);vm.runInContext(`(${component.callbacks[axis]})()`,context);await tick();assert.equal(f.requests[0].parameter,'position');assert.equal(f.requests[0].operation,'set');assert.deepEqual(f.requests[0].value,expected);f.controller.dispose();
 }
 for(const parameter of ['width','height','rollUpLines','rollUpCurrentLine']) {
  const f=await fixture();vm.runInNewContext(`(${component.callbacks[2]})()`,{controller:f.controller,parameter});await tick();assert.equal(f.requests[0].parameter,parameter);assert.equal(f.requests[0].operation,'reset');assert.equal('value' in f.requests[0],false,'host computes adaptive defaults at the current sequence and playhead');f.controller.dispose();
 }
});
test('scroll and edge numeric double-click resets use the same verified native reset transaction',async()=>{
 const component=sourceComponent('NativeRollUpControls');assert.equal(component.callbacks.length,1);
 const keys=['rollUpSpeed','rollUpLines','rollUpDuration','rollUpFadePosition','rollUpFadeThickness','rollUpFadeAmount',...['Top','Bottom','Left','Right'].flatMap(side=>['Inset','Width','Amount'].map(field=>`boundary${side}${field}`))];
 for(const key of keys){const f=await fixture();vm.runInNewContext(`(${component.callbacks[0]})()`,{controller:f.controller,row:{key}});await tick();assert.equal(f.requests[0].parameter,key);assert.equal(f.requests[0].operation,'reset');assert.equal('value' in f.requests[0],false);f.controller.dispose();}
});

test('the primary Visible lines field edits the effect Visible lines stream rather than Groups per page',async()=>{
 const component=sourceComponent('NativeEffectControls');
 const declarations=component.ast.instance.content.body;
 const rows=declarations.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='rows'));
 const labels=declarations.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='labels'));
 const scalar=declarations.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='scalar');
 const code=ts.transpileModule([rows,labels,scalar].map(n=>component.source.slice(n.start,n.end)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const f=await fixture(),context={controller:f.controller};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(vm.runInContext('rows[3]',context),'rollUpLines');assert.equal(vm.runInContext('labels[rows[3]]',context),'Visible lines');
 vm.runInContext('scalar(rows[3],1)',context);await tick();assert.equal(f.requests.length,1);assert.equal(f.requests[0].parameter,'rollUpLines');assert.equal(f.requests[0].value,1);
 assert.doesNotMatch(component.source,/Groups per page/);f.controller.dispose();
});


test('Current line follows Visible lines and rounds edits to the native integer stream',async()=>{
 const component=sourceComponent('NativeEffectControls'),declarations=component.ast.instance.content.body;
 const names=['rows','labels','scalar'];
 const code=ts.transpileModule(declarations.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>names.includes(d.id.name))).map(n=>component.source.slice(n.start,n.end)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const f=await fixture(),context={controller:f.controller};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(vm.runInContext('rows[4]',context),'rollUpCurrentLine');assert.equal(vm.runInContext('labels[rows[4]]',context),'Current line');
 vm.runInContext('scalar(rows[4],2.7)',context);await tick();assert.equal(f.requests[0].parameter,'rollUpCurrentLine');assert.equal(f.requests[0].value,3);
 assert.equal(vm.runInContext('rows[5]',context),undefined);f.controller.dispose();
});


test('Pause Line Length numeric reset uses the same native reset transaction',async()=>{
 const component=sourceComponent('NativePauseLineControl');assert.equal(component.callbacks.length,1);
 const f=await fixture();vm.runInNewContext(`(${component.callbacks[0]})()`,{controller:f.controller,parameter:'rollUpBlankLineSeconds'});await tick();
 assert.equal(f.requests[0].parameter,'rollUpBlankLineSeconds');assert.equal(f.requests[0].operation,'reset');assert.equal('value' in f.requests[0],false);f.controller.dispose();
});
