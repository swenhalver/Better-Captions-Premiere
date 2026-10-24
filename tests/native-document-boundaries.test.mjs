import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultNativeStyle, validateNativeDocument } from '../webview-ui/src/lib/native-effect/contract.ts';
import { encodeNativeDocument, encodeNativeTransportText, decodeNativeTransportTimeOrigin } from '../webview-ui/src/lib/native-effect/encode.ts';
import { decodeNativePanelDocument } from '../webview-ui/src/lib/native-effect/panel.ts';
import { nativeCaptionPhrases } from '../webview-ui/src/lib/native-effect/phrases.ts';
import { transcriptLines, changeTranscriptLineBreak } from '../webview-ui/src/lib/transcript/lines.ts';
import { legacyNativeDocumentBytes, nativeCarrier } from './helpers/native-document.mjs';

const word = (text, start, end, lineBreakBefore) => ({ text, start, end, endOfSentence: /[.!?]$/.test(text), ...(lineBreakBefore === undefined ? {} : { lineBreakBefore }) });
function document() {
  return { version: 1, binaryVersion: 11, animationAuthority: 'premiere-effect', sequenceId: 'sequence', timeOriginSeconds: 12.125,
    style: defaultNativeStyle(), captions: [
      { id: 'left', start: .1, end: .8, manualSplit: true, words: [word('Hello.', .1, .3, 'break'), word('more', .4, .8, 'join')] },
      { id: 'right', start: 2.1, end: 2.8, manualSplit: false, words: [word('world', 2.1, 2.3, 'join'), word('next', 2.4, 2.8, 'break')] },
    ] };
}
function panelCaptions(doc) {
  return doc.captions.map(caption => ({ id: caption.id, text: caption.words.map(word => word.text).join(' '), manualSplit: caption.manualSplit,
    startTime: caption.start, endTime: caption.end, words: caption.words.map(({ start, end, ...word }) => ({ ...word, startTime: start, endTime: end, isActive: false })) }));
}

test('v9 stores boundary then removed-pause u32 per word and validates both bounded fields', () => {
  const doc = document(), baseline = structuredClone(doc);
  delete doc.captions[0].words[0].lineBreakBefore;
  const bytes = encodeNativeDocument(doc), decoded = decodeNativePanelDocument(nativeCarrier(bytes), 'sequence');
  assert.equal(new DataView(bytes.buffer).getUint32(4,true),11);
  assert.deepEqual(decoded, doc);
  assert.equal(decodeNativeTransportTimeOrigin(nativeCarrier(bytes)), doc.timeOriginSeconds);
  const invalid = bytes.slice(), firstWordBoundary = 12 + 4 + 4 + 4 + 4 + 4 + new TextEncoder().encode('Hello.').length + 8 + 8 + 4;
  new DataView(invalid.buffer).setUint32(firstWordBoundary, 4, true);
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(invalid), 'sequence'), /boundary/);
  assert.throws(() => decodeNativeTransportTimeOrigin(nativeCarrier(invalid)), /boundary/);
  // A merge edge (3) exists from v10 only.
  const edge = bytes.slice(); new DataView(edge.buffer).setUint32(firstWordBoundary, 3, true);
  assert.equal(decodeNativePanelDocument(nativeCarrier(edge), 'sequence').captions[0].words[0].lineBreakBefore, 'edge');
  const edgeV9 = edge.slice(); new DataView(edgeV9.buffer).setUint32(4, 9, true);
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(edgeV9), 'sequence'), /boundary/);
  assert.throws(() => decodeNativeTransportTimeOrigin(nativeCarrier(edgeV9)), /boundary/);
  for (const value of ['auto', '', null, true, 0, 1, {}, []]) {
    const bad = structuredClone(baseline); bad.captions[0].words[0].lineBreakBefore = value;
    assert.throws(() => validateNativeDocument(bad), /boundary/);
  }
  assert.deepEqual(validateNativeDocument(baseline), baseline);
  const removedOffset = firstWordBoundary + 4;
  for (const value of [0, 1, 8]) {
    const withRemoved = structuredClone(baseline);
    withRemoved.captions[0].words[0].pauseLinesRemoved = value;
    const encoded = encodeNativeDocument(withRemoved), decoded = decodeNativePanelDocument(nativeCarrier(encoded), 'sequence');
    assert.equal(new DataView(encoded.buffer).getUint32(removedOffset, true), value);
    assert.equal(decoded.captions[0].words[0].pauseLinesRemoved ?? 0, value);
    assert.equal(decodeNativeTransportTimeOrigin(nativeCarrier(encoded)), baseline.timeOriginSeconds);
    assert.deepEqual(encodeNativeDocument(decoded), encoded);
  }
  const invalidRemoved = bytes.slice();
  new DataView(invalidRemoved.buffer).setUint32(removedOffset, 9, true);
  assert.throws(() => decodeNativePanelDocument(nativeCarrier(invalidRemoved), 'sequence'), /pause lines/);
  assert.throws(() => decodeNativeTransportTimeOrigin(nativeCarrier(invalidRemoved)), /pause lines/);
  for (const value of [-1, 1.5, 9, NaN, Infinity, '1', null, true, {}, []]) {
    const bad = structuredClone(baseline); bad.captions[0].words[0].pauseLinesRemoved = value;
    assert.throws(() => validateNativeDocument(bad), /pause lines/);
  }
});

