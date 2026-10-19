import type { CaptionItem } from './types';
import { MAX_NATIVE_CARRIER_BYTES } from './native-effect/encode.ts';

export interface LegacyCaptionConnection {
  kind: 'generated-movie';
  clipNodeId: string;
  projectItemId: string;
  path: string;
  trackIndex: number;
  clipIndex: number;
  startTime: number;
  endTime: number;
  startTicks: string;
  endTicks: string;
  inTicks: string;
  outTicks: string;
  selected: boolean;
  disabled?: boolean;
}

export interface NativeCaptionConnection {
  kind: 'native-effect';
  maxChars?: number;
  clipNodeId: string;
  projectItemId: string;
  trackIndex: number;
  clipIndex: number;
  startTicks: string;
  endTicks: string;
  inTicks: string;
  outTicks: string;
  selected: boolean;
  disabled?: boolean;
  locator: {
    projectPath: string;
    sequenceId: string;
    clipNodeId: string;
    trackIndex: number;
    clipIndex: number;
    componentIndex: number;
    documentParamIndex: number;
  };
  matchName: string;
  connectionRevision?: string;
  documentText?: string;
  revision?: string;
}

export interface CaptionConnections {
  ok: true;
  version: 1;
  readOnly: true;
  projectPath: string;
  sequenceId: string;
  nativeSequenceId: string;
  playhead: number;
  playheadTicks: string;
  selectedClipNodeIds: string[];
  connectionRevision?: string;
  native: NativeCaptionConnection[];
  legacy: LegacyCaptionConnection[];
  warnings: string[];
}

