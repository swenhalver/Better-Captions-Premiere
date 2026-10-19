import { createHostAPI } from './cep-api';
import { startAgentBridge } from './lib/agent-bridge';
import type { AgentHandler } from './lib/agent-bridge';

const CHANNEL = 'better-captions';
const HOST_METHODS = [
  'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'saveSession', 'loadStylePresets', 'saveStylePresets',
  'transcribeSequence', 'getFonts', 'getFontCatalog', 'showInPremiere', 'beginCaption',
  'saveCaptionFrames', 'finishCaption', 'preflightCaptionClips',
  'applyCaptionClips', 'readTimeline', 'selectCaptionClip', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionConnections', 'writeNativeCaptionDocument', 'createNativeCaptionDocument', 'readCaptionArea', 'editCaptionArea', 'getColorScheme', 'readCaptionConsolidation', 'applyConsolidatedCaption',
] as const;
const READ_METHODS = new Set(['loadStylePresets', 'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'getFonts', 'getFontCatalog', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionConnections', 'readCaptionArea', 'readCaptionConsolidation']);
// Internal position sampling may report lane availability, but cannot be
// requested through the webview's RPC allowlist.
const AVAILABILITY_METHODS = new Set<string>([...HOST_METHODS, 'readTimelinePlayhead']);
const TRANSPORT_CODES = new Set(['BC_NATIVE_PENDING', 'BC_NATIVE_WAITING', 'BC_NATIVE_QUEUE_EXPIRED', 'BC_NATIVE_BUSY', 'BC_RENDERER_UNAVAILABLE', 'BC_NATIVE_CLOSED', 'BC_OUTPUT_UNCONFIRMED']);
export interface NativeTransportAvailability {
  version: 1;
  revision: number;
  state: 'ready' | 'waiting' | 'closed';
  method: string | null;
  reason: 'idle' | 'native-timeout' | 'panel-timeout' | 'closed';
}
export interface NativeTransportError extends Error {
  code: string;
  method: string;
  recoverable: boolean;
  operationPending: boolean;
}
interface UXPMessageHost {
  postMessage: (message: unknown) => void;
}
interface Message {
  channel?: string; id?: string; method?: string; args?: unknown[];
  result?: unknown; error?: { message?: string; code?: unknown; method?: unknown; recoverable?: unknown; operationPending?: unknown; outputApplied?:unknown } | string;
  type?: string; visible?: boolean;
}
function nativeTransport(host: UXPMessageHost, webviewAPI: unknown) {
  let nextId = 0, handler: AgentHandler | null = null;
  const callbacks = webviewAPI as Record<string, (...args: never[]) => unknown>;
  const pending = new Map<string, { method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const prefix = 'ui-' + Date.now().toString(36) + '-';
  const unresolved = new Map<string, string>();
  const availabilityListeners = new Set<(status: NativeTransportAvailability) => void>();
  let closed = false;
  let nativeAvailability: NativeTransportAvailability = { version: 1, revision: -1, state: 'ready', method: null, reason: 'idle' };
  let availability: NativeTransportAvailability = { version: 1, revision: 0, state: 'ready', method: null, reason: 'idle' };
  function transportError(message: string, code: string, method: string, recoverable: boolean, operationPending: boolean): NativeTransportError {
    return Object.assign(new Error(message), { code, method, recoverable, operationPending });
  }
  function publishAvailability() {
    const localMethod = unresolved.values().next().value as string | undefined;
    const next = closed || nativeAvailability.state === 'closed' ? { state: 'closed' as const, method: null, reason: 'closed' as const }
      : nativeAvailability.state === 'waiting' ? { state: 'waiting' as const, method: nativeAvailability.method, reason: 'native-timeout' as const }
      : localMethod ? { state: 'waiting' as const, method: localMethod, reason: 'panel-timeout' as const }
      : { state: 'ready' as const, method: null, reason: 'idle' as const };
    if (availability.state === next.state && availability.method === next.method && availability.reason === next.reason) return;
    availability = { version: 1, revision: availability.revision + 1, ...next };
    for (const listener of availabilityListeners) { try { listener({ ...availability }); } catch { /* UI observers cannot release or block the lane. */ } }
  }
  function receiveAvailability(value: unknown) {
    const status = value as NativeTransportAvailability | null;
    if (closed || nativeAvailability.state === 'closed') return;
    if (!status || status.version !== 1 || !Number.isSafeInteger(status.revision) || status.revision < 0 || status.revision <= nativeAvailability.revision) return;
    if (status.state === 'ready') { if (status.method !== null || status.reason !== 'idle') return; }
    else if (status.state === 'waiting') { if (typeof status.method !== 'string' || !AVAILABILITY_METHODS.has(status.method) || status.reason !== 'native-timeout') return; }
    else if (status.state === 'closed') { if (status.method !== null && (typeof status.method !== 'string' || !AVAILABILITY_METHODS.has(status.method))) return; if (status.reason !== 'closed') return; }
    else return;
    nativeAvailability = { version: 1, revision: status.revision, state: status.state, method: status.method, reason: status.reason };
    publishAvailability();
  }
  function responseError(value: NonNullable<Message['error']>, method: string): Error {
    const message = (typeof value === 'string' ? value : typeof value.message === 'string' ? value.message : 'Premiere caption operation failed.').slice(0, 4000);
    if (typeof value !== 'string' && value.code === 'BC_OUTPUT_UNCONFIRMED' && value.method === method && value.recoverable === false && typeof value.outputApplied === 'boolean') return Object.assign(transportError(message,value.code,method,false,false),{outputApplied:value.outputApplied});
    if (typeof value === 'string' || typeof value.code !== 'string' || !TRANSPORT_CODES.has(value.code) || value.method !== method || typeof value.recoverable !== 'boolean' || typeof value.operationPending !== 'boolean') return new Error(message);
    return transportError(message, value.code, method, value.recoverable && (value.code !== 'BC_NATIVE_PENDING' || READ_METHODS.has(method)), value.operationPending);
  }
  function call(method: string, args: unknown[] = []): Promise<unknown> {
    if (closed || nativeAvailability.state === 'closed') return Promise.reject(transportError('The caption editor was closed.', 'BC_NATIVE_CLOSED', method, false, false));
    if (unresolved.size || nativeAvailability.state === 'waiting') return Promise.reject(transportError('A previous Premiere operation has not returned. Native requests are paused; its timeout did not cancel the operation.', 'BC_NATIVE_WAITING', method, true, true));
    if(pending.size>=16)return Promise.reject(transportError('The caption panel is busy. Wait for its current operations to finish.', 'BC_NATIVE_BUSY', method, true, false));
    const id = prefix + ++nextId;
    const timeout = READ_METHODS.has(method)?15000:method === 'transcribeSequence' ? 60 * 60 * 1000 : ['finishCaption','applyCaptionClips','applyConsolidatedCaption'].includes(method) ? 30 * 60 * 1000 : 60 * 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id); unresolved.set(id, method); publishAvailability();
        reject(transportError('Premiere did not finish the caption operation. Native requests are paused until its response returns; the timeout did not cancel Premiere’s work.', 'BC_NATIVE_PENDING', method, READ_METHODS.has(method), true));
      }, timeout);
      pending.set(id, { method, resolve, reject, timer });
      try { host.postMessage({ channel: CHANNEL, id, method, args }); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  function send(data: Message) { host.postMessage({ channel: CHANNEL, ...data }); }
  async function receive(event: MessageEvent & { message?: unknown }) {
    let data: Message;
    const raw = event.data ?? event.message;
    try { data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Message; } catch { return; }
    if (!data || data.channel !== CHANNEL) return;
    if(data.type==='better-captions-native-availability') { receiveAvailability(data); return; }
    // The same window message reaches main-webview's visibility listener.
    if(data.type==='better-captions-panel-visibility'&&typeof data.visible==='boolean')return;
    if (!data.method) {
      if (!data.id) return;
      unresolved.delete(data.id);
      const request = pending.get(data.id);
      if (!request) { publishAvailability(); return; }
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) request.reject(responseError(data.error, request.method));
      else request.resolve(data.result);
      publishAvailability();
      return;
    }
    if (data.method.startsWith("agent.") && (!data.id || !/^host-[a-zA-Z0-9_-]{1,100}$/.test(data.id))) return;
    const args = Array.isArray(data.args) ? data.args : [];
    try {
      let result: unknown;
      switch (data.method) {
        case 'ui.sequenceActivated': callbacks.onSequenceActivated?.(); return;
        case 'ui.sequenceClosed': callbacks.onSequenceClosed?.(); return;
        case 'ui.timelinePlayhead': callbacks.onTimelinePlayhead?.(...args as never[]); return;
        case 'ui.colorScheme': callbacks.updateColorScheme?.(...args as never[]); return;
        case 'agent.getState': if (!handler) throw new Error('The caption editor is not ready.'); result = await handler.getState(); break;
        case 'agent.patchStyle': if (!handler) throw new Error('The caption editor is not ready.'); result = await handler.patchStyle(args[0] as Parameters<AgentHandler['patchStyle']>[0]); break;
        case 'agent.patchAnimation': if (!handler?.patchAnimation) throw new Error('Animation editing is unavailable.'); result = await handler.patchAnimation(args[0] as Parameters<NonNullable<AgentHandler['patchAnimation']>>[0]); break;
        case 'agent.setCaptions': if (!handler) throw new Error('The caption editor is not ready.'); result = await handler.setCaptions(args[0] as Parameters<AgentHandler['setCaptions']>[0]); break;
        case 'agent.refresh': if (!handler) throw new Error('The caption editor is not ready.'); result = await handler.refresh(); break;
        case 'agent.apply': if (!handler) throw new Error('The caption editor is not ready.'); result = await handler.apply(); break;
        case 'agent.readArea': if (!handler?.readArea) throw new Error('Caption area inspection is unavailable.'); result = await handler.readArea(args[0]); break;
        case 'agent.editArea': if (!handler?.editArea) throw new Error('Caption area editing is unavailable.'); result = await handler.editArea(args[0]); break;
        default: throw new Error('Unsupported caption editor method.');
      }
      if (data.id) send({ id: data.id, result: result === undefined ? null : result });
    } catch (error) {
      if (data.id) send({ id: data.id, error: { message: error instanceof Error ? error.message : String(error) } });
    }
  }
  window.addEventListener('message', receive);
  const methods = Object.fromEntries(HOST_METHODS.map(method => [method, (...args: unknown[]) => call(method, args)])) as unknown as ReturnType<typeof createHostAPI>;
  return {
    ...methods,
    isDemo: false,
    getTransportAvailability: (): NativeTransportAvailability => ({ ...availability }),
    onTransportAvailability(listener: (status: NativeTransportAvailability) => void): () => void {
      if (typeof listener !== 'function') throw new TypeError('A transport availability listener is required.');
      availabilityListeners.add(listener);
      try { listener({ ...availability }); } catch {}
      return () => { availabilityListeners.delete(listener); };
    },
    startAgentBridge(agent: AgentHandler): () => void {
      handler = agent;
      void call('agent.ready').catch(error => console.error('[Better Captions] Agent hooks could not start:', error));
      return () => {
        closed = true; publishAvailability(); availabilityListeners.clear();
        handler = null;
        try { host.postMessage({ channel: CHANNEL, id: prefix + ++nextId, method: 'agent.stopped', args: [] }); } catch {}
        window.removeEventListener('message', receive);
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('The caption editor was closed.')); }
        pending.clear();
      };
    },
  };
}
export const initWebview = (webviewAPI: unknown) => {
  const win = window as unknown as { uxpHost?: UXPMessageHost };
  if (win.uxpHost) return { page: 'main', api: nativeTransport(win.uxpHost, webviewAPI) };
  // Keep the ordinary browser preview and render-only CEP adapter available for QA.
  return { page: 'main', api: { ...createHostAPI(), startAgentBridge } };
};
