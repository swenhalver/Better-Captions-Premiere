import { createHostAPI } from './cep-api';
import { startAgentBridge } from './lib/agent-bridge';
import type { AgentHandler } from './lib/agent-bridge';

const CHANNEL = 'better-captions';
const HOST_METHODS = [
  'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'saveSession', 'loadStylePresets', 'saveStylePresets',
  'transcribeSequence', 'getFonts', 'showInPremiere', 'beginCaption',
  'saveCaptionFrames', 'finishCaption', 'preflightCaptionClips',
  'applyCaptionClips', 'readTimeline', 'selectCaptionClip', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionArea', 'editCaptionArea', 'getColorScheme', 'readCaptionConsolidation', 'applyConsolidatedCaption',
] as const;
const READ_METHODS = new Set(['loadStylePresets', 'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'getFonts', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionArea', 'readCaptionConsolidation']);
interface UXPMessageHost {
  postMessage: (message: unknown) => void;
}
interface Message {
  channel?: string; id?: string; method?: string; args?: unknown[];
  result?: unknown; error?: { message?: string } | string;
  type?: string; visible?: boolean;
}
function nativeTransport(host: UXPMessageHost, webviewAPI: unknown) {
  let nextId = 0, handler: AgentHandler | null = null;
  const callbacks = webviewAPI as Record<string, (...args: never[]) => unknown>;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const prefix = 'ui-' + Date.now().toString(36) + '-';
  let unresolvedRead: string | null = null;
  function call(method: string, args: unknown[] = []): Promise<unknown> {
    if(unresolvedRead)return Promise.reject(new Error('A previous Premiere read has not returned. Native requests are paused; its timeout did not cancel the operation.'));
    if(pending.size>=16)return Promise.reject(new Error('The caption panel is busy. Wait for its current operations to finish.'));
    const id = prefix + ++nextId;
    const timeout = READ_METHODS.has(method)?15000:method === 'transcribeSequence' ? 60 * 60 * 1000 : ['finishCaption','applyCaptionClips','applyConsolidatedCaption'].includes(method) ? 30 * 60 * 1000 : 60 * 1000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id);if(READ_METHODS.has(method))unresolvedRead=id;reject(new Error('Premiere did not finish the caption operation. Native reads are paused until its response returns; the timeout did not cancel Premiere’s work.')); }, timeout);
      pending.set(id, { resolve, reject, timer });
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
    // The same window message reaches main-webview's visibility listener.
    if(data.type==='better-captions-panel-visibility'&&typeof data.visible==='boolean')return;
    if (!data.method) {
      if (!data.id) return;
      if(data.id===unresolvedRead)unresolvedRead=null;
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) request.reject(new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Premiere caption operation failed.'));
      else request.resolve(data.result);
      return;
    }
    if (data.method.startsWith("agent.") && (!data.id || !/^host-[a-zA-Z0-9_-]{1,100}$/.test(data.id))) return;
    const args = Array.isArray(data.args) ? data.args : [];
    try {
      let result: unknown;
      switch (data.method) {
        case 'ui.sequenceActivated': callbacks.onSequenceActivated?.(); return;
        case 'ui.sequenceClosed': callbacks.onSequenceClosed?.(); return;
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
    startAgentBridge(agent: AgentHandler): () => void {
      handler = agent;
      void call('agent.ready').catch(error => console.error('[Better Captions] Agent hooks could not start:', error));
      return () => {
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
