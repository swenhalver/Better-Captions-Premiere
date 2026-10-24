import { encodeNativeDocument } from '../../webview-ui/src/lib/native-effect/encode.ts';

/** Legacy fixture builder. Production only writes v9; historical layouts omit
 * each word's pause-removal count (and pre-v8 boundary enum) and truncate the append-only style footer. */
export function legacyNativeDocumentBytes(document, version) {
  if (!Number.isInteger(version) || version < 1 || version > 8) throw new Error('Expected a historical BCAP version.');
  const source = Buffer.from(encodeNativeDocument(document));
  let offset = 8;
  const u = () => { const value = source.readUInt32LE(offset); offset += 4; return value; };
  const string = () => { const length = u(); offset += length; };
  const count = u(), parts = [source.subarray(0, 12)];
  for (let index = 0; index < count; index++) {
    const start = offset; string(); u(); const words = u(); parts.push(source.subarray(start, offset));
    for (let word = 0; word < words; word++) {
      const start = offset; string(); offset += 20; if (version >= 8) offset += 4; parts.push(source.subarray(start, offset)); offset += version >= 8 ? 4 : 8;
    }
  }
  const footerSizes = [0, 0, 8, 64, 68, 80, 140, 428, 428];
  parts.push(source.subarray(offset, source.length - 428 + footerSizes[version]));
  const bytes = Buffer.concat(parts); bytes.writeUInt32LE(version, 4);
  return new Uint8Array(bytes);
}
export const nativeCarrier = bytes => 'BCDOC1:' + Buffer.from(bytes).toString('hex');
