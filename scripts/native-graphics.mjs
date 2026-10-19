#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const HELP = `Better Captions native Premiere graphics prototype

Usage:
  node scripts/native-graphics.mjs --session <JSON-file> --output <new-directory>

Requires Node.js 22.18 or later with built-in TypeScript support (Node.js 24+ recommended).
Input: one saved SessionState or NativeGraphicsPlanInput JSON object, at most 8 MiB.
The output directory must not exist, and its parent directory must already exist.

Creates graphics.xml, manifest.json, source-plan.srt and README.txt.
The XML writer records its capabilities and limitations in manifest.json. SRT
carries plain phrase text and timing only; it does not apply rich word styles.
This command does not launch Premiere, modify the source JSON, or overwrite files.
If writing fails, any incomplete output is preserved at the reported path.
`;

function argumentsFor(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!['--session', '--output'].includes(name)) throw new Error(`Unknown option ${JSON.stringify(name)}. Use --help for usage.`);
    if (Object.hasOwn(values, name)) throw new Error(`Provide ${name} only once.`);
    if (!value || value.startsWith('--')) throw new Error(`${name} needs a path. Use --help for usage.`);
    values[name] = value;
  }
  if (!values['--session'] || !values['--output']) throw new Error('Both --session and --output are required. Use --help for usage.');
  return { session: path.resolve(values['--session']), output: path.resolve(values['--output']) };
}

async function readSession(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('The session path must identify a regular JSON file.');
    if (stat.size > MAX_INPUT_BYTES) throw new Error('Session JSON exceeds the 8 MiB input limit.');
    const chunks = [], buffer = Buffer.alloc(65536); let bytes = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, MAX_INPUT_BYTES - bytes + 1), null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > MAX_INPUT_BYTES) throw new Error('Session JSON exceeds the 8 MiB input limit.');
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { throw new Error('Session JSON must use valid UTF-8 text.'); }
    let parsed;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/u, '')); }
    catch { throw new Error('Session file is not valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Session JSON must contain one saved SessionState or NativeGraphicsPlanInput object.');
    return parsed;
  } finally { await handle.close(); }
}

function planInput(value) {
  if (Object.hasOwn(value, 'sequence')) return value;
  return {
    sequence: { id: value.sequenceId, name: value.sequenceName, frameRate: value.frameRate, frameWidth: value.frameWidth, frameHeight: value.frameHeight },
    captions: value.captions,
    style: value.style,
    ...(value.animation !== undefined ? { animation: value.animation } : {}),
    ...(value.transcriptJson !== undefined ? { transcriptJson: value.transcriptJson } : {}),
  };
}

function readme(input, generationId, count) {
  return `Better Captions native Premiere graphics prototype

This is an interchange prototype for scratch-project testing. A production
Better Captions plugin installation and automatic timeline updates are separate.

Generation: ${generationId}
Source sequence: ${JSON.stringify(input.sequence.name ?? input.sequence.id)}
Planned phrases: ${count}

Files
  graphics.xml     Native graphics interchange produced by the XML writer.
  manifest.json    Source identity, authoring intent, writer capabilities and limits.
  source-plan.srt  Plain-text phrase/timing fallback; no rich styling or native links.
  README.txt       These instructions. Written last when all outputs are complete.

Import graphics.xml into a new scratch Premiere project first. Inspect the native
graphic objects and Effect Controls in the main Program Monitor workflow. Verify
text, timing, appearance, saving/reopening and playback before production use.
Generating these files alone is not native acceptance or proof of editability.

Read manifest.json for which properties the XML writer actually applies. Retained
source styles, animation and geometry describe authoring intent; their presence
does not imply that every property was transferred. The fallback SRT contains
plain phrase text/timing only and does not carry per-word styles or shapes.

Keep the manifest with this output. Reconnection to existing graphics requires
verified native identity/readback; exporting does not replace timeline objects.
The CLI never launches an application or edits the input session file.

To generate another output, use a new directory:
  node scripts/native-graphics.mjs --session <JSON-file> --output <new-directory>
Requires Node.js 22.18 or later with built-in TypeScript support; Node.js 24+ is
recommended. Do not import an incomplete directory left by an I/O failure.
`;
}

let createdOutput;
const written = [];
async function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (args.help) { process.stdout.write(HELP); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 18) throw new Error('Use Node.js 22.18 or later with built-in TypeScript support (Node.js 24+ recommended).');
  const input = planInput(await readSession(args.session));
  const { buildNativeGraphicsPlan } = await import('../webview-ui/src/lib/native-graphics/plan.ts');
  const plan = buildNativeGraphicsPlan(input);
  const { buildNativeGraphicsXml } = await import('../webview-ui/src/lib/native-graphics/xml.ts');
  const generationId = randomUUID(), native = buildNativeGraphicsXml(input, { generationId });
  if (!native || typeof native.xml !== 'string' || !native.xml.trim() || !native.manifest || typeof native.manifest !== 'object' || Array.isArray(native.manifest)) throw new Error('The native graphics writer did not return valid XML and a manifest.');
  // Finish planning and serialization before creating any output. Exclusive
  // directory/file creation closes the existence-check race without clobbering.
  const files = [
    ['graphics.xml', native.xml],
    ['manifest.json', JSON.stringify(native.manifest, null, 2) + '\n'],
    ['source-plan.srt', plan.srt],
    ['README.txt', readme(input, generationId, plan.manifest.phrases.length)],
  ];
  try { await fs.mkdir(args.output, { recursive: false, mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Output already exists; choose a new directory: ${args.output}`);
    if (error.code === 'ENOENT') throw new Error(`The output parent directory must already exist: ${path.dirname(args.output)}`);
    throw error;
  }
  createdOutput = args.output;
  for (const [name, content] of files) {
    await fs.writeFile(path.join(args.output, name), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    written.push(name);
  }
  process.stdout.write(`Created native graphics prototype: ${args.output}\n${plan.manifest.phrases.length} phrases; generation ${generationId}\nRead README.txt and manifest.json before importing graphics.xml.\n`);
}

main().catch(error => {
  process.stderr.write(`Native graphics export failed: ${error.message}\n`);
  if (createdOutput) process.stderr.write(`Incomplete output preserved at: ${createdOutput}\nCompleted files: ${written.join(', ') || 'none'}. Do not import this incomplete output; retry with a new directory.\n`);
  process.exitCode = 1;
});
