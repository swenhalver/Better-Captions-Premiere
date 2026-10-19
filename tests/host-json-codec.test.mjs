import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../cep/host/bridge.jsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('    function jsonString('),source.indexOf('    function reply('));
const codec=vm.runInNewContext('(function(){'+body+';return {parse:parseJSON,stringify:stringify};})()',{JSON:undefined});
const plain=value=>JSON.parse(JSON.stringify(value));
// Reference the established byte encoding (control escapes are always \\uXXXX).
const quote=value=>'"'+value.replace(/["\\\x00-\x1f]/g,c=>c==='"'?'\\"':c==='\\'?'\\\\':'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+'"';
test('strict local ES3 codec preserves byte encoding and UTF-16 across every code unit',()=>{
 let text='';for(let i=0;i<=0xffff;i++)text+=String.fromCharCode(i);
 assert.equal(codec.stringify(text),quote(text));assert.equal(codec.parse(codec.stringify(text)),text);
 assert.equal(codec.parse(JSON.stringify(text)),text);
});
test('codec matches native JSON values for nested escaped document revisions and deterministic fixtures',()=>{
 let seed=1729;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<80;i++){
  let text='';for(let j=0;j<200;j++)text+=String.fromCharCode(random()&0xffff);
  const value={zero:0,bool:!!(i%2),none:null,number:(random()-2**31)/17,words:[text,'"\\\b\f\n\r\t/'],revision:JSON.stringify({documentText:'BCDOC1:'+text})};
  assert.deepEqual(plain(codec.parse(JSON.stringify(value))),value);
  assert.deepEqual(JSON.parse(codec.stringify(codec.parse(JSON.stringify(value)))),value);
 }
});
test('codec rejects malformed strings, control bytes, unsafe keys, excessive nesting and trailing values',()=>{
 const malformed=['"unterminated','"bad\\x"','"bad\\u123"','"bad\\uZZZZ"','"bad\\"','"raw\nline"','"a" false','{"__proto__":{}}','{"constructor":0}','{"prototype":0}','[1,]','{"a":1,}','01','NaN','Infinity','-Infinity','[truefalse]'];
 for(let i=0;i<32;i++)malformed.push('"a'+String.fromCharCode(i)+'b"');
 for(const text of malformed)assert.throws(()=>codec.parse(text),/Invalid caption job JSON/,JSON.stringify(text));
 assert.throws(()=>codec.parse('['.repeat(66)+'0'+']'.repeat(66)),/Invalid caption job JSON/);
 assert.deepEqual(plain(codec.parse(' \r\n\t{"ok":[true,false,null,-1.5e2]} ')),{ok:[true,false,null,-150]});
});
test('large carriers and nested opaque revisions round trip without a per-character JavaScript copy loop',()=>{
 const carrier='BCDOC1:'+'abcdef0123456789'.repeat(100000),documentRevision=JSON.stringify({documentText:carrier}),revision=JSON.stringify({documentRevision,controls:{width:1536}}),text=JSON.stringify({snapshot:{revision:documentRevision},request:{revision,value:600}});
 assert.deepEqual(plain(codec.parse(text)),JSON.parse(text));assert.equal(codec.stringify(carrier),quote(carrier));
 assert.match(body,/special\.exec\(text\)/);assert.doesNotMatch(body,/out \+= c|for \(var i = 0; i < value\.length/);
});
