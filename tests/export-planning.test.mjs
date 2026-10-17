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
test('export streams at most 32 frames per batch and retains only completed media paths', async () => {
  const batches = [], renders = [], context = { clearRect() {} };
  const exporter = loadTypeScript(path.join(root, 'webview-ui/src/lib/export/exporter.ts'), { '../canvas/engine': { CaptionRenderer: class { renderFrame(caption, time, style) { renders.push({ caption, time, style }); } } } }, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => 'data:image/png;base64,AAAA' }) } });
  const style = { fontFamily: 'Arial', fontWeight: 700, fontSize: 50, activeWord: {}, spokenWord: {}, positionX: .5, positionY: .8 };
  const result = await exporter.exportFrames([cue('a', 0, 2), cue('b', 2.1, 3)], style, {}, 1920, 1080, 31, 3, {
    begin: async id => '/output/' + id,
    write: async (folder, frames, start) => { batches.push({ folder, length: frames.length, start }); },
    finish: async folder => folder + '/caption.mov',
  });
  assert.ok(batches.every(b => b.length <= 32));
  assert.equal(batches.filter(b => b.folder === '/output/a').reduce((sum, b) => sum + b.length, 0), 62);
  assert.equal(result[0].mediaPath, '/output/a/caption.mov'); assert.equal(renders[0].caption.position.x, .23); assert.equal(renders[0].style.positionY, .8);
  assert.equal(renders.length, 90);
});
test('CEP save uses its own sequence directory when a different sequence becomes active', async () => {
  let active = 'a'; const saved = [], contexts = { a: { id: 'a', projectPath: '/project/a.prproj', width: 1920, height: 1080, fps: 24 }, b: { id: 'b', projectPath: '/project/b.prproj', width: 1920, height: 1080, fps: 24 } };
  const runtime = { directory: context => '/data/' + context.id, save: (dir, data) => saved.push({ dir, data }) };
  const window = { __adobe_cep__: { getSystemPath: () => '/extension', evalScript: (expression, callback) => { const args = JSON.parse('[' + expression.slice(expression.indexOf('(') + 1, -1) + ']'); callback(JSON.stringify(args[0] && args[0] !== active ? { error: 'The active sequence changed.' } : contexts[active])); } }, require: () => runtime };
  const api = loadTypeScript(path.join(root, 'webview-ui/src/cep-api.ts'), {}, { window }).createHostAPI();
  await api.getActiveSequenceInfo(); active = 'b'; await api.getActiveSequenceInfo(); await api.saveSession({ sequenceId: 'a', text: 'Keep my original sequence' });
  assert.equal(saved[0].dir, '/data/a'); await assert.rejects(api.saveSession({ sequenceId: 'unknown' }), /Refresh/); await assert.rejects(api.beginCaption('caption-a', 'a'), /changed/);
});
