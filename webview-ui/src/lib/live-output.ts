export interface LiveOutputContext {
  sequenceId: string;
  signature: string;
  needed: boolean;
  ready: boolean;
}
export interface LiveOutputStatus { phase: 'idle' | 'waiting' | 'working' | 'error'; message: string; }
interface Options {
  current: () => LiveOutputContext | null;
  apply: (context: LiveOutputContext) => Promise<unknown>;
  supersede?: () => void;
  onStatus: (status: LiveOutputStatus) => void;
  /** Quiet time before a write. A function is read per edit (typing steps are already debounced). */
  debounce?: number | (() => number);
  now?: () => number;
}
const identity = (context: LiveOutputContext) => JSON.stringify([context.sequenceId, context.signature]);
const nativeReadMethods = new Set(['readCaptionConnections', 'loadStylePresets', 'getActiveSequenceInfo', 'fetchTranscriptJSON', 'loadSession', 'getFonts', 'getFontCatalog', 'readTimeline', 'readCaptionMotion', 'readCaptionGeometry', 'readCaptionSelection', 'readCaptionArea', 'readCaptionConsolidation', 'readNativeCaptionControls']);
export function retryableNativeRead(problem: unknown): boolean {
  const error = problem as { code?: string; method?: string; recoverable?: boolean } | null;
  return error?.recoverable === true && ['BC_NATIVE_PENDING', 'BC_NATIVE_WAITING', 'BC_NATIVE_QUEUE_EXPIRED', 'BC_NATIVE_BUSY', 'BC_RENDERER_UNAVAILABLE'].includes(error.code ?? '') &&
    (error.code !== 'BC_NATIVE_PENDING' || nativeReadMethods.has(error.method ?? ''));
}
/** A read discarded because it sampled across a playhead move (scrubbing,
 * playback). Nothing failed: keep the last confirmed values and take the next
 * scheduled read. Writes never carry this classification. */
export function staleNativeRead(problem: unknown): boolean {
  const error = problem as { code?: string; method?: string; recoverable?: boolean } | null;
  return error?.code === 'BC_NATIVE_STALE' && error.recoverable === true && ['readCaptionConnections', 'readNativeCaptionControls'].includes(error.method ?? '');
}
/** Expected, self-clearing read failures: the next scheduled read recovers. */
export function transientNativeRead(problem: unknown): boolean { return staleNativeRead(problem) || retryableNativeRead(problem); }
/** Coalesce edits before rendering, serialize output, and never replay an uncertain write. */
export function createLiveOutput(options: Options) {
  const now = options.now ?? Date.now;
  let alive = true, running = '', desired = '', changedAt = now(), failed = '', complete = '', retryAt = 0, retries = 0;
  let current: Promise<void> | null = null;
  const debounce = () => typeof options.debounce === 'function' ? options.debounce() : options.debounce ?? 400;
  const uncertain = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(delay: number) {
    if (!alive || running || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void drain(); }, Math.max(0, delay));
  }
  function notify() {
    if (!alive) return;
    const context = options.current(), next = context?.needed ? identity(context) : '';
    if (next !== desired) {
      desired = next; changedAt = now(); failed = ''; retries = 0; retryAt = 0;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      if (running && next !== running) options.supersede?.();
    }
    if (running) return;
    if (context && uncertain.has(context.sequenceId)) {
      options.onStatus({ phase: 'error', message: uncertain.get(context.sequenceId)! }); return;
    }
    if (!context || !next || next === complete) { options.onStatus({ phase: 'idle', message: '' }); return; }
    if (failed === next) return;
    options.onStatus({ phase: 'waiting', message: context.ready ? 'Changes queued…' : 'Waiting for Premiere…' });
    schedule(Math.max(0, changedAt + debounce() - now(), retryAt - now()));
  }
  async function drain() {
    if (!alive || running) return;
    const context = options.current();
    if (!context?.needed) { desired = ''; options.onStatus({ phase: 'idle', message: '' }); return; }
    const key = identity(context);
    if (key !== desired) { notify(); return; }
    if (uncertain.has(context.sequenceId) || failed === key || complete === key) return;
    if (!context.ready) {
      options.onStatus({ phase: 'waiting', message: 'Waiting for Premiere…' });
      schedule(500); return;
    }
    const delay = Math.max(changedAt + debounce() - now(), retryAt - now());
    if (delay > 0) { schedule(delay); return; }
    running = key;
    options.onStatus({ phase: 'working', message: 'Updating captions…' });
    let finish = () => {};
    current = new Promise(resolve => { finish = resolve; });
    try {
      await options.apply(context);
      complete = key; retries = 0; retryAt = 0;
    } catch (problem) {
      const error = problem as { code?: string; recoverable?: boolean; message?: string };
      if (error?.code === 'BC_RENDER_SUPERSEDED') { /* A newer edit replaces this render before any timeline write. */ }
      else if (retryableNativeRead(problem)) {
        retryAt = now() + Math.min(8000, 750 * 2 ** Math.min(retries++, 4));
        options.onStatus({ phase: 'waiting', message: 'Waiting for Premiere… Your edits are saved.' });
      } else {
        failed = key;
        if (error?.code === 'BC_OUTPUT_UNCONFIRMED' || (error?.code === 'BC_NATIVE_PENDING' && !retryableNativeRead(problem)) ||
          (error?.recoverable === false && (error.code?.startsWith('BC_NATIVE_') || error.code === 'BC_RENDERER_UNAVAILABLE'))) {
          uncertain.set(context.sequenceId, String(error?.message ?? problem).slice(0, 1000));
        }
        options.onStatus({ phase: 'error', message: String(error?.message ?? problem).slice(0, 1000) });
      }
    } finally {
      running = ''; current = null; finish();
      if (alive) notify();
    }
  }
  return {
    notify,
    block(sequenceId:string,message:string) { uncertain.set(sequenceId,message); notify(); },
    /** A verified host read can settle the current output without replaying its
     * uncertain setter. Call only after adopting that exact native document. */
    confirmReadback(sequenceId:string,signature:string) {
      const context = options.current();
      if (!alive || running || !context || context.sequenceId !== sequenceId || context.signature !== signature || context.needed) return false;
      const key = identity(context);
      uncertain.delete(sequenceId);
      if (failed === key) failed = '';
      complete = key; retries = 0; retryAt = 0;
      notify(); return true;
    },
    /** The layer was read back into the editor (Premiere Undo/Redo): a later edit
     * back to an earlier written state must be written again. */
    forget() { complete = ''; failed = ''; retries = 0; retryAt = 0; notify(); },
    diagnostics: () => ({ running: !!running, queued: !!desired && desired !== complete, retries, blocked: uncertain.size > 0 }),
    /** Settles when no write is in flight. A write that is not ready yet is not awaited. */
    idle: () => current ?? Promise.resolve(),
    stop() { alive = false; if (timer !== undefined) clearTimeout(timer); },
  };
}
