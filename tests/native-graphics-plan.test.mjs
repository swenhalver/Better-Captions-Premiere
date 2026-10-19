import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeGraphicsPlan, NATIVE_GRAPHICS_LIMITS } from '../webview-ui/src/lib/native-graphics/plan.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';

const word = (text, startTime, endTime, patch = {}) => ({ text, startTime, endTime, isActive: false, ...patch });
const words = (text, offset = 0) => text.split(' ').map((text, index) => word(text, offset + index * .4, offset + index * .4 + .25));
const caption = (id, items, patch = {}) => ({ id, words: items, text: items.map(item => item.text).join(' '), startTime: items[0].startTime, endTime: items.at(-1).endTime + .1, ...patch });
function input(captions = [caption('source-a', words('Hello native graphics'))], patch = {}) {
  return { captions, style: structuredClone(DEFAULT_STYLE), animation: structuredClone(DEFAULT_ANIMATION),
    sequence: { id: 'sequence-a', name: 'Scratch', frameRate: 30, frameWidth: 1920, frameHeight: 1080 }, ...patch };
}
const codes = plan => plan.manifest.warnings.map(warning => warning.code);

test('plain phrase SRT and manifest explicitly distinguish retained authoring intent from applied native capabilities', () => {
  const data = input(), plan = buildNativeGraphicsPlan(data);
  assert.equal(plan.srt, '1\r\n00:00:00,000 --> 00:00:01,167\r\nHello native graphics\r\n');
  assert.equal(plan.manifest.phrases[0].startFrame, 0);
  assert.equal(plan.manifest.phrases[0].endFrame, 35);
  assert.deepEqual(plan.manifest.handoff, { format: 'srt', carries: ['plain-text', 'phrase-timing'], graphicsUpgrade: 'manual-premiere-command', nativeGraphicsVerified: false, appliesWordStyles: false, createsShapes: false, appliesGeometryKeyframes: false, appliesDynamicReflow: false, programmaticNativeTextEditing: false });
  assert.deepEqual(plan.manifest.reconnection.nativeLinks, []);
  assert.equal(plan.manifest.reconnection.status, 'unbound');
  assert.ok(codes(plan).includes('STYLE_INTENT_ONLY'));
  assert.ok(codes(plan).includes('ANIMATION_AND_GEOMETRY_INTENT_ONLY'));
  assert.ok(codes(plan).includes('RECONNECTION_UNBOUND'));
  assert.deepEqual(plan.manifest.source.style, data.style);
});

test('exact NTSC frame ratios are retained without confusing frame count with drop-frame timecode', () => {
  const rate = { numerator: 30000, denominator: 1001 }, start = 1800 * 1001 / 30000, end = 1802 * 1001 / 30000;
  const data = input([caption('fractional', [word('NTSC', start, end)], { endTime: end })]);
  data.sequence.frameRate = rate;
  const plan = buildNativeGraphicsPlan(data), phrase = plan.manifest.phrases[0];
  assert.deepEqual(plan.manifest.sequence.frameRate, rate);
  assert.equal(phrase.startFrame, 1800); assert.equal(phrase.endFrame, 1802);
  assert.equal(phrase.srtStartMs, 60060); assert.equal(phrase.srtEndMs, 60127);
  assert.match(plan.srt, /00:01:00,060 --> 00:01:00,127/);
  assert.equal(phrase.sourceStartTime, start); assert.equal(phrase.sourceEndTime, end);
  assert.ok(codes(plan).includes('TIMING_QUANTIZED'), 'SRT millisecond approximation is disclosed even when source times are exact frames');
});

test('decimal NTSC rates disclose canonicalization while explicit non-NTSC ratios are not guessed', () => {
  const data = input(); data.sequence.frameRate = 23.976;
  const plan = buildNativeGraphicsPlan(data);
  assert.deepEqual(plan.manifest.sequence.frameRate, { numerator: 24000, denominator: 1001 });
  assert.ok(codes(plan).includes('FRAME_RATE_CANONICALIZED'));
  data.sequence.frameRate = { numerator: 2997, denominator: 100 };
  const exact = buildNativeGraphicsPlan(data);
  assert.deepEqual(exact.manifest.sequence.frameRate, { numerator: 2997, denominator: 100 });
  assert.ok(!codes(exact).includes('FRAME_RATE_CANONICALIZED'));
});

