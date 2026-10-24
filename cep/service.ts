import { createHostAPI } from '../webview-ui/src/cep-api';

/** Local-only transport for the single visible UXP S-Captions panel. */
export const SERVICE_ACTIONS = [
  'readCaptionConsolidation', 'stageCaptionConsolidation', 'verifyCaptionConsolidation', 'rollbackCaptionConsolidation',
  'getFonts', 'getFontCatalog', 'beginCaption', 'saveCaptionFrames', 'finishCaption',
  'preflightCaptionClips', 'prepareCaptionTrack', 'applyCaptionClips', 'readTimeline', 'showInPremiere',
  'selectCaptionClip', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionAreaDescriptor', 'patchCaptionKeyValues',
  'readCaptionConnections', 'readNativeCaptionControls', 'readNativeCaptionExtension', 'extendNativeCaptionDocument', 'editNativeCaptionControl', 'seekNativeCaptionKeyframe', 'writeNativeCaptionDocument', 'restoreNativeCaptionDocument', 'undoNativeCaptionSteps', 'stepNativeHistoryForTest', 'createNativeCaptionDocument',
] as const;
const READ_ACTIONS = new Set(['getFonts', 'getFontCatalog', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionConnections', 'readNativeCaptionControls', 'readNativeCaptionExtension', 'readCaptionAreaDescriptor', 'readCaptionConsolidation', 'verifyCaptionConsolidation']);
const ARG_COUNTS: Record<string, number[]> = {
  readCaptionConsolidation:[1], stageCaptionConsolidation:[4], verifyCaptionConsolidation:[3], rollbackCaptionConsolidation:[3],
  getFonts: [0], getFontCatalog: [0], beginCaption: [1], saveCaptionFrames: [3], finishCaption: [3, 4],
  preflightCaptionClips: [2, 3], prepareCaptionTrack: [2, 3, 4], applyCaptionClips: [2, 3, 4], readTimeline: [1], showInPremiere: [1],
  selectCaptionClip: [1], readCaptionMotion: [1, 2], readCaptionGeometry: [1], readCaptionSelection: [1], readCaptionAreaDescriptor: [1], patchCaptionKeyValues: [2],
  readNativeCaptionExtension:[1],extendNativeCaptionDocument:[2],readNativeCaptionControls:[1],editNativeCaptionControl:[2],seekNativeCaptionKeyframe:[2],readCaptionConnections:[2],writeNativeCaptionDocument:[2],restoreNativeCaptionDocument:[3],undoNativeCaptionSteps:[3],stepNativeHistoryForTest:[1],createNativeCaptionDocument:[1],
};
interface Request { version: number; id: string; createdAt: number; expiresAt?: number; sequenceId: string; projectPath: string; action: string; args: any[]; }
interface ServiceOptions { api?: any; fs?: any; path?: any; os?: any; crypto?: any; process?: any; platform?: any; root?: string; intervalMs?: number; maxRequestsPerPoll?: number; }

export function validateServiceRequest(value: unknown, filename: string, now = Date.now()): Request {
  const request = value as Request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.version !== 1 || !/^[a-f0-9]{32}$/.test(request.id) || filename !== request.id + '.json') throw new Error('Invalid caption service request identity.');
  if (!Number.isFinite(request.createdAt) || Math.abs(now - request.createdAt) > 120000) throw new Error('Caption service request expired.');
  const project = request.projectPath;
  const localProject = typeof project === 'string' && (/^\/(?!\/)/.test(project) || /^[a-z]:[\\/]/i.test(project)) && !/[\u0000-\u001f]/.test(project) && !project.split(/[\\/]/).some(part => part === '.' || part === '..');
  if (typeof request.sequenceId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(request.sequenceId) || !localProject || project.length > 4096) throw new Error('Invalid captured Premiere sequence or project.');
  if (!SERVICE_ACTIONS.includes(request.action as typeof SERVICE_ACTIONS[number])) throw new Error('Unsupported caption service action.');
  if (!Array.isArray(request.args) || !ARG_COUNTS[request.action].includes(request.args.length)) throw new Error('Invalid caption service arguments.');
  const deletionIndex = request.action === 'preflightCaptionClips' ? 2 : ['prepareCaptionTrack', 'applyCaptionClips'].includes(request.action) ? 3 : -1;
  if (deletionIndex >= 0 && request.args.length > deletionIndex && !Array.isArray(request.args[deletionIndex])) throw new Error('Invalid caption service arguments.');
  if(request.action==='readCaptionMotion'&&request.args.length===2){
    const options=request.args[1];
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length!==1||options.includeDiagnostics!==true)throw new Error('Invalid caption service arguments.');
  }
  if(request.action==='readCaptionConnections'){
    const [links,options]=request.args;
    if(!Array.isArray(links)||links.length>10000||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length!==1||typeof options.includeDocuments!=='boolean')throw new Error('Invalid caption discovery arguments.');
  }
  if (READ_ACTIONS.has(request.action)) {
    const expiresAt = request.expiresAt ?? request.createdAt + 10000;
    if (!Number.isFinite(expiresAt) || expiresAt < request.createdAt || expiresAt > request.createdAt + 10000 || now >= expiresAt) throw new Error('The caption read expired before execution. No native read was started.');
  }
  return request;
}

