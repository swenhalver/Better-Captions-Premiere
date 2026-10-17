import { createHostAPI } from '../webview-ui/src/cep-api';

/** Local-only transport for the single visible UXP Better Captions panel. */
export const SERVICE_ACTIONS = [
  'readCaptionConsolidation', 'stageCaptionConsolidation', 'verifyCaptionConsolidation', 'rollbackCaptionConsolidation',
  'getFonts', 'beginCaption', 'saveCaptionFrames', 'finishCaption',
  'preflightCaptionClips', 'prepareCaptionTrack', 'applyCaptionClips', 'readTimeline', 'showInPremiere',
  'selectCaptionClip', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionAreaDescriptor', 'patchCaptionKeyValues',
] as const;
const READ_ACTIONS = new Set(['getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionAreaDescriptor', 'readCaptionConsolidation', 'verifyCaptionConsolidation']);
const ARG_COUNTS: Record<string, number[]> = {
  readCaptionConsolidation:[1], stageCaptionConsolidation:[4], verifyCaptionConsolidation:[3], rollbackCaptionConsolidation:[3],
  getFonts: [0], beginCaption: [1], saveCaptionFrames: [3], finishCaption: [3, 4],
  preflightCaptionClips: [2], prepareCaptionTrack: [2, 3], applyCaptionClips: [2, 3], readTimeline: [1], showInPremiere: [1],
  selectCaptionClip: [1], readCaptionMotion: [1, 2], readCaptionGeometry: [1], readCaptionSelection: [1], readCaptionAreaDescriptor: [1], patchCaptionKeyValues: [2],
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
  if(request.action==='readCaptionMotion'&&request.args.length===2){
    const options=request.args[1];
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length!==1||options.includeDiagnostics!==true)throw new Error('Invalid caption service arguments.');
  }
  if (READ_ACTIONS.has(request.action)) {
    const expiresAt = request.expiresAt ?? request.createdAt + 10000;
    if (!Number.isFinite(expiresAt) || expiresAt < request.createdAt || expiresAt > request.createdAt + 10000 || now >= expiresAt) throw new Error('The caption read expired before execution. No native read was started.');
  }
  return request;
}

/** The envelope holds sequence identity; args contain only the method's other arguments. */
export async function dispatchServiceRequest(api: any, request: Request): Promise<unknown> {
  const info = await api.getActiveSequenceInfo(request.sequenceId);
  if (!info || info.id !== request.sequenceId || info.projectPath !== request.projectPath) throw new Error('The active Premiere sequence or project changed. Refresh Better Captions.');
  const [a, b, c, d] = request.args, id = info.id;
  switch (request.action) {
    case 'readCaptionConsolidation': return api.readCaptionConsolidation(a,id);
    case 'stageCaptionConsolidation': return api.stageCaptionConsolidation(a,b,c,d,id);
    case 'verifyCaptionConsolidation': return api.verifyCaptionConsolidation(a,b,c,id);
    case 'rollbackCaptionConsolidation': return api.rollbackCaptionConsolidation(a,b,c,id);
    case 'getFonts': return api.getFonts();
    case 'beginCaption': return api.beginCaption(a, id);
    case 'saveCaptionFrames': return api.saveCaptionFrames(a, b, c, id);
    case 'finishCaption': return api.finishCaption(a, b, c, id, d);
    case 'preflightCaptionClips': return api.preflightCaptionClips(a, b, id);
    case 'prepareCaptionTrack': return api.prepareCaptionTrack(a, b, id, c);
    case 'applyCaptionClips': return api.applyCaptionClips(a, b, id, c);
    case 'readTimeline': return api.readTimeline(a, id);
    case 'showInPremiere': return api.showInPremiere(a, id);
    case 'selectCaptionClip': return api.selectCaptionClip(a, id);
    case 'readCaptionMotion': return b === undefined ? api.readCaptionMotion(a, id) : api.readCaptionMotion(a, id, b);
    case 'readCaptionGeometry': return api.readCaptionGeometry(a, id);
    case 'readCaptionAreaDescriptor': return api.readCaptionAreaDescriptor(a, id);
    case 'patchCaptionKeyValues': return api.patchCaptionKeyValues(a, b, id);
    case 'readCaptionSelection': return api.readCaptionSelection(a, id);
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
    busy = true;
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
          const result = await dispatchServiceRequest(api, request);
          atomic(output, { version: 1, id, sequenceId: request.sequenceId, projectPath: request.projectPath, result: result ?? null });
        } catch (failure) {
          atomic(output, { version: 1, id, sequenceId: request?.sequenceId ?? null, projectPath: request?.projectPath ?? null, error: failure instanceof Error ? failure.message : String(failure) });
        } finally { currentRequest = null; try { fs.unlinkSync(claimed); } catch {} }
      }
    } finally { busy = false; if (alive) announce(); else release(); }
  }
  acquire();
  announce();
  const timer = setInterval(() => { void poll().catch(console.error); }, options.intervalMs ?? 250);
  const heartbeatTimer = setInterval(() => { if (alive) announce(); }, 3000);
  const stop = () => {
    alive = false; clearInterval(timer); clearInterval(heartbeatTimer);
    if (!busy) release();
  };
  win?.addEventListener('unload', stop, { once: true });
  void poll().catch(console.error);
  return { stop, poll, root: base, get active() { return ownsLock; } };
}

if (typeof window !== 'undefined' && (window as any).__adobe_cep__) startBackendService();