test('shared rounded boundaries remain non-overlapping in frames and SRT milliseconds at fractional fps', () => {
  const captions = Array.from({ length: 80 }, (_, index) => {
    const start = index * .057, end = (index + 1) * .057;
    return caption(`source-${index}`, [word(`w${index}`, start, end)], { endTime: end, manualSplit: true });
  });
  const data = input(captions); data.sequence.frameRate = { numerator: 24000, denominator: 1001 };
  const plan = buildNativeGraphicsPlan(data);
  assert.equal(plan.manifest.phrases.length, captions.length);
  for (const [index, phrase] of plan.manifest.phrases.entries()) {
    assert.ok(phrase.endFrame > phrase.startFrame); assert.ok(phrase.srtEndMs > phrase.srtStartMs);
    assert.equal(phrase.sourceStartTime, captions[index].startTime);
    assert.equal(phrase.sourceEndTime, captions[index].endTime);
    if (index) {
      assert.equal(phrase.startFrame, plan.manifest.phrases[index - 1].endFrame);
      assert.equal(phrase.srtStartMs, plan.manifest.phrases[index - 1].srtEndMs);
    }
  }
});

test('genuine source overlap is rejected even below the older caption validator tolerance', () => {
  const a = caption('a', [word('a', 0, .5)], { endTime: .5 });
  const b = caption('b', [word('b', .49999, .8)], { endTime: .8 });
  assert.throws(() => buildNativeGraphicsPlan(input([a, b])), /Source caption 2 overlaps/);
  const inside = caption('a', [word('one', 0, .5), word('two', .49999, .8)], { endTime: .8 });
  assert.throws(() => buildNativeGraphicsPlan(input([inside])), /Source word timings overlap/);
});

test('zero-frame phrases fail explicitly instead of silently dropping, stretching or shifting speech', () => {
  const data = input([caption('tiny', [word('tiny', .001, .005)], { startTime: .001, endTime: .005 })]);
  const before = structuredClone(data);
  assert.throws(() => buildNativeGraphicsPlan(data), /shorter than a representable frame/);
  assert.deepEqual(data, before);
  data.captions[0].words[0].endTime = .001;
  assert.throws(() => buildNativeGraphicsPlan(data), /word timing/);
});

test('existing grapheme character cap includes spaces and keeps Unicode words intact', () => {
  const data = input([caption('unicode', [word('👨‍👩‍👧‍👦', 0, .25), word('e\u0301', .4, .65), word('世界', .8, 1.05)])]);
  data.style.maxChars = 3;
  const plan = buildNativeGraphicsPlan(data);
  assert.deepEqual(plan.manifest.phrases.map(phrase => phrase.text), ['👨‍👩‍👧‍👦 e\u0301', '世界']);
  assert.ok(plan.srt.includes('👨‍👩‍👧‍👦 e\u0301'));
  assert.equal(plan.manifest.phrases.flatMap(phrase => phrase.words).length, 3);
  assert.ok(!codes(plan).includes('WHOLE_WORD_EXCEEDS_CHARACTER_CAP'));
});

test('a long whole word is preserved and explicitly flagged rather than silently split', () => {
  const data = input([caption('word', words('extraordinary'))]); data.style.maxChars = 3;
  const plan = buildNativeGraphicsPlan(data);
  assert.equal(plan.manifest.phrases[0].text, 'extraordinary');
  assert.ok(codes(plan).includes('WHOLE_WORD_EXCEEDS_CHARACTER_CAP'));
});

test('automatic source containers can share a phrase but manual splits remain independent', () => {
  const captions = [caption('a', words('one two')), caption('b', words('three four', .8))];
  const joined = buildNativeGraphicsPlan(input(captions));
  assert.equal(joined.manifest.phrases.length, 1);
  assert.deepEqual(joined.manifest.phrases[0].sourceCaptionIds, ['a', 'b']);
  assert.deepEqual(joined.manifest.phrases[0].words.map(word => [word.captionId, word.wordIndex]), [['a', 0], ['a', 1], ['b', 0], ['b', 1]]);
  const split = buildNativeGraphicsPlan(input(captions.map(caption => ({ ...caption, manualSplit: true }))));
  assert.equal(split.manifest.phrases.length, 2);
  assert.ok(split.manifest.phrases.every(phrase => phrase.manualSplit));
});

