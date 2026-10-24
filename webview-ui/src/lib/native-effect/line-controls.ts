export interface ConfirmedLineControls {
  clipKey: string | null;
  count: number | null;
}

interface LineControls {
  rollUp?: { value: unknown };
  rollUpLines?: { value: unknown };
  groups?: { value: unknown };
}

/** Null is a pending/cleared control read, not a new visible-line count. Only
 * carry a confirmed count across refreshes of the same caption clip. */
export function confirmLineControls(previous: ConfirmedLineControls, clipKey: string | null, controls: LineControls | null): ConfirmedLineControls {
  let count = previous.clipKey === clipKey ? previous.count : null;
  const rolling = controls?.rollUp?.value;
  if (clipKey !== null && typeof rolling === 'number' && Number.isFinite(rolling)) {
    const value = rolling >= .5 ? controls?.rollUpLines?.value : controls?.groups?.value;
    if (typeof value === 'number' && Number.isFinite(value)) count = Math.max(0, Math.min(8, Math.round(value)));
  }
  return previous.clipKey === clipKey && previous.count === count ? previous : { clipKey, count };
}

/** Stored styles survive reductions; only an unavailable selected scope closes. */
export function confirmedLineScope<T extends string>(scope: T, previous: ConfirmedLineControls, next: ConfirmedLineControls): T | 'all' {
  const position = Number(/^line-([1-8])$/.exec(scope)?.[1] ?? 0);
  return position && (previous.clipKey !== next.clipKey || next.count !== null && position > next.count) ? 'all' : scope;
}
