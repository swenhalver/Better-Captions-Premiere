'use strict';
const { privateRoot, ensureFolder, readJSON, writeJSON, randomId } = require('./storage.js');
const MAX_BYTES = 5000000;
const ACTIONS = ['get_state', 'patch_style', 'patch_animation', 'set_captions', 'set_position', 'refresh', 'apply'];
const NONCE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function bounded(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error('Expected caption agent JSON.');
  let size = 0;
  for (const char of text) { const point = char.codePointAt(0); size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4; if (size > MAX_BYTES) throw new Error('The caption agent payload is too large.'); }
  return value;
}
async function exists(folder, name) { try { return await folder.getEntry(name); } catch { return null; } }

/** Local JSON requests only. All caption/style validation stays in the UI. */
async function startAgentBridge(handler) {
  if (!handler || typeof handler.getState !== 'function') throw new Error('Caption agent state is unavailable.');
  const root = await privateRoot('agent');
  const instances = await ensureFolder(root.nativePath + '/instances');
  const requests = await ensureFolder(root.nativePath + '/requests');
  const responses = await ensureFolder(root.nativePath + '/responses');
  const instanceId = randomId(), instanceName = instanceId + '.json';
  if (!/^[a-f0-9]{32}$/.test(instanceId)) throw new Error('Could not create a caption agent instance identity.');
  let alive = true, busy = false, announcement = null;

  async function announce() {
    if (!alive) return;
    if (announcement) return announcement;
    announcement = (async () => {
      const state = await handler.getState();
      if (!alive) return;
      await writeJSON(instances, instanceName, bounded({ version: 1, instanceId, sequenceId: state?.sequenceId ?? null, sequenceName: state?.sequenceName ?? null, updatedAt: Date.now(), busy, capabilities: ACTIONS }));
    })();
    try { await announcement; } finally { announcement = null; }
  }

  async function dispatch(request, state) {
    const payload = request.payload ?? {};
    switch (request.action) {
      case 'get_state': return;
      case 'patch_style': await handler.patchStyle(payload); return;
      case 'patch_animation':
        if (typeof handler.patchAnimation !== 'function') throw new Error('Animation editing is unavailable in this panel.');
        await handler.patchAnimation(payload); return;
      case 'set_captions': await handler.setCaptions(payload.captions); return;
      case 'set_position': {
        if (!record(payload)) throw new Error('Expected a caption position object.');
        if (payload.captionId) {
          if (typeof payload.captionId !== 'string' || !Array.isArray(state.captions) || !state.captions.some(caption => caption.id === payload.captionId)) throw new Error('Caption identity not found.');
          await handler.setCaptions(state.captions.map(caption => caption.id === payload.captionId ? { ...caption, position: { x: payload.x, y: payload.y } } : caption));
        } else await handler.patchStyle({ positionX: payload.x, positionY: payload.y });
        return;
      }
      case 'refresh': await handler.refresh(); return;
      case 'apply': await handler.apply(); return;
      default: throw new Error('Unsupported caption action.');
    }
  }

  async function poll() {
    if (!alive || busy) return;
    busy = true;
    try {
      const entries = await requests.getEntries();
      let processed = 0;
      for (const entry of entries) {
        if (!alive || processed >= 64) break;
        if (!entry.isFile || !entry.name.endsWith('.json')) continue;
        const id = entry.name.slice(0, -5);
        if (!NONCE.test(id)) continue;
        let request;
        try { request = await readJSON(entry, MAX_BYTES); } catch { continue; }
        // Other active panels own their requests; leave those entries alone.
        if (!record(request) || request.instanceId !== instanceId) continue;
        processed++;
        if (await exists(responses, entry.name)) { await entry.delete(); continue; }
        let claimed = false;
        try {
          bounded(request);
          if (request.version !== 1 || request.id !== id || !Number.isFinite(request.createdAt) || Math.abs(Date.now() - request.createdAt) > 120000 || !ACTIONS.includes(request.action)) throw new Error('Invalid, expired or unsupported caption agent request.');
          const state = await handler.getState();
          if (!state) throw new Error('No active caption session.');
          if (request.sequenceId !== state.sequenceId) throw new Error('The active sequence changed. Read state again.');
          if (!alive) throw new Error('The caption agent stopped before the request could run.');
          // Claim before any UI action. A replay cannot repeat a timeline edit.
          await entry.delete(); claimed = true;
          await dispatch(request, state);
          const latest = await handler.getState();
          if (latest?.sequenceId !== request.sequenceId) throw new Error('The active sequence changed while the request was running. Read state again.');
          await writeJSON(responses, entry.name, bounded({ version: 1, id, ok: true, completedAt: Date.now(), state: latest }));
        } catch (error) {
          const message = String(error?.message || error).slice(0, 2000);
          await writeJSON(responses, entry.name, { version: 1, id, ok: false, completedAt: Date.now(), error: message });
        } finally {
          if (!claimed) { try { await entry.delete(); } catch {} }
        }
      }
    } finally { busy = false; if (alive) await announce(); }
  }

  await announce();
  const timer = setInterval(() => poll().catch(console.error), 500);
  const heartbeat = setInterval(() => announce().catch(console.error), 5000);
  return async function stop() {
    alive = false; clearInterval(timer); clearInterval(heartbeat);
    if (announcement) { try { await announcement; } catch {} }
    const instance = await exists(instances, instanceName);
    if (instance) { try { await instance.delete(); } catch {} }
  };
}

module.exports = { startAgentBridge };