test('every historical v1–7 storage boundary migrates to a word break with source data intact', () => {
  const doc = document();
  for (const caption of doc.captions) for (const word of caption.words) delete word.lineBreakBefore;
  Object.assign(doc.style.current, { fontWeight: 700, italic: true, fontWeightOffset: 100, bubbleFillSpaces: true,
    bubblePaddingInline: 19, bubblePaddingBlock: 3, underline: false, paddingTop: 2, marginLeft: -3, radiusBR: 14 });
  doc.style.baseFontWeight = 400; doc.style.letterCase = 'uppercase';
  for (let version = 1; version <= 7; version++) {
    const text = nativeCarrier(legacyNativeDocumentBytes(doc, version));
    const decoded = decodeNativePanelDocument(text, 'sequence');
    assert.equal(decoded.binaryVersion, 11);
    assert.equal(decoded.timeOriginSeconds, version === 1 ? 0 : doc.timeOriginSeconds);
    assert.deepEqual(decoded.captions, doc.captions.map((caption, index) => ({ ...caption,
      words: caption.words.map((word, wordIndex) => ({ ...word, ...(index > 0 && wordIndex === 0 ? { lineBreakBefore: 'break' } : {}) })) })));
    assert.equal(decoded.style.current.fontFamily, doc.style.current.fontFamily);
    if (version >= 3) assert.equal(decoded.style.current.fontWeight, 700);
    if (version >= 4) assert.equal(decoded.style.letterCase, 'uppercase');
    if (version >= 5) assert.equal(decoded.style.current.bubbleFillSpaces, true);
    if (version >= 6) { assert.equal(decoded.style.current.bubblePaddingInline, 19); assert.equal(decoded.style.current.underline, false); }
    if (version >= 7) { assert.equal(decoded.style.current.marginLeft, -3); assert.equal(decoded.style.current.radiusBR, 14); }
    const upgraded = encodeNativeTransportText(decoded);
    assert.deepEqual(decodeNativePanelDocument(upgraded, 'sequence'), decoded, 'second read must not invent further splits');
    assert.equal(decodeNativeTransportTimeOrigin(text), decoded.timeOriginSeconds);
  }
});

test('joins override EOS, pauses and character limits across storage edges; breaks precede punctuation', () => {
  const captions = panelCaptions(document()), before = structuredClone(captions);
  const grouped = nativeCaptionPhrases(captions, 1), rows = transcriptLines(grouped);
  assert.deepEqual(rows.map(row => row.segment.text), ['Hello. more world', 'next']);
  assert.equal(grouped[0].renderSegments[0], grouped[1].renderSegments[0], 'a spanning row is shared and shown once');
  assert.deepEqual(rows.map(row => [row.start, row.end]), [[0, 3], [3, 4]]);
  assert.deepEqual(captions, before);
  const auto = structuredClone(captions);
  for (const caption of auto) for (const word of caption.words) delete word.lineBreakBefore;
  assert.deepEqual(transcriptLines(nativeCaptionPhrases(auto, 500)).map(row => row.segment.text), ['Hello.', 'more', 'world next']);
  const punctuation = panelCaptions({ captions: [{ ...document().captions[0], words: [word('first', 0, .1), word(',', .1, .2, 'break')] }] });
  assert.deepEqual(transcriptLines(nativeCaptionPhrases(punctuation, 500)).map(row => row.segment.text), ['first', ',']);
});

