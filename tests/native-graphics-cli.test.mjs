import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';

const cli = fileURLToPath(new URL('../scripts/native-graphics.mjs', import.meta.url));
const run = (args, nodeArgs = []) => spawnSync(process.execPath, [...nodeArgs, cli, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
function temporary(t) {
  const base = fs.realpathSync(os.tmpdir()), root = fs.realpathSync(fs.mkdtempSync(path.join(base, 'better-captions-native-graphics-cli-')));
  assert.equal(path.dirname(root), base); assert.ok(path.basename(root).startsWith('better-captions-native-graphics-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function direct() {
  return {
    sequence: { id: 'cli-sequence', name: 'Unicode scratch sequence', frameRate: { numerator: 30000, denominator: 1001 }, frameWidth: 1920, frameHeight: 1080 },
    captions: [{ id: 'source-phrase', startTime: 0, endTime: 1.001, text: 'Bonjour 👋 café', words: [
      { text: 'Bonjour', startTime: 0, endTime: .3, isActive: false },
      { text: '👋', startTime: .4, endTime: .6, isActive: false },
      { text: 'café', startTime: .7, endTime: 1.001, isActive: false },
    ] }],
    style: structuredClone(DEFAULT_STYLE), animation: structuredClone(DEFAULT_ANIMATION), transcriptJson: null,
  };
}
function writeInput(root, input = direct()) {
  const file = path.join(root, 'session with spaces.json');
  fs.writeFileSync(file, typeof input === 'string' ? input : JSON.stringify(input), 'utf8');
  return file;
}
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function invoke(file, output, nodeArgs = []) { return run(['--session', file, '--output', output], nodeArgs); }

test('actual CLI exports Unicode and NTSC input into four files without changing the session', t => {
  const root = temporary(t), file = writeInput(root), before = digest(file), output = path.join(root, 'new graphics output');
  const result = invoke(file, output);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined);
  assert.deepEqual(fs.readdirSync(output).sort(), ['README.txt', 'graphics.xml', 'manifest.json', 'source-plan.srt']);
  assert.equal(digest(file), before);
  const srt = fs.readFileSync(path.join(output, 'source-plan.srt'), 'utf8');
  assert.equal(srt, '1\r\n00:00:00,000 --> 00:00:01,001\r\nBonjour 👋 café\r\n');
  const xml = fs.readFileSync(path.join(output, 'graphics.xml'), 'utf8');
  assert.match(xml, /<xmeml\b/u); assert.ok(xml.includes('café'));
  const manifestText = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), manifest = JSON.parse(manifestText);
  assert.equal(typeof manifest, 'object'); assert.ok(manifestText.includes('cli-sequence'));
  const generation = result.stdout.match(/generation ([\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})/iu)?.[1];
  assert.ok(generation, result.stdout); assert.ok(manifestText.includes(generation));
  const readme = fs.readFileSync(path.join(output, 'README.txt'), 'utf8');
  assert.match(readme, /plain phrase text\/timing only/u); assert.match(readme, /Node\.js 22\.18/u); assert.ok(readme.includes(generation));
});

test('saved SessionState fields map to the same phrase timing and source identity', t => {
  const root = temporary(t), source = direct();
  const session = { sequenceId: 'saved-sequence', sequenceName: 'Saved session', frameRate: 29.97, frameWidth: 1920, frameHeight: 1080,
    captions: source.captions, style: source.style, animation: source.animation, transcriptJson: source.transcriptJson,
    nativeClipId: 'old-effect-instance', projectPath: 'unrelated-project.prproj', hasTranscript: true, isLoading: false, currentTime: 0, duration: 5 };
  const file = writeInput(root, '\uFEFF' + JSON.stringify(session)), output = path.join(root, 'output');
  const result = invoke(file, output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(output, 'source-plan.srt'), 'utf8'), '1\r\n00:00:00,000 --> 00:00:01,001\r\nBonjour 👋 café\r\n');
  const manifestText = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8');
  assert.ok(manifestText.includes('saved-sequence')); assert.ok(manifestText.includes('source-phrase'));
  assert.match(fs.readFileSync(path.join(output, 'README.txt'), 'utf8'), /Saved session/u);
});

test('existing directories and files are never clobbered, including the input file itself', t => {
  const root = temporary(t), file = writeInput(root), before = digest(file), output = path.join(root, 'existing');
  fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'sentinel.txt'), 'preserve me');
  let result = invoke(file, output);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Output already exists/u);
  assert.deepEqual(fs.readdirSync(output), ['sentinel.txt']); assert.equal(fs.readFileSync(path.join(output, 'sentinel.txt'), 'utf8'), 'preserve me');
  result = invoke(file, file);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Output already exists/u); assert.equal(digest(file), before);
});