/** The envelope holds sequence identity; args contain only the method's other arguments. */
export async function dispatchServiceRequest(api: any, request: Request): Promise<unknown> {
  // These fixed native jobs validate the captured envelope inside the same
  // host evaluation as their document/clip/clock checks. Avoid two preceding
  // context evalScript round trips for every interactive numeric movement.
  if (['readNativeCaptionControls','editNativeCaptionControl','seekNativeCaptionKeyframe'].includes(request.action) && typeof api.dispatchNativeCaptionControlRequest === 'function') {
    return api.dispatchNativeCaptionControlRequest({action:request.action,sequenceId:request.sequenceId,projectPath:request.projectPath,args:request.args});
  }
  const info = await api.getActiveSequenceInfo(request.sequenceId);
  if (!info || info.id !== request.sequenceId || info.projectPath !== request.projectPath) throw new Error('The active Premiere sequence or project changed. Refresh S-Captions.');
  const [a, b, c, d] = request.args, id = info.id;
  switch (request.action) {
    case 'readCaptionConsolidation': return api.readCaptionConsolidation(a,id);
    case 'stageCaptionConsolidation': return api.stageCaptionConsolidation(a,b,c,d,id);
    case 'verifyCaptionConsolidation': return api.verifyCaptionConsolidation(a,b,c,id);
    case 'rollbackCaptionConsolidation': return api.rollbackCaptionConsolidation(a,b,c,id);
    case 'getFonts': return api.getFonts();
    case 'getFontCatalog': return api.getFontCatalog();
    case 'beginCaption': return api.beginCaption(a, id);
    case 'saveCaptionFrames': return api.saveCaptionFrames(a, b, c, id);
    case 'finishCaption': return api.finishCaption(a, b, c, id, d);
    case 'preflightCaptionClips': return api.preflightCaptionClips(a, b, id, ...(request.args.length > 2 ? [c] : []));
    case 'prepareCaptionTrack': return api.prepareCaptionTrack(a, b, id, c, ...(request.args.length > 3 ? [d] : []));
    case 'applyCaptionClips': return api.applyCaptionClips(a, b, id, c, ...(request.args.length > 3 ? [d] : []));
    case 'readTimeline': return api.readTimeline(a, id);
    case 'showInPremiere': return api.showInPremiere(a, id);
    case 'selectCaptionClip': return api.selectCaptionClip(a, id);
    case 'readCaptionMotion': return b === undefined ? api.readCaptionMotion(a, id) : api.readCaptionMotion(a, id, b);
    case 'readCaptionGeometry': return api.readCaptionGeometry(a, id);
    case 'readCaptionAreaDescriptor': return api.readCaptionAreaDescriptor(a, id);
    case 'patchCaptionKeyValues': return api.patchCaptionKeyValues(a, b, id);
    case 'readCaptionSelection': return api.readCaptionSelection(a, id);
    case 'readCaptionConnections': return api.readCaptionConnections(id,a,b);
    case 'createNativeCaptionDocument': return api.createNativeCaptionDocument(a,id);
    case 'readNativeCaptionExtension': return api.readNativeCaptionExtension(a,id);
    case 'extendNativeCaptionDocument': return api.extendNativeCaptionDocument(a,b,id);
    case 'readNativeCaptionControls': return api.readNativeCaptionControls(a,id);
    case 'seekNativeCaptionKeyframe': return api.seekNativeCaptionKeyframe(a,b,id);
    case 'editNativeCaptionControl': return api.editNativeCaptionControl(a,b,id);
    case 'writeNativeCaptionDocument': return api.writeNativeCaptionDocument(a,b,id);
    case 'restoreNativeCaptionDocument': return api.restoreNativeCaptionDocument(a,b,c,id);
    case 'undoNativeCaptionSteps': return api.undoNativeCaptionSteps(a,b,c,id);
    case 'stepNativeHistoryForTest': return api.stepNativeHistoryForTest(a,id);
    default: throw new Error('Unsupported caption service action.');
  }
}

