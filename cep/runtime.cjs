'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const platform = require('./platform.cjs');
const jobs = new Map();
const readJobs = new Set();
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** The executable and every argument are separate: no command shell is involved. */
function run(exe, args, { cwd, env, signal, timeout = 60 * 60 * 1000, maxOutputBytes = 4 * 1024 * 1024, strictOutput = false } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let out = '', err = '', settled = false, outputBytes = 0, overflow = false;
    const abort = () => child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(out);
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', b => {
      outputBytes += Buffer.byteLength(b, 'utf8');
      if (strictOutput && outputBytes > maxOutputBytes) { overflow = true; child.kill('SIGTERM'); return; }
      out = (out + b).slice(-maxOutputBytes);
    });
    child.stderr.on('data', b => { err = (err + b).slice(-12000); });
    child.on('error', finish);
    child.on('close', (code, killedBy) => finish(overflow ? new Error('Local process output exceeded its safe size limit.') : code === 0 ? null : new Error(signal?.aborted ? 'Cancelled.' : err.slice(-2000) || `Local process stopped (${code ?? killedBy}).`)));
  });
}

function directory(context) {
  if (!context.projectPath || !path.isAbsolute(context.projectPath)) throw new Error('Save the Premiere project first so caption assets have a permanent home.');
  if (typeof context.id !== 'string' || !context.id) throw new Error('Premiere did not return a sequence identity.');
  const slug = context.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  if (!slug) throw new Error('Invalid sequence identity.');
  const dir = path.join(path.dirname(context.projectPath), 'Better Captions', slug);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return fs.realpathSync(dir);
}

function writeJSON(file, data) {
  const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return file;
}

/** Polling jobs stay outside media projects and exist only while ExtendScript reads them. */
function readJob(data, root = path.join(platform.dataRoot(), 'service')) {
  const folder = path.join(root, 'jobs');
  for (const dir of [path.dirname(root), root, folder]) {
    platform.secureDirectory(dir);
  }
  const file = path.join(folder, 'read-' + crypto.randomBytes(16).toString('hex') + '.json');
  writeJSON(file, data); readJobs.add(file); return file;
}
function disposeReadJob(file) {
  if (!readJobs.has(file)) throw new Error('Unknown caption read job.');
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { readJobs.delete(file); }
}

