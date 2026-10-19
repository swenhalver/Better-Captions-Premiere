import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeGraphicsXml } from '../webview-ui/src/lib/native-graphics/xml.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';

const makeInput = () => ({
  sequence: { id: 'source-seq', name: 'Original', frameRate: 30, frameWidth: 1920, frameHeight: 1080 },
  captions: [
    { id: 'a', text: 'Native & editable', startTime: 0, endTime: 2, manualSplit: true, words: [
      { text: 'Native', startTime: 0, endTime: .5, isActive: false },
      { text: '&', startTime: .5, endTime: 1, isActive: false },
      { text: 'editable', startTime: 1, endTime: 2, isActive: false },
    ] },
    { id: 'b', text: '世界', startTime: 3, endTime: 5, manualSplit: true, words: [{ text: '世界', startTime: 3, endTime: 5, isActive: false }] },
  ],
  style: { ...structuredClone(DEFAULT_STYLE), fontSize: 72 },
  animation: structuredClone(DEFAULT_ANIMATION),
});
const options = { generationId: 'sample-1', sequenceName: 'Review & "Native"' };

test('public Text XML preserves phrase frames and gaps without external media or a compiled effect', () => {
  const input = makeInput(), before = structuredClone(input);
  const { xml, manifest } = buildNativeGraphicsXml(input, options);
  assert.deepEqual(input, before);
  assert.equal((xml.match(/<generatoritem /g) || []).length, 2);
  assert.match(xml, /<start>0<\/start><end>60<\/end>/);
  assert.match(xml, /<start>90<\/start><end>150<\/end>/);
  assert.match(xml, /<in>0<\/in><out>60<\/out>/);
  assert.match(xml, /<parameterid>fontsize<\/parameterid><name>Size<\/name><value>32<\/value>/);
  assert.match(xml, /Native &amp; editable/);
  assert.match(xml, /Review &amp; &quot;Native&quot;/);
  assert.match(xml, /世界/);
  assert.doesNotMatch(xml, /DOCTYPE|pathurl|\.mov|\.mogrt|BCAP|BCDOC|file:\/\//);
  assert.deepEqual(manifest.sourcePlan.source.captions, before.captions);
  assert.deepEqual(manifest.output.clips.map(c => [c.startFrame, c.endFrame]), [[0, 60], [90, 150]]);
  assert.equal(manifest.output.nativeImportVerified, false);
  assert.equal(manifest.output.createsShapes, false);
  assert.equal(manifest.reconnection.status, 'unbound');
  assert.deepEqual(manifest.reconnection.nativeLinks, []);
  assert.ok(manifest.warnings.some(value => value.includes('Past/current/next')));
});

test('NTSC keeps exact frame counts and rejects a non-representable rational fps', () => {
  const input = makeInput(); input.sequence.frameRate = { numerator: 30000, denominator: 1001 };
  const { xml } = buildNativeGraphicsXml(input, options);
  assert.match(xml, /<timebase>30<\/timebase><ntsc>TRUE<\/ntsc>/);
  assert.match(xml, /<start>90<\/start><end>150<\/end>/);
  input.sequence.frameRate = { numerator: 2997, denominator: 100 };
  assert.throws(() => buildNativeGraphicsXml(input, options), /integer frame rate/);
});

test('XML names and font names are escaped and malformed identity/style cannot become markup', () => {
  const input = makeInput(); input.style.fontFamily = 'Example <Regular> & Bold';
  assert.match(buildNativeGraphicsXml(input, options).xml, /Example &lt;Regular&gt; &amp; Bold/);
  assert.throws(() => buildNativeGraphicsXml(input, { generationId: 'id"><file>' }), /generation ID/);
  assert.throws(() => buildNativeGraphicsXml(input, { ...options, sequenceName: 'bad\u0001' }), /control character/);
  input.style.fontFamily = '\ud800';
  assert.throws(() => buildNativeGraphicsXml(input, options), /incomplete Unicode/);
  for (const patch of [{ fontSize: NaN }, { fontSize: 0 }, { textColor: '#fff' }, { textAlign: 'justify' }]) {
    assert.throws(() => buildNativeGraphicsXml({ ...makeInput(), style: { ...makeInput().style, ...patch } }, options));
  }
});

test('case conversion and explicit regular/bold mapping do not change source data', () => {
  const input = makeInput(); input.style.textTransform = 'uppercase'; input.style.fontWeight = 500;
  const { xml, manifest } = buildNativeGraphicsXml(input, options);
  assert.match(xml, /NATIVE &amp; EDITABLE/);
  assert.match(xml, /<parameterid>fontstyle<\/parameterid><name>Style<\/name><value>1<\/value>/);
  assert.ok(manifest.warnings.some(value => value.includes('Weight 500')));
  assert.equal(manifest.sourcePlan.source.captions[0].text, 'Native & editable');
  assert.throws(() => buildNativeGraphicsXml({ ...input, captions: [] }, options), /Transcribe or load captions/);
});

test('re-export IDs are disjoint while source phrase identities remain stable', () => {
  const first = buildNativeGraphicsXml(makeInput(), options).manifest;
  const second = buildNativeGraphicsXml(makeInput(), { generationId: 'sample-2' }).manifest;
  assert.deepEqual(first.sourcePlan.phrases.map(p => p.id), second.sourcePlan.phrases.map(p => p.id));
  assert.ok(first.output.clips.every(c => !second.output.clips.some(d => d.xmlId === c.xmlId || d.name === c.name)));
});