test('v8 storage edges and manualSplit flags do not create grouping boundaries', () => {
  const doc = document();
  for (const caption of doc.captions) for (const word of caption.words) { delete word.lineBreakBefore; word.endOfSentence = false; word.text = word.text.replace('.', ''); }
  doc.captions[1].words[0].start = .9; doc.captions[1].words[0].end = 1.1;
  doc.captions[1].words[1].start = 1.2; doc.captions[1].words[1].end = 1.4; doc.captions[1].start = .9; doc.captions[1].end = 1.4;
  const carrier = nativeCarrier(legacyNativeDocumentBytes(doc, 8));
  const decoded = decodeNativePanelDocument(carrier, 'sequence');
  assert.deepEqual(decoded, doc);
  assert.equal(decodeNativeTransportTimeOrigin(carrier), doc.timeOriginSeconds);
  assert.ok(decoded.captions.every(caption => caption.words.every(word => (word.pauseLinesRemoved ?? 0) === 0)));
  assert.equal(transcriptLines(nativeCaptionPhrases(panelCaptions(decoded), 500)).length, 1);
});

test('v8 explicit breaks and joins survive the v10 upgrade without storage-edge migration or invented deletion', () => {
  const doc = document();
  doc.captions[0].words[0].pauseLinesRemoved = 8;
  const bytes = legacyNativeDocumentBytes(doc, 8), decoded = decodeNativePanelDocument(nativeCarrier(bytes), 'sequence');
  delete doc.captions[0].words[0].pauseLinesRemoved;
  // Before v10, a break beside a joined word was a merge's edge.
  doc.captions[0].words[0].lineBreakBefore = 'edge'; doc.captions[1].words[1].lineBreakBefore = 'edge';
  assert.deepEqual(decoded, doc);
  assert.deepEqual(decodeNativePanelDocument(encodeNativeTransportText(decoded), 'sequence'), decoded);
});

test('merged and split cross-container rows survive encoding and subsequent automatic regrouping', () => {
  const captions = nativeCaptionPhrases(panelCaptions(document()), 1), line = transcriptLines(captions)[0];
  const merged = changeTranscriptLineBreak(captions, line), grouped = nativeCaptionPhrases(merged, 1);
  assert.equal(transcriptLines(grouped).length, 1);
  const split = changeTranscriptLineBreak(grouped, transcriptLines(grouped)[0], 2);
  assert.deepEqual(transcriptLines(nativeCaptionPhrases(split, 500)).map(row => [row.start, row.end]), [[0, 2], [2, 4]]);
  assert.deepEqual(split.map(caption => caption.id), captions.map(caption => caption.id));
  const doc = document();
  doc.captions = split.map(caption => ({ id: caption.id, start: caption.startTime, end: caption.endTime, manualSplit: !!caption.manualSplit,
    words: caption.words.map(({ startTime, endTime, isActive, ...word }) => ({ ...word, start: startTime, end: endTime })) }));
  const decoded = decodeNativePanelDocument(encodeNativeTransportText(doc), 'sequence');
  assert.deepEqual(transcriptLines(nativeCaptionPhrases(panelCaptions(decoded), 1)).map(row => [row.start, row.end]), [[0, 2], [2, 4]]);
});

test('pre-v10 merge edges become clearable once at decode, while v10 manual breaks beside joins stay breaks', () => {
  const doc = document();
  doc.captions.push({ id: 'tail', start: 3, end: 4, manualSplit: false, words: [word('alone', 3, 3.4, 'break'), word('after', 3.5, 4)] });
  const v9 = encodeNativeDocument(doc).slice(0, -4); new DataView(v9.buffer).setUint32(4, 9, true); // v9 lacks only the v11 line wrap word
  const legacy = decodeNativePanelDocument(nativeCarrier(v9), 'sequence');
  assert.deepEqual(legacy.captions.flatMap(caption => caption.words.map(word => word.lineBreakBefore ?? '-')), ['edge', 'join', 'join', 'edge', 'break', '-'], 'only breaks beside joins came from merges');
  const current = decodeNativePanelDocument(encodeNativeTransportText(doc), 'sequence');
  assert.deepEqual(current.captions.flatMap(caption => caption.words.map(word => word.lineBreakBefore ?? '-')), ['break', 'join', 'join', 'break', 'break', '-'], 'v10 is never reinterpreted');
  assert.deepEqual(decodeNativePanelDocument(encodeNativeTransportText(legacy), 'sequence'), legacy, 'the one-time upgrade is stable');
});
