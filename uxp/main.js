/* One native Premiere panel, with its existing Svelte editor in a local webview. */
const { entrypoints } = require('uxp');
const premiere = require('premierepro');
const { createHostAPI } = require('./api.js');

const CHANNEL = 'better-captions';
const PANEL_ID = 'betterCaptions';
const HOST_METHODS = new Set([
  'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'saveSession',
  'transcribeSequence', 'getFonts', 'showInPremiere', 'beginCaption',
  'saveCaptionFrames', 'finishCaption', 'preflightCaptionClips',
  'applyCaptionClips', 'readTimeline', 'selectCaptionClip', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionArea', 'editCaptionArea', 'getColorScheme',
]);
const AGENT_METHODS = new Set(['getState', 'patchStyle', 'patchAnimation', 'setCaptions', 'refresh', 'apply']);
const ID = /^(?:ui|host)-[a-zA-Z0-9_-]{1,100}$/;
const pending = new Map();
const running = new Set();
const completed = new Set();
const api = createHostAPI();
let webview = null, uiReady = false, destroyed = false, panelVisible = false, nextId = 0;
let agentStart = null, agentStop = null, loadFailure = null;
const cleanupListeners = [];

function showStatus(text, isError = false) {
  const status = document.getElementById('caption-host-status');
  if (!status) return;
  status.textContent = text;
  status.style.display = text ? 'block' : 'none';
  status.style.color = isError ? '#ffb4a9' : '#dddddd';
}
function envelope(event) {
  const raw = event && event.message !== undefined ? event.message : event && event.data !== undefined ? event.data : null;
  if (typeof raw === 'string') {
    if (raw.length > 100 * 1024 * 1024) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}
function send(data) {
  if (destroyed || !webview) throw new Error('The Better Captions panel is closed.');
  webview.postMessage({ channel: CHANNEL, ...data });
}
function safeError(error) {
  return { message: String(error && error.message || error || 'Premiere caption operation failed.').slice(0, 4000) };
}
function visibility(visible = panelVisible) {
  panelVisible = visible;
  if (webview && !destroyed) { try { send({ type: 'better-captions-panel-visibility', visible }); } catch {} }
}
function rejectPending(message) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
  pending.clear();
}
function requestAgent(method, args = []) {
  if (!AGENT_METHODS.has(method)) return Promise.reject(new Error('Unsupported caption agent action.'));
  if (!uiReady || destroyed || !webview) return Promise.reject(new Error('Open Better Captions in Premiere and wait for its editor to load.'));
  const id = 'host-' + Date.now().toString(36) + '-' + ++nextId;
  const timeout = method === 'apply' ? 60 * 60 * 1000 : 60 * 1000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The caption editor did not finish ' + method + '. Check its panel for an error.')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { send({ id, method: 'agent.' + method, args }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
const agentProxy = {
  getState: () => requestAgent('getState'),
  patchStyle: patch => requestAgent('patchStyle', [patch]),
  patchAnimation: patch => requestAgent('patchAnimation', [patch]),
  setCaptions: captions => requestAgent('setCaptions', [captions]),
  refresh: () => requestAgent('refresh'),
  apply: () => requestAgent('apply'),
};
async function startAgent() {
  if (!agentStart) {
    agentStart = Promise.resolve().then(() => {
      if (typeof api.startAgentBridge !== 'function') throw new Error('Caption agent hooks are not available in this plugin build.');
      return api.startAgentBridge(agentProxy);
    }).then(stop => {
      if (typeof stop === 'function') { if (destroyed) return stop(); agentStop = stop; }
    }).catch(error => { agentStart = null; throw error; });
  }
  await agentStart;
}
async function onMessage(event) {
  if (event && event.source && event.source !== webview) return;
  const data = envelope(event);
  if (!data || data.channel !== CHANNEL || typeof data.id !== 'string' || !ID.test(data.id)) return;
  if (typeof data.method !== 'string') {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) request.reject(new Error(String(data.error.message || data.error)));
    else request.resolve(data.result);
    return;
  }
  if (!data.id.startsWith('ui-') || !Array.isArray(data.args) || data.args.length > 8 || (running.has(data.id) || completed.has(data.id))) return;
  if (!HOST_METHODS.has(data.method) && data.method !== 'agent.ready' && data.method !== 'agent.stopped' && data.method !== 'diagnostic') {
    send({ id: data.id, error: { message: 'Unsupported Premiere caption method.' } }); return;
  }
  running.add(data.id);
  try {
    let result;
    if (data.method === 'agent.ready') { uiReady = true; loadFailure = null; showStatus(''); await startAgent(); visibility(); result = { ready: true }; }
    else if (data.method === 'agent.stopped') { uiReady = false; result = { ready: false }; }
    else if (data.method === 'diagnostic') {
      const diagnostic = data.args[0];
      if (!diagnostic || typeof diagnostic !== 'object' || typeof diagnostic.stage !== 'string' || typeof diagnostic.message !== 'string') throw new Error('Invalid caption bootstrap diagnostic.');
      const detail = diagnostic.message.slice(0, 2000);
      if (diagnostic.stage === 'error' || diagnostic.stage === 'policy') {
        loadFailure = detail; showStatus('The caption editor could not start: ' + detail, true);
        console.error('[Better Captions] Editor bootstrap:', detail);
      } else if (!uiReady && !loadFailure) showStatus('Loading caption editor controls…');
      result = { reported: true };
    }
    else {
      const method = api[data.method];
      if (typeof method !== 'function') throw new Error('This Premiere caption operation is unavailable: ' + data.method);
      result = await method.apply(api, data.args);
    }
    send({ id: data.id, result: result === undefined ? null : result });
  } catch (error) { try { send({ id: data.id, error: safeError(error) }); } catch { /* Panel closed during the operation. */ } }
  finally { completed.add(data.id); if (completed.size > 512) completed.delete(completed.values().next().value); running.delete(data.id); }
}
function notify(method, args = []) {
  if (webview && !destroyed) { try { send({ method, args }); } catch { /* A reload receives current state on mount. */ } }
}
function sequenceEvents() {
  try {
    const events = premiere.Constants.SequenceEvent;
    for (const [event, method] of [[events.ACTIVATED, 'ui.sequenceActivated'], [events.CLOSED, 'ui.sequenceClosed']]) {
      if (!event) continue;
      const listener = () => notify(method);
      premiere.EventManager.addGlobalEventListener(event, listener);
      cleanupListeners.push(() => premiere.EventManager.removeGlobalEventListener(event, listener));
    }
  } catch (error) { console.warn('[Better Captions] Sequence event updates unavailable:', safeError(error).message); }
}
function mount() {
  if (webview || destroyed) return;
  try {
    webview = document.createElement('webview');
    webview.className = 'caption-host__webview';
    webview.id = 'better-captions-editor';
    webview.uxpAllowInspector = 'false';
    webview.addEventListener('message', onMessage);
    window.addEventListener('message', onMessage);
    cleanupListeners.push(() => window.removeEventListener('message', onMessage));
    webview.addEventListener('loadstart', () => { uiReady = false; loadFailure = null; showStatus('Loading caption editor…'); rejectPending('The Better Captions editor is reloading. Try the agent action again when it is ready.'); });
    webview.addEventListener('loadstop', () => {
      if (!uiReady && !loadFailure) showStatus('Caption editor loaded. Waiting for its controls…');
      Promise.resolve(api.getColorScheme()).then(scheme => notify('ui.colorScheme', [scheme])).catch(() => {});
      visibility();
    });
    webview.addEventListener('loaderror', event => {
      loadFailure = String(event.message || 'The local editor page did not load.') + (event.code === undefined ? '' : ' (code ' + event.code + ')');
      showStatus('The caption editor could not load: ' + loadFailure, true);
      console.error('[Better Captions] Webview load:', loadFailure);
    });
    webview.src = 'plugin:/client/index.html';
    document.getElementById('app').appendChild(webview);
    sequenceEvents();
  } catch (error) {
    const message = document.createElement('div'); message.className = 'caption-host__error';
    message.textContent = 'Better Captions could not open its editor: ' + safeError(error).message;
    document.getElementById('app').appendChild(message);
  }
}
async function destroy() {
  visibility(false);
  destroyed = true; uiReady = false;
  rejectPending('The Better Captions plugin was closed.');
  for (const remove of cleanupListeners.splice(0)) { try { remove(); } catch {} }
  if (agentStop) await agentStop();
  if (typeof api.dispose === 'function') await api.dispose();
}
entrypoints.setup({
  plugin: { create: mount, destroy },
  panels: { [PANEL_ID]: { create: mount, show() { mount(); visibility(true); }, hide() { visibility(false); } } },
});
mount();
