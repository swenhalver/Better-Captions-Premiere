import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), paths = require('../uxp/paths.js');

test('UXP accepts local Mac/Windows paths and rejects traversal, relative, device and UNC paths', () => {
  assert.equal(paths.localPath('C:\\Project Data\\Café #1\\edit.prproj'), 'C:/Project Data/Café #1/edit.prproj');
  assert.equal(paths.fileUrl('D:\\Project Data'), 'file:/D:/Project Data');
  assert.equal(paths.fileUrl('/Users/editor/Project Data'), 'file:/Users/editor/Project Data');
  assert.equal(paths.parentPath('C:/edit.prproj'), 'C:/'); assert.equal(paths.parentPath('C:/'), null);
  for (const value of ['C:edit.prproj', '\\\\server\\share', '//server/share', '\\\\?\\C:\\edit', 'C:/a/../b', '/a/./b', 'C:/trailing./edit', 'relative', 'file:/C:/edit', '/bad\0path']) assert.throws(() => paths.localPath(value));
});

test('UXP discovers the same platform private root as the background worker', () => {
  assert.equal(paths.privateBase('C:\\Users\\Éditeur\\AppData\\Roaming\\Adobe\\UXP\\PluginsStorage\\PPRO\\data'), 'C:/Users/Éditeur/AppData/Roaming/Better Captions');
  assert.equal(paths.privateBase('/Users/editor/Library/Application Support/Adobe/UXP/PluginsStorage/data'), '/Users/editor/Library/Application Support/Better Captions');
  assert.throws(() => paths.privateBase('C:/unrecognized/data'), /Cannot locate/);
});

for (const drive of ['C:/', '/']) test(`UXP creates missing nested folders from ${drive} without treating a drive as a folder`, async () => {
  const entries = new Map(), urls = [];
  function folder(name) {
    const value = { nativePath: name, isFolder: true, async createFolder(child) { assert.ok(child && !/[\\/]/.test(child)); return folder(name.replace(/\/$/, '') + '/' + child); } };
    entries.set(name, value); return value;
  }
  folder(drive);
  const filesystem = { async getEntryWithUrl(url) { urls.push(url); const entry = entries.get(url.replace(/^file:\/(?!\/)(?=[a-z]:)/i, '').replace(/^file:/, '')); if (!entry) throw new Error('Missing'); return entry; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../uxp/storage.js', import.meta.url), 'utf8'), { module, crypto, require: name => name === './paths.js' ? paths : { storage: { localFileSystem: filesystem } } });
  const expected = drive + 'Project Data/Café/Better Captions';
  assert.equal((await module.exports.ensureFolder(expected)).nativePath, expected);
  assert.ok(urls.every(url => url.startsWith(drive === '/' ? 'file:/' : 'file:/C:/')));
});