function save(dir, data) { return writeJSON(path.join(dir, 'captions.better-captions.json'), data); }
function load(dir) {
  const file = path.join(dir, 'captions.better-captions.json');
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('The saved caption session is too large.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function jobDir(dir, name) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(name)) throw new Error('Invalid caption job name.');
  const folder = fs.mkdtempSync(path.join(dir, name + '-'));
  fs.chmodSync(folder, 0o700);
  jobs.set(folder, { next: 0, width: 0, height: 0, complete: false });
  return folder;
}

function captionJob(folder) {
  const job = jobs.get(folder);
  if (!job || fs.realpathSync(folder) !== folder) throw new Error('Unknown caption output folder. Render this caption again.');
  if (job.complete) throw new Error('This caption has already been encoded.');
  return job;
}

function saveFrames(folder, frames, start) {
  const job = captionJob(folder);
  if (!Array.isArray(frames) || !frames.length || frames.length > 32) throw new Error('Caption batches must contain 1–32 frames.');
  if (!Number.isSafeInteger(start) || start !== job.next || start + frames.length > 1000000) throw new Error('Caption frames arrived out of order.');
  const buffers = frames.map(frame => {
    if (typeof frame !== 'string' || frame.length > 12000000 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(frame)) throw new Error('Invalid or oversized PNG caption frame.');
    const buffer = Buffer.from(frame, 'base64');
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('A caption frame is not a PNG.');
    const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    if (width < 1 || width > 8192 || height < 1 || height > 8192 || ![4, 6].includes(buffer[25])) throw new Error('Caption frames must contain transparency and valid dimensions.');
    if (job.width && (width !== job.width || height !== job.height)) throw new Error('Caption frame dimensions changed during rendering.');
    job.width = width; job.height = height;
    return buffer;
  });
  if (buffers.reduce((n, b) => n + b.length, 0) > 24 * 1024 * 1024) throw new Error('The caption frame batch is too large.');
  buffers.forEach((buffer, i) => fs.writeFileSync(path.join(folder, 'frame_' + String(start + i).padStart(6, '0') + '.png'), buffer, { flag: 'wx', mode: 0o600 }));
  job.next += frames.length;
}

function frameRateArgument(fps) {
  if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('Unsupported sequence frame rate.');
  for (const rate of [24000, 30000, 48000, 60000, 120000]) if (Math.abs(fps - rate / 1001) < 0.000001) return `${rate}/1001`;
  return String(fps);
}

async function encode(folder, fps, count, signal, renderBounds) {
  const job = captionJob(folder), rate = frameRateArgument(fps);
  if (!Number.isSafeInteger(count) || count < 1 || count !== job.next) throw new Error('Caption frame count does not match the rendered frames.');
  const ffmpeg = platform.resolveTool('ffmpeg'), ffprobe = platform.resolveTool('ffprobe');
  const output = path.join(folder, 'caption.mov'), partial = path.join(folder, 'caption.partial.mov');
  if (fs.existsSync(output) || fs.existsSync(partial)) throw new Error('Caption output already exists. Render again to a new job folder.');
  let width=job.width,height=job.height,filters=[];
  if(renderBounds){
    const b=renderBounds;
    if(![b.x,b.y,b.width,b.height,b.frameWidth,b.frameHeight].every(Number.isInteger)||b.width<1||b.height<1||b.frameWidth<1||b.frameHeight<1||b.width>b.frameWidth||b.height>b.frameHeight||b.frameWidth>8192||b.frameHeight>8192||Math.abs(b.x)>b.frameWidth||Math.abs(b.y)>b.frameHeight)throw new Error('Invalid caption text-area bounds.');
    width=b.width;height=b.height;
    if(job.width===width&&job.height===height){/* Frames already contain just the paragraph box. */}
    else if(job.width===b.frameWidth&&job.height===b.frameHeight&&b.x>=0&&b.y>=0&&b.x+width<=job.width&&b.y+height<=job.height)filters=['-vf',`crop=${width}:${height}:${b.x}:${b.y}:exact=1`];
    else throw new Error('Caption text-area bounds do not match the rendered frame dimensions.');
  }
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', rate, '-start_number', '0', '-i', 'frame_%06d.png', '-frames:v', String(count), ...filters, '-an', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-threads', '2', 'caption.partial.mov'], { cwd: folder, signal });
  const probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,nb_frames,r_frame_rate', '-of', 'json', partial], { signal }));
  const stream = probe.streams?.[0];
  if (!stream || stream.codec_name !== 'prores' || !/^yuva/.test(stream.pix_fmt) || stream.width !== width || stream.height !== height || Number(stream.nb_frames) !== count) throw new Error('The caption movie failed codec, transparency, dimensions, or frame-count verification.');
  const parts = stream.r_frame_rate.split('/').map(Number);
  if (Math.abs(parts[0] / parts[1] - fps) > 0.00001) throw new Error('The caption movie has the wrong frame rate.');
  fs.renameSync(partial, output);
  writeJSON(path.join(folder, 'render.json'), { width, height, frameRate: fps, frames: count, codec: 'ProRes 4444', alpha: true, renderBounds });
  job.complete = true;
  // PNGs are staging files; only the verified movie and small manifest are retained.
  for (let i = 0; i < count; i++) fs.unlinkSync(path.join(folder, 'frame_' + String(i).padStart(6, '0') + '.png'));
  return output;
}

