'use strict';
const ppro = require('premierepro');
const fs = require('uxp').storage.localFileSystem;
const { ensureFolder, privateRoot, readJSON, writeJSON, randomId } = require('./storage.js');
const native = require('./transcript.js');
const { localPath, parentPath } = require('./paths.js');
const key = id => String(id).replace(/[{}]/g, '').toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const READ_METHODS = new Set(['loadStylePresets', 'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionArea', 'readCaptionConsolidation']);
const SERVICE_READS = new Set(['getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionAreaDescriptor', 'readCaptionConsolidation', 'verifyCaptionConsolidation']);

function createHostAPI(options = {}) {
  const contexts = new Map();
  let presetStore;
  function presets() { return presetStore ?? (presetStore = require('./style-presets.js').createPresetStore({ getFolder: () => fs.getDataFolder(), readJSON, writeJSON })); }
  let currentId = '';
  const readTimeout = options.readTimeoutMs ?? 12000;
  const startupGrace = Math.min(5000, Math.max(0, Number.isFinite(options.serviceStartupGraceMs) ? options.serviceStartupGraceMs : 5000));
  const startupPoll = Math.min(250, Math.max(1, Number.isFinite(options.serviceStartupPollMs) ? options.serviceStartupPollMs : 150));
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
    const timeout = READ_METHODS.has(method) ? readTimeout : method === 'transcribeSequence' ? 60 * 60 * 1000 : ['finishCaption','applyCaptionClips','applyConsolidatedCaption'].includes(method) ? 30 * 60 * 1000 : 60000;
    return new Promise((resolve, reject) => {
      const job = { run, resolve, reject, timer: null, deadline: Date.now() + timeout };
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
    let parent;
    try { parent = parentPath(localPath(context.projectPath)); } catch {}
    if (!parent) throw new Error('Save the Premiere project first so caption assets have a permanent home.');
    return ensureFolder(parent.replace(/\/$/, '') + '/Better Captions/' + context.id);
  }
  async function requireService(root, action) {
    const unavailable = () => new Error('The Better Captions background renderer is unavailable or out of date. Save your work, restart Premiere, then reopen Better Captions to start it.');
    // Startup checks read only the private heartbeat. Leave time for the serial
    // deadline to reject a missing renderer normally, before any request exists.
    const reserve = Math.min(1000, Math.max(0, readTimeout / 2));
    const grace = Math.max(0, Math.min(startupGrace, (active?.deadline ?? Date.now() + readTimeout) - Date.now() - reserve));
    const deadline = Date.now() + grace;
    let remaining = grace;
    while (true) {
      if (disposed) throw new Error('The Better Captions plugin was closed.');
      let status;
      try { status = await readJSON(await root.getEntry('service.json'), 16384); } catch {}
      if (disposed) throw new Error('The Better Captions plugin was closed.');
      const age = Date.now() - status?.updatedAt;
      const fresh = record(status) && Number.isFinite(status.updatedAt) && age >= -5000 && age <= 10000;
      if (fresh) {
        if (status.version !== 1 || !/^[a-f0-9]{24}$/.test(status.instanceId) || !Array.isArray(status.actions) || !status.actions.includes(action)) throw unavailable();
        return;
      }
      remaining = Math.min(remaining, deadline - Date.now());
      if (remaining <= 0) throw unavailable();
      const wait = Math.min(startupPoll, remaining);
      await sleep(wait);
      // A wall-clock adjustment cannot extend the bounded startup grace.
      remaining -= wait;
    }
  }
  async function backend(action, args, sequenceId = currentId) {
    const context = captured(sequenceId);
    const root = await privateRoot('service');
    await requireService(root, action);
    await sequenceContext(context.id);
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
  async function captionDestination(captions, track, id, previous, deletedLinks = []) {
    if(track!==-1 || !captions.some(caption=>!caption.clipNodeId))return track;
    const prepared=await backend('prepareCaptionTrack',[captions,track,previous,...(deletedLinks.length?[deletedLinks]:[])],id),context=captured(id);
    if(!record(prepared) || prepared.ok!==true || !record(prepared.destination) || prepared.sequenceId!==context.id || prepared.projectPath!==context.projectPath)throw new Error('Premiere could not confirm the automatic caption track for this project and sequence.');
    if(prepared.destination.mode==='create'){
      const {project,sequence}=await sequenceContext(id);
      return require('./caption-track.js').createCaptionTrack(ppro,project,sequence,prepared);
    }
    if(prepared.destination.mode==='reuse' && Number.isInteger(prepared.destination.trackIndex) && prepared.destination.trackIndex>=0)return prepared.destination.trackIndex;
    throw new Error('Premiere did not confirm a safe automatic caption track.');
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
    async loadStylePresets() { return presets().load(); },
    async saveStylePresets(library) { return presets().save(library); },
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
    async preflightCaptionClips(captions, track, id, deletedLinks = []) {
      if(!Array.isArray(deletedLinks))throw new Error('Invalid deleted caption links.');
      return backend('preflightCaptionClips', [captions, track, ...(deletedLinks.length?[deletedLinks]:[])], id);
    },
    async applyCaptionClips(captions, track, id, previous = captions, deletedLinks = []) {
      if(!Array.isArray(deletedLinks))throw new Error('Invalid deleted caption links.');
      [captions,previous,deletedLinks]=JSON.parse(JSON.stringify([captions,previous,deletedLinks]));
      const destination=await captionDestination(captions,track,id,previous,deletedLinks);
      return backend('applyCaptionClips', [captions, destination, previous, ...(deletedLinks.length?[deletedLinks]:[])], id);
    },
    async readCaptionConsolidation(captions,id) { return backend('readCaptionConsolidation',[captions],id); },
    async applyConsolidatedCaption(caption,previous,plan,id) {
      // Freeze the identities used by this multi-step native operation. Later
      // editor changes must not redirect verification or cleanup to other clips.
      [caption,previous,plan]=JSON.parse(JSON.stringify([caption,previous,plan]));
      const fresh=await backend('readCaptionConsolidation',[previous],id);
      if(!plan || JSON.stringify(fresh)!==JSON.stringify(plan))throw new Error('Legacy caption geometry changed while rendering. Apply again.');
      const destination=await captionDestination([caption],-1,id,[caption]);
      const result=await backend('stageCaptionConsolidation',[caption,destination,previous,plan],id);
      if(!result?.ok || result.cues?.length!==1)throw new Error('Premiere did not confirm the combined caption replacement.');
      const cue=result.cues[0],linked={...caption,clipNodeId:cue.clipNodeId,projectItemId:cue.projectItemId,mediaPath:cue.path,startTime:cue.start,endTime:cue.end};
      const verify=()=>backend('verifyCaptionConsolidation',[linked,previous,plan],id);
      try {
        const {project,sequence}=await sequenceContext(id);
        await require('./consolidation.js').removeLegacyClips(ppro,project,sequence,plan,verify);
      } catch (error) {
        // A host transaction can return an uncertain result after committing.
        // Preserve the replacement when all originals were actually removed.
        const status=await verify();
        if(status?.ok && status.complete===true)return result;
        if(status?.ok && status.complete===false){
          await backend('rollbackCaptionConsolidation',[linked,previous,plan],id);
          throw new Error(String(error.message||error)+' Original clips were preserved.');
        }
        throw error;
      }
      return result;
    },
    async readTimeline(captions, id = currentId) { return backend('readTimeline', [captions], id); },
    async selectCaptionClip(caption, id = currentId) { return backend('selectCaptionClip', [caption], id); },
    async readCaptionMotion(captions, id = currentId, options) { return backend('readCaptionMotion', options?.includeDiagnostics === true ? [captions, { includeDiagnostics: true }] : [captions], id); },
    async readCaptionGeometry(captions, id = currentId) { return backend('readCaptionGeometry', [captions], id); },
    async readCaptionSelection(captions, id = currentId) { return backend('readCaptionSelection', [captions], id); },
    async readCaptionArea(caption,id=currentId,frame=0) {
      const link={id:caption.id,clipNodeId:caption.clipNodeId,projectItemId:caption.projectItemId,mediaPath:caption.mediaPath,...(caption.captionBundle===true?{captionBundle:true}:{}),renderBounds:caption.renderBounds?JSON.parse(JSON.stringify(caption.renderBounds)):undefined};
      const revalidate=()=>backend('readCaptionAreaDescriptor',[link],id);
      const descriptor=await revalidate(), {sequence}=await sequenceContext(id);
      return require('./text-area.js').readArea(ppro,sequence,descriptor,frame,revalidate);
    },
    async editCaptionArea(caption,id=currentId,request) {
      const link={id:caption.id,clipNodeId:caption.clipNodeId,projectItemId:caption.projectItemId,mediaPath:caption.mediaPath,...(caption.captionBundle===true?{captionBundle:true}:{}),renderBounds:caption.renderBounds?JSON.parse(JSON.stringify(caption.renderBounds)):undefined};
      const revalidate=()=>backend('readCaptionAreaDescriptor',[link],id);
      const descriptor=await revalidate(), {project,sequence}=await sequenceContext(id);
      // Call the internal backend directly while this native lane is occupied.
      // Re-entering the public serialized API here would deadlock the edit.
      const patchKeyValues=patch=>backend('patchCaptionKeyValues',[link,patch],id);
      return require('./text-area.js').editArea(ppro,project,sequence,descriptor,request,revalidate,{patchKeyValues});
    },
    async getColorScheme() { return { theme: 'darkest', colors: {} }; },
    async startAgentBridge(proxy) { return require('./agent.js').startAgentBridge(proxy); },
  };
  const api = { ...nativeAPI };
  for (const method of Object.keys(nativeAPI)) if (typeof nativeAPI[method] === 'function' && !['getColorScheme', 'startAgentBridge'].includes(method)) {
    api[method] = (...args) => {
      // Resolve implicit identities when requested, before a queued refresh
      // can change currentId. File saves already carry their own identity.
      if (['fetchTranscriptJSON', 'transcribeSequence', 'loadSession'].includes(method) && args[0] === undefined) args[0] = currentId;
      if (['showInPremiere', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'selectCaptionClip', 'readCaptionArea', 'editCaptionArea'].includes(method) && args[1] === undefined) args[1] = currentId;
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
