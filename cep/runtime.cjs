'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const ffprobe = '/opt/homebrew/bin/ffprobe';
const jobs = new Map();
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

/** The executable and every argument are separate: no command shell is involved. */
function run(exe, args, { cwd, signal, timeout = 60 * 60 * 1000 } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', settled = false;
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
    child.stdout.on('data', b => { out = (out + b).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', b => { err = (err + b).slice(-12000); });
    child.on('error', finish);
    child.on('close', (code, killedBy) => finish(code === 0 ? null : new Error(signal?.aborted ? 'Cancelled.' : err.slice(-2000) || `Local process stopped (${code ?? killedBy}).`)));
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

async function encode(folder, fps, count, signal) {
  const job = captionJob(folder), rate = frameRateArgument(fps);
  if (!Number.isSafeInteger(count) || count < 1 || count !== job.next) throw new Error('Caption frame count does not match the rendered frames.');
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) throw new Error('Install the local FFmpeg and FFprobe executables first.');
  const output = path.join(folder, 'caption.mov'), partial = path.join(folder, 'caption.partial.mov');
  if (fs.existsSync(output) || fs.existsSync(partial)) throw new Error('Caption output already exists. Render again to a new job folder.');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-framerate', rate, '-start_number', '0', '-i', 'frame_%06d.png', '-frames:v', String(count), '-an', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-threads', '2', 'caption.partial.mov'], { cwd: folder, signal });
  const probe = JSON.parse(await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,nb_frames,r_frame_rate', '-of', 'json', partial], { signal }));
  const stream = probe.streams?.[0];
  if (!stream || stream.codec_name !== 'prores' || !/^yuva/.test(stream.pix_fmt) || stream.width !== job.width || stream.height !== job.height || Number(stream.nb_frames) !== count) throw new Error('The caption movie failed codec, transparency, dimensions, or frame-count verification.');
  const parts = stream.r_frame_rate.split('/').map(Number);
  if (Math.abs(parts[0] / parts[1] - fps) > 0.00001) throw new Error('The caption movie has the wrong frame rate.');
  fs.renameSync(partial, output);
  writeJSON(path.join(folder, 'render.json'), { width: job.width, height: job.height, frameRate: fps, frames: count, codec: 'ProRes 4444', alpha: true });
  job.complete = true;
  // PNGs are staging files; only the verified movie and small manifest are retained.
  for (let i = 0; i < count; i++) fs.unlinkSync(path.join(folder, 'frame_' + String(i).padStart(6, '0') + '.png'));
  return output;
}

async function fonts() {
  const text = await run('/opt/homebrew/bin/fc-list', ['--format', '%{family}\n'], { timeout: 15000 });
  return [...new Set(text.split('\n').flatMap(x => x.split(',')).map(s => s.trim()).filter(Boolean))].sort();
}

module.exports = { run, directory, save, load, writeJSON, jobDir, saveFrames, encode, fonts, frameRateArgument, fs, path };
