import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const runtime = require('../cep/runtime.cjs');
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length); return out; }
function png(width = 32, height = 18) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const p = y * (width * 4 + 1) + 1 + x * 4; rows[p] = 255; rows[p + 1] = 216; rows[p + 2] = 77; rows[p + 3] = x > 7 && x < 24 && y > 4 && y < 14 ? 255 : 0; }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
function temporary(t) { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'better-captions-runtime-'))); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('process arguments remain literal, including shell metacharacters', async t => {
  const dir = temporary(t), marker = path.join(dir, 'injected');
  const argument = '$(touch ' + marker + '); `touch ' + marker + '`';
  assert.equal(await runtime.run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument]), argument);
  assert.equal(fs.existsSync(marker), false);
});
test('frame writer rejects unowned directories, invalid PNGs, oversized batches and out-of-order frames', t => {
  const dir = temporary(t), folder = runtime.jobDir(dir, 'caption-test'), frame = png();
  assert.throws(() => runtime.saveFrames(dir, [frame], 0), /Unknown/);
  assert.throws(() => runtime.saveFrames(folder, ['aGVsbG8='], 0), /PNG/);
  assert.throws(() => runtime.saveFrames(folder, Array(33).fill(frame), 0), /1–32/);
  assert.throws(() => runtime.saveFrames(folder, [frame], 1), /order/);
  runtime.saveFrames(folder, [frame, frame], 0);
  assert.throws(() => runtime.saveFrames(folder, [frame], 0), /order/);
});
for (const fps of [30000 / 1001, 31]) test(`ProRes output preserves alpha, dimensions, frame count and ${fps} fps`, async t => {
  const dir = temporary(t), folder = runtime.jobDir(dir, 'caption-codec'), frame = png();
  runtime.saveFrames(folder, Array(4).fill(frame), 0);
  const output = await runtime.encode(folder, fps, 4);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'render.json'), 'utf8'));
  assert.equal(manifest.frames, 4); assert.equal(manifest.alpha, true); assert.equal(manifest.width, 32); assert.equal(manifest.height, 18);
  assert.equal(fs.readdirSync(folder).some(name => name.endsWith('.png')), false);
  const rgba = execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  assert.ok(rgba[3] < 3, 'transparent corner is preserved');
  assert.ok(rgba[(8 * 32 + 16) * 4 + 3] > 250, 'opaque caption area is preserved');
  assert.throws(() => runtime.saveFrames(folder, [frame], 4), /already/);
});
test('a box-sized transparent movie retains offscreen placement metadata and odd source dimensions', async t => {
  const dir = temporary(t), folder = runtime.jobDir(dir, 'caption-paragraph'), frame = png(31, 19);
  const bounds = { x: -12, y: -8, width: 31, height: 19, frameWidth: 720, frameHeight: 1280 };
  runtime.saveFrames(folder, [frame, frame], 0);
  const output = await runtime.encode(folder, 24, 2, undefined, bounds);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'render.json'), 'utf8'));
  assert.equal(manifest.width, 31); assert.equal(manifest.height, 19); assert.deepEqual(manifest.renderBounds, bounds);
  const rgba = execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1']);
  assert.equal(rgba.length, 31 * 19 * 4); assert.ok(rgba[3] < 3); assert.ok(rgba[(8 * 31 + 16) * 4 + 3] > 250);
});
test('paragraph encoding rejects source dimensions that do not match its declared box', async t => {
  const dir = temporary(t), folder = runtime.jobDir(dir, 'caption-wrong-box');
  runtime.saveFrames(folder, [png(32, 18)], 0);
  await assert.rejects(runtime.encode(folder, 24, 1, undefined, { x: -12, y: 0, width: 31, height: 18, frameWidth: 720, frameHeight: 1280 }), /do not match/);
  assert.equal(fs.readdirSync(folder).includes('caption.mov'), false);
});
test('session files round-trip with private permissions', t => {
  const dir = temporary(t), data = { sequenceId: 'sequence-a', captions: [{ text: 'Editable source' }] };
  const file = runtime.save(dir, data); assert.deepEqual(runtime.load(dir), data); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test('read-only polling jobs use private ephemeral storage and tracked cleanup', t => {
  const dir = temporary(t), root = path.join(dir, 'service'), data = { sequenceId: 'sequence', projectPath: '/media/project.prproj', cues: [] };
  const file = runtime.readJob(data, root);
  assert.equal(path.dirname(file), path.join(root, 'jobs'));assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), data);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  runtime.disposeReadJob(file);assert.equal(fs.existsSync(file), false);
  assert.throws(() => runtime.disposeReadJob(path.join(dir, 'unrelated.json')), /Unknown/);
});
test('read-only job storage rejects a symbolic-link root without writing through it', t => {
  const dir = temporary(t), target = path.join(dir, 'elsewhere'), root = path.join(dir, 'service');
  fs.mkdirSync(target);fs.symlinkSync(target, root);
  assert.throws(() => runtime.readJob({ cues:[] }, root), /real private/);assert.deepEqual(fs.readdirSync(target), []);
});