test('malformed JSON and invalid root values create no output or parent directories', t => {
  const root = temporary(t);
  for (const [index, text] of ['{broken', 'null', '[]', '"session"'].entries()) {
    const file = writeInput(root, text), output = path.join(root, `missing-parent-${index}`, 'output');
    const result = invoke(file, output);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /valid JSON|JSON must contain/u);
    assert.ok(!fs.existsSync(path.dirname(output))); assert.equal(fs.readFileSync(file, 'utf8'), text);
  }
});

test('invalid authoring data and SRT injection fail before any files are created', t => {
  const root = temporary(t), badInputs = [direct(), direct(), direct(), direct()];
  badInputs[0].style.maxChars = 0;
  badInputs[1].captions[0].words[1].startTime = .2;
  badInputs[2].captions[0].words[0].text = 'safe\n\n2\n00:00:00,000 --> 00:00:01,000\ninjected';
  badInputs[3].sequence.frameRate = 0;
  for (const [index, data] of badInputs.entries()) {
    const file = writeInput(root, data), before = digest(file), output = path.join(root, `invalid-${index}`);
    const result = invoke(file, output);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /character limit|overlap|plain text|Frame rate/u);
    assert.ok(!fs.existsSync(output)); assert.equal(digest(file), before);
  }
});

test('oversize and invalid UTF-8 inputs are rejected without output', t => {
  const root = temporary(t), file = path.join(root, 'oversize.json'), output = path.join(root, 'output');
  fs.writeFileSync(file, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
  let result = invoke(file, output);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /8 MiB input limit/u); assert.ok(!fs.existsSync(output));
  fs.writeFileSync(file, Buffer.from([0x7b, 0xff, 0x7d]));
  result = invoke(file, output);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /valid UTF-8/u); assert.ok(!fs.existsSync(output));
});

test('output parent must exist and source paths must be readable regular files', t => {
  const root = temporary(t), file = writeInput(root), output = path.join(root, 'missing-parent', 'output');
  const result = invoke(file, output);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /output parent directory must already exist/u);
  assert.ok(!fs.existsSync(path.dirname(output)));
  const missing = invoke(path.join(root, 'missing.json'), path.join(root, 'new-output'));
  assert.notEqual(missing.status, 0); assert.ok(!fs.existsSync(path.join(root, 'new-output')));
});

test('partial output is preserved with useful recovery information on actual write failure', t => {
  const root = temporary(t), file = writeInput(root), before = digest(file), output = path.join(root, 'incomplete');
  const preload = path.join(root, 'simulate-io-failure.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs/promises';
import path from 'node:path';
const write = fs.writeFile;
fs.writeFile = async function(file, ...args) {
  if (path.basename(String(file)) === 'manifest.json') { const error = new Error('Simulated disk write failure'); error.code = 'EIO'; throw error; }
  return write.call(this, file, ...args);
};\n`, 'utf8');
  const result = invoke(file, output, ['--import', pathToFileURL(preload).href]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Simulated disk write failure/u);
  assert.ok(result.stderr.includes(`Incomplete output preserved at: ${output}`));
  assert.match(result.stderr, /Completed files: graphics\.xml/u); assert.match(result.stderr, /retry with a new directory/u);
  assert.deepEqual(fs.readdirSync(output), ['graphics.xml']); assert.match(fs.readFileSync(path.join(output, 'graphics.xml'), 'utf8'), /<xmeml\b/u);
  assert.equal(digest(file), before);
});

test('help documents runtime and fidelity limits; malformed arguments never create output', t => {
  const root = temporary(t), output = path.join(root, 'output');
  const help = run(['--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /Node\.js 22\.18/u); assert.match(help.stdout, /8 MiB/u); assert.match(help.stdout, /does not launch Premiere/u);
  for (const args of [[], ['--session'], ['--session', 'one', '--session', 'two', '--output', output], ['--unknown', 'value'], ['--output', output]]) {
    const result = run(args);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /required|needs a path|only once|Unknown option/u);
    assert.ok(!fs.existsSync(output));
  }
});