test('speaker, placement, sentence punctuation and silent gaps retain meaningful phrase boundaries', () => {
  const a = caption('a', words('first')), b = caption('b', words('second', .4));
  assert.equal(buildNativeGraphicsPlan(input([a, { ...b, speaker: 'B' }])).manifest.phrases.length, 2);
  const positions = buildNativeGraphicsPlan(input([{ ...a, position: { x: .3, y: .8 } }, { ...b, position: { x: .7, y: .8 } }]));
  assert.equal(positions.manifest.phrases.length, 2);
  assert.deepEqual(positions.manifest.phrases.map(phrase => phrase.intendedPosition), [{ x: .3, y: .8 }, { x: .7, y: .8 }]);
  assert.equal(buildNativeGraphicsPlan(input([caption('punctuation', words('Hello. Goodbye.'))])).manifest.phrases.length, 2);
  assert.equal(buildNativeGraphicsPlan(input([a, caption('gap', words('later', 2))])).manifest.phrases.length, 2);
});

test('stable endpoint identities survive spelling/style/timing edits and distinguish regrouped ranges', () => {
  const data = input(), first = buildNativeGraphicsPlan(data), again = buildNativeGraphicsPlan(data);
  assert.deepEqual(first, again, 'groupCaptionWords random IDs do not leak into the deterministic manifest');
  const edited = structuredClone(data); edited.style.textColor = '#ff0000';
  edited.captions[0].words[1].text = 'Premiere'; edited.captions[0].text = 'Hello Premiere graphics';
  edited.captions[0].words = edited.captions[0].words.map(word => ({ ...word, startTime: word.startTime + 1, endTime: word.endTime + 1 }));
  edited.captions[0].startTime += 1; edited.captions[0].endTime += 1;
  assert.equal(buildNativeGraphicsPlan(edited).manifest.phrases[0].id, first.manifest.phrases[0].id);
  data.style.maxChars = 8;
  const regrouped = buildNativeGraphicsPlan(data);
  assert.equal(regrouped.manifest.phrases.length, 3);
  assert.ok(regrouped.manifest.phrases.every(phrase => phrase.id !== first.manifest.phrases[0].id));
  assert.equal(new Set(regrouped.manifest.phrases.map(phrase => phrase.id)).size, 3);
});

test('full rich source, original links and transcript survive separately without mutating the input', () => {
  const data = input();
  Object.assign(data.captions[0], { clipNodeId: 'old-native-effect', projectItemId: 'old-item', mediaPath: '/old/render.mov', position: { x: .25, y: .75 }, timingEstimated: true,
    motionProfile: { signature: 'existing-keys', samples: [{ time: 0, scaleX: .8, scaleY: .6 }] },
    renderBounds: { x: 100, y: 200, width: 400, height: 300, frameWidth: 1920, frameHeight: 1080 },
  });
  data.style.activeWord.fontWeightOffset = 100; data.style.activeWord.italic = true;
  data.style.upcomingWord = { color: '#fff999', fontWeightOffset: 0 };
  data.transcriptJson = { language: 'en', segments: [{ start: 0, duration: 1, language: 'en', speaker: 'A', words: [] }], speakers: [{ id: 'A', name: 'Speaker' }] };
  const before = structuredClone(data), plan = buildNativeGraphicsPlan(data);
  assert.deepEqual(data, before);
  assert.deepEqual(plan.manifest.source, { captions: data.captions, style: data.style, animation: data.animation, transcriptJson: data.transcriptJson });
  assert.deepEqual(JSON.parse(JSON.stringify(plan.manifest)), plan.manifest);
  assert.deepEqual(plan.manifest.reconnection.nativeLinks, []);
  assert.ok(!plan.srt.includes('old-native-effect')); assert.ok(!plan.srt.includes('#fff999'));
  plan.manifest.source.style.activeWord.padding = 42;
  plan.manifest.source.captions[0].motionProfile.samples[0].scaleX = 4;
  assert.deepEqual(data, before, 'returned manifest is detached from live authoring state');
});