const FONT_CATALOG_BYTES = 4 * 1024 * 1024, FONT_CATALOG_ROWS = 100000, FONT_CATALOG_FAMILIES = 20000;
// Enumerate aliases individually: a comma can also be part of a family name.
// https://github.com/fontconfig/fontconfig/blob/main/doc/fcformat.fncs
const FONTCONFIG_FORMAT = '%{weight}\t%{slant}\t%{variable}\t[%{[]family{"%{family|cescape}",}}]\n';
// Values from fontconfig.h, converted by the documented piecewise interpolation
// of FcWeightToOpenTypeDouble. Book and semilight deliberately remain 380/350.
// https://www.freedesktop.org/software/fontconfig/fontconfig-devel/fcweighttoopentypedouble.html
const FC_WEIGHT_POINTS = [[0,100],[40,200],[50,300],[55,350],[75,380],[80,400],[100,500],[180,600],[200,700],[205,800],[210,900],[215,1000]];
function cssWeightFromFontconfig(weight) {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 215) throw new Error('Fontconfig returned an invalid font weight.');
  for (let index = 0; index < FC_WEIGHT_POINTS.length; index++) {
    const [fc, css] = FC_WEIGHT_POINTS[index];
    if (weight === fc) return css;
    if (weight < fc) {
      const [previousFC, previousCSS] = FC_WEIGHT_POINTS[index - 1];
      return Math.round((previousCSS + (weight - previousFC) * (css - previousCSS) / (fc - previousFC)) * 1000) / 1000;
    }
  }
  throw new Error('Fontconfig returned an unsupported font weight.');
}
function fontText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > FONT_CATALOG_BYTES || !text.trim()) throw new Error('The installed font catalog is empty or exceeds its safe size limit.');
  return text.replace(/^\uFEFF/, '');
}
function fontValues(text, maximum) {
  const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?', scalar = new RegExp('^' + number + '$'), range = new RegExp('^\\[\\s*(' + number + ')\\s+(' + number + ')\\s*\\]$');
  const values = text.split(',');
  if (values.length > 64) throw new Error('The installed font metadata contains too many values.');
  return values.map(value => {
    value = value.trim(); const match = range.exec(value);
    let min, max;
    if (match) { min = Number(match[1]); max = Number(match[2]); }
    else if (scalar.test(value)) min = max = Number(value);
    else throw new Error('The installed font metadata is malformed.');
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > maximum) throw new Error('The installed font metadata is out of range.');
    return { min, max, range: !!match };
  });
}
function fontCatalogBuilder() {
  const families = new Map();
  function add(names, weights, italic, ranges = []) {
    if (!Array.isArray(names) || !names.length || names.length > 256 || typeof italic !== 'boolean') throw new Error('The installed font family metadata is malformed.');
    for (let name of names) {
      if (typeof name !== 'string' || !name.trim() || name.length > 4096 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('The installed font family name is invalid.');
      name = name.trim(); const id = name.normalize('NFC').toLocaleLowerCase();
      let entry = families.get(id);
      if (!entry) {
        if (families.size >= FONT_CATALOG_FAMILIES) throw new Error('The installed font catalog contains too many families.');
        entry = { family:name, weights:new Set(), italic:false, ranges:[] }; families.set(id, entry);
      } else if (name < entry.family) entry.family = name;
      for (const weight of weights) {
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 1000) throw new Error('The installed font weight is invalid.');
        entry.weights.add(weight);
      }
      if (entry.weights.size > 2000 || entry.ranges.length + ranges.length > FONT_CATALOG_ROWS) throw new Error('The installed font family has too many weight values.');
      entry.italic ||= italic; entry.ranges.push(...ranges);
    }
  }
  function finish() {
    if (!families.size) throw new Error('No physical installed font families could be enumerated.');
    return [...families.values()].map(entry => {
      const result = { family:entry.family, weights:[...entry.weights].sort((a,b)=>a-b), italic:entry.italic };
      const ranges = entry.ranges.sort((a,b)=>a.min-b.min || a.max-b.max), merged = [];
      for (const range of ranges) {
        const last = merged.at(-1);
        if (last && range.min <= last.max) last.max = Math.max(last.max, range.max);
        else merged.push({ ...range });
      }
      // Do not claim the unsupported gap between separate variable fonts.
      if (merged.length === 1 && merged[0].max > merged[0].min) result.variable = merged[0];
      return result;
    }).sort((a,b)=>a.family.localeCompare(b.family,'en',{sensitivity:'base'}) || a.family.localeCompare(b.family,'en'));
  }
  return { add, finish };
}
function parseFontConfigCatalog(text) {
  const lines = fontText(text).trimEnd().split(/\r?\n/), builder = fontCatalogBuilder();
  if (lines.length > FONT_CATALOG_ROWS) throw new Error('The installed font catalog contains too many faces.');
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 4 || !/^(?:true|false)?$/i.test(fields[2])) throw new Error('Fontconfig returned malformed font metadata.');
    let aliases;
    try { aliases = JSON.parse(fields[3].replace(/,\]$/, ']')); } catch { throw new Error('Fontconfig returned malformed font family aliases.'); }
    const values = fontValues(fields[0],215), weights = [], ranges = [], variable = /^true$/i.test(fields[2]);
    for (const value of values) {
      const min = cssWeightFromFontconfig(value.min), max = cssWeightFromFontconfig(value.max);
      weights.push(min, max);
      if (value.range && variable && min < max) ranges.push({min,max});
    }
    builder.add(aliases, weights, fontValues(fields[1],110).some(value=>value.max>0), ranges);
  }
  return builder.finish();
}
// WPF exposes actual physical faces and OpenType weights. Composite families
// have no GlyphTypeface; simulated bold/oblique faces are not installed faces.
// https://learn.microsoft.com/dotnet/api/system.windows.media.fontfamily.gettypefaces
const WINDOWS_FONT_SCRIPT = String.raw`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName PresentationCore
$rows=New-Object System.Collections.ArrayList
$familyCount=0; $faceCount=0
foreach($family in [System.Windows.Media.Fonts]::SystemFontFamilies) {
  $familyCount++; if($familyCount -gt 20000) { throw 'Too many installed font families.' }
  $names=New-Object 'System.Collections.Generic.List[string]'
  $names.Add($family.Source)
  foreach($name in $family.FamilyNames.Values) { $names.Add($name) }
  foreach($face in $family.GetTypefaces()) {
    $faceCount++; if($faceCount -gt 100000) { throw 'Too many installed font faces.' }
    [System.Windows.Media.GlyphTypeface]$glyph=$null
    if($face.IsBoldSimulated -or $face.IsObliqueSimulated -or -not $face.TryGetGlyphTypeface([ref]$glyph)) { continue }
    $italic=($glyph.Style -eq [System.Windows.FontStyles]::Italic -or $glyph.Style -eq [System.Windows.FontStyles]::Oblique)
    $null=$rows.Add([PSCustomObject]@{families=@($names.ToArray());weight=$glyph.Weight.ToOpenTypeWeight();italic=$italic})
  }
}
[Console]::WriteLine((ConvertTo-Json -InputObject @($rows.ToArray()) -Depth 4 -Compress))`;
function parseWindowsFontCatalog(text) {
  let rows;
  try { rows = JSON.parse(fontText(text)); } catch (error) { throw new Error('Windows did not return a valid installed font catalog: ' + error.message); }
  if (!Array.isArray(rows) || !rows.length || rows.length > FONT_CATALOG_ROWS) throw new Error('Windows returned an empty or oversized installed font catalog.');
  const builder = fontCatalogBuilder();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isInteger(row.weight)) throw new Error('Windows returned malformed installed font metadata.');
    builder.add(row.families,[row.weight],row.italic);
  }
  return builder.finish();
}
async function fontCatalog() {
  const options = { timeout:process.platform === 'win32' ? 30000 : 15000, strictOutput:true, maxOutputBytes:FONT_CATALOG_BYTES };
  if (process.platform === 'win32') {
    const text = await run(platform.systemPowerShell(), ['-NoLogo','-NoProfile','-NonInteractive','-Sta','-EncodedCommand',Buffer.from(WINDOWS_FONT_SCRIPT,'utf16le').toString('base64')], { ...options,env:platform.powerShellEnv() });
    return parseWindowsFontCatalog(text);
  }
  return parseFontConfigCatalog(await run(platform.resolveTool('fc-list'),['--format',FONTCONFIG_FORMAT],options));
}
async function fonts() { return (await fontCatalog()).map(entry=>entry.family); }

module.exports = { run, directory, save, load, writeJSON, readJob, disposeReadJob, jobDir, saveFrames, encode, fonts, fontCatalog, parseFontConfigCatalog, parseWindowsFontCatalog, cssWeightFromFontconfig, FONTCONFIG_FORMAT, WINDOWS_FONT_SCRIPT, frameRateArgument, fs, path, platform };
