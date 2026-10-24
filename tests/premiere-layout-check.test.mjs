import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const mac = process.platform === 'darwin';
let scratch, binary;
before(() => {
  if (!mac) return;
  scratch = mkdtempSync(path.join(os.tmpdir(), 'bc-premiere-layout-'));
  binary = path.join(scratch, 'check-layout');
  const build = spawnSync('swiftc', ['-O', path.join(root, 'scripts/check-premiere-layout.swift'), '-o', binary], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
});
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
function check(file, args = []) {
  const result = spawnSync(binary, [path.resolve(root, file), ...args], { encoding: 'utf8' });
  assert.ok(result.stdout, result.stderr);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test('saved full-window reference passes based on actual dock geometry', { skip: !mac }, () => {
  const { status, report } = check('docs/testing/panel-layout-good-full.png');
  assert.equal(status, 0);
  assert.equal(report.pass, true);
  assert.ok(Math.abs(report.measuredRatios.leftPane - 0.31) < 0.01);
  assert.ok(Math.abs(report.measuredRatios.programPane - 0.46) < 0.01);
  assert.ok(Math.abs(report.measuredRatios.rightPane - 0.225) < 0.01);
  assert.ok(report.measuredRatios.topRowHeight > 0.43 && report.measuredRatios.topRowHeight < 0.60);
});
test('actual narrow reference fails even though Premiere and S-Captions are visible', { skip: !mac }, () => {
  const { status, report } = check('docs/testing/panel-layout-bad.png');
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.ok(report.measuredRatios.leftPane < 0.20);
  assert.ok(report.errors.some(e => e.includes('Left pane')));
});

// Dependency-free PNG fixtures exercise the two specific automation hazards:
// a 13% dock, and a correct window pasted into a 2x white CUA canvas. They do
// not depend on UI text or a saved workspace name.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const kind = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, crc]);
}
function fixture(name, { left = 310, row = 310, pad = false } = {}) {
  const width = pad ? 2000 : 1000, height = pad ? 1200 : 600;
  const offsetX = pad ? 10 : 0, offsetY = pad ? 12 : 0;
  const scanlines = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const cx = x - offsetX, cy = y - offsetY;
      if (cx < 0 || cy < 0 || cx >= 1000 || cy >= 600) continue;
      let value = 31;
      if ((cy >= 30 && cy <= row && (Math.abs(cx - left) <= 1 || Math.abs(cx - 775) <= 1)) ||
          (Math.abs(cy - row) <= 1 && cx <= 775)) value = 0;
      const index = y * (width * 3 + 1) + 1 + x * 3;
      scanlines.fill(value, index, index + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const file = path.join(scratch, `${name}.png`);
  writeFileSync(file, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
test('13% left dock and overly tall top row are rejected independently', { skip: !mac }, () => {
  const narrow = check(fixture('narrow', { left: 130 }));
  assert.equal(narrow.status, 1);
  assert.ok(Math.abs(narrow.report.measuredRatios.leftPane - 0.13) < 0.01);
  assert.ok(narrow.report.errors.some(e => e.includes('Left pane')));
  const tall = check(fixture('tall', { row: 430 }));
  assert.equal(tall.status, 1);
  assert.ok(tall.report.errors.some(e => e.includes('Top row')));
});
test('white canvas is excluded and raw dimensions cannot masquerade as window bounds', { skip: !mac }, () => {
  const file = fixture('padded', { pad: true });
  const correct = check(file, ['--window-width', '1000', '--window-height', '600']);
  assert.equal(correct.status, 0);
  assert.deepEqual(correct.report.contentBounds, { x: 10, y: 12, width: 1000, height: 600 });
  assert.deepEqual(correct.report.rawImage, { width: 2000, height: 1200 });
  assert.equal(correct.report.coordinateMapping.verified, true);
  assert.equal(correct.report.coordinateMapping.scope, 'screenshot-content-to-window-bounds-only');
  assert.equal(correct.report.coordinateMapping.inputCoordinatesVerified, false);
  assert.ok(correct.report.coordinateCaveats.some(e => e.includes('actual Computer Use input mapping is independently calibrated')));
  assert.ok(correct.report.coordinateCaveats.some(e => e.includes('white padding')));
  const wrong = check(file, ['--window-width', '2000', '--window-height', '1200']);
  assert.equal(wrong.status, 1);
  assert.equal(wrong.report.coordinateMapping.verified, false);
  assert.ok(wrong.report.errors.some(e => e.includes('coordinate mapping is unsafe')));
  const retina = check(file, ['--window-width', '500', '--window-height', '300', '--pixels-per-point', '2']);
  assert.equal(retina.status, 0);
  assert.equal(retina.report.coordinateMapping.verified, true);
});

for (const file of [
  'artifacts/pretty-default/final-one-minute-after-release.png',
  'artifacts/layout-recurrence/after-panel-reshow.png',
  'artifacts/layout-recurrence/effect-controls.png',
]) {
  test(`real padded capture passes with content bounds: ${file}`, { skip: !mac || !existsSync(path.join(root, file)) }, () => {
    const { status, report } = check(file, ['--window-width', '2560', '--window-height', '1409']);
    assert.equal(status, 0, JSON.stringify(report.errors));
    assert.equal(report.whitePaddingDetected, true);
    assert.deepEqual(report.rawImage, { width: 5120, height: 2818 });
    assert.deepEqual(report.contentBounds, { x: 0, y: 0, width: 2560, height: 1409 });
    assert.ok(Math.abs(report.measuredRatios.leftPane - 0.31) < 0.01);
    assert.equal(report.coordinateMapping.rawToContentWidthRatio, 2);
    assert.equal(report.coordinateMapping.scope, 'screenshot-content-to-window-bounds-only');
    assert.equal(report.coordinateMapping.inputCoordinatesVerified, false);
    assert.ok(report.coordinateCaveats.some(e => e.includes('actual Computer Use input mapping is independently calibrated')));
  });
}

const regrownCapture = 'artifacts/layout-recurrence/after-window-grow.png';
test('actual shrink/grow recurrence fails after the outer window has grown again', {
  skip: !mac || !existsSync(path.join(root, regrownCapture)),
}, () => {
  const { status, report } = check(regrownCapture);
  assert.equal(status, 1);
  assert.equal(report.pass, false);
  assert.ok(report.measuredRatios.leftPane > 0.14 && report.measuredRatios.leftPane < 0.18);
  assert.ok(report.errors.some(e => e.includes('Left pane')));
  assert.equal(report.coordinateMapping.inputCoordinatesVerified, false);
});
