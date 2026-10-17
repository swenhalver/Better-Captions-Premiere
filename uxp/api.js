'use strict';
const ppro = require('premierepro');
const fs = require('uxp').storage.localFileSystem;
const { ensureFolder, privateRoot, readJSON, writeJSON, randomId } = require('./storage.js');
const native = require('./transcript.js');
const key = id => String(id).replace(/[{}]/g, '').toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function createHostAPI() {
  const contexts = new Map();
  let currentId = '';
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
    await writeJSON(requests, name, { version: 1, id, createdAt: Date.now(), sequenceId: context.id, projectPath: context.projectPath, action, args });
    let input = null, output = null;
    try { input = await requests.getEntry(name); } catch { /* The renderer may already have claimed it. */ }
    const started = Date.now();
    try {
      while (Date.now() - started < 30 * 60 * 1000) {
        try { output = await responses.getEntry(name); } catch {}
        if (output) {
          const response = await readJSON(output, 30 * 1024 * 1024);
          if (!record(response) || response.version !== 1 || response.id !== id || response.sequenceId !== context.id || response.projectPath !== context.projectPath) throw new Error('The caption render service returned a mismatched response.');
          if (typeof response.error === 'string') throw new Error(response.error);
          await sequenceContext(context.id);
          return response.result;
        }
        if (Date.now() - started > 7000) {
          let unclaimed = false; try { await requests.getEntry(name); unclaimed = true; } catch {}
          if (unclaimed) throw new Error('Restart Premiere once after installing Better Captions so its background renderer can start. Save your work first.');
        }
        await sleep(150);
      }
      throw new Error('The caption render service timed out.');
    } finally {
      for (const file of [input, output]) if (file) try { await file.delete(); } catch {}
    }
  }
  const api = {
    isDemo: false,
    async getActiveSequenceInfo() {
      const project = await ppro.Project.getActiveProject();
      if (!project) return null;
      const sequence = await project.getActiveSequence();
      if (!sequence) return null;
      const id = key(sequence.guid.toString()), settings = await sequence.getSettings();
      const rect = await settings.getVideoFrameRect();
      const timebase = Number(await sequence.getTimebase()), duration = (await sequence.getEndTime()).seconds;
      const previous = contexts.get(id);
      if (previous && previous.projectPath !== project.path) throw new Error('The project location changed. Reopen Better Captions.');
      const tracks = [];
      for (let index = 0; index < await sequence.getVideoTrackCount(); index++) {
        const track = await sequence.getVideoTrack(index);
        tracks.push({ index, name: track.name || 'Video ' + (index + 1), clips: (await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)).length, locked: false });
      }
      const info = { id, name: sequence.name, projectPath: project.path, duration, frameRate: 254016000000 / timebase, frameWidth: rect.width, frameHeight: rect.height, tracks };
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
    async getFonts() { if (!currentId) await api.getActiveSequenceInfo(); return backend('getFonts', []); },
    async showInPremiere(time, id = currentId) { return backend('showInPremiere', [time], id); },
    async beginCaption(captionId, id) { return backend('beginCaption', [captionId], id); },
    async saveCaptionFrames(folder, frames, start, id) { return backend('saveCaptionFrames', [folder, frames, start], id); },
    async finishCaption(folder, fps, count, id) { return backend('finishCaption', [folder, fps, count], id); },
    async preflightCaptionClips(captions, track, id) { return backend('preflightCaptionClips', [captions, track], id); },
    async applyCaptionClips(captions, track, id, previous = captions) { return backend('applyCaptionClips', [captions, track, previous], id); },
    async readTimeline(captions, id = currentId) { return backend('readTimeline', [captions], id); },
    async getColorScheme() { return { theme: 'darkest', colors: {} }; },
    async startAgentBridge(proxy) { return require('./agent.js').startAgentBridge(proxy); },
  };
  return api;
}
module.exports = { createHostAPI };
