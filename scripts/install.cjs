#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
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
function install(args = process.argv.slice(2)) {
  if (args.some(arg => arg !== '--service-only') || args.length > 1) throw new Error('Usage: node scripts/install.cjs [--service-only]');
  if (!windows && process.platform !== 'darwin') throw new Error('Premiere installation supports Windows and macOS.');
  const uxpVersion = /ExtensionBundleVersion="([\d.]+)"/.exec(fs.readFileSync(path.join(root, 'cep', 'CSXS', 'manifest.xml'), 'utf8'))?.[1];
  if (!uxpVersion) throw new Error('Invalid Better Captions service manifest.');
  const ccx = path.join(root, 'dist', `Better-Captions-Swen-${uxpVersion}.ccx`);
  const source = path.join(root, 'cep');
  if (!fs.existsSync(ccx) || !fs.existsSync(path.join(source, 'service-client', 'service.html'))) throw new Error('Run npm run package before installation.');
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
  let linkedSource = false;
  if (fs.existsSync(destination) || (() => { try { return fs.lstatSync(destination).isSymbolicLink(); } catch { return false; } })()) {
    linkedSource = fs.lstatSync(destination).isSymbolicLink() && fs.realpathSync(destination) === fs.realpathSync(source);
    if (!linkedSource) {
      let installed; try { installed = JSON.parse(fs.readFileSync(path.join(destination, 'better-captions-install.json'), 'utf8')); } catch {}
      if (installed?.id !== 'ca.swen.bettercaptions.service' || fs.lstatSync(destination).isSymbolicLink()) throw new Error('Another installation occupies ' + destination + '. It was preserved.');
    }
  }
  const privateRoot = platform.dataRoot();
  for (const dir of ['', 'agent', 'agent/instances', 'agent/requests', 'agent/responses', 'service', 'service/requests', 'service/responses']) platform.secureDirectory(path.join(privateRoot, dir));
  if (args.includes('--service-only')) {
    const plugins = path.join(path.dirname(extensions), '..', 'UXP', 'Plugins', 'External');
    if (!installedPanel(plugins, uxpVersion)) throw new Error('Install this version of the CCX through Creative Cloud first. Its registered UXP panel was not found.');
  } else {
    const result = run(upia, [windows ? '/install' : '--install', ccx]);
    console.log(result.trim());
    if (!/Installation Successful/i.test(result)) throw new Error('Adobe did not confirm installation. Open Creative Cloud Desktop and retry. Alternatively open ' + ccx + ' in Creative Cloud, complete its installation, then run node scripts/install.cjs --service-only.');
  }
  if (!linkedSource) {
    fs.mkdirSync(extensions, { recursive: true });
    const staging = fs.mkdtempSync(path.join(extensions, '.better-captions-'));
    for (const name of ['CSXS', 'host', 'runtime.cjs', 'platform.cjs', 'service-client']) fs.cpSync(path.join(source, name), path.join(staging, name), { recursive: true });
    fs.writeFileSync(path.join(staging, 'better-captions-install.json'), JSON.stringify({ id: 'ca.swen.bettercaptions.service', version: uxpVersion }));
    // Preserve the previous owned service for recovery; never remove another extension.
    if (fs.existsSync(destination)) {
      const backups = platform.secureDirectory(path.join(privateRoot, 'install-backups'));
      fs.renameSync(destination, path.join(backups, 'service-' + Date.now()));
    }
    fs.renameSync(staging, destination);
  }
  if (windows) run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['add', 'HKCU\\Software\\Adobe\\CSXS.12', '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f']);
  else run('/usr/bin/defaults', ['write', 'com.adobe.CSXS.12', 'PlayerDebugMode', '-string', '1']);
  console.log('Installed Better Captions: ' + destination);
  console.log('Save your work and restart Premiere once. Open Window > UXP Plugins > Better Captions; the render service stays invisible.');
}
if (require.main === module) { try { install(); } catch (error) { console.error(error.message); if (error.stdout) console.error(String(error.stdout)); if (error.stderr) console.error(String(error.stderr)); process.exitCode = 1; } }
module.exports = { install, installedPanel };
