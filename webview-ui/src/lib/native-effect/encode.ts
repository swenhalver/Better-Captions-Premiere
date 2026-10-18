import { validateNativeDocument, validateNativeStyle, type NativeColor, type NativeWordStyle } from './contract.ts';
/** BCAP little-endian v2 payload matching native/core/caption_core.cpp.
 * Sequence/clip bounds stay in the panel envelope; the renderer receives source words,
 * manual container identities and styles. No path, code, animation or host mutation. */
export function encodeNativeDocument(input: unknown): Uint8Array {
  const doc = validateNativeDocument(input), bytes: number[] = [];
  const u = (n: number) => { for (let i = 0; i < 4; i++) bytes.push((n >>> (8 * i)) & 255); };
  const d = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, n, true); bytes.push(...b); };
  const s = (text: string) => { const b = new TextEncoder().encode(text); u(b.length); for (const n of b) bytes.push(n); };
  const color = (c: NativeColor) => { d(c.r); d(c.g); d(c.b); d(c.a); };
  const style = (w: NativeWordStyle) => {
    s(w.fontFamily); d(w.fontSize); d(w.sizeScale); d(w.opacity); color(w.color); u(Number(w.bubble));
    color(w.bubbleColor); d(w.padding); d(w.radius); d(w.outlineWidth); color(w.outlineColor);
    d(w.shadowBlur); d(w.shadowX); d(w.shadowY); color(w.shadowColor);
  };
  u(0x50414342); u(2); u(doc.captions.length);
  for (const c of doc.captions) {
    s(c.id); u(Number(c.manualSplit)); u(c.words.length);
    for (const w of c.words) { s(w.text); d(w.start); d(w.end); u(Number(w.endOfSentence)); }
  }
  style(doc.style.upcoming); style(doc.style.current); style(doc.style.spoken);
  d(doc.style.wordSpacing); d(doc.style.lineHeight); u(Number(doc.style.titleCase)); d(doc.timeOriginSeconds);
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Native payload exceeds 16 MiB.');
  return Uint8Array.from(bytes);
}

/** Experimental UTF-16 carrier for the native FLATTEN/UNFLATTEN boundary.
 * Callback routing requires host verification; no PF SCAN bypass is assumed.
 * Budget includes an optional UTF-16 terminator. BCAP binary codec version is independent of the JSON protocol. */
export const NATIVE_TRANSPORT_PREFIX = 'BCDOC1:';
export const MAX_NATIVE_CARRIER_BYTES = 16 * 1024 * 1024;
export const MAX_NATIVE_TRANSPORT_BCAP_BYTES = Math.floor((MAX_NATIVE_CARRIER_BYTES - (NATIVE_TRANSPORT_PREFIX.length + 1) * 2) / 4);
export function encodeNativeTransportText(input: unknown): string {
  const encoded = encodeNativeDocument(input);
  if (encoded.length > MAX_NATIVE_TRANSPORT_BCAP_BYTES) throw new Error('Native UTF-16 carrier exceeds 16 MiB.');
  const parts: string[] = [NATIVE_TRANSPORT_PREFIX];
  // Bounded chunks avoid millions of small string allocations at the carrier limit.
  for (let offset = 0; offset < encoded.length; offset += 8192) {
    let hex = '';
    for (const byte of encoded.subarray(offset, offset + 8192)) hex += byte.toString(16).padStart(2, '0');
    parts.push(hex);
  }
  return parts.join('');
}

/** Bounded structural BCAP reader for the persisted origin in a host-read carrier.
 * Walks the complete layout before accepting the footer; it does not infer an
 * origin from caller style/transcript data or from a moved clip's new position. */
export function decodeNativeTransportTimeOrigin(text: unknown): number {
  if (typeof text !== 'string' || !/^BCDOC1:[0-9a-f]+$/.test(text) || text.length % 2 !== 1 || (text.length + 1) * 2 > MAX_NATIVE_CARRIER_BYTES) throw new Error('Invalid bounded native carrier.');
  const hex = text.slice(NATIVE_TRANSPORT_PREFIX.length), bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(bytes.buffer); let offset = 0;
  const need = (n: number) => { if (offset + n > bytes.length) throw new Error('Truncated native document.'); };
  const u = () => { need(4); const n = view.getUint32(offset, true); offset += 4; return n; };
  const d = () => { need(8); const n = view.getFloat64(offset, true); offset += 8; if (!Number.isFinite(n)) throw new Error('Nonfinite native document value.'); return n; };
  const flag = () => { const n = u(); if (n > 1) throw new Error('Invalid native document flag.'); return Boolean(n); };
  const string = (limit: number) => {
    const n = u(); if (n === 0 || n > limit) throw new Error('Invalid native string length.'); need(n);
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + n)); offset += n;
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) throw new Error('Invalid native string.');
    return value;
  };
  if (u() !== 0x50414342) throw new Error('Invalid native document magic.');
  const version = u(); if (version !== 1 && version !== 2) throw new Error('Unsupported native binary version.');
  const containers = u(); if (containers > 10000) throw new Error('Too many native containers.');
  const identities = new Set<string>(); let count = 0;
  for (let i = 0; i < containers; i++) {
    const identity = string(256); if (identities.has(identity)) throw new Error('Duplicate native identity.'); identities.add(identity);
    flag(); const words = u(); count += words; if (count > 100000) throw new Error('Too many native words.');
    let previous = -1;
    for (let j = 0; j < words; j++) { string(4096); const start = d(), end = d(); flag(); if (start < 0 || end < start || start < previous) throw new Error('Invalid native timing.'); previous = start; }
  }
  const color = () => ({ r: d(), g: d(), b: d(), a: d() });
  const style = () => ({ fontFamily: string(256), fontSize: d(), sizeScale: d(), opacity: d(), color: color(), bubble: flag(), bubbleColor: color(), padding: d(), radius: d(), outlineWidth: d(), outlineColor: color(), shadowBlur: d(), shadowX: d(), shadowY: d(), shadowColor: color() });
  const upcoming = style(), current = style(), spoken = style();
  validateNativeStyle({ upcoming, current, spoken, wordSpacing: d(), lineHeight: d(), titleCase: flag() });
  const origin = version === 2 ? d() : 0;
  if (Math.abs(origin) > 864000 || offset !== bytes.length) throw new Error('Invalid native document origin or trailing bytes.');
  return origin;
}
