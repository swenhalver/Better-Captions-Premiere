import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const script = fs.readFileSync(new URL('../scripts/install.cjs', import.meta.url), 'utf8');
const manifestTemplate = fs.readFileSync(new URL('../cep/CSXS/manifest.xml', import.meta.url), 'utf8');
const currentVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
const upia = '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent';
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
function service(folder, version, legacy = false) {
  write(path.join(folder, 'CSXS/manifest.xml'), manifestTemplate.replace(/(ExtensionBundleVersion|Version)="\d+\.\d+\.\d+"/g, (_, key) => `${key}="${version}"`));
  write(path.join(folder, 'host/bridge.jsx'), 'var BetterCaptionsHost = (function () { return {}; })();\n');
  write(path.join(folder, 'runtime.cjs'), "module.exports = { saveFrames() {}, encode() {} };\n");
  write(path.join(folder, 'service-client/service.html'), '<html><script type="module" src="./assets/service-fixture.js"></script></html>');
  write(path.join(folder, 'service-client/assets/service-fixture.js'), 'const BetterCaptionsHost = {}; const beginCaption = true;\n');
  if (!legacy) write(path.join(folder, 'platform.cjs'), "module.exports = {};\n");
}
function snapshot(folder) {
  return fs.readdirSync(folder, { recursive: true }).sort().map(name => {
    const file = path.join(folder, name), stat = fs.lstatSync(file);
    return [name, stat.isSymbolicLink() ? 'link:' + fs.readlinkSync(file) : stat.isDirectory() ? 'directory' : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
  });
}
function fixture(t, hooks = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-installer-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'new-package'), home = path.join(temporary, 'home');
  const source = path.join(root, 'cep'), old = path.join(temporary, 'permanent-old-source', 'cep');
  const extensions = path.join(home, 'Library/Application Support/Adobe/CEP/extensions');
  const destination = path.join(extensions, 'ca.swen.bettercaptions');
  const privateRoot = path.join(home, 'Library/Application Support/Better Captions');
  service(source, currentVersion); service(old, '0.3.1', true);
  write(path.join(root, 'dist', `Better-Captions-Swen-${currentVersion}.ccx`), 'fixture-ccx');
  fs.mkdirSync(extensions, { recursive: true });
  const calls = [], messages = [];
  const filesystem = { ...fs,
    existsSync: file => file === upia || fs.existsSync(file),
    renameSync: (from, to) => hooks.rename ? hooks.rename(from, to, fs) : fs.renameSync(from, to),
    cpSync: (from, to, options) => hooks.copy ? hooks.copy(from, to, options, fs) : fs.cpSync(from, to, options)
  };
  const platform = {
    dataRoot: () => privateRoot,
    secureDirectory: folder => { assert.ok(folder.startsWith(privateRoot)); fs.mkdirSync(folder, { recursive: true, mode: 0o700 }); assert.ok(!fs.lstatSync(folder).isSymbolicLink()); fs.chmodSync(folder, 0o700); return folder; },
    resolveTool: name => { if (hooks.dependencyError) throw new Error('Missing fixture dependency'); return path.join(temporary, 'bin', name); }
  };
  const sandbox = {
    module: { exports: {} }, __dirname: path.join(root, 'scripts'),
    process: { platform: 'darwin', env: {}, argv: [], getuid: typeof process.getuid === 'function' ? () => process.getuid() : undefined },
    console: { log: message => messages.push(message) },
    require: name => {
      if (name === 'node:fs') return filesystem;
      if (name === 'node:os') return { homedir: () => home };
      if (name === '../cep/platform.cjs') return platform;
      if (name === 'node:child_process') return { execFileSync: (exe, args, options) => { calls.push({ exe, args: [...args], options }); if (exe === upia) return hooks.upia ? hooks.upia() : 'Installation Successful'; return 'fixture version'; } };
      return require(name);
    }
  };
  vm.runInNewContext(script, sandbox, { filename: 'fixture-install.cjs' });
  return { ...sandbox.module.exports, root, source, old, destination, extensions, privateRoot, calls, messages,
    link(target = old) { fs.symlinkSync(target, destination, 'dir'); },
    registered(version = currentVersion) { write(path.join(home, 'Library/Application Support/Adobe/UXP/Plugins/External/panel/manifest.json'), JSON.stringify({ id: 'ca.swen.bettercaptions', version, host: { app: 'premierepro' } })); },
    backups() { const folder = path.join(privateRoot, 'install-backups'); return fs.existsSync(folder) ? fs.readdirSync(folder).map(name => path.join(folder, name)) : []; },
    stages() { const folder = path.join(privateRoot, 'install-staging'); return fs.existsSync(folder) ? fs.readdirSync(folder).map(name => path.join(folder, name)) : []; }
  };
}
function assertOldLink(f, oldSnapshot) {
  assert.ok(fs.lstatSync(f.destination).isSymbolicLink()); assert.equal(fs.readlinkSync(f.destination), f.old);
  assert.deepEqual(snapshot(f.old), oldSnapshot);
}

