import type { CaptionItem, SequenceInfo, RenderBounds } from './lib/types';
import { emptyPresetLibrary, validatePresetLibrary, PRESET_STORAGE_KEY, type PresetLibrary } from './lib/style-presets.ts';
declare const window: Window & { __adobe_cep__?: any; require?: any };
const demoWords = 'Every word has its own style. Move captions anywhere in the frame.'.split(' ').map((text, i) => ({ text, start: i * .42, duration: .36, confidence: 1, eos: /[.!?]$/.test(text), type: 'word' as const, tags: [] }));
export interface CapturedContext { id: string; name: string; projectPath: string; width: number; height: number; fps: number; duration: number; dir: string; }
export interface NativeTranscriptProvider { fetch(context: CapturedContext): Promise<string | null>; transcribe(context: CapturedContext): Promise<string | null>; }

export function createHostAPI(nativeTranscript?: NativeTranscriptProvider) {
  const cep = window.__adobe_cep__;
  const contexts = new Map<string, CapturedContext>();
  let currentId = '', runtime: any = null;
  if (cep) {
    const extension = cep.getSystemPath('extension');
    const root = extension.startsWith('file:') ? window.require!('node:url').fileURLToPath(extension) : extension;
    runtime = window.require!(window.require!('node:path').join(root, 'runtime.cjs'));
  }
  function captured(sequenceId = currentId): CapturedContext {
    const value = contexts.get(sequenceId);
    if (!value) throw new Error('Refresh the sequence in Better Captions first.');
    if (!value.projectPath || !value.dir) throw new Error('Save the Premiere project first so captions have a permanent home.');
    return value;
  }
  function host(method: string, args: unknown[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!cep) return reject(new Error('Open Better Captions in Premiere to use the timeline.'));
      const serialized = args.map(x => JSON.stringify(x).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')).join(',');
      cep.evalScript('BetterCaptionsHost.' + method + '(' + serialized + ')', (raw: string) => {
        let data: any;
        try { data = JSON.parse(raw); } catch { return reject(new Error('Premiere did not return a valid caption response.')); }
        if (data.error) {
          const explanation = data.rolledBack === false ? ' Some changes could not be restored. Use Premiere Undo and review the recovery job: ' + data.recoveryJob : '';
          const error = Object.assign(new Error(data.error + explanation), { details: data });
          reject(error);
        } else resolve(data);
      });
    });
  }
  async function checkSequence(sequenceId: string) {
    const original = captured(sequenceId), live = await host('context', [original.id]);
    if (live.projectPath !== original.projectPath || live.width !== original.width || live.height !== original.height || Math.abs(live.fps - original.fps) > .000001) throw new Error('The Premiere project or sequence settings changed. Refresh and render again.');
    return original;
  }
  function ownedFolder(folder: string, sequenceId: string) {
    const context = captured(sequenceId);
    if (typeof folder !== 'string' || runtime.path.dirname(folder) !== context.dir || runtime.fs.realpathSync(folder) !== folder) throw new Error('Invalid caption output folder.');
    return context;
  }
  function jobFile(context: CapturedContext, prefix: string, data: any) {
    const file = runtime.path.join(context.dir, prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.json');
    runtime.writeJSON(file, data);
    return file;
  }
  async function readJob(method:string,data:unknown){
    const file=runtime.readJob(data);
    try{return await host(method,[file]);}
    finally{runtime.disposeReadJob(file);}
  }
  function generatedMedia(context: CapturedContext, file: unknown) {
    if (typeof file !== 'string' || runtime.path.basename(file) !== 'caption.mov' || runtime.path.dirname(runtime.path.dirname(file)) !== context.dir || !runtime.path.basename(runtime.path.dirname(file)).startsWith('caption-')) throw new Error('Caption media must come from this sequence’s generated asset folder.');
    const stat = runtime.fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || runtime.fs.realpathSync(file) !== file) throw new Error('Caption media must be a generated movie, not a symbolic link.');
  }
  function timelinePayload(context: CapturedContext, captions: CaptionItem[], track: number, previous: CaptionItem[]) {
    return { sequenceId: context.id, projectPath: context.projectPath, track, width: context.width, height: context.height, fps: context.fps,
      cues: captions.map(c => ({ id: c.id, text: c.text, startFrame: Math.round(c.startTime * context.fps), endFrame: Math.round(c.endTime * context.fps), path: c.mediaPath, previousPath: previous.find(old => old.id === c.id)?.mediaPath ?? c.mediaPath, clipNodeId: c.clipNodeId, projectItemId: c.projectItemId,captionBundle:c.captionBundle,renderBounds:c.renderBounds,previousRenderBounds:previous.find(old=>old.id===c.id)?.renderBounds,motionProfile:c.motionProfile })) };
  }
  function legacyCues(context: CapturedContext, captions: CaptionItem[]) {
    if (!Array.isArray(captions) || captions.length < 2 || captions.length > 64) throw new Error('Invalid legacy caption conversion.');
    return captions.map(c => {
      generatedMedia(context, c.mediaPath);
      return { id:c.id, clipNodeId:c.clipNodeId, projectItemId:c.projectItemId, mediaPath:c.mediaPath, startTime:c.startTime, endTime:c.endTime, renderBounds:c.renderBounds, manualSplit:c.manualSplit, captionBundle:c.captionBundle };
    });
  }
  const api = {
    async loadStylePresets(): Promise<PresetLibrary> {
      if (cep) throw new Error('Style presets require the Better Captions UXP panel.');
      const raw = localStorage.getItem(PRESET_STORAGE_KEY);
      return raw === null ? emptyPresetLibrary() : validatePresetLibrary(JSON.parse(raw));
    },
    async saveStylePresets(library: PresetLibrary): Promise<PresetLibrary> {
      if (cep) throw new Error('Style presets require the Better Captions UXP panel.');
      const input = validatePresetLibrary(library);
      const write = () => {
        const raw = localStorage.getItem(PRESET_STORAGE_KEY);
        const current = raw === null ? emptyPresetLibrary() : validatePresetLibrary(JSON.parse(raw));
        if (input.revision !== current.revision) throw new Error('Presets changed in another tab. Reload presets before saving again.');
        const next = validatePresetLibrary({ ...input, revision: input.revision + 1 });
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
        return next;
      };
      return window.navigator?.locks ? window.navigator.locks.request(PRESET_STORAGE_KEY, write) : write();
    },
    async readCaptionAreaDescriptor(caption:CaptionItem,sequenceId=currentId){
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionAreaDescriptor',{sequenceId:context.id,projectPath:context.projectPath,cues:[{id:caption.id,clipNodeId:caption.clipNodeId,projectItemId:caption.projectItemId,mediaPath:caption.mediaPath,captionBundle:caption.captionBundle,renderBounds:caption.renderBounds}]});
    },
    async patchCaptionKeyValues(caption:CaptionItem,patch:unknown,sequenceId=currentId){
      const context=await checkSequence(sequenceId);
      const file=jobFile(context,'key-value-job',{sequenceId:context.id,projectPath:context.projectPath,cues:[{id:caption.id,clipNodeId:caption.clipNodeId,projectItemId:caption.projectItemId,mediaPath:caption.mediaPath,captionBundle:caption.captionBundle,renderBounds:caption.renderBounds}],patch});
      const result=await host('patchCaptionKeyValues',[file]);
      try{runtime.fs.unlinkSync(file);}catch{} // Failed mutations retain their recovery job.
      return result;
    },
    async readCaptionArea(_caption:CaptionItem,_sequenceId:string,_frame:number):Promise<import('./lib/text-area').TextAreaState>{throw new Error('Native text-area editing requires the UXP panel.');},
    async editCaptionArea(_caption:CaptionItem,_sequenceId:string,_request:import('./lib/text-area').TextAreaEdit):Promise<import('./lib/text-area').TextAreaState>{throw new Error('Native text-area editing requires the UXP panel.');},
    isDemo: !cep,
    async getActiveSequenceInfo(sequenceId?: string): Promise<SequenceInfo | null> {
      if (!cep) return { id: 'demo', name: 'Better Captions · interactive preview', duration: 6, frameRate: 24, frameWidth: 720, frameHeight: 1280, tracks: [] };
      const live = await host('context', sequenceId ? [sequenceId] : []);
      const previous = contexts.get(live.id);
      if (previous && previous.projectPath !== live.projectPath) throw new Error('The project location changed. Reload the Better Captions panel to use its new asset folder.');
      const context: CapturedContext = { ...live, dir: live.projectPath ? runtime.directory(live) : '' };
      contexts.set(live.id, context); currentId = live.id;
      return { ...live, frameWidth: live.width, frameHeight: live.height, frameRate: live.fps };
    },
    async fetchTranscriptJSON(sequenceId = currentId) {
      if (!cep) return JSON.stringify({ language: 'en', speakers: [], segments: [{ start: 0, duration: 6, language: 'en', speaker: '', words: demoWords }] });
      if (!nativeTranscript) throw new Error('Open Window > UXP Plugins > Better Captions to use native transcription.');
      const context = await checkSequence(sequenceId), json = await nativeTranscript.fetch(context);
      await checkSequence(sequenceId); return json;
    },
    async loadSession(sequenceId = currentId) {
      if (!cep) { try { return JSON.parse(localStorage.getItem('better-captions-fork-demo') || 'null'); } catch { return null; } }
      const context = captured(sequenceId), data = runtime.load(context.dir);
      if (data && data.sequenceId !== context.id) throw new Error('The saved captions belong to another sequence.');
      return data;
    },
    async saveSession(session: any) {
      const data = JSON.parse(JSON.stringify(session));
      if (!cep) { localStorage.setItem('better-captions-fork-demo', JSON.stringify(data)); return; }
      // A slow previous sequence save must never use the latest active sequence's directory.
      return runtime.save(captured(data.sequenceId).dir, data);
    },
    async transcribeSequence(sequenceId = currentId) {
      if (!cep) throw new Error('Transcription is available in the Premiere panel.');
      if (!nativeTranscript) throw new Error('Open Window > UXP Plugins > Better Captions to use native transcription.');
      const context = await checkSequence(sequenceId), json = await nativeTranscript.transcribe(context);
      await checkSequence(sequenceId); return json;
    },
    async getFonts() { return cep ? runtime.fonts() : ['Arial', 'Helvetica', 'Georgia', 'Verdana', 'Times New Roman', 'Impact']; },
    async showInPremiere(time: number, sequenceId = currentId) { const context = captured(sequenceId); return host('seek', [context.id, time, context.projectPath]); },
    async beginCaption(id: string, sequenceId: string) {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid caption identity.');
      const context = await checkSequence(sequenceId);
      return runtime.jobDir(context.dir, 'caption-' + id);
    },
    async saveCaptionFrames(folder: string, frames: string[], start: number, sequenceId: string) {
      ownedFolder(folder, sequenceId); runtime.saveFrames(folder, frames, start);
    },
    async finishCaption(folder: string, fps: number, count: number, sequenceId: string,renderBounds?:RenderBounds) {
      const context = ownedFolder(folder, sequenceId);
      if (Math.abs(context.fps - fps) > .000001) throw new Error('Caption frame rate does not match the sequence.');
      await checkSequence(sequenceId);
      const media = await runtime.encode(folder, fps, count,undefined,renderBounds);
      await checkSequence(sequenceId);
      return media;
    },
    async preflightCaptionClips(captions: CaptionItem[], track: number, sequenceId: string) {
      const context = await checkSequence(sequenceId);
      return host('preflight', [jobFile(context, 'preflight', timelinePayload(context, captions, track, captions))]);
    },
    async readCaptionConsolidation(captions: CaptionItem[], sequenceId: string) {
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionConsolidation',{sequenceId:context.id,projectPath:context.projectPath,cues:legacyCues(context,captions)});
    },
    async stageCaptionConsolidation(caption: CaptionItem, track:number, previous:CaptionItem[], plan:unknown, sequenceId:string) {
      const context=await checkSequence(sequenceId);generatedMedia(context,caption.mediaPath);
      return host('stageCaptionConsolidation',[jobFile(context,'consolidation-stage',{...timelinePayload(context,[caption],track,[caption]),legacyCues:legacyCues(context,previous),plan})]);
    },
    async verifyCaptionConsolidation(caption:CaptionItem, previous:CaptionItem[], plan:unknown, sequenceId:string) {
      const context=await checkSequence(sequenceId);generatedMedia(context,caption.mediaPath);
      return readJob('verifyCaptionConsolidation',{sequenceId:context.id,projectPath:context.projectPath,cues:[caption],legacyCues:legacyCues(context,previous),plan});
    },
    async rollbackCaptionConsolidation(caption:CaptionItem, previous:CaptionItem[], plan:unknown, sequenceId:string) {
      const context=await checkSequence(sequenceId);generatedMedia(context,caption.mediaPath);
      return host('rollbackCaptionConsolidation',[jobFile(context,'consolidation-rollback',{sequenceId:context.id,projectPath:context.projectPath,cues:[caption],legacyCues:legacyCues(context,previous),plan})]);
    },
    async prepareCaptionTrack(captions: CaptionItem[], track: number, sequenceId: string, previous: CaptionItem[] = captions) {
      const context = await checkSequence(sequenceId);
      captions.forEach(caption => generatedMedia(context, caption.mediaPath));
      previous.filter(caption => caption.clipNodeId).forEach(caption => generatedMedia(context, caption.mediaPath));
      const firstNew = track === -1 ? captions.find(caption => !caption.clipNodeId) : undefined;
      if (firstNew) {
        const probe = JSON.parse(await runtime.run(runtime.platform.resolveTool('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', firstNew.mediaPath], { timeout: 15000 }));
        if (!Array.isArray(probe.streams) || probe.streams.length !== 1 || probe.streams[0]?.codec_type !== 'video') throw new Error('Creating a caption track requires a generated video-only caption movie. No timeline changes were made.');
        await checkSequence(sequenceId);
      }
      const result = await host('prepareCaptionTrack', [jobFile(context, 'caption-track-job', timelinePayload(context, captions, track, previous))]);
      if (result.seed) {
        if (!firstNew || result.seed.id !== firstNew.id || result.seed.path !== firstNew.mediaPath) throw new Error('Premiere returned a different temporary caption source. No track was created.');
        result.seed.videoOnly = true;
      }
      return result;
    },
    async applyCaptionClips(captions: CaptionItem[], track: number, sequenceId: string, previous: CaptionItem[] = captions) {
      const context = await checkSequence(sequenceId);
      captions.forEach(caption => generatedMedia(context, caption.mediaPath));
      previous.filter(caption => caption.clipNodeId).forEach(caption => generatedMedia(context, caption.mediaPath));
      return host('apply', [jobFile(context, 'timeline-job', timelinePayload(context, captions, track, previous))]);
    },
    async readTimeline(captions: CaptionItem[], sequenceId = currentId) {
      const context = await checkSequence(sequenceId);
      return readJob('readTimeline', { sequenceId: context.id, projectPath: context.projectPath, cues: captions.map(c => ({ id: c.id, clipNodeId: c.clipNodeId,projectItemId:c.projectItemId,mediaPath:c.mediaPath,captionBundle:c.captionBundle })) });
    },
    async readCaptionMotion(captions:CaptionItem[],sequenceId=currentId,options?:{includeDiagnostics?:boolean}){
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionMotion',{sequenceId:context.id,projectPath:context.projectPath,...(options?.includeDiagnostics===true?{includeDiagnostics:true}:{}),cues:captions.map(c=>({id:c.id,clipNodeId:c.clipNodeId,projectItemId:c.projectItemId,mediaPath:c.mediaPath,captionBundle:c.captionBundle,startTime:c.startTime,endTime:c.endTime,renderBounds:c.renderBounds}))});
    },
    async readCaptionGeometry(captions:CaptionItem[],sequenceId=currentId){
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionGeometry',{sequenceId:context.id,projectPath:context.projectPath,cues:captions.map(c=>({id:c.id,clipNodeId:c.clipNodeId,projectItemId:c.projectItemId,mediaPath:c.mediaPath,captionBundle:c.captionBundle,startTime:c.startTime,endTime:c.endTime}))});
    },
    async selectCaptionClip(caption:CaptionItem,sequenceId=currentId){
      const context=await checkSequence(sequenceId);
      return readJob('selectCaptionClip',{sequenceId:context.id,projectPath:context.projectPath,cues:[caption]});
    },
    async readCaptionSelection(captions:CaptionItem[],sequenceId=currentId){
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionSelection',{sequenceId:context.id,projectPath:context.projectPath,cues:captions.filter(c=>c.clipNodeId).map(c=>({id:c.id,clipNodeId:c.clipNodeId,projectItemId:c.projectItemId,mediaPath:c.mediaPath,captionBundle:c.captionBundle}))});
    },
    async getColorScheme() { return { theme: 'darkest', colors: {} }; },
  };
  return api;
}
