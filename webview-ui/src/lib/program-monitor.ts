import type { CaptionItem, MotionProfile } from './types';

export type CaptionLink = Pick<CaptionItem, 'id' | 'clipNodeId' | 'projectItemId' | 'mediaPath'>;
export function captionLinks(captions: CaptionItem[]): CaptionLink[] {
  return captions.filter(caption => caption.clipNodeId).map(caption => ({
    id: caption.id, clipNodeId: caption.clipNodeId, projectItemId: caption.projectItemId, mediaPath: caption.mediaPath,
  }));
}
export interface CaptionGeometryCue {
  id: string; clipNodeId: string; projectItemId: string; path: string;
  watchSignature: string; controlRevision?: string;
}
/** Accept read-only control updates only for the exact still-selected link. */
export function confirmCaptionGeometry(captured: CaptionItem, current: CaptionItem, cue: CaptionGeometryCue | undefined) {
  const link = (caption: CaptionItem) => JSON.stringify([caption.id, caption.clipNodeId, caption.projectItemId,
    caption.mediaPath, caption.startTime, caption.endTime, caption.renderBounds]);
  if (link(captured) !== link(current)) throw new Error('The caption link changed while its controls were being read. Refresh the selected caption.');
  if (!cue || cue.id !== captured.id || cue.clipNodeId !== captured.clipNodeId || cue.projectItemId !== captured.projectItemId || cue.path !== captured.mediaPath) throw new Error('Premiere did not confirm the selected caption controls.');
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096;
  if (!valid(cue.watchSignature) || cue.controlRevision !== undefined && !valid(cue.controlRevision)) throw new Error('Premiere returned an invalid caption control revision.');
  return { watchSignature: cue.watchSignature, controlRevision: cue.controlRevision ?? null };
}
export function panelVisibilityMessage(value: unknown): boolean | null {
  let message = value;
  if (typeof message === 'string') {
    if (message.length > 1024) return null;
    try { message = JSON.parse(message); } catch { return null; }
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const data = message as { type?: unknown; visible?: unknown };
  return data.type === 'better-captions-panel-visibility' && typeof data.visible === 'boolean' ? data.visible : null;
}
export interface CaptionSelectionContext {
  sequenceId: string;
  captions: CaptionLink[];
  revision?: string | number;
}
export interface NativeCaptionSelection {
  ok: boolean;
  captionId: string | null;
  clipNodeId?: string;
  time: number;
}
interface SelectionOptions {
  current: () => CaptionSelectionContext | null;
  read: (context: CaptionSelectionContext) => Promise<NativeCaptionSelection>;
  accept: (selection: NativeCaptionSelection, context: CaptionSelectionContext) => void;
}
const selectionIdentity = (context: CaptionSelectionContext) => JSON.stringify([
  context.sequenceId, context.revision,
  context.captions.map(caption => [caption.id, caption.clipNodeId, caption.projectItemId, caption.mediaPath]),
]);
/** Follow native selection without selecting clips or seeking Premiere. */
export function createCaptionSelectionSync(options: SelectionOptions) {
  let alive = true, reading = false, generation = 0;
  return {
    async sync() {
      if (!alive || reading) return;
      const context = options.current();
      if (!context) return;
      const expected = selectionIdentity(context);
      const requestGeneration = generation;
      reading = true;
      try {
        const selection = await options.read(context);
        const current = options.current();
        if (!alive || generation !== requestGeneration || !current || selectionIdentity(current) !== expected) return;
        if (!selection?.ok || !Number.isFinite(selection.time) || selection.time < 0 || (selection.captionId !== null && typeof selection.captionId !== 'string')) throw new Error('Premiere did not confirm its selected caption.');
        if (selection.captionId !== null) {
          const caption = current.captions.find(item => item.id === selection.captionId);
          if (!caption?.clipNodeId || selection.clipNodeId !== caption.clipNodeId) throw new Error('Premiere returned a different caption clip. Refresh the sequence before resizing.');
        }
        options.accept(selection, current);
      } finally { reading = false; }
    },
    invalidate() { generation++; },
    stop() { alive = false; generation++; },
  };
}

/** The legacy movie's saved samples describe its existing inverse-scale compensation. */
export function legacyMotionIdentity(sequenceId: string, caption: CaptionItem): string {
  return JSON.stringify([sequenceId, caption.id, caption.clipNodeId, caption.projectItemId, caption.mediaPath,
    caption.startTime, caption.endTime, typeof caption.motionProfile?.signature === 'string' ? caption.motionProfile.signature.slice(0, 4096) : null]);
}
export function legacyMotionBaseline(saved: MotionProfile | undefined, live: MotionProfile): { signature: string; changed: boolean } {
  const valid = (profile: MotionProfile | undefined) => {
    if (!profile || typeof profile.signature !== 'string' || !profile.signature || profile.signature.length > 4096 || !Array.isArray(profile.samples) || !profile.samples.length || profile.samples.length > 100000) return false;
    return profile.samples.every((sample, index) => sample && Number.isFinite(sample.time) && sample.time >= 0 &&
      [sample.scaleX, sample.scaleY].every(value => Number.isFinite(value) && value >= .01 && value <= 100) &&
      (index === 0 || sample.time > profile.samples[index - 1].time));
  };
  const update = () => { throw new Error('Use Update Program Monitor once to establish this older caption’s rendered text-box baseline.'); };
  if (!valid(saved) || !valid(live) || typeof live.watchSignature !== 'string' || !live.watchSignature || live.watchSignature.length > 4096) return update();
  // Do not infer a curve from incomplete or differently timed samples.
  if (saved!.samples.length !== live.samples.length || live.samples.some((sample, index) => Math.abs(sample.time - saved!.samples[index].time) > 1e-6)) return update();
  const changed = live.samples.some((sample, index) => Math.abs(sample.scaleX - saved!.samples[index].scaleX) > 1e-6 || Math.abs(sample.scaleY - saved!.samples[index].scaleY) > 1e-6);
  return { signature: changed ? 'legacy-rendered:' + saved!.signature : live.watchSignature, changed };
}

/** Watch only the selected caption's native text-box geometry, never its Position. */
export interface MotionWatchContext {
  sequenceId: string;
  captionId: string;
  clipNodeId: string;
  revision?: string;
  savedSignature?: string | null;
}
export interface ReflowStatus { phase: 'idle' | 'waiting' | 'working' | 'ready' | 'error'; message: string; }
interface WatchOptions {
  beforeRead?: () => Promise<void>;
  current: () => MotionWatchContext | null;
  readSignature: (context: MotionWatchContext) => Promise<string>;
  apply: (context: MotionWatchContext) => Promise<unknown>;
  onStatus: (status: ReflowStatus) => void;
  interval?: number;
  stableFor?: number;
  now?: () => number;
  autoStart?: boolean;
}
const identity = (context: MotionWatchContext) => JSON.stringify([context.sequenceId, context.captionId, context.clipNodeId]);
export function startProgramMonitorWatcher(options: WatchOptions) {
  const now = options.now ?? Date.now;
  let alive = true, visible = true, inFlight = false, generation = 0, selectionPaused = false;
  let retryRevision: string | number | undefined;
  const automatic = options.autoStart !== false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let key = '', baseline: string | null = null, lastSaved: string | null = null, revision = '';
  let candidate: string | null = null, candidateSince = 0, failed: string | null = null, readPaused = false, lastObserved: string | null = null;
  const idle = () => options.onStatus({ phase: 'idle', message: '' });
  function reset() {
    generation++; key = ''; baseline = null; lastSaved = null; candidate = null; failed = null; readPaused = false; selectionPaused = false; lastObserved = null; revision = ''; idle();
    schedule();
  }
  function stillCurrent(expected: string, expectedGeneration: number) {
    const current = options.current();
    return alive && visible && generation === expectedGeneration && current && identity(current) === expected ? current : null;
  }
  async function inspectMotion() {
    const context = options.current();
    if (!context) { candidate = null; idle(); return; }
    const nextKey = identity(context);
    if (key !== nextKey) {
      key = nextKey; baseline = context.savedSignature ?? null; lastSaved = baseline;
      revision = context.revision ?? ''; candidate = null; failed = null; readPaused = false; lastObserved = null; idle();
    } else if (revision !== (context.revision ?? '')) {
      revision = context.revision ?? ''; failed = null; readPaused = false; candidate = null;
    }
    if (readPaused) return;
    const requestGeneration = generation;
    let observed: string | null = null, applying = false;
    try {
      observed = await options.readSignature(context);
      const current = stillCurrent(nextKey, requestGeneration);
      if (!current) return;
      if (typeof observed !== 'string' || !observed || observed.length > 500000) throw new Error('Premiere returned invalid text-box geometry.');
      lastObserved = observed;
      const saved = current.savedSignature ?? null;
      if (saved !== lastSaved) { lastSaved = saved; baseline = saved; candidate = null; failed = null; }
      if (baseline === null) { baseline = observed; idle(); return; }
      if (observed === baseline) { candidate = null; failed = null; idle(); return; }
      if (observed === failed) return;
      if (candidate !== observed) {
        candidate = observed; candidateSince = now();
        options.onStatus({ phase: 'waiting', message: 'Text-box resize detected. Waiting for the drag to finish…' });
        return;
      }
      if (now() - candidateSince < (options.stableFor ?? 750)) return;
      if (!stillCurrent(nextKey, requestGeneration)) return;
      applying = true;
      options.onStatus({ phase: 'working', message: 'Reflowing the selected caption at the same font size…' });
      await options.apply(current);
      if (!stillCurrent(nextKey, requestGeneration)) return;
      baseline = observed; candidate = null; failed = null;
      options.onStatus({ phase: 'ready', message: 'Selected caption reflow updated. Position and box-size keyframes stay in Premiere.' });
    } catch (error) {
      if (!stillCurrent(nextKey, requestGeneration)) return;
      if (applying) failed = observed;
      else readPaused = true;
      candidate = null;
      const detail = error instanceof Error ? error.message : String(error);
      options.onStatus({ phase: 'error', message: 'Text-box reflow paused: ' + detail + ' Use Update Program Monitor to retry.' });
    }
  }
  async function tick() {
    if (!alive || !visible || inFlight || selectionPaused || readPaused) return;
    const requestGeneration = generation;
    inFlight = true;
    try {
      if (options.beforeRead) await options.beforeRead();
      if (!alive || !visible || generation !== requestGeneration) return;
      await inspectMotion();
    } catch (error) {
      if (!alive || !visible || generation !== requestGeneration) return;
      selectionPaused = true;
      candidate = null;
      const detail = error instanceof Error ? error.message : String(error);
      options.onStatus({ phase: 'error', message: 'Caption selection paused: ' + detail + ' Use Update Program Monitor to retry.' });
    } finally { inFlight = false; schedule(); }
  }
  function schedule() {
    if (!automatic || !alive || !visible || inFlight || selectionPaused || readPaused || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void tick(); }, options.interval ?? 750);
  }
  schedule();
  return {
    tick,
    reset,
    diagnostics() {
      const short = (value: string | null) => value === null ? null : value.slice(0, 160);
      return { alive, visible, inFlight, timerScheduled: timer !== undefined, readPaused, selectionPaused,
        baseline: short(baseline), candidate: short(candidate), lastObserved: short(lastObserved) };
    },
    notifyRevision(value: string | number) { if (retryRevision !== value) { retryRevision = value; reset(); } },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value; generation++; candidate = null;
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      if (visible) schedule();
      else if (!selectionPaused && !readPaused) idle();
    },
    stop() { alive = false; generation++; if (timer !== undefined) clearTimeout(timer); },
  };
}