test('migrates the legacy source symlink itself, preserving its permanent source and other extensions', t => {
  const f = fixture(t); f.link(); const before = snapshot(f.old);
  write(path.join(f.extensions, 'unrelated-extension/keep.txt'), 'untouched');
  f.install([]);
  assert.ok(fs.lstatSync(f.destination).isDirectory()); assert.ok(!fs.lstatSync(f.destination).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, 'better-captions-install.json'))).version, currentVersion);
  assert.deepEqual(snapshot(f.old), before); assert.equal(fs.readFileSync(path.join(f.extensions, 'unrelated-extension/keep.txt'), 'utf8'), 'untouched');
  assert.equal(f.backups().length, 1); assert.ok(fs.lstatSync(f.backups()[0]).isSymbolicLink()); assert.equal(fs.readlinkSync(f.backups()[0]), f.old);
  // The VM models macOS installation, but mode bits belong to the real host filesystem.
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.dirname(f.backups()[0])).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(f.destination, 'better-captions-install.json')).mode & 0o777, 0o600);
  }
  assert.ok(!f.backups()[0].startsWith(f.extensions)); assert.deepEqual(f.stages(), []);
  assert.equal(f.calls.filter(call => call.exe === upia).length, 1);
  assert.ok(f.calls.every(call => call.options.timeout === 120000 && !call.options.shell));
});

for (const version of ['0.2.0', '0.2.1', '0.2.2', '0.3.0', '0.3.1']) test(`accepts only a recognized complete ${version} legacy service`, t => {
  const f = fixture(t); service(f.old, version, true); f.link(); f.registered(); f.install(['--service-only']);
  assert.equal(f.backups().length, 1); assert.equal(f.calls.filter(call => call.exe === upia).length, 0);
});

for (const [name, change] of [
  ['unknown old version', folder => service(folder, '0.3.2', true)],
  ['incomplete manifest', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</ExtensionManifest>', '')); }],
  ['ambiguous manifest sections', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</ExtensionList>', '</ExtensionList><ExtensionList></ExtensionList>')); }],
  ['mismatched extension version', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Version="0.3.1" />', 'Version="0.2.0" />')); }],
  ['foreign bundle', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('ExtensionBundleId="ca.swen.bettercaptions"', 'ExtensionBundleId="other.publisher"')); }],
  ['foreign service', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('ca.swen.bettercaptions.service', 'other.service')); }],
  ['ambiguous duplicate extension', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('</ExtensionList>', '<Extension Id="ca.swen.bettercaptions.service" Version="0.3.1" /></ExtensionList>')); }],
  ['duplicate identity attribute', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('ExtensionBundleId=', 'ExtensionBundleId="other" ExtensionBundleId=')); }],
  ['foreign resource path', folder => { const file = path.join(folder, 'CSXS/manifest.xml'); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('./host/bridge.jsx', '../somewhere/bridge.jsx')); }],
  ['missing runtime', folder => fs.unlinkSync(path.join(folder, 'runtime.cjs'))],
  ['unrecognized runtime', folder => fs.writeFileSync(path.join(folder, 'runtime.cjs'), 'unrelated code')],
  ['linked runtime', folder => { fs.renameSync(path.join(folder, 'runtime.cjs'), path.join(folder, 'other.cjs')); fs.symlinkSync('other.cjs', path.join(folder, 'runtime.cjs')); }],
  ['missing built script', folder => fs.unlinkSync(path.join(folder, 'service-client/assets/service-fixture.js'))],
  ['script traversal', folder => fs.writeFileSync(path.join(folder, 'service-client/service.html'), '<script src="../../outside.js"></script>')]
]) test(`refuses ${name} without changing the existing link or target`, t => {
  const f = fixture(t); change(f.old); f.link(); const before = snapshot(f.old);
  assert.throws(() => f.install([]), /unrecognized installation.*preserved/i); assertOldLink(f, before);
  assert.equal(f.calls.filter(call => call.exe === upia).length, 0); assert.deepEqual(f.backups(), []);
});

test('refuses a broken symlink unchanged rather than following or deleting it', t => {
  const f = fixture(t), missing = path.join(f.old, 'missing'); f.link(missing);
  assert.throws(() => f.install([]), /unrecognized installation.*preserved/i);
  assert.ok(fs.lstatSync(f.destination).isSymbolicLink()); assert.equal(fs.readlinkSync(f.destination), missing);
  assert.equal(f.calls.filter(call => call.exe === upia).length, 0);
});

