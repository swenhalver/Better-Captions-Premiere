import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { writeZip } = require('../scripts/zip.cjs');
const { installedPanel } = require('../scripts/install.cjs');

test('both Adobe manifests and the package advertise the same upgrade version', () => {
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
  assert.equal(JSON.parse(fs.readFileSync(new URL('../uxp/manifest.json', import.meta.url))).version, version);
  assert.equal(/ExtensionBundleVersion="([\d.]+)"/.exec(fs.readFileSync(new URL('../cep/CSXS/manifest.xml', import.meta.url), 'utf8'))[1], version);
});

test('service-only installation requires the matching registered Premiere UXP version', t => {
  const plugins = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-installed-')); t.after(() => fs.rmSync(plugins, { recursive: true, force: true }));
  const folder = path.join(plugins, 'panel'); fs.mkdirSync(folder);
  for(const manifest of [{id:'other',version:'0.4.0',host:{app:'premierepro'}},{id:'ca.swen.bettercaptions',version:'0.3.1',host:{app:'premierepro'}},{id:'ca.swen.bettercaptions',version:'0.4.0',host:{app:'PS'}}]) { fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest)); assert.equal(installedPanel(plugins,'0.4.0'),false); }
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({id:'ca.swen.bettercaptions',version:'0.4.0',host:{app:'premierepro'}}));assert.equal(installedPanel(plugins,'0.4.0'),true);
});

test('portable plugin archives retain UTF-8 names, binary contents and executable Mac wrappers', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-zip-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Café')); fs.writeFileSync(path.join(root, 'Café', 'panel.txt'), 'Editable caption ✓'); fs.writeFileSync(path.join(root, 'install.sh'), '#!/bin/zsh\n');
  const archive = path.join(root, 'plugin.ccx'); writeZip(archive, root, ['Café', 'install.sh']);
  const bytes = fs.readFileSync(archive), end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50); assert.equal(bytes.readUInt16LE(end + 10), 2);
  let position = bytes.readUInt32LE(end + 16); const files = new Map();
  for (let i = 0; i < 2; i++) {
    assert.equal(bytes.readUInt32LE(position), 0x02014b50); assert.equal(bytes.readUInt16LE(position + 8), 0x800);
    const size = bytes.readUInt32LE(position + 20), nameLength = bytes.readUInt16LE(position + 28), name = bytes.toString('utf8', position + 46, position + 46 + nameLength), local = bytes.readUInt32LE(position + 42);
    const payload = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, zlib.inflateRawSync(bytes.subarray(payload, payload + size)).toString());
    if (name.endsWith('.sh')) assert.equal((bytes.readUInt32LE(position + 38) >>> 16) & 0o777, 0o755);
    position += 46 + nameLength + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32);
  }
  assert.equal(files.get('Café/panel.txt'), 'Editable caption ✓'); assert.equal(files.get('install.sh'), '#!/bin/zsh\n');
});