export function startBackendService(options: ServiceOptions = {}) {
  const win = typeof window === 'undefined' ? undefined : window as any;
  const requireNode = win?.require;
  if (!options.api && (!win?.__adobe_cep__ || typeof requireNode !== 'function')) throw new Error('The caption background service must run in Premiere CEP.');
  const api = options.api ?? createHostAPI();
  const fs = options.fs ?? requireNode('node:fs'), path = options.path ?? requireNode('node:path');
  const crypto = options.crypto ?? requireNode('node:crypto');
  const processAPI = options.process ?? requireNode('node:process');
  const extension = win?.__adobe_cep__?.getSystemPath('extension');
  const extensionRoot = extension?.startsWith('file:') ? requireNode('node:url').fileURLToPath(extension) : extension;
  const platform = options.platform ?? requireNode(path.join(extensionRoot, 'platform.cjs'));
  const base = options.root ?? path.join(platform.dataRoot(), 'service');
  const instanceId = crypto.randomBytes(12).toString('hex');
  for (const folder of [path.dirname(base), base, path.join(base, 'requests'), path.join(base, 'responses')]) {
    platform.secureDirectory(folder);
  }
  const requests = path.join(base, 'requests'), responses = path.join(base, 'responses'), heartbeat = path.join(base, 'service.json');
  const lock = path.join(base, 'worker.lock.json'), recoveryLock = path.join(base, 'worker-recovery.lock.json');
  const owner = { version: 1, instanceId, pid: processAPI.pid };
  let busy = false, alive = true, ownsLock = false, currentRequest: string | null = null;
  // The hidden CEP worker survives visible-panel close/blur. Clearing the
  // lease is a real parameter update, so the Program Monitor cache refreshes.
  // Startup also reclaims any lease retained in Premiere's host namespace.
  let guideSweepPending = typeof api.clearExpiredNativeCaptionGuides === 'function', guideSweepAt = Date.now();
  let watcher:any=null,wakeTimer:ReturnType<typeof setTimeout>|undefined,wakePending=false;
  function wake(){
    if(!alive)return;wakePending=true;if(busy||wakeTimer!==undefined)return;
    wakeTimer=setTimeout(()=>{wakeTimer=undefined;if(alive)void poll().catch(console.error);},0);
    (wakeTimer as any)?.unref?.();
  }
  function lockOwner(file: string) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid caption worker ownership file.');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || !Number.isSafeInteger(value.pid) || value.pid < 1 || !/^[a-f0-9]{24}$/.test(value.instanceId)) throw new Error('Invalid caption worker identity.');
    return value;
  }
  function ownerAlive(value: any) {
    try { processAPI.kill(value.pid, 0); return true; }
    catch (error) { return (error as {code?:string}).code !== 'ESRCH'; }
  }
  function exclusive(file: string) {
    try { fs.writeFileSync(file, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }); return true; }
    catch (error) { if ((error as {code?:string}).code === 'EEXIST') return false; throw error; }
  }
  function removeOwned(file: string) {
    try { if (lockOwner(file).instanceId === instanceId) fs.unlinkSync(file); } catch {}
  }
  function acquire() {
    if (ownsLock) return true;
    if (exclusive(lock)) { ownsLock = true; return true; }
    // Never steal a live worker, even if its heartbeat is stale while native
    // Premiere work is blocked. A timeout cannot cancel that native call.
    if (ownerAlive(lockOwner(lock))) return false;
    if (!exclusive(recoveryLock)) {
      const recovering = lockOwner(recoveryLock);
      if (ownerAlive(recovering)) return false;
      // A crashed recovery can only be removed after its process is gone.
      if (lockOwner(recoveryLock).instanceId === recovering.instanceId) fs.unlinkSync(recoveryLock);
      if (!exclusive(recoveryLock)) return false;
    }
    try {
      let previous;
      try { previous = lockOwner(lock); } catch (error) { if ((error as {code?:string}).code !== 'ENOENT') throw error; }
      if (previous && ownerAlive(previous)) return false;
      if (previous) fs.unlinkSync(lock);
      ownsLock = exclusive(lock); return ownsLock;
    } finally { removeOwned(recoveryLock); }
  }
  const atomic = (file: string, data: unknown) => {
    const temp = file + '.tmp-' + instanceId;
    fs.writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  const announce = () => { if (ownsLock) atomic(heartbeat, { version: 1, instanceId, updatedAt: Date.now(), busy, requestId: currentRequest, actions: SERVICE_ACTIONS }); };
  function release() {
    if (!ownsLock) return;
    try { if (JSON.parse(fs.readFileSync(heartbeat, 'utf8')).instanceId === instanceId) fs.unlinkSync(heartbeat); } catch {}
    removeOwned(lock); ownsLock = false;
  }
  async function poll() {
    if (!alive || busy || !acquire()) return;
    busy = true;wakePending=false;
    try {
      const pending = fs.readdirSync(requests).filter((name: string) => /^[a-f0-9]{32}\.json$/.test(name)).sort();
      const started = Date.now(), quota = Math.max(1, Math.min(4, options.maxRequestsPerPoll ?? 4));
      let processed = 0;
      for (const name of pending) {
        if (!alive || processed >= quota || (processed > 0 && Date.now() - started >= 100)) break;
        const input = path.join(requests, name), output = path.join(responses, name), id = name.slice(0, -5);
        let stat;
        try { stat = fs.lstatSync(input); } catch { continue; }
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const claimed = path.join(requests, '.processing-' + id + '-' + instanceId);
        // An atomic claim prevents a second CEP instance from executing the same mutation.
        try { fs.renameSync(input, claimed); } catch { continue; }
        processed++;
        let request: Request | undefined;
        currentRequest = id; announce();
        try {
          if (fs.existsSync(output)) continue; // Completed request IDs are idempotent.
          if (stat.size > 40 * 1024 * 1024) throw new Error('Caption service request is too large.');
          request = validateServiceRequest(JSON.parse(fs.readFileSync(claimed, 'utf8')), name);
          if (request.action === 'editNativeCaptionControl' && ['position','width','height'].includes(request.args[1]?.parameter)) {
            guideSweepPending = typeof api.clearExpiredNativeCaptionGuides === 'function'; guideSweepAt = Date.now() + 800;
          }
          const result = await dispatchServiceRequest(api, request);
          atomic(output, { version: 1, id, sequenceId: request.sequenceId, projectPath: request.projectPath, result: result ?? null });
        } catch (failure) {
          const nativeFailure=failure as {code?:string;recoverable?:boolean;outputApplied?:boolean};
          const metadata=nativeFailure?.code==='BC_OUTPUT_UNCONFIRMED'&&nativeFailure.recoverable===false&&typeof nativeFailure.outputApplied==='boolean'
            ? {code:'BC_OUTPUT_UNCONFIRMED',recoverable:false,outputApplied:nativeFailure.outputApplied}:{};
          atomic(output, { version: 1, id, sequenceId: request?.sequenceId ?? null, projectPath: request?.projectPath ?? null, error: failure instanceof Error ? failure.message : String(failure),...metadata });
        } finally { currentRequest = null; try { fs.unlinkSync(claimed); } catch {} }
      }
      if (guideSweepPending && Date.now() >= guideSweepAt) {
        guideSweepAt = Date.now() + 250;
        try { const result = await api.clearExpiredNativeCaptionGuides(); guideSweepPending = result?.pending > 0; }
        catch { /* Keep trying after a busy host/project switch; native TTL still expires. */ }
      }
    } finally { busy = false; if (alive) { announce(); if(wakePending)wake(); } else release(); }
  }
  acquire();
  announce();
  const timer = setInterval(() => { void poll().catch(console.error); }, options.intervalMs ?? 250);
  // Wake for completed atomic request-file renames instead of making native
  // drags wait up to the 250ms fallback tick. No fast idle polling is added.
  // The unchanged claim/validation path still serializes and bounds every job.
  try { if(typeof fs.watch==='function'){
    watcher=fs.watch(requests,{persistent:false},(_event:unknown,filename:unknown)=>{
      if(!alive||typeof filename!=='string'||!/^[a-f0-9]{32}\.json$/.test(filename))return;
      if(fs.existsSync(path.join(requests,filename)))wake();
    });
    watcher.on?.('error',()=>{try{watcher?.close();}catch{}watcher=null;});
  }}catch{watcher=null;}
  const heartbeatTimer = setInterval(() => { if (alive) announce(); }, 3000);
  const stop = () => {
    alive = false; clearInterval(timer); clearInterval(heartbeatTimer);
    if(wakeTimer!==undefined){clearTimeout(wakeTimer);wakeTimer=undefined;}
    try{watcher?.close();}catch{}watcher=null;
    if (!busy) release();
  };
  win?.addEventListener('unload', stop, { once: true });
  void poll().catch(console.error);
  return { stop, poll, root: base, get active() { return ownsLock; } };
}

if (typeof window !== 'undefined' && (window as any).__adobe_cep__) startBackendService();
