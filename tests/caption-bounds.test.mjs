import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('../webview-ui/node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(new URL('../webview-ui/src/lib/export/bounds.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {}; vm.runInNewContext(code, { exports });
test('paragraph boxes keep their original height while width follows the explicit wrap setting',()=>{
  const first=exports.textAreaBounds(720,1280,.8,.5,.85,140);
  assert.equal(first.width,576);assert.equal(first.height,512);assert.equal(first.y,832);
  const updated=exports.textAreaBounds(720,1280,.5,.5,.85,900,first);
  assert.equal(updated.width,360);assert.equal(updated.height,512,'text overflow must not silently grow a resized paragraph box');
  const edge=exports.textAreaBounds(720,1280,.8,0,0,100);
  assert.equal(edge.x,-288);assert.equal(edge.y,-256,'box content remains available when native Motion brings it back on screen');
});