test('refuses unmarked folders and a claimed ownership marker with a foreign manifest', t => {
  const f = fixture(t); service(f.destination, currentVersion); const before = snapshot(f.destination);
  assert.throws(() => f.install([]), /preserved/); assert.deepEqual(snapshot(f.destination), before);
  write(path.join(f.destination, 'better-captions-install.json'), JSON.stringify({ id: 'ca.swen.bettercaptions.service', version: currentVersion }));
  fs.writeFileSync(path.join(f.destination, 'CSXS/manifest.xml'), '<foreign />'); const marked = snapshot(f.destination);
  assert.throws(() => f.install([]), /preserved/); assert.deepEqual(snapshot(f.destination), marked);
});

test('keeps a validated link to this exact source in place', t => {
  const f = fixture(t); f.link(f.source); f.install([]);
  assert.ok(fs.lstatSync(f.destination).isSymbolicLink()); assert.equal(fs.readlinkSync(f.destination), f.source);
  assert.deepEqual(f.backups(), []); assert.deepEqual(f.stages(), []);
});

test('dependency failure cannot move the existing service or run Adobe UPIA', t => {
  const f = fixture(t, { dependencyError: true }); f.link(); const before = snapshot(f.old);
  assert.throws(() => f.install([]), /Missing fixture dependency/); assertOldLink(f, before);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.backups(), []);
});

for (const [name, upiaResult] of [['failure', () => { throw new Error('Adobe fixture failed'); }], ['unconfirmed result', () => 'Operation pending']]) test(`UPIA ${name} leaves the legacy installation unchanged and removes only staging`, t => {
  const f = fixture(t, { upia: upiaResult }); f.link(); const before = snapshot(f.old);
  assert.throws(() => f.install([]), /Adobe/); assertOldLink(f, before);
  assert.deepEqual(f.backups(), []); assert.deepEqual(f.stages(), []);
});

test('incomplete staging is rejected before UPIA and leaves the old target unchanged', t => {
  const f = fixture(t, { copy(from, to, options, real) { real.cpSync(from, to, options); if (path.basename(from) === 'runtime.cjs') real.writeFileSync(to, 'incomplete'); } }); f.link(); const before = snapshot(f.old);
  assert.throws(() => f.install([]), /Unrecognized service source/); assertOldLink(f, before);
  assert.equal(f.calls.filter(call => call.exe === upia).length, 0); assert.deepEqual(f.stages(), []);
});

test('service-only upgrade refuses a different registered UXP version without moving the old service', t => {
  const f = fixture(t); f.link(); f.registered('0.3.1'); const before = snapshot(f.old);
  assert.throws(() => f.install(['--service-only']), /registered UXP panel was not found/); assertOldLink(f, before);
  assert.equal(f.calls.filter(call => call.exe === upia).length, 0); assert.deepEqual(f.stages(), []);
});

test('publication failure restores the exact prior symlink and preserves its target', t => {
  const f = fixture(t, { rename(from, to, real) { if (from.includes(`${path.sep}install-staging${path.sep}`)) throw new Error('fixture publication error'); real.renameSync(from, to); } });
  f.link(); const before = snapshot(f.old); assert.throws(() => f.install([]), /previous service was restored/);
  assertOldLink(f, before); assert.deepEqual(f.backups(), []); assert.deepEqual(f.stages(), []);
});

test('a failed rollback retains both backup link and staged copy with actionable recovery paths', t => {
  const f = fixture(t, { rename(from, to, real) { if (from.includes(`${path.sep}install-staging${path.sep}`) || from.includes(`${path.sep}install-backups${path.sep}`)) throw new Error('fixture disk failure'); real.renameSync(from, to); } });
  f.link(); const before = snapshot(f.old);
  assert.throws(() => f.install([]), /automatic recovery could not restore.*Preserve backup.*staged service/);
  assert.equal(f.backups().length, 1); assert.ok(fs.lstatSync(f.backups()[0]).isSymbolicLink()); assert.equal(fs.readlinkSync(f.backups()[0]), f.old);
  assert.equal(f.stages().length, 1); assert.deepEqual(snapshot(f.old), before);
});

test('an installation replaced while Adobe runs is preserved rather than overwritten', t => {
  let f; f = fixture(t, { upia() { fs.unlinkSync(f.destination); write(path.join(f.destination, 'foreign.txt'), 'new external occupant'); return 'Installation Successful'; } });
  f.link(); assert.throws(() => f.install([]), /preserved/);
  assert.equal(fs.readFileSync(path.join(f.destination, 'foreign.txt'), 'utf8'), 'new external occupant');
  assert.deepEqual(f.backups(), []); assert.deepEqual(f.stages(), []);
});

test('fresh and repeated owned installations publish validated copies with recoverable backups', t => {
  const f = fixture(t); f.registered(); f.install(['--service-only']);
  const first = snapshot(f.destination); assert.deepEqual(f.backups(), []);
  f.install(['--service-only']); assert.equal(f.backups().length, 1); assert.deepEqual(snapshot(f.backups()[0]), first);
  assert.deepEqual(snapshot(f.destination), first); assert.deepEqual(f.stages(), []);
});
