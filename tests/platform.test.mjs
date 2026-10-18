import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url), platform = require('../cep/platform.cjs');

test('the CLI and renderer use the existing Mac root and the Windows roaming root', () => {
  assert.equal(platform.dataRoot({ platform: 'darwin', home: '/Users/editor', env: {} }), '/Users/editor/Library/Application Support/Better Captions');
  assert.equal(platform.dataRoot({ platform: 'win32', home: 'C:\\Users\\Editor', env: { APPDATA: 'D:\\Profile Data\\Roaming' } }), 'D:\\Profile Data\\Roaming\\Better Captions');
  assert.equal(platform.dataRoot({ platform: 'win32', home: 'C:\\Users\\Editor', env: {} }), 'C:\\Users\\Editor\\AppData\\Roaming\\Better Captions');
  assert.throws(() => platform.dataRoot({ platform: 'win32', env: { APPDATA: '\\\\server\\shared' } }), /local Windows/);
});

test('tool discovery supports both Homebrew architectures, WinGet and absolute PATH entries', () => {
  const options = { platform: 'darwin', env: {}, exists: file => file === '/usr/local/bin/ffmpeg' };
  assert.equal(platform.resolveTool('ffmpeg', options), '/usr/local/bin/ffmpeg');
  const env = { LOCALAPPDATA: 'C:\\Users\\Editor\\AppData\\Local', PATH: '.;relative;D:\\Media Tools\\bin' };
  assert.equal(platform.resolveTool('ffprobe', { platform: 'win32', env, exists: file => file === 'D:\\Media Tools\\bin\\ffprobe.exe' }), 'D:\\Media Tools\\bin\\ffprobe.exe');
  assert.equal(platform.resolveTool('ffmpeg', { platform: 'win32', env, exists: file => file.includes('WinGet\\Links\\ffmpeg.exe') }), 'C:\\Users\\Editor\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe');
  for (const executable of ['ffmpeg.exe', 'C:\\tools\\ffmpeg.cmd', '\\\\server\\ffmpeg.exe']) assert.throws(() => platform.resolveTool('ffmpeg', { platform: 'win32', env: { BETTER_CAPTIONS_FFMPEG: executable }, exists: () => true }), /Invalid local executable/);
  assert.throws(() => platform.resolveTool('shell'), /Unknown/);
});

test('Windows private storage has a protected owner/System/Administrators ACL inherited by files', { skip: process.platform !== 'win32' }, t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-acl-')); t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  platform.secureDirectory(folder); fs.writeFileSync(path.join(folder, 'request.json'), '{}');
  const script = "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=[System.IO.Directory]::GetAccessControl($env:BETTER_CAPTIONS_PRIVATE_DIRECTORY); $file=[System.IO.File]::GetAccessControl([System.IO.Path]::Combine($env:BETTER_CAPTIONS_PRIVATE_DIRECTORY,'request.json')); @{owner=$sid;protected=$acl.AreAccessRulesProtected;directory=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value});file=@($file.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object {$_.IdentityReference.Value})} | ConvertTo-Json -Compress";
  const result = JSON.parse(execFileSync(platform.systemPowerShell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env: { ...platform.powerShellEnv(), BETTER_CAPTIONS_PRIVATE_DIRECTORY: folder }, windowsHide: true }));
  assert.equal(result.protected, true);
  const expected = [result.owner, 'S-1-5-18', 'S-1-5-32-544'].sort();
  assert.deepEqual(result.directory.sort(), expected); assert.deepEqual(result.file.sort(), expected);
});

test('Windows font enumeration returns installed families without fontconfig', { skip: process.platform !== 'win32' }, async () => {
  const fonts = await require('../cep/runtime.cjs').fonts();
  assert.ok(fonts.includes('Arial')); assert.ok(fonts.length > 10); assert.ok(fonts.every(font => !/[\r\n\u0000]/.test(font)));
});
