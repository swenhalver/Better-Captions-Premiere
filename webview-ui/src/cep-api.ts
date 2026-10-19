import { decodeNativePanelDocument } from './lib/native-effect/panel.ts';
import type { CaptionItem, SequenceInfo, RenderBounds } from './lib/types';
import type { DeletedCaptionLink } from './lib/export/deleted-links';
import { emptyPresetLibrary, validatePresetLibrary, PRESET_STORAGE_KEY, type PresetLibrary } from './lib/style-presets.ts';
declare const window: Window & { __adobe_cep__?: any; require?: any };
const demoWords = 'Every word has its own style. Move captions anywhere in the frame.'.split(' ').map((text, i) => ({ text, start: i * .42, duration: .36, confidence: 1, eos: /[.!?]$/.test(text), type: 'word' as const, tags: [] }));
export interface CapturedContext { id: string; name: string; projectPath: string; width: number; height: number; fps: number; duration: number; dir: string; ticksPerFrame?: string; tracks?: {index:number;locked:boolean}[]; }
export interface NativeTranscriptProvider { fetch(context: CapturedContext): Promise<string | null>; transcribe(context: CapturedContext): Promise<string | null>; }
export interface FontCatalogEntry { family:string;weights:number[];italic:boolean;variable?:{min:number;max:number}; }
const HOST_BRIDGE_METHODS = ['context','seek','selectCaptionClip','readCaptionSelection','readCaptionConnections','readNativeCaptionControls','readNativeCaptionExtension','extendNativeCaptionDocument','editNativeCaptionControl','seekNativeCaptionKeyframe','writeNativeCaptionDocument','createNativeCaptionDocument','readCaptionGeometry','readCaptionMotion','readCaptionAreaDescriptor','patchCaptionKeyValues','preflight','prepareCaptionTrack','apply','readTimeline','readCaptionConsolidation','stageCaptionConsolidation','verifyCaptionConsolidation','rollbackCaptionConsolidation'];
function sameSavedSequence(a:unknown,b:string) {
  if(typeof a!=='string')return false;
  const canonical=(value:string)=>{
    const plain=value.startsWith('{')&&value.endsWith('}')?value.slice(1,-1):value;
    return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(plain)?plain.toLowerCase():value;
  };
  return canonical(a)===canonical(b);
}
export interface NativeCaptionLocator { projectPath:string;sequenceId:string;clipNodeId:string;trackIndex:number;clipIndex:number;componentIndex:number;documentParamIndex:number; }
export interface NativeCaptionSnapshot { locator:NativeCaptionLocator;revision:string;grouping?:{before:number;value:number}; }
export interface NativeCaptionControlDescriptor { value:number|[number,number];defaultValue:number|[number,number];animated:boolean;keyframesSupported:boolean;hasKey:boolean;keys:{ticks:string;value:number|[number,number]}[]; }
export interface NativeCaptionControls { ok:true;clipNodeId:string;revision:string;timelineTicks:string;sourceTicks:string|null;startTicks:string;endTicks:string;inTicks:string;outTicks:string;clock:'clip-source';insideClip:boolean;position:NativeCaptionControlDescriptor;width:NativeCaptionControlDescriptor;height:NativeCaptionControlDescriptor;groups?:NativeCaptionControlDescriptor;smartFit?:NativeCaptionControlDescriptor;rollUp?:NativeCaptionControlDescriptor;rollUpLines?:NativeCaptionControlDescriptor;rollUpDuration?:NativeCaptionControlDescriptor;rollUpFade?:NativeCaptionControlDescriptor;rollUpFadePosition?:NativeCaptionControlDescriptor;rollUpFadeThickness?:NativeCaptionControlDescriptor;rollUpFadeAmount?:NativeCaptionControlDescriptor;rollUpFadeCurve?:NativeCaptionControlDescriptor;rollUpDirection?:NativeCaptionControlDescriptor;rollUpSpeed?:NativeCaptionControlDescriptor;rollUpWait?:NativeCaptionControlDescriptor;rollUpTransition?:NativeCaptionControlDescriptor;readbackVerified?:boolean;retry?:'never'; }
export interface NativeCaptionControlEdit { revision:string;parameter:'position'|'width'|'height'|'groups'|'smartFit'|'rollUp'|'rollUpLines'|'rollUpDuration'|'rollUpFade'|'rollUpFadePosition'|'rollUpFadeThickness'|'rollUpFadeAmount'|'rollUpFadeCurve'|'rollUpDirection'|'rollUpSpeed'|'rollUpWait'|'rollUpTransition';operation:'set'|'reset';value?:number|[number,number];atTicks:string; }
export interface NativeCaptionKeyframeSeek { revision:string;parameter:'position'|'width'|'height'|'groups'|'smartFit'|'rollUp'|'rollUpLines'|'rollUpDuration'|'rollUpFade'|'rollUpFadePosition'|'rollUpFadeThickness'|'rollUpFadeAmount'|'rollUpFadeCurve'|'rollUpDirection'|'rollUpSpeed'|'rollUpWait'|'rollUpTransition';direction:'previous'|'next';atTicks:string; }
export interface CaptionConnectionTiming { startTicks:string;endTicks:string;inTicks:string;outTicks:string; }
export interface NativeLineFitState { sizeScale:number;bubbleMode:1|2|3;paddingScale:number; }
export interface NativeLineFitStates { upcoming:NativeLineFitState;current:NativeLineFitState;spoken:NativeLineFitState; }
export interface NativeCaptionConnection extends CaptionConnectionTiming {
  kind:'native-effect';maxChars?:number;smartLineFit?:boolean;lineFitWidth?:number;lineFitFontScale?:number;lineFitStates?:NativeLineFitStates;disabled?:boolean;clipNodeId:string;projectItemId:string;trackIndex:number;clipIndex:number;selected:boolean;
  locator:NativeCaptionLocator;matchName:string;connectionRevision:string;documentText?:string;revision?:string;
}
export interface NativeCaptionExtensionReceipt { ok:true;revision:string;connection:NativeCaptionConnection;ticksPerFrame:string;targetEndTicks:string;targetOutTicks:string;canExtend:boolean; }
export interface NativeCaptionExtensionRequest { revision:string;documentText:string;endTicks:string;outTicks:string; }
export interface NativeCaptionExtensionResult { ok:true;connection:NativeCaptionConnection;readbackVerified:true;retry:'never'; }
export interface LegacyCaptionConnection extends CaptionConnectionTiming {
  kind:'generated-movie';disabled?:boolean;clipNodeId:string;projectItemId:string;path:string;trackIndex:number;clipIndex:number;startTime:number;endTime:number;selected:boolean;
}
export interface CaptionConnectionsReceipt {
  ok:true;version:1;readOnly:true;projectPath:string;sequenceId:string;nativeSequenceId:string;playhead:number;playheadTicks:string;
  selectedClipNodeIds:string[];native:NativeCaptionConnection[];legacy:LegacyCaptionConnection[];warnings:string[];
}
type ConnectionLink=Pick<CaptionItem,'id'|'clipNodeId'|'projectItemId'|'mediaPath'>;
function connectionLinks(links:ConnectionLink[]) {
  if(!Array.isArray(links)||links.length>10000)throw new Error('Invalid saved caption connection links.');
  const ids=new Set<string>();
  return links.map(link=>{
    if(!link||typeof link.id!=='string'||!link.id||link.id.length>256||ids.has(link.id)||typeof link.projectItemId!=='string'||!link.projectItemId||link.projectItemId.length>256||typeof link.mediaPath!=='string'||!link.mediaPath||link.mediaPath.length>4096)throw new Error('Invalid saved caption connection identity.');
    ids.add(link.id);return {id:link.id,projectItemId:link.projectItemId,mediaPath:link.mediaPath,...(typeof link.clipNodeId==='string'?{clipNodeId:link.clipNodeId}:{})};
  });
}

