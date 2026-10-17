import { createHostAPI } from '../webview-ui/src/cep-api';

/** Local-only transport for the single visible UXP Better Captions panel. */
export const SERVICE_ACTIONS = [
  'getFonts', 'beginCaption', 'saveCaptionFrames', 'finishCaption',
  'preflightCaptionClips', 'applyCaptionClips', 'readTimeline', 'showInPremiere',
] as const;
const ARG_COUNTS: Record<string, number[]> = {
  getFonts: [0], beginCaption: [1], saveCaptionFrames: [3], finishCaption: [3],
  preflightCaptionClips: [2], applyCaptionClips: [2, 3], readTimeline: [1], showInPremiere: [1],
};
interface Request { version: number; id: string; createdAt: number; sequenceId: string; projectPath: string; action: string; args: any[]; }
interface ServiceOptions { api?: any; fs?: any; path?: any; os?: any; crypto?: any; root?: string; intervalMs?: number; }

export function validateServiceRequest(value: unknown, filename: string, now = Date.now()): Request {
  const request = value as Request;
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.version !== 1 || !/^[a-f0-9]{32}$/.test(request.id) || filename !== request.id + '.json') throw new Error('Invalid caption service request identity.');
  if (!Number.isFinite(request.createdAt) || Math.abs(now - request.createdAt) > 120000) throw new Error('Caption service request expired.');
  if (typeof request.sequenceId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(request.sequenceId) || typeof request.projectPath !== 'string' || !request.projectPath.startsWith('/') || request.projectPath.length > 4096) throw new Error('Invalid captured Premiere sequence or project.');
  if (!SERVICE_ACTIONS.includes(request.action as typeof SERVICE_ACTIONS[number])) throw new Error('Unsupported caption service action.');
  if (!Array.isArray(request.args) || !ARG_COUNTS[request.action].includes(request.args.length)) throw new Error('Invalid caption service arguments.');
  return request;
}

/** The envelope holds sequence identity; args contain only the method's other arguments. */
export async function dispatchServiceRequest(api: any, request: Request): Promise<unknown> {
  const info = await api.getActiveSequenceInfo(request.sequenceId);
  if (!info || info.id !== request.sequenceId || info.projectPath !== request.projectPath) throw new Error('The active Premiere sequence or project changed. Refresh Better Captions.');
  const [a, b, c] = request.args, id = info.id;
  switch (request.action) {
    case 'getFonts': return api.getFonts();
    case 'beginCaption': return api.beginCaption(a, id);
    case 'saveCaptionFrames': return api.saveCaptionFrames(a, b, c, id);
    case 'finishCaption': return api.finishCaption(a, b, c, id);
    case 'preflightCaptionClips': return api.preflightCaptionClips(a, b, id);
    case 'applyCaptionClips': return api.applyCaptionClips(a, b, id, c);
    case 'readTimeline': return api.readTimeline(a, id);
    case 'showInPremiere': return api.showInPremiere(a, id);
    default: throw new Error('Unsupported caption service action.');
  }
}

export function startBackendService(options: ServiceOptions = {}) {
  const win = typeof window === 'undefined' ? undefined : window as any;
  const requireNode = win?.require;
  if (!options.api && (!win?.__adobe_cep__ || typeof requireNode !== 'function')) throw new Error('The caption background service must run in Premiere CEP.');
  const api = options.api ?? createHostAPI();
  const fs = options.fs ?? requireNode('node:fs'), path = options.path ?? requireNode('node:path');
  const os = options.os ?? requireNode('node:os'), crypto = options.crypto ?? requireNode('node:crypto');
  const base = options.root ?? path.join(os.homedir(), 'Library', 'Application Support', 'Better Captions', 'service');
  const instanceId = crypto.randomBytes(12).toString('hex');
  for (const folder of [path.dirname(base), base, path.join(base, 'requests'), path.join(base, 'responses')]) {
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The caption service folder must be a real private directory.');
    fs.chmodSync(folder, 0o700);
  }
  const requests = path.join(base, 'requests'), responses = path.join(base, 'responses'), heartbeat = path.join(base, 'service.json');
  let busy = false, alive = true, currentRequest: string | null = null;
  const atomic = (file: string, data: unknown) => {
    const temp = file + '.tmp-' + instanceId;
    fs.writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
    try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  const announce = () => atomic(heartbeat, { version: 1, instanceId, updatedAt: Date.now(), busy, requestId: currentRequest, actions: SERVICE_ACTIONS });
  async function poll() {
    if (!alive || busy) return;
    busy = true;
    try {
      const pending = fs.readdirSync(requests).filter((name: string) => /^[a-f0-9]{32}\.json$/.test(name)).sort();
      for (const name of pending) {
        if (!alive) break;
        const input = path.join(requests, name), output = path.join(responses, name), id = name.slice(0, -5);
        let stat;
        try { stat = fs.lstatSync(input); } catch { continue; }
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const claimed = path.join(requests, '.processing-' + id + '-' + instanceId);
        // An atomic claim prevents a second CEP instance from executing the same mutation.
        try { fs.renameSync(input, claimed); } catch { continue; }
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
    } finally { busy = false; if (alive) announce(); }
  }
  announce();
  const timer = setInterval(() => { void poll().catch(console.error); }, options.intervalMs ?? 250);
  const heartbeatTimer = setInterval(() => { if (alive) announce(); }, 3000);
  const stop = () => {
    alive = false; clearInterval(timer); clearInterval(heartbeatTimer);
    try { if (JSON.parse(fs.readFileSync(heartbeat, 'utf8')).instanceId === instanceId) fs.unlinkSync(heartbeat); } catch {}
  };
  win?.addEventListener('unload', stop, { once: true });
  void poll().catch(console.error);
  return { stop, poll, root: base };
}

if (typeof window !== 'undefined' && (window as any).__adobe_cep__) startBackendService();
