#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const { writeZip } = require('./zip.cjs');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'uxp/manifest.json'), 'utf8'));
if (!fs.existsSync(path.join(root, 'cep/client/index.html'))) throw new Error('Run npm run build first.');
fs.mkdirSync(dist, { recursive: true });
const ccx = path.join(dist, `Better-Captions-Swen-${manifest.version}.ccx`);
const zip = path.join(dist, `Better-Captions-Swen-${manifest.version}-Windows-macOS.zip`);
const client=path.join(root,'uxp/client');
fs.rmSync(client,{recursive:true,force:true});
fs.cpSync(path.join(root,'cep/client'),client,{recursive:true});
writeZip(ccx, path.join(root, 'uxp'), ['manifest.json', 'index.html', 'main.js', 'api.js', 'storage.js', 'paths.js', 'transcript.js', 'text-area.js', 'transcript-core.js', 'agent.js', 'client']);
writeZip(zip, root, ['cep/CSXS', 'cep/host', 'cep/runtime.cjs', 'cep/platform.cjs', 'cep/service-client', 'scripts/install-cep.sh', 'scripts/install.cjs', 'scripts/agent.cjs', 'README.md', 'docs/release-0.5.0.md', 'SECURITY-AUDIT.md', 'security/FORK-CHANGES.md', path.relative(root, ccx)]);
console.log(ccx); console.log(zip);
