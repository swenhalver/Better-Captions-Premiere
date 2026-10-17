#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'uxp/manifest.json'), 'utf8'));
if (!fs.existsSync(path.join(root, 'cep/client/index.html'))) throw new Error('Run npm run build first.');
fs.mkdirSync(dist, { recursive: true });
const ccx = path.join(dist, `Better-Captions-Swen-${manifest.version}.ccx`);
const zip = path.join(dist, `Better-Captions-Swen-${manifest.version}-macOS.zip`);
for (const file of [ccx, zip]) if (fs.existsSync(file)) fs.unlinkSync(file);
const client=path.join(root,'uxp/client');
fs.rmSync(client,{recursive:true,force:true});
fs.cpSync(path.join(root,'cep/client'),client,{recursive:true});
execFileSync('/usr/bin/zip', ['-q', '-r', ccx, 'manifest.json', 'index.html', 'main.js', 'api.js', 'storage.js', 'transcript.js', 'transcript-core.js', 'agent.js', 'client'], { cwd: path.join(root, 'uxp') });
execFileSync('/usr/bin/zip', ['-q', '-r', zip, 'cep/CSXS', 'cep/host', 'cep/runtime.cjs', 'cep/service-client', 'scripts/install-cep.sh', 'scripts/agent.cjs', 'README.md', 'SECURITY-AUDIT.md', 'security/FORK-CHANGES.md', path.relative(root, ccx), '-x', '*.DS_Store', 'cep/.debug'], { cwd: root });
console.log(ccx); console.log(zip);