test('SRT cue and formatting injection fail explicitly while ordinary punctuation stays literal', () => {
  for (const text of ['safe\n\n2\n00:00:00,000 --> 00:00:01,000\nInjected', '<i>italic</i>', '1 --> 2', '&lt;tag&gt;', '&#x41;', '{\\an8}position', 'a\u0000b', 'a\u2028b', '\ud800']) {
    const data = input([caption('unsafe', [word(text, 0, .5)])]);
    assert.throws(() => buildNativeGraphicsPlan(data), /plain text|Unicode/, text);
  }
  const plan = buildNativeGraphicsPlan(input([caption('safe', [word('Rock & roll — “yes!”', 0, 1)])]));
  assert.ok(plan.srt.includes('Rock & roll — “yes!”'));
});

test('word-derived SRT never executes or emits unrelated source text fields', () => {
  const data = input(); data.captions[0].text = '<script>ignored derived caption text</script>\n\n2';
  const plan = buildNativeGraphicsPlan(data);
  assert.ok(!plan.srt.includes('script')); assert.equal(plan.manifest.source.captions[0].text, data.captions[0].text);
});

test('invalid rates, dimensions, identities, character caps and nonfinite timings fail before export', () => {
  for (const frameRate of [0, NaN, Infinity, 241, { numerator: 0, denominator: 1001 }, { numerator: 30000, denominator: 0 }, { numerator: 29.97, denominator: 1 }]) {
    const data = input(); data.sequence.frameRate = frameRate;
    assert.throws(() => buildNativeGraphicsPlan(data), /Frame rate/);
  }
  for (const frameWidth of [0, 1.2, 16385, NaN]) {
    const data = input(); data.sequence.frameWidth = frameWidth;
    assert.throws(() => buildNativeGraphicsPlan(data), /dimensions/);
  }
  const missingId = input(); missingId.sequence.id = '';
  assert.throws(() => buildNativeGraphicsPlan(missingId), /sequence ID/);
  const duplicate = input([caption('duplicate', words('a')), caption('duplicate', words('b', 1))]);
  assert.throws(() => buildNativeGraphicsPlan(duplicate), /Duplicate caption/);
  const badCap = input(); badCap.style.maxChars = 501;
  assert.throws(() => buildNativeGraphicsPlan(badCap), /character limit/);
  const badTime = input(); badTime.captions[0].words[0].startTime = NaN;
  assert.throws(() => buildNativeGraphicsPlan(badTime), /word timing/);
});

test('source and generated phrase budgets are bounded independently', () => {
  const cue = caption('a', words('a'));
  assert.throws(() => buildNativeGraphicsPlan(input(Array(NATIVE_GRAPHICS_LIMITS.captions + 1).fill(cue))), /2000 source captions/);
  assert.throws(() => buildNativeGraphicsPlan(input([{ ...cue, words: Array(NATIVE_GRAPHICS_LIMITS.words + 1).fill(cue.words[0]) }])), /20000 words/);
  const data = input([caption('many', Array.from({ length: NATIVE_GRAPHICS_LIMITS.phrases + 1 }, (_, index) => word('a', index * .25, index * .25 + .1)))]);
  data.style.maxChars = 1;
  assert.throws(() => buildNativeGraphicsPlan(data), /exceeds 2000 native graphic phrases/);
  assert.throws(() => buildNativeGraphicsPlan(input([caption('long-text', [word('a'.repeat(NATIVE_GRAPHICS_LIMITS.textCharacters + 1), 0, 1)])])), /250000 text characters/);
  assert.throws(() => buildNativeGraphicsPlan(input([caption('long-time', [word('a', 86400, 86401)])])), /24 hours/);
});

test('manifest rejects cycles, executable values and prototype-bearing objects', () => {
  const cyclic = input(); cyclic.style.other = cyclic.style;
  assert.throws(() => buildNativeGraphicsPlan(cyclic), /non-cyclic JSON/);
  const executable = input(); executable.style.other = () => 'not allowed';
  assert.throws(() => buildNativeGraphicsPlan(executable), /JSON data/);
  const custom = input(); custom.style.other = new Date();
  assert.throws(() => buildNativeGraphicsPlan(custom), /plain JSON objects/);
  const unsafe = input(); unsafe.style.other = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => buildNativeGraphicsPlan(unsafe), /unsupported object key/);
  assert.equal({}.polluted, undefined);
});
