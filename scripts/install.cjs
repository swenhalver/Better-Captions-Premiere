#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const platform = require('../cep/platform.cjs');
const root = path.resolve(__dirname, '..'), windows = process.platform === 'win32';
function run(exe, args) { return execFileSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); }
function installedPanel(plugins, version) {
  if (!fs.existsSync(plugins)) return false;
  return fs.readdirSync(plugins).some(name => {
    try {
      const folder = path.join(plugins, name), stat = fs.lstatSync(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
      return manifest.id === 'ca.swen.bettercaptions' && manifest.version === version && manifest.host?.app === 'premierepro';
    } catch { return false; }
  });
}
const legacyVersions = new Set(['0.2.0', '0.2.1', '0.2.2', '0.3.0', '0.3.1']);
const serviceFiles = ['CSXS', 'host', 'runtime.cjs', 'platform.cjs', 'service-client'];
function statIfPresent(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function owned(stat) { return typeof process.getuid !== 'function' || stat.uid === process.getuid(); }
function readRegular(folder, relative, maxBytes = 4 * 1024 * 1024) {
  const parts = relative.split('/'); let file = folder;
  for (let i = 0; i < parts.length; i++) {
    file = path.join(file, parts[i]); const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !owned(stat) || (i === parts.length - 1 ? !stat.isFile() || stat.size > maxBytes : !stat.isDirectory())) throw new Error('Unrecognized service file: ' + relative);
  }
  return fs.readFileSync(file, 'utf8');
}
function attributes(text) {
  const result = {}; let remainder = text;
  for (const match of text.matchAll(/([A-Za-z][\w:-]*)\s*=\s*(["'])([^<>]*?)\2/g)) {
    if (Object.hasOwn(result, match[1]) || /&/.test(match[3])) throw new Error('Ambiguous service manifest.');
    result[match[1]] = match[3]; remainder = remainder.replace(match[0], '');
  }
  if (!/^\s*\/?\s*$/.test(remainder)) throw new Error('Invalid service manifest attributes.');
  return result;
}
function serviceVersion(folder, legacy = false) {
  const folderStat = fs.lstatSync(folder);
  if (!folderStat.isDirectory() || folderStat.isSymbolicLink() || !owned(folderStat)) throw new Error('The service source must be an owned directory.');
  let xml = readRegular(folder, 'CSXS/manifest.xml', 65536);
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) throw new Error('Unrecognized service manifest declarations.');
  xml = xml.replace(/<!--[\s\S]*?-->/g, '');
  const document = xml.replace(/^\s*<\?xml[^?]*\?>/, '').trim();
  if (!/^<ExtensionManifest\b[^>]*>[\s\S]*<\/ExtensionManifest>$/.test(document) || (document.match(/<\/ExtensionManifest>/g) || []).length !== 1) throw new Error('Incomplete service manifest.');
  for (const name of ['ExtensionList', 'DispatchInfoList', 'DispatchInfo', 'Resources', 'UI']) {
    if ((document.match(new RegExp('<' + name + '\\s*>', 'g')) || []).length !== 1 || (document.match(new RegExp('</' + name + '>', 'g')) || []).length !== 1) throw new Error('Ambiguous service manifest section: ' + name);
  }
  const roots = [...xml.matchAll(/<ExtensionManifest\b([^>]*)>/g)];
  const extensions = [...xml.matchAll(/<Extension\b([^>]*)>/g)].map(match => attributes(match[1]));
  if (roots.length !== 1 || extensions.length !== 2) throw new Error('Ambiguous service manifest.');
  const rootAttrs = attributes(roots[0][1]), version = rootAttrs.ExtensionBundleVersion;
  if (rootAttrs.ExtensionBundleId !== 'ca.swen.bettercaptions' || !/^\d+\.\d+\.\d+$/.test(version || '') || legacy && !legacyVersions.has(version) || extensions.some(ext => ext.Id !== 'ca.swen.bettercaptions.service') || extensions.filter(ext => ext.Version === version).length !== 1 || extensions.some(ext => ext.Version !== undefined && ext.Version !== version)) throw new Error('Unrecognized Better Captions service identity or version.');
  const one = (name, value) => { const values = [...xml.matchAll(new RegExp('<' + name + '\\b[^>]*>([^<]*)</' + name + '>', 'g'))]; if (values.length !== 1 || values[0][1].trim() !== value) throw new Error('Unrecognized service resource: ' + name); };
  one('MainPath', './service-client/service.html'); one('ScriptPath', './host/bridge.jsx'); one('Type', 'Custom'); one('AutoVisible', 'false');
  const hosts = [...xml.matchAll(/<Host\b([^>]*)>/g)].map(match => attributes(match[1]));
  if (hosts.length !== 1 || hosts[0].Name !== 'PPRO') throw new Error('Unrecognized service host.');
  const bridge = readRegular(folder, 'host/bridge.jsx'), runtime = readRegular(folder, 'runtime.cjs');
  if (!/\bvar BetterCaptionsHost\s*=/.test(bridge) || !/\bmodule\.exports\s*=/.test(runtime) || !/\bsaveFrames\b/.test(runtime) || !/\bencode\b/.test(runtime)) throw new Error('Unrecognized service source files.');
  const html = readRegular(folder, 'service-client/service.html', 65536), scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/g)];
  if (scripts.length !== 1 || !/^\.\/assets\/service-[A-Za-z0-9_-]+\.js$/.test(scripts[0][2])) throw new Error('Unrecognized built service module.');
  const bundle = readRegular(folder, 'service-client/' + scripts[0][2].slice(2));
  if (!bundle.includes('BetterCaptionsHost') || !bundle.includes('beginCaption')) throw new Error('Unrecognized built service contents.');
  if (!legacy) readRegular(folder, 'platform.cjs');
  return version;
}
function existingService(destination, source) {
  const stat = statIfPresent(destination);
  if (!stat) return { kind: 'missing' };
  const reject = () => { throw new Error('Another or unrecognized installation occupies ' + destination + '. It was preserved.'); };
  if (!owned(stat)) return reject();
  let kind;
  if (stat.isSymbolicLink()) {
    let target; try { target = fs.realpathSync(destination); } catch { return reject(); }
    if (target === fs.realpathSync(source)) kind = 'source-link';
    else { try { serviceVersion(target, true); } catch { return reject(); } kind = 'legacy-link'; }
  } else if (stat.isDirectory()) {
    try {
      const installed = JSON.parse(readRegular(destination, 'better-captions-install.json', 4096));
      if (installed.id !== 'ca.swen.bettercaptions.service' || installed.version !== serviceVersion(destination)) return reject();
    } catch { return reject(); }
    kind = 'owned-directory';
  } else return reject();
  return { kind, dev: stat.dev, ino: stat.ino, link: stat.isSymbolicLink() ? fs.readlinkSync(destination) : undefined };
}
function publishService(staging, destination, source, previous, privateRoot) {
  if (JSON.stringify(existingService(destination, source)) !== JSON.stringify(previous)) throw new Error('The installed service changed during installation. It was preserved.');
  let backup;
  if (previous.kind !== 'missing') {
    const backups = platform.secureDirectory(path.join(privateRoot, 'install-backups'));
    backup = path.join(backups, 'service-' + Date.now() + '-' + randomBytes(8).toString('hex'));
    // Rename the link itself; its permanent legacy source must never be changed.
    fs.renameSync(destination, backup);
  }
  try { fs.renameSync(staging, destination); }
  catch (error) {
    if (backup) {
      try {
        if (statIfPresent(destination)) throw new Error('The destination is occupied.');
        fs.renameSync(backup, destination);
      } catch (recovery) {
        const failure = new Error('Service installation failed and automatic recovery could not restore ' + destination + '. Preserve backup ' + backup + ' and staged service ' + staging + '. ' + recovery.message);
        failure.preserveStaging = true; throw failure;
      }
    }
    throw new Error('Service installation failed' + (backup ? '; the previous service was restored' : '') + '. ' + error.message);
  }
  return backup;
}
function install(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--service-only') || args.length > 1) throw new Error('Usage: node scripts/install.cjs [--service-only]');
  if (!windows && process.platform !== 'darwin') throw new Error('Premiere installation supports Windows and macOS.');
  const uxpVersion = /ExtensionBundleVersion="([\d.]+)"/.exec(fs.readFileSync(path.join(root, 'cep', 'CSXS', 'manifest.xml'), 'utf8'))?.[1];
  if (!uxpVersion) throw new Error('Invalid Better Captions service manifest.');
  const ccx = path.join(root, 'dist', `Better-Captions-Swen-${uxpVersion}.ccx`);
  const source = path.join(root, 'cep');
  if (!fs.existsSync(ccx) || !fs.existsSync(path.join(source, 'service-client', 'service.html'))) throw new Error('Run npm run package before installation.');
  if (serviceVersion(source) !== uxpVersion) throw new Error('Invalid Better Captions service version.');
  const upia = windows
    ? path.join(process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files', 'Adobe', 'Adobe Desktop Common', 'RemoteComponents', 'UPI', 'UnifiedPluginInstallerAgent', 'UnifiedPluginInstallerAgent.exe')
    : '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent';
  if (!args.includes('--service-only') && !fs.existsSync(upia)) throw new Error('Install Adobe Creative Cloud Desktop first (its UPIA installer is required).');
  // Resolve and exercise dependencies before changing an Adobe installation.
  for (const name of ['ffmpeg', 'ffprobe', ...(!windows ? ['fc-list'] : [])]) {
    const exe = platform.resolveTool(name); run(exe, [name === 'fc-list' ? '--version' : '-version']); console.log(name + ': ' + exe);
  }
  const extensions = windows ? path.join(process.env.APPDATA, 'Adobe', 'CEP', 'extensions') : path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions');
  const destination = path.join(extensions, 'ca.swen.bettercaptions');
  const previous = existingService(destination, source);
  const privateRoot = platform.dataRoot();
  for (const dir of ['', 'agent', 'agent/instances', 'agent/requests', 'agent/responses', 'service', 'service/requests', 'service/responses']) platform.secureDirectory(path.join(privateRoot, dir));
  if (args.includes('--service-only')) {
    const plugins = path.join(path.dirname(extensions), '..', 'UXP', 'Plugins', 'External');
    if (!installedPanel(plugins, uxpVersion)) throw new Error('Install this version of the CCX through Creative Cloud first. Its registered UXP panel was not found.');
  }
  let staging;
  try {
    if (previous.kind !== 'source-link') {
      const stageRoot = platform.secureDirectory(path.join(privateRoot, 'install-staging'));
      staging = fs.mkdtempSync(path.join(stageRoot, 'service-'));
      for (const name of serviceFiles) fs.cpSync(path.join(source, name), path.join(staging, name), { recursive: true });
      if (serviceVersion(staging) !== uxpVersion) throw new Error('The staged service version changed.');
      fs.writeFileSync(path.join(staging, 'better-captions-install.json'), JSON.stringify({ id: 'ca.swen.bettercaptions.service', version: uxpVersion }), { mode: 0o600 });
    }
    if (!args.includes('--service-only')) {
      // Premiere's UXP plugin manager keeps the first registration of a plugin id and
      // ignores the rest, so stale older versions win over the one just installed.
      // Remove every existing S-Captions registration before installing this one.
      for (let attempt = 0; attempt < 12; attempt++) {
        const listed = run(upia, [windows ? '/list' : '--list', 'all']);
        if (!/^\s*Enabled\s+S-Captions\s+\d/m.test(listed) && !/^\s*Disabled\s+S-Captions\s+\d/m.test(listed)) break;
        const removed = run(upia, [windows ? '/remove' : '--remove', 'S-Captions']);
        console.log(removed.trim());
        if (!/Removal Successful|Removed/i.test(removed)) throw new Error('Adobe could not remove the previous S-Captions registration. Quit Premiere and retry.');
      }
      const result = run(upia, [windows ? '/install' : '--install', ccx]);
      console.log(result.trim());
      if (!/Installation Successful/i.test(result)) throw new Error('Adobe did not confirm installation. Open Creative Cloud Desktop and retry. Alternatively open ' + ccx + ' in Creative Cloud, complete its installation, then run node scripts/install.cjs --service-only.');
    }
    if (staging) {
      fs.mkdirSync(extensions, { recursive: true });
      const backup = publishService(staging, destination, source, previous, privateRoot); staging = undefined;
      if (backup) console.log('Previous service preserved: ' + backup);
    }
  } catch (error) {
    if (staging && !error.preserveStaging) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch {} }
    throw error;
  }
  if (windows) run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['add', 'HKCU\\Software\\Adobe\\CSXS.12', '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
  else run('/usr/bin/defaults', ['write', 'com.adobe.CSXS.12', 'PlayerDebugMode', '-string', '1']);
  console.log('Installed S-Captions: ' + destination);
  console.log('Save your work and restart Premiere once. Open Window > UXP Plugins > S-Captions; the render service stays invisible.');
}
if (require.main === module) { try { install(); } catch (error) { console.error(error.message); if (error.stdout) console.error(String(error.stdout)); if (error.stderr) console.error(String(error.stderr)); process.exitCode = 1; } }
module.exports = { install, installedPanel, serviceVersion, existingService };
