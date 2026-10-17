'use strict';
const ppro = require('premierepro');
const fs = require('uxp').storage.localFileSystem;
const { ensureFolder, privateRoot, readJSON, writeJSON, randomId } = require('./storage.js');
const native = require('./transcript.js');
const key = id => String(id).replace(/[{}]/g, '').toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const READ_METHODS = new Set(['getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection']);
const SERVICE_READS = new Set(['getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection']);

function createHostAPI(options = {}) {
  const contexts = new Map();
  let currentId = '';
  const readTimeout = options.readTimeoutMs ?? 12000;
  const waiting = [];
  let active = null, unresolved = null, disposed = false;
  function drain() {
    if (active || disposed || unresolved || !waiting.length) return;
    const job = waiting.shift(); active = job;
    Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
      clearTimeout(job.timer);
      if (unresolved === job) unresolved = null;
      active = null; drain();
    });
  }
  function serial(method, run) {
    if (disposed) return Promise.reject(new Error('The Better Captions plugin is closed.'));
    if (unresolved) return Promise.reject(new Error('A previous Premiere read has not finished. Native requests are paused until it returns; the timeout did not cancel that operation.'));
    if (waiting.length >= 8) return Promise.reject(new Error('Better Captions is busy. Wait for the current operation before requesting more native work.'));
    const timeout = READ_METHODS.has(method) ? readTimeout : method === 'transcribeSequence' ? 60 * 60 * 1000 : method === 'finishCaption' || method === 'applyCaptionClips' ? 30 * 60 * 1000 : 60000;
    return new Promise((resolve, reject) => {
      const job = { run, resolve, reject, timer: null };
      job.timer = setTimeout(() => {
        if (active === job) {
          unresolved = job;
          reject(new Error('Premiere did not finish ' + method + ' within its time limit. Native requests are paused until it returns. This timeout did not cancel Premiere’s operation.'));
          for (const queued of waiting.splice(0)) { clearTimeout(queued.timer); queued.reject(new Error('Native requests paused while a previous Premiere operation is unresolved.')); }
        } else {
          const index = waiting.indexOf(job); if (index >= 0) waiting.splice(index, 1);
          reject(new Error('The caption read expired while waiting for the current native operation. No new native call was started.'));
        }
      }, timeout);
      waiting.push(job); drain();
    });
  }
  async function sequenceContext(id) {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error('Open a Premiere project first.');
    const sequence = id ? (await project.getSequences()).find(item => key(item.guid.toString()) === key(id)) : await project.getActiveSequence();
    if (!sequence) throw new Error('The requested sequence is no longer open. Refresh Better Captions.');
    const captured = contexts.get(key(sequence.guid.toString()));
    if (captured && captured.projectPath !== project.path) throw new Error('The Premiere project location changed. Reopen Better Captions.');
    return { project, sequence };
  }
  function captured(id = currentId) {
    const context = contexts.get(key(id));
    if (!context) throw new Error('Refresh the sequence in Better Captions first.');
    return context;
  }
  async function sessionFolder(id) {
    const context = captured(id);
    if (!context.projectPath || !context.projectPath.startsWith('/')) throw new Error('Save the Premiere project first so caption assets have a permanent home.');
    return ensureFolder(context.projectPath.replace(/\/[^/]+$/, '') + '/Better Captions/' + context.id);
  }
  async function backend(action, args, sequenceId = currentId) {
    const context = captured(sequenceId);
    await sequenceContext(context.id);
    const root = await privateRoot('service');
    const requests = await ensureFolder(root.nativePath + '/requests'), responses = await ensureFolder(root.nativePath + '/responses');
    const id = randomId(), name = id + '.json';
    const createdAt = Date.now();
    await writeJSON(requests, name, { version: 1, id, createdAt, ...(SERVICE_READS.has(action) ? { expiresAt: createdAt + Math.min(10000, readTimeout) } : {}), sequenceId: context.id, projectPath: context.projectPath, action, args });
    let input = null, output = null;
    try { input = await requests.getEntry(name); } catch { /* The renderer may already have claimed it. */ }
    try {
      // Caller deadlines are owned by the serial lane. Keep that lane occupied
      // until the worker really responds: a missing file is not cancellation,
      // and a file that still exists can be claimed immediately after a check.
      while (true) {
        if (disposed) throw new Error('The Better Captions plugin closed while waiting for the renderer. Its already started native operation was not cancelled.');
        try { output = await responses.getEntry(name); } catch {}
        if (output) {
          const response = await readJSON(output, 30 * 1024 * 1024);
          if (!record(response) || response.version !== 1 || response.id !== id || response.sequenceId !== context.id || response.projectPath !== context.projectPath) throw new Error('The caption render service returned a mismatched response.');
          if (typeof response.error === 'string') throw new Error(response.error);
          if (!SERVICE_READS.has(action)) await sequenceContext(context.id);
          return response.result;
        }
        await sleep(unresolved ? 1000 : 150);
      }
    } finally {
      for (const file of [input, output]) if (file) try { await file.delete(); } catch {}
    }
  }
  const nativeAPI = {
    isDemo: false,
    async getActiveSequenceInfo() {
      const project = await ppro.Project.getActiveProject();
      if (!project) return null;
      const sequence = await project.getActiveSequence();
      if (!sequence) return null;
      const id = key(sequence.guid.toString()), settings = await sequence.getSettings();
      const rect = await settings.getVideoFrameRect();
      const timebase = Number(await sequence.getTimebase()), duration = (await sequence.getEndTime()).seconds;
      const playhead = (await sequence.getPlayerPosition()).seconds;
      const previous = contexts.get(id);
      if (previous && previous.projectPath !== project.path) throw new Error('The project location changed. Reopen Better Captions.');
      const tracks = [];
      const trackCount = await sequence.getVideoTrackCount();
      for (let index = 0; index < trackCount; index++) {
        const track = await sequence.getVideoTrack(index);
        tracks.push({ index, name: track.name || 'Video ' + (index + 1), clips: (await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)).length, locked: false });
      }
      const info = { id, name: sequence.name, projectPath: project.path, duration, playhead, frameRate: 254016000000 / timebase, frameWidth: rect.width, frameHeight: rect.height, tracks };
      contexts.set(id, info); currentId = id;
      return info;
    },
    async fetchTranscriptJSON(id = currentId) { const { sequence } = await sequenceContext(id); return native.fetchTranscript(sequence); },
    async transcribeSequence(id = currentId) { const { sequence } = await sequenceContext(id); return native.transcribe(sequence); },
    async loadSession(id = currentId) {
      const context = captured(id);
      if (!context.projectPath) return null;
      const folder = await sessionFolder(id);
      let file; try { file = await folder.getEntry('captions.better-captions.json'); } catch { return null; }
      const saved = await readJSON(file);
      if (saved.sequenceId !== context.id) throw new Error('The saved captions belong to another sequence.');
      return saved;
    },
    async saveSession(session) {
      if (!record(session) || typeof session.sequenceId !== 'string') throw new Error('Invalid caption session.');
      await sequenceContext(session.sequenceId);
      const folder = await sessionFolder(session.sequenceId);
      await writeJSON(folder, 'captions.better-captions.json', session);
    },
    async getFonts() { if (!currentId) await nativeAPI.getActiveSequenceInfo(); return backend('getFonts', []); },
    async showInPremiere(time, id = currentId) { return backend('showInPremiere', [time], id); },
    async beginCaption(captionId, id) { return backend('beginCaption', [captionId], id); },
    async saveCaptionFrames(folder, frames, start, id) { return backend('saveCaptionFrames', [folder, frames, start], id); },
    async finishCaption(folder, fps, count, id, bounds) { return backend('finishCaption', bounds ? [folder, fps, count, bounds] : [folder, fps, count], id); },
    async preflightCaptionClips(captions, track, id) { return backend('preflightCaptionClips', [captions, track], id); },
    async applyCaptionClips(captions, track, id, previous = captions) { return backend('applyCaptionClips', [captions, track, previous], id); },
    async readTimeline(captions, id = currentId) { return backend('readTimeline', [captions], id); },
    async selectCaptionClip(caption, id = currentId) { return backend('selectCaptionClip', [caption], id); },
    async readCaptionMotion(captions, id = currentId, options) { return backend('readCaptionMotion', options?.includeDiagnostics === true ? [captions, { includeDiagnostics: true }] : [captions], id); },
    async readCaptionGeometry(captions, id = currentId) { return backend('readCaptionGeometry', [captions], id); },
    async readCaptionSelection(captions, id = currentId) { return backend('readCaptionSelection', [captions], id); },
    async getColorScheme() { return { theme: 'darkest', colors: {} }; },
    async startAgentBridge(proxy) { return require('./agent.js').startAgentBridge(proxy); },
  };
  const api = { ...nativeAPI };
  for (const method of Object.keys(nativeAPI)) if (typeof nativeAPI[method] === 'function' && !['getColorScheme', 'startAgentBridge'].includes(method)) {
    api[method] = (...args) => {
      // Resolve implicit identities when requested, before a queued refresh
      // can change currentId. File saves already carry their own identity.
      if (['fetchTranscriptJSON', 'transcribeSequence', 'loadSession'].includes(method) && args[0] === undefined) args[0] = currentId;
      if (['showInPremiere', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'selectCaptionClip'].includes(method) && args[1] === undefined) args[1] = currentId;
      return serial(method, () => nativeAPI[method](...args));
    };
  }
  api.dispose = () => {
    disposed = true;
    for (const queued of waiting.splice(0)) { clearTimeout(queued.timer); queued.reject(new Error('The Better Captions plugin was closed.')); }
    if (active) { clearTimeout(active.timer); active.reject(new Error('The Better Captions plugin closed; its native operation was not cancelled.')); }
  };
  return api;
}
module.exports = { createHostAPI };