export function createHostAPI(nativeTranscript?: NativeTranscriptProvider) {
  const cep = window.__adobe_cep__;
  const contexts = new Map<string, CapturedContext>();
  let currentId = '', runtime: any = null, hostScript = '';
  let hostReady: Promise<void> | null = null;
  let hostReadinessFailedAt: number | null = null;
  if (cep) {
    const extension = cep.getSystemPath('extension');
    const root = extension.startsWith('file:') ? window.require!('node:url').fileURLToPath(extension) : extension;
    const path = window.require!('node:path');
    hostScript = path.join(root, 'host', 'bridge.jsx');
    runtime = window.require!(path.join(root, 'runtime.cjs'));
  }
  function captured(sequenceId = currentId): CapturedContext {
    const value = contexts.get(sequenceId);
    if (!value) throw new Error('Refresh the sequence in Better Captions first.');
    if (!value.projectPath || !value.dir) throw new Error('Save the Premiere project first so captions have a permanent home.');
    return value;
  }
  function responseError(method: string, raw: unknown, phase = 'host') {
    const preview = typeof raw === 'string' ? raw.slice(0, 240).replace(/[\u0000-\u001f\u007f]/g, ' ') : '';
    return Object.assign(new Error('Premiere did not return a valid caption response [' + method + '; ' + typeof raw + ']: ' + JSON.stringify(preview)), {
      details: { phase, method, responseType: typeof raw, responseLength: typeof raw === 'string' ? raw.length : null, responsePreview: preview },
    });
  }
  function ensureHostReady(): Promise<void> {
    if (!cep) return Promise.reject(new Error('Open Better Captions in Premiere to use the timeline.'));
    if (hostReady && hostReadinessFailedAt !== null && Date.now() - hostReadinessFailedAt >= 1000) {
      hostReady = null; hostReadinessFailedAt = null;
    }
    if (!hostReady) hostReady = new Promise<void>((resolve, reject) => {
      // This is a fixed extension-owned file, never a caller-supplied script.
      // Keep the bootstrap ES3 and independent of the host's optional JSON API.
      const file = JSON.stringify(hostScript).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      const script = String.raw`(function(){/*better-captions-host-ready-v1*/
var required=${JSON.stringify(HOST_BRIDGE_METHODS)},loaded=false;
function ready(namespace){if(typeof namespace!=='object'||namespace===null)return false;for(var i=0;i<required.length;i++)if(typeof namespace[required[i]]!=='function')return false;return true;}
function quoted(value){var text=String(value).slice(0,400),out='"';for(var i=0;i<text.length;i++){var c=text.charAt(i),n=text.charCodeAt(i);if(c==='"'||c==='\\')out+='\\'+c;else if(n<32||n===127)out+=' ';else out+=c;}return out+'"';}
try{var scope=$.global;if(!scope)throw new Error('Premiere did not expose the global script scope.');if(!ready(scope.BetterCaptionsHost)){var file=new File(${file});if(!file.exists)throw new Error('The installed Better Captions host script is missing.');$.evalFile(file);loaded=true;var namespace=typeof BetterCaptionsHost==='undefined'?null:BetterCaptionsHost;if(!ready(namespace))throw new Error('The installed Better Captions host did not expose every required method.');scope.BetterCaptionsHost=namespace;}if(!ready(scope.BetterCaptionsHost))throw new Error('The installed Better Captions host was not published globally.');return '{"version":1,"ok":true,"loaded":'+(loaded?'true':'false')+'}';}
catch(e){var line=Number(e&&e.line);return '{"version":1,"ok":false,"error":'+quoted(e)+',"line":'+(isFinite(line)&&line>0&&line<=10000000?String(Math.floor(line)):'null')+'}';}
})()`;
      // ExtendScript evalFile can place var declarations in the caller's scope.
      // Verify the published object from a separate evaluation, after the loader
      // IIFE has returned, before any actual host method is allowed to run.
      const verifyScript = `(function(){/*better-captions-host-global-v1*/try{var required=${JSON.stringify(HOST_BRIDGE_METHODS)},namespace=$.global.BetterCaptionsHost;if(typeof namespace!=='object'||namespace===null||typeof BetterCaptionsHost==='undefined'||BetterCaptionsHost!==namespace)return 'BC_HOST_GLOBAL_NOT_READY_V1';for(var i=0;i<required.length;i++)if(typeof namespace[required[i]]!=='function')return 'BC_HOST_GLOBAL_NOT_READY_V1';return 'BC_HOST_GLOBAL_READY_V1';}catch(e){return 'BC_HOST_GLOBAL_NOT_READY_V1';}})()`;
      const verifyGlobal = () => { try { cep.evalScript(verifyScript, (raw: unknown) => {
        if (raw !== 'BC_HOST_GLOBAL_READY_V1') return reject(responseError('host global readiness', raw, 'global verification'));
        resolve();
      }); } catch (error) { reject(responseError('host global readiness', String(error), 'global verification')); } };
      const bootstrap = () => { try { cep.evalScript(script, (raw: unknown) => {
        let data: any;
        try {
          if (typeof raw !== 'string' || raw.length > 4096) throw new Error();
          data = JSON.parse(raw);
        } catch { return reject(responseError('host readiness', raw, 'bootstrap')); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || typeof data.ok !== 'boolean') return reject(responseError('host readiness', raw, 'bootstrap'));
        if (data.ok !== true) {
          if (typeof data.error !== 'string' || data.error.length > 400 || !(data.line === null || Number.isInteger(data.line) && data.line > 0 && data.line <= 10000000)) return reject(responseError('host readiness', raw, 'bootstrap'));
          const message = data.error.replace(/[\u0000-\u001f\u007f]/g, ' ');
          return reject(Object.assign(new Error('Premiere could not initialize the Better Captions host: ' + message + (data.line === null ? '' : ' (line ' + data.line + ')')), { details: { phase: 'bootstrap', nativeError: message, line: data.line } }));
        }
        if (typeof data.loaded !== 'boolean') return reject(responseError('host readiness', raw, 'bootstrap'));
        verifyGlobal();
      }); } catch (error) { reject(responseError('host readiness', String(error), 'bootstrap')); } };
      // A literal has no dependency on the namespace, File, $, JSON or app.
      // Distinguish a broken CEP evaluator from failure to load our own JSX.
      try {
        cep.evalScript('"BC_NATIVE_EVAL_V1"', (raw: unknown) => {
          if (raw !== 'BC_NATIVE_EVAL_V1') return reject(responseError('native evaluator', raw, 'evaluator'));
          bootstrap();
        });
      } catch (error) { reject(responseError('native evaluator', String(error), 'evaluator')); }
    }).catch(error => { hostReadinessFailedAt = Date.now(); throw error; });
    // A later request may retry readiness after a short cooldown. Never retry
    // inside the failed request, or reset readiness after a host method ran.
    return hostReady;
  }
  function host(method: string, args: unknown[] = []): Promise<any> {
    return ensureHostReady().then(() => new Promise((resolve, reject) => {
      const serialized = args.map(x => JSON.stringify(x).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')).join(',');
      cep.evalScript('BetterCaptionsHost.' + method + '(' + serialized + ')', (raw: unknown) => {
        let data: any;
        try { if (typeof raw !== 'string') throw new Error(); data = JSON.parse(raw); } catch { return reject(responseError(method, raw)); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return reject(responseError(method, raw));
        if (data.error) {
          const explanation = data.rolledBack === false ? ' Some changes could not be restored. Use Premiere Undo and review the recovery job: ' + data.recoveryJob : '';
          const error = Object.assign(new Error(data.error + explanation), { details: data });
          if(data.code==='BC_OUTPUT_UNCONFIRMED'&&data.recoverable===false&&typeof data.outputApplied==='boolean')Object.assign(error,{code:data.code,recoverable:false,outputApplied:data.outputApplied});
          reject(error);
        } else resolve(data);
      });
    }));
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
  function timelinePayload(context: CapturedContext, captions: CaptionItem[], track: number, previous: CaptionItem[], deletedLinks: DeletedCaptionLink[] = []) {
    if (!Array.isArray(deletedLinks)) throw new Error('Invalid deleted caption links.');
    return { sequenceId: context.id, projectPath: context.projectPath, track, width: context.width, height: context.height, fps: context.fps, ...(deletedLinks.length ? { deletedLinks } : {}),
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
      if (data && !sameSavedSequence(data.sequenceId, context.id)) throw new Error('The saved captions belong to another sequence.');
      return data ? { ...data, sequenceId: context.id } : data;
    },
    async saveSession(session: any) {
      const data = JSON.parse(JSON.stringify(session));
      if (!cep) { localStorage.setItem('better-captions-fork-demo', JSON.stringify(data)); return; }
      // A slow previous sequence save must never use the latest active sequence's directory.
      const context=captured(data.sequenceId);
      if(data.projectPath!==undefined&&data.projectPath!==context.projectPath)throw new Error('The saved caption session belongs to another project path.');
      return runtime.save(context.dir, data);
    },
    async transcribeSequence(sequenceId = currentId) {
      if (!cep) throw new Error('Transcription is available in the Premiere panel.');
      if (!nativeTranscript) throw new Error('Open Window > UXP Plugins > Better Captions to use native transcription.');
      const context = await checkSequence(sequenceId), json = await nativeTranscript.transcribe(context);
      await checkSequence(sequenceId); return json;
    },
    async transcribeSequenceRange(_beginSeconds:number,_endSeconds:number,_sequenceId=currentId):Promise<string>{
      throw new Error('Extend captions is available in the installed Premiere panel.');
    },
    async getFonts() { return cep ? runtime.fonts() : ['Arial', 'Helvetica', 'Georgia', 'Verdana', 'Times New Roman', 'Impact']; },
    async getFontCatalog():Promise<FontCatalogEntry[]> {
      // BrowserPreview labels its synthetic fixture; installed Premiere always
      // reads the real runtime catalog and propagates any enumeration failure.
      if(!cep)return ['Arial','Helvetica','Georgia','Verdana','Times New Roman','Impact'].map(family=>({family,weights:family==='Impact'?[400]:[400,700],italic:family!=='Impact'}));
      return runtime.fontCatalog();
    },
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
    async preflightCaptionClips(captions: CaptionItem[], track: number, sequenceId: string, deletedLinks: DeletedCaptionLink[] = []) {
      const context = await checkSequence(sequenceId);
      return host('preflight', [jobFile(context, 'preflight', timelinePayload(context, captions, track, captions, deletedLinks))]);
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
    async prepareCaptionTrack(captions: CaptionItem[], track: number, sequenceId: string, previous: CaptionItem[] = captions, deletedLinks: DeletedCaptionLink[] = []) {
      const context = await checkSequence(sequenceId);
      captions.forEach(caption => generatedMedia(context, caption.mediaPath));
      previous.filter(caption => caption.clipNodeId).forEach(caption => generatedMedia(context, caption.mediaPath));
      const firstNew = track === -1 ? captions.find(caption => !caption.clipNodeId) : undefined;
      if (firstNew) {
        const probe = JSON.parse(await runtime.run(runtime.platform.resolveTool('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', firstNew.mediaPath], { timeout: 15000 }));
        if (!Array.isArray(probe.streams) || probe.streams.length !== 1 || probe.streams[0]?.codec_type !== 'video') throw new Error('Creating a caption track requires a generated video-only caption movie. No timeline changes were made.');
        await checkSequence(sequenceId);
      }
      const result = await host('prepareCaptionTrack', [jobFile(context, 'caption-track-job', timelinePayload(context, captions, track, previous, deletedLinks))]);
      if (result.seed) {
        if (!firstNew || result.seed.id !== firstNew.id || result.seed.path !== firstNew.mediaPath) throw new Error('Premiere returned a different temporary caption source. No track was created.');
        result.seed.videoOnly = true;
      }
      return result;
    },
    async applyCaptionClips(captions: CaptionItem[], track: number, sequenceId: string, previous: CaptionItem[] = captions, deletedLinks: DeletedCaptionLink[] = []) {
      const context = await checkSequence(sequenceId);
      captions.forEach(caption => generatedMedia(context, caption.mediaPath));
      previous.filter(caption => caption.clipNodeId).forEach(caption => generatedMedia(context, caption.mediaPath));
      return host('apply', [jobFile(context, 'timeline-job', timelinePayload(context, captions, track, previous, deletedLinks))]);
    },
    async readTimeline(captions: CaptionItem[], sequenceId = currentId) {
      const context = await checkSequence(sequenceId);
      return readJob('readTimeline', { sequenceId: context.id, projectPath: context.projectPath, cues: captions.map(c => ({ id: c.id, clipNodeId: c.clipNodeId,projectItemId:c.projectItemId,mediaPath:c.mediaPath,captionBundle:c.captionBundle })) });
    },
    async readCaptionConnections(sequenceId=currentId,knownLinks:ConnectionLink[]=[],options:{includeDocuments?:boolean}={}):Promise<CaptionConnectionsReceipt>{
      const links=connectionLinks(knownLinks);
      if(!options||typeof options!=='object'||Object.keys(options).some(key=>key!=='includeDocuments')||options.includeDocuments!==undefined&&typeof options.includeDocuments!=='boolean')throw new Error('Invalid caption discovery options.');
      const context=await checkSequence(sequenceId);
      return readJob('readCaptionConnections',{sequenceId:context.id,projectPath:context.projectPath,generatedRoot:context.dir,knownLinks:links,includeDocuments:options.includeDocuments!==false});
    },
    async createNativeCaptionDocument(request:any,sequenceId=currentId){
      if(!request || typeof request!=='object' || Object.keys(request).some(key=>!['documentText','startFrame','endFrame','sourceInTicks','geometry'].includes(key)))throw new Error('Invalid native caption creation request.');
      const frozen=JSON.parse(JSON.stringify(request)),context=await checkSequence(sequenceId);
      const document=decodeNativePanelDocument(frozen.documentText,sequenceId);
      const finalWord=document.captions.flatMap(c=>c.words).reduce((end,w)=>Math.max(end,w.end),0);
      if(!finalWord || frozen.endFrame!==Math.ceil(finalWord*context.fps-1e-7))throw new Error('Native caption duration differs from the verified transcript and frame rate.');
      if(document.timeOriginSeconds!==0 || frozen.startFrame!==0 || frozen.sourceInTicks!=='0')throw new Error('New native captions must use the verified zero source clock.');
      return readJob('createNativeCaptionDocument',{...frozen,version:1,creationId:window.require!('node:crypto').randomUUID(),projectPath:context.projectPath,sequenceId:context.id,
        width:context.width,height:context.height,ticksPerFrame:context.ticksPerFrame,expectedVideoTrackCount:context.tracks?.length});
    },
    async readNativeCaptionExtension(snapshot:NativeCaptionSnapshot,sequenceId=currentId):Promise<NativeCaptionExtensionReceipt>{
      if(!snapshot||typeof snapshot.revision!=='string'||snapshot.revision.length>16*1024*1024)throw new Error('Invalid caption extension snapshot.');
      const frozen=JSON.parse(JSON.stringify(snapshot)),context=await checkSequence(sequenceId);
      return readJob('readNativeCaptionExtension',{sequenceId:context.id,projectPath:context.projectPath,snapshot:frozen});
    },
    async extendNativeCaptionDocument(snapshot:NativeCaptionSnapshot,request:NativeCaptionExtensionRequest,sequenceId=currentId):Promise<NativeCaptionExtensionResult>{
      if(!snapshot||typeof snapshot.revision!=='string'||!request||typeof request.revision!=='string'||typeof request.documentText!=='string'||(request.documentText.length+1)*2>16*1024*1024)throw new Error('Invalid bounded caption extension.');
      const frozen=JSON.parse(JSON.stringify({snapshot,request})),context=await checkSequence(sequenceId);
      decodeNativePanelDocument(request.documentText,sequenceId);
      return readJob('extendNativeCaptionDocument',{sequenceId:context.id,projectPath:context.projectPath,...frozen});
    },
    async readNativeCaptionControls(snapshot:NativeCaptionSnapshot,sequenceId=currentId):Promise<NativeCaptionControls>{
      if(!snapshot||typeof snapshot!=='object'||typeof snapshot.revision!=='string'||snapshot.revision.length>16*1024*1024)throw new Error('Invalid native caption control snapshot.');
      const frozen=JSON.parse(JSON.stringify(snapshot)),context=await checkSequence(sequenceId);
      return readJob('readNativeCaptionControls',{sequenceId:context.id,projectPath:context.projectPath,snapshot:frozen});
    },
    async seekNativeCaptionKeyframe(snapshot:NativeCaptionSnapshot,request:NativeCaptionKeyframeSeek,sequenceId=currentId):Promise<NativeCaptionControls>{
      if(!snapshot||typeof snapshot!=='object'||typeof snapshot.revision!=='string'||snapshot.revision.length>16*1024*1024||!request||typeof request!=='object')throw new Error('Invalid native caption keyframe navigation.');
      const frozen=JSON.parse(JSON.stringify({snapshot,request})),context=await checkSequence(sequenceId);
      return readJob('seekNativeCaptionKeyframe',{sequenceId:context.id,projectPath:context.projectPath,...frozen});
    },
    async editNativeCaptionControl(snapshot:NativeCaptionSnapshot,request:NativeCaptionControlEdit,sequenceId=currentId):Promise<NativeCaptionControls>{
      if(!snapshot||typeof snapshot!=='object'||typeof snapshot.revision!=='string'||snapshot.revision.length>16*1024*1024||!request||typeof request!=='object')throw new Error('Invalid native caption control edit.');
      const frozen=JSON.parse(JSON.stringify({snapshot,request})),context=await checkSequence(sequenceId);
      return readJob('editNativeCaptionControl',{sequenceId:context.id,projectPath:context.projectPath,...frozen});
    },
    async writeNativeCaptionDocument(snapshot:NativeCaptionSnapshot,documentText:string,sequenceId=currentId){
      if(!snapshot||typeof snapshot!=='object'||typeof snapshot.revision!=='string'||snapshot.revision.length>16*1024*1024||typeof documentText!=='string'||(documentText.length+1)*2>16*1024*1024)throw new Error('Invalid bounded native caption update.');
      const frozen=JSON.parse(JSON.stringify(snapshot)),context=await checkSequence(sequenceId);
      return readJob('writeNativeCaptionDocument',{sequenceId:context.id,projectPath:context.projectPath,snapshot:frozen,documentText});
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
