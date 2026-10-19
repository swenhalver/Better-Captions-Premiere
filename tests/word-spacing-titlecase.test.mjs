import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptionRenderer } from '../webview-ui/src/lib/canvas/engine.ts';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
import { restoreSessionStyle } from '../webview-ui/src/lib/session/style.ts';
import { transformCaptionText } from '../webview-ui/src/lib/typography.ts';
import { validateStylePatch } from '../webview-ui/src/lib/agent-bridge.ts';
import { capturePresetLook, applyPresetLook, validatePresetLook } from '../webview-ui/src/lib/style-presets.ts';

// Variable glyph metrics and real canvas-state transforms expose wrong measured
// case, moving word centers and gaps hidden by a uniform monospace fixture.
class PaintRecorder {
  font = '700 32px "Fixture"'; transform = [1, 1, 0, 0]; stack = []; texts = []; bubbles = []; points = [];
  save() { this.stack.push({ font: this.font, transform: [...this.transform], fillStyle: this.fillStyle }); }
  restore() { Object.assign(this, this.stack.pop()); }
  clearRect() { this.texts = []; this.bubbles = []; }
  translate(x, y) { this.transform[2] += x * this.transform[0]; this.transform[3] += y * this.transform[1]; }
  scale(x, y) { this.transform[0] *= x; this.transform[1] *= y; }
  point(x, y) { return [x * this.transform[0] + this.transform[2], y * this.transform[1] + this.transform[3]]; }
  measureText(text) {
    const size = Number(this.font.match(/([\d.]+)px/)[1]);
    return { width: Array.from(text).reduce((n, letter) => n + (letter === ' ' ? .25 : /\p{Lu}/u.test(letter) ? .6 : .5) * size, 0), actualBoundingBoxAscent: size * .6, actualBoundingBoxDescent: size * .3 };
  }
  fillText(text, x, y) {
    const start = this.point(x, y), end = this.point(x + this.measureText(text).width, y);
    this.texts.push({ text, x: start[0], right: end[0], y: start[1], font: this.font });
  }
  strokeText() {}
  beginPath() { this.points = []; }
  moveTo(x, y) { this.points.push(this.point(x, y)); }
  lineTo(x, y) { this.points.push(this.point(x, y)); }
  quadraticCurveTo(cx, cy, x, y) { this.points.push(this.point(cx, cy), this.point(x, y)); }
  closePath() {}
  fill() { this.bubbles.push({ left: Math.min(...this.points.map(p => p[0])), right: Math.max(...this.points.map(p => p[0])), color: this.fillStyle }); }
}
const caption = text => {
  const words = text.split(' ').map((text, i) => ({ text, startTime: i * .5, endTime: i * .5 + .4, isActive: false }));
  return { id: 'fixture', text, words, startTime: 0, endTime: words.length * .5 };
};
const animation = { ...DEFAULT_ANIMATION, preset: 'karaoke', fadeInDuration: 0, fadeOutDuration: 0 };
function plainStyle() {
  const style = structuredClone(DEFAULT_STYLE);
  Object.assign(style, { fontSize: 32, strokeEnabled: false, backgroundEnabled: false });
  for (const state of ['activeWord', 'spokenWord']) Object.assign(style[state], { sizeScale: 1, bubble: false });
  return style;
}
function render(cue, style, time = .2, width = 1000) {
  const ctx = new PaintRecorder(), layout = new CaptionRenderer(ctx, width, 512).renderFrame(cue, time, style, animation, { width, height: 512 });
  assert.equal(ctx.stack.length, 0);
  return { layout, texts: ctx.texts, bubbles: ctx.bubbles };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('word spacing changes the font space between words without changing letter spacing or font size', () => {
  const cue = caption('one two three'), style = plainStyle();
  for (const percent of [0, 50, 100, 200, 300]) {
    style.wordSpacing = percent;
    const frame = render(cue, style);
    near(frame.texts[1].x - frame.texts[0].right, 8 * percent / 100);
    near(frame.texts[2].x - frame.texts[1].right, 8 * percent / 100);
    assert.ok(frame.texts.every(word => word.font.includes('32px')));
  }
  assert.equal(style.activeWord.letterSpacing, undefined);
});

test('normal spacing removes repeated highlight padding while keeping active words and line centers stable', () => {
  const cue = caption('one two three four'), style = structuredClone(DEFAULT_STYLE), legacy = structuredClone(style);
  delete legacy.wordSpacing;
  const normal = render(cue, style), old = render(cue, legacy);
  assert.ok(normal.layout.width < old.layout.width - 50, 'bubble padding is shared through gaps instead of added around every word');
  const frames = [.2, .45, .7, 1.2, 1.7, 1.95].map(time => render(cue, style, time));
  const centers = frame => frame.texts.map(word => [(word.x + word.right) / 2, word.y]);
  for (const frame of frames) centers(frame).forEach((center, i) => center.forEach((v, axis) => near(v, centers(frames[0])[i][axis])));
  assert.ok(frames.every(frame => JSON.stringify(frame.layout.rows) === JSON.stringify(frames[0].layout.rows)));
});

test('tight spacing keeps active bubbles clear of adjacent text and inside the measured row', () => {
  const cue = caption('A wide word I'), style = structuredClone(DEFAULT_STYLE);
  style.wordSpacing = 0;
  for (const time of [.2, .7, 1.2, 1.7]) {
    const frame = render(cue, style, time), active = Math.floor(time / .5), bubble = frame.bubbles[0];
    assert.ok(bubble, 'current bubble is drawn');
    if (active > 0) assert.ok(bubble.left >= frame.texts[active - 1].right + style.strokeWidth - 1e-8);
    if (active + 1 < frame.texts.length) assert.ok(bubble.right <= frame.texts[active + 1].x - style.strokeWidth + 1e-8);
    assert.ok(bubble.left >= 500 - frame.layout.width / 2 - 1e-8);
    assert.ok(bubble.right <= 500 + frame.layout.width / 2 + 1e-8);
  }
});

test('word spacing participates in line wrapping at fixed font size', () => {
  const cue = caption('one two six'), style = plainStyle();
  style.wordSpacing = 0;
  const tight = render(cue, style, .2, 160);
  style.wordSpacing = 200;
  const loose = render(cue, style, .2, 160);
  assert.equal(tight.layout.rows.length, 1); assert.equal(loose.layout.rows.length, 2);
  assert.ok([...tight.texts, ...loose.texts].every(word => word.font.includes('32px')));
});

test('new styles use natural spacing, saved legacy styles remain unchanged until explicitly adjusted', () => {
  assert.equal(restoreSessionStyle().wordSpacing, 100);
  const old = structuredClone(DEFAULT_STYLE); delete old.wordSpacing;
  assert.equal(restoreSessionStyle(old).wordSpacing, undefined);
  const adjusted = restoreSessionStyle(JSON.parse(JSON.stringify({ ...old, wordSpacing: 65 })));
  assert.equal(adjusted.wordSpacing, 65);
  for (const invalid of [-1, 301, NaN, Infinity, '100', null]) assert.equal(restoreSessionStyle({ ...old, wordSpacing: invalid }).wordSpacing, undefined);
});

test('word spacing and title case survive preset capture/application while old presets retain legacy spacing', () => {
  const style = plainStyle(); style.wordSpacing = 55; style.textTransform = 'titlecase'; style.activeWord.textTransform = 'uppercase';
  const saved = capturePresetLook(style, animation), restored = applyPresetLook(plainStyle(), saved);
  assert.equal(restored.style.wordSpacing, 55); assert.equal(restored.style.textTransform, 'titlecase'); assert.equal(restored.style.activeWord.textTransform, 'uppercase');
  const legacy = structuredClone(saved); delete legacy.style.wordSpacing;
  assert.equal(applyPresetLook(style, legacy).style.wordSpacing, undefined, 'old presets must clear a target’s new natural spacing');
  assert.deepEqual(validatePresetLook(legacy), legacy);
  for (const invalid of [-1, 301, '100', null]) assert.throws(() => validatePresetLook({ ...saved, style: { ...saved.style, wordSpacing: invalid } }));
  assert.throws(() => validatePresetLook({ ...saved, style: { ...saved.style, unsupported: 1 } }));
});

test('agent style edits accept bounded spacing and title case for every word state only', () => {
  for (const wordSpacing of [0, 25, 100, 300]) assert.deepEqual(validateStylePatch({ wordSpacing }), { wordSpacing });
  const patch = { textTransform: 'titlecase', activeWord: { textTransform: 'titlecase' }, spokenWord: { textTransform: 'titlecase' }, upcomingWord: { textTransform: 'titlecase' } };
  assert.deepEqual(validateStylePatch(patch), patch);
  for (const wordSpacing of [-1, 301, NaN, Infinity, '100', null]) assert.throws(() => validateStylePatch({ wordSpacing }));
  assert.throws(() => validateStylePatch({ activeWord: { wordSpacing: 100 } }));
  assert.throws(() => validateStylePatch({ textTransform: 'title-case' }));
});

test('title case handles Unicode, contractions, punctuation and hyphens without changing transcription', () => {
  const source = '“hELLO,” don’T stop—rÉSUMÉ élÈVE ΜΊΑ ПРИВЕТ 123abc e\u0301LAN';
  assert.equal(transformCaptionText(source, 'titlecase'), '“Hello,” Don’t Stop—Résumé Élève Μία Привет 123Abc E\u0301lan');
  assert.equal(transformCaptionText("'tIS mOTHER-in-LAW l’AMOUR rock ’n’ roll", 'titlecase'), "'Tis Mother-In-Law L’amour Rock ’N’ Roll");
  for (const text of ['', '👩🏽‍💻', '中文 标题', '123', '...']) assert.equal(transformCaptionText(text, 'titlecase'), text);
  const cue = caption('dON’T “ÉLÈVE,”'), before = structuredClone(cue), style = plainStyle();
  style.textTransform = 'titlecase';
  assert.deepEqual(render(cue, style).texts.map(word => word.text), ['Don’t', '“Élève,”']);
  style.activeWord.textTransform = 'uppercase';
  assert.deepEqual(render(cue, style).texts.map(word => word.text), ['DON’T', '“Élève,”']);
  assert.deepEqual(cue, before, 'case conversion only affects styled output');
});

test('title-case measurement matches painting, including a long word split across lines', () => {
  const cue = caption('EXTRAORDINARY'), style = plainStyle();
  style.textTransform = 'titlecase';
  const frame = render(cue, style, .2, 80);
  assert.ok(frame.layout.rows.length > 1);
  assert.equal(frame.texts.map(word => word.text).join(''), 'Extraordinary', 'continuations do not capitalize the middle of a word');
  assert.ok(frame.texts.every(word => word.x >= -1e-8 && word.right <= 80 + 1e-8));
  for (const word of frame.texts) assert.ok(word.right - word.x <= frame.layout.width + 1e-8);
});
