/** Read-only reconnection work shares one lane, including after a slow response.
 * Visibility/transport events wake it; a deadline never starts a second read. */
export function startCaptionReconnect(options: {
  ready: () => boolean;
  inspect: () => Promise<void>;
  onError: (error: unknown) => void;
  interval?: number;
}) {
  const interval = Math.max(1000, options.interval ?? 2500);
  let stopped = false, inFlight = false, requested = false, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(delay: number) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void inspect(); }, delay);
  }
  async function inspect() {
    if (stopped || inFlight) return;
    if (!options.ready()) { schedule(interval); return; }
    inFlight = true; requested = false;
    try { await options.inspect(); failures = 0; }
    catch (error) { failures++; if (!stopped) options.onError(error); }
    finally {
      inFlight = false;
      if (!stopped) schedule(requested ? 0 : Math.min(15000, interval * Math.max(1, failures)));
    }
  }
  schedule(interval);
  return {
    notify() { if (stopped) return; if (inFlight) requested = true; else schedule(0); },
    stop() { stopped = true; clearTimeout(timer); },
    diagnostics() { return { inFlight, failures, stopped }; },
  };
}
