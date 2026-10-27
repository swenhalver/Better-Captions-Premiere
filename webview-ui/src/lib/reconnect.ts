/** Read-only reconnection work shares one lane, including after a slow response.
 * Visibility/transport events wake it; a deadline never starts a second read. */
export function startCaptionReconnect(options: {
  ready: () => boolean;
  inspect: () => Promise<void>;
  onError: (error: unknown) => void;
  /** Expected read races (a scrub moved the playhead mid-read): no error, no backoff; the next poll reads again. */
  transient?: (error: unknown) => boolean;
  interval?: number;
  /** A shorter interval while it returns a number, e.g. while the line editor follows Premiere Undo. */
  fast?: () => number | null;
}) {
  const base = Math.max(1000, options.interval ?? 2500);
  const period = () => { const fast = options.fast?.(); return typeof fast === 'number' && fast >= 100 ? Math.min(base, fast) : base; };
  let stopped = false, inFlight = false, requested = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(delay: number) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void inspect(); }, delay);
  }
  async function inspect() {
    if (stopped || inFlight) return;
    if (!options.ready()) { schedule(period()); return; }
    inFlight = true; requested = false;
    try { await options.inspect(); failures = 0; }
    catch (error) { if (options.transient?.(error)) { /* Keep the last accepted connection. */ } else { failures++; if (!stopped) options.onError(error); } }
    finally {
      inFlight = false;
      if (!stopped) schedule(requested ? 0 : Math.min(15000, period() * Math.max(1, failures)));
    }
  }
  schedule(period());
  return {
    notify() { if (stopped) return; if (inFlight) requested = true; else schedule(0); },
    stop() { stopped = true; clearTimeout(timer); },
    diagnostics() { return { inFlight, failures, stopped }; },
  };
}
