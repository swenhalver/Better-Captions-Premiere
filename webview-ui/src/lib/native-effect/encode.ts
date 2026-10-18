import { validateNativeDocument, type NativeColor, type NativeWordStyle } from './contract.ts';
/** BCAP little-endian v1 payload matching native/core/caption_core.cpp.
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
  u(0x50414342); u(doc.version); u(doc.captions.length);
  for (const c of doc.captions) {
    s(c.id); u(Number(c.manualSplit)); u(c.words.length);
    for (const w of c.words) { s(w.text); d(w.start); d(w.end); u(Number(w.endOfSentence)); }
  }
  style(doc.style.upcoming); style(doc.style.current); style(doc.style.spoken);
  d(doc.style.wordSpacing); d(doc.style.lineHeight); u(Number(doc.style.titleCase));
  if (bytes.length > 16 * 1024 * 1024) throw new Error('Native payload exceeds 16 MiB.');
  return Uint8Array.from(bytes);
}
