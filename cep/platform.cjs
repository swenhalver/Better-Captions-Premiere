'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const secured = new Set();
function dataRoot({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming');
    if (!/^[a-z]:[\\/]/i.test(roaming)) throw new Error('A local Windows AppData folder is required.');
    return path.win32.join(roaming, 'Better Captions');
  }
  return path.posix.join(home, 'Library', 'Application Support', 'Better Captions');
}
function systemPowerShell() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
function powerShellEnv() {
  // A parent PowerShell 7 session can otherwise pass incompatible module paths to Windows PowerShell.
  return { ...process.env, PSModulePath: path.join(path.dirname(systemPowerShell()), 'Modules') };
}
function secureDirectory(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw new Error('The caption service folder must be a real private directory owned by you.');
  if (process.platform !== 'win32') fs.chmodSync(folder, 0o700);
  else if (!secured.has(folder)) {
    // Create a fresh protected DACL: chmod cannot protect Windows files.
    // The path is data in the child environment, never interpolated into code.
    const script = "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); foreach($principal in @($sid.Value,'S-1-5-18','S-1-5-32-544')) { $rule=New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.SecurityIdentifier]::new($principal),'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; [System.IO.Directory]::SetAccessControl($env:BETTER_CAPTIONS_PRIVATE_DIRECTORY,$acl)";
    execFileSync(systemPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...powerShellEnv(), BETTER_CAPTIONS_PRIVATE_DIRECTORY: folder }, windowsHide: true, timeout: 15000, stdio: 'pipe' });
    secured.add(folder);
  }
  return folder;
}
function resolveTool(name, { platform = process.platform, env = process.env, exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } } } = {}) {
  if (!['ffmpeg', 'ffprobe', 'fc-list'].includes(name)) throw new Error('Unknown caption dependency.');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executable = name + (platform === 'win32' ? '.exe' : '');
  const override = env['BETTER_CAPTIONS_' + name.replace('-', '_').toUpperCase()];
  const valid = file => paths.isAbsolute(file) && (platform !== 'win32' || /^[a-z]:[\\/].*\.exe$/i.test(file));
  if (override) {
    if (!valid(override) || !exists(override)) throw new Error('Invalid local executable for ' + name + '.');
    return override;
  }
  const directories = platform === 'win32'
    ? [paths.join(env.LOCALAPPDATA || paths.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'), paths.join(env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin')]
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  directories.push(...(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').map(dir => dir.replace(/^"|"$/g, '')).filter(dir => paths.isAbsolute(dir)));
  for (const dir of [...new Set(directories)]) { const candidate = paths.join(dir, executable); if (valid(candidate) && exists(candidate)) return candidate; }
  throw new Error('Install local ' + name + ' and add its folder to PATH, then restart Premiere. You can also set BETTER_CAPTIONS_' + name.replace('-', '_').toUpperCase() + ' to its absolute executable path.');
}
module.exports = { dataRoot, secureDirectory, resolveTool, systemPowerShell, powerShellEnv };