interface SequenceIdentity { id: string; projectPath?: string; }
const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const plainGuid = new RegExp('^' + guid + '$', 'i');
const bracedGuid = new RegExp('^\\{' + guid + '\\}$', 'i');
const validText = (value: unknown, limit = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
const canonicalId = (value: string) => plainGuid.test(value) ? value.toLowerCase() : bracedGuid.test(value) ? value.slice(1, -1).toLowerCase() : value;

/** Only actual GUIDs receive brace/case normalization; opaque IDs stay exact. */
export function sameSequenceId(a: string, b: string): boolean {
  return validText(a) && validText(b) && canonicalId(a) === canonicalId(b);
}

function localPath(value: unknown, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (!validText(value, 4096)) throw new Error('Caption connections require a valid local absolute path.');
  const windows = /^[a-z]:[\\/]/i.test(value);
  if (!windows && (!value.startsWith('/') || value.startsWith('//') || value.includes('\\'))) throw new Error('Caption connections require a local drive or POSIX path.');
  const normalized = windows ? value.replace(/\\/g, '/') : value;
  const parts = normalized.split('/');
  if (parts.some(part => part === '.' || part === '..')) throw new Error('Caption connection paths cannot contain traversal segments.');
  if (windows && parts.slice(1).some(part => /[<>:"|?*]|[. ]$/.test(part))) throw new Error('Caption connections contain an invalid Windows path.');
  const separators = normalized.replace(/\/{2,}/g, '/');
  const collapsed = /^[a-z]:\/$/i.test(separators) ? separators : separators.replace(/\/$/, '') || '/';
  // Preserve component case: Windows can explicitly enable case-sensitive
  // directories, and POSIX paths must never be case-folded or basename-matched.
  return windows ? collapsed[0].toLowerCase() + collapsed.slice(1) : collapsed;
}

export function connectionKey(info: SequenceIdentity): string {
  if (!info || !validText(info.id)) throw new Error('Caption connections require a sequence identity.');
  return JSON.stringify([localPath(info.projectPath, true), canonicalId(info.id)]);
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const index = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000;
const ticks = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d{0,23})$/.test(value);
const sourceTickBound = 864000n * 254016000000n;
const sourceTicks = (value: unknown): value is string => typeof value === 'string' && /^-?(?:0|[1-9]\d{0,23})$/.test(value) && BigInt(value) >= -sourceTickBound && BigInt(value) <= sourceTickBound;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const orderedTicks = (a: string, b: string) => a.length < b.length || a.length === b.length && a < b;
function append<K>(map: Map<K, number[]>, key: K, value: number) {
  const values = map.get(key);
  if (values) values.push(value); else map.set(key, [value]);
}

function validateSnapshot(value: CaptionConnections, expected: SequenceIdentity) {
  const fail = () => { throw new Error('Premiere returned malformed caption connections. Refresh the sequence before reconnecting.'); };
  if (!record(value) || value.ok !== true || value.version !== 1 || value.readOnly !== true || !validText(value.sequenceId) || !validText(value.nativeSequenceId) || typeof value.projectPath !== 'string') fail();
  if (!sameSequenceId(value.sequenceId, expected.id) || !sameSequenceId(value.nativeSequenceId, expected.id) || connectionKey({ id: value.sequenceId, projectPath: value.projectPath }) !== connectionKey(expected)) throw new Error('The caption connections belong to another project or sequence. Refresh before reconnecting.');
  if (!time(value.playhead) || !ticks(value.playheadTicks) || !Array.isArray(value.legacy) || !Array.isArray(value.native) || value.legacy.length + value.native.length > 10000 || !Array.isArray(value.selectedClipNodeIds) || value.selectedClipNodeIds.length > 10000 || !Array.isArray(value.warnings) || value.warnings.length > 10000 || value.warnings.some(warning => typeof warning !== 'string' || warning.length > 4000)) fail();
  if (value.connectionRevision !== undefined && !validText(value.connectionRevision, 4096)) fail();
  const selected = new Set<string>();
  for (const id of value.selectedClipNodeIds) { if (!validText(id) || selected.has(id)) fail(); selected.add(id); }
  const legacyNodes = new Set<string>(), nativeLocators = new Set<string>();
  for (const entry of [...value.legacy, ...value.native]) {
    if (!record(entry) || !validText(entry.clipNodeId) || !validText(entry.projectItemId) || !index(entry.trackIndex) || !index(entry.clipIndex) || !ticks(entry.startTicks) || !ticks(entry.endTicks) || !sourceTicks(entry.inTicks) || !sourceTicks(entry.outTicks) || !orderedTicks(entry.startTicks, entry.endTicks) || BigInt(entry.inTicks) >= BigInt(entry.outTicks) || typeof entry.selected !== 'boolean' || entry.disabled !== undefined && typeof entry.disabled !== 'boolean' || entry.selected !== selected.has(entry.clipNodeId)) fail();
  }
  for (const entry of value.legacy) {
    if (entry.kind !== 'generated-movie' || !time(entry.startTime) || !time(entry.endTime) || entry.endTime <= entry.startTime || legacyNodes.has(entry.clipNodeId)) fail();
    localPath(entry.path); legacyNodes.add(entry.clipNodeId);
  }
  for (const entry of value.native) {
    if (entry.maxChars !== undefined && (!Number.isInteger(entry.maxChars) || entry.maxChars < 1 || entry.maxChars > 500)) fail();
    const locator = entry.locator;
    if (entry.kind !== 'native-effect' || !validText(entry.matchName, 512) || !record(locator) || locator.clipNodeId !== entry.clipNodeId || locator.trackIndex !== entry.trackIndex || locator.clipIndex !== entry.clipIndex || !index(locator.componentIndex) || !index(locator.documentParamIndex) || typeof locator.projectPath !== 'string' || !validText(locator.sequenceId)) fail();
    if (connectionKey({ id: locator.sequenceId, projectPath: locator.projectPath }) !== connectionKey(expected)) throw new Error('A native caption connection belongs to another project or sequence.');
    if (entry.documentText !== undefined && (typeof entry.documentText !== 'string' || entry.documentText.length > MAX_NATIVE_CARRIER_BYTES) || entry.revision !== undefined && !validText(entry.revision, MAX_NATIVE_CARRIER_BYTES + 65536) || entry.connectionRevision !== undefined && !validText(entry.connectionRevision, 4096)) fail();
    const key = JSON.stringify([entry.clipNodeId, locator.componentIndex, locator.documentParamIndex]);
    if (nativeLocators.has(key)) fail(); nativeLocators.add(key);
  }
  return selected;
}

/** Plan link repairs only. Transcript timing, native curves and saved geometry stay untouched. */
export function reconnectLegacyCaptions(captions: CaptionItem[], snapshot: CaptionConnections, expected: SequenceIdentity): {
  captions: CaptionItem[]; changed: boolean; selectedId: string | null; unresolved: string[]; ambiguous: string[];
} {
  connectionKey(expected);
  const selected = validateSnapshot(snapshot, expected);
  if (!Array.isArray(captions) || captions.length > 10000) throw new Error('Expected a bounded saved caption list.');
  const ids = new Set<string>();
  for (const caption of captions) {
    if (!record(caption) || !validText(caption.id, 160) || ids.has(caption.id)) throw new Error('Saved caption identities are missing or duplicated.');
    ids.add(caption.id);
  }
  const pair = (item: string, path: string) => JSON.stringify([item, localPath(path)]);
  const byPair = new Map<string, number[]>(), byNode = new Map<string, number>();
  snapshot.legacy.forEach((entry, at) => {
    const key = pair(entry.projectItemId, entry.path); append(byPair, key, at); byNode.set(entry.clipNodeId, at);
  });
  const found = new Map<number, number>(), candidates = new Map<number, number[]>(), unresolved = new Set<number>(), ambiguous = new Set<number>(), used = new Set<number>(), contested = new Set<number>();
  const exact = new Map<number, number[]>();
  captions.forEach((caption, at) => {
    if (caption.clipNodeId === undefined && caption.projectItemId === undefined && caption.mediaPath === undefined) return;
    if (!validText(caption.projectItemId) || !validText(caption.mediaPath, 4096)) { unresolved.add(at); return; }
    let key: string;
    try { key = pair(caption.projectItemId, caption.mediaPath); } catch { unresolved.add(at); return; }
    const matches = byPair.get(key) ?? []; candidates.set(at, matches);
    const direct = caption.clipNodeId ? byNode.get(caption.clipNodeId) : undefined;
    if (direct !== undefined && matches.includes(direct)) append(exact, direct, at);
  });
  for (const [entry, owners] of exact) {
    if (owners.length === 1) { found.set(owners[0], entry); used.add(entry); }
    else { owners.forEach(at => ambiguous.add(at)); contested.add(entry); }
  }
  // Resolve whole batches before claiming a candidate, so list order never
  // chooses between two saved captions that both point at one native clip.
  while (true) {
    const proposed = new Map<number, number[]>();
    for (const [at, original] of candidates) {
      if (found.has(at) || ambiguous.has(at) || unresolved.has(at)) continue;
      const available = original.filter(entry => !used.has(entry) && !contested.has(entry));
      if (!available.length) { (original.length ? ambiguous : unresolved).add(at); continue; }
      const caption = captions[at], timed = available.filter(entry => {
        const native = snapshot.legacy[entry];
        return time(caption.startTime) && time(caption.endTime) && Math.abs(native.startTime - caption.startTime) <= 1e-6 && Math.abs(native.endTime - caption.endTime) <= 1e-6;
      });
      const entry = available.length === 1 ? available[0] : timed.length === 1 ? timed[0] : undefined;
      if (entry !== undefined) append(proposed, entry, at);
    }
    if (!proposed.size) break;
    for (const [entry, owners] of proposed) {
      if (owners.length === 1) { found.set(owners[0], entry); used.add(entry); }
      else { owners.forEach(at => ambiguous.add(at)); contested.add(entry); }
    }
  }
  for (const at of candidates.keys()) if (!found.has(at) && !unresolved.has(at)) ambiguous.add(at);
  let changed = false, selectedId: string | null = null;
  const result = captions.map((caption, at) => {
    const entry = found.get(at); if (entry === undefined) return caption;
    const match = snapshot.legacy[entry];
    if (selected.size === 1 && selected.has(match.clipNodeId)) selectedId = caption.id;
    if (caption.clipNodeId === match.clipNodeId && caption.projectItemId === match.projectItemId && caption.mediaPath === match.path) return caption;
    changed = true; return { ...caption, clipNodeId: match.clipNodeId, projectItemId: match.projectItemId, mediaPath: match.path };
  });
  return { captions: result, changed, selectedId, unresolved: captions.filter((_, at) => unresolved.has(at)).map(caption => caption.id), ambiguous: captions.filter((_, at) => ambiguous.has(at)).map(caption => caption.id) };
}

/** An enabled native clip outranks preserved disabled movie backups, never a
 * selected clip or another enabled caption version. Call after snapshot validation. */
export function nativeAboveDisabledBackups(snapshot: CaptionConnections): NativeCaptionConnection | undefined {
  if (snapshot.selectedClipNodeIds.length || snapshot.native.length !== 1 || snapshot.native[0].disabled === true || !snapshot.legacy.length || !snapshot.legacy.every(clip => clip.disabled === true)) return undefined;
  return snapshot.native[0];
}
