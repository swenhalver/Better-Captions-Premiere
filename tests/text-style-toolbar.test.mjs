import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { validateStylePatch } from '../webview-ui/src/lib/agent-bridge.ts';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { compile } = require('svelte/compiler');
const sourceUrl = new URL('../webview-ui/src/components/TextStyleToolbar.svelte', import.meta.url);
const compiled = compile(readFileSync(sourceUrl, 'utf8'), { generate: 'server', filename: 'TextStyleToolbar.svelte' });
assert.deepEqual(compiled.warnings, [], 'Compile the actual toolbar without accessibility warnings');
const folder = mkdtempSync(join(tmpdir(), 'better-captions-text-style-'));
after(() => rmSync(folder, { recursive: true, force: true }));
symlinkSync(fileURLToPath(new URL('../webview-ui/node_modules', import.meta.url)), join(folder, 'node_modules'), 'dir');
const code = compiled.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, (_match, quote, specifier) => `from ${quote}${new URL(`${specifier}.ts`, sourceUrl).href}${quote}`);
writeFileSync(join(folder, 'TextStyleToolbar.mjs'), code);
const { default: TextStyleToolbar, textStylePatch, textStyleAppearance, textStyleMixed,
  textStyleBoldState, textStyleBoldDisabled, textStyleBoldPatch } = await import(pathToFileURL(join(folder, 'TextStyleToolbar.mjs')));
const { render } = await import(pathToFileURL(require.resolve('svelte/server')));
const fresh = () => structuredClone(DEFAULT_STYLE);
const apply = (style, patch) => {
  validateStylePatch(patch);
  return { ...style, ...patch };
};
const view = props => render(TextStyleToolbar, { props: { style: fresh(), fonts: ['Arial', 'Georgia'], scope: 'all', onScopeChange() {}, onUpdate() {}, ...props } }).body;

test('each word scope resolves its effective font, size and inherited effects', () => {
  const style = fresh();
  Object.assign(style, { fontFamily: 'Georgia', fontSize: 80, shadowEnabled: true, shadowBlur: 12 });
  Object.assign(style.activeWord, { fontFamily: '', sizeScale: 1.5, color: '#123456', opacity: .4 });
  const current = textStyleAppearance(style, 'current');
  assert.equal(current.fontFamily, 'Georgia');
  assert.equal(current.fontSize, 120);
  assert.equal(current.shadowBlur, 12);
  assert.equal(current.color, '#123456');
  assert.equal(current.opacity, .4);
  assert.equal(textStyleAppearance(style, 'all').fontSize, 80);
  assert.equal(textStyleAppearance(style, 'spoken').color, style.spokenWord.color);
  assert.equal(textStyleAppearance(style, 'upcoming').color, style.textColor);
});

test('editing one scope preserves the complete other states and unrelated properties', () => {
  const style = fresh(), before = structuredClone(style);
  const patch = textStylePatch(style, 'current', { bubbleColor: '#ff0000', padding: 21, textTransform: 'titlecase' });
  const next = apply(style, patch);
  assert.deepEqual(style, before, 'No mutation of the saved style');
  assert.deepEqual(next.spokenWord, before.spokenWord);
  assert.equal(next.upcomingWord, before.upcomingWord);
  assert.equal(next.textTransform, before.textTransform);
  assert.equal(next.activeWord.fontWeight, before.activeWord.fontWeight);
  assert.equal(next.activeWord.bubbleColor, '#ff0000');
  assert.equal(next.activeWord.padding, 21);
  assert.equal(next.activeWord.textTransform, 'titlecase');
});

test('All words changes just the chosen property across base and all three states', () => {
  const style = fresh();
  style.upcomingWord = { fontFamily: 'Next', color: '#111111', letterSpacing: 3, sizeScale: .8 };
  style.spokenWord.shadowEnabled = true;
  const next = apply(style, textStylePatch(style, 'all', { fontFamily: 'Georgia', textTransform: 'titlecase' }));
  assert.equal(next.fontFamily, 'Georgia');
  assert.equal(next.textTransform, 'titlecase');
  for (const key of ['spokenWord', 'activeWord', 'upcomingWord']) {
    assert.equal(resolveAppearance(next, key).fontFamily, 'Georgia');
    assert.equal(resolveAppearance(next, key).textTransform, 'titlecase');
    assert.equal(resolveAppearance(next, key).color, resolveAppearance(style, key).color);
    assert.equal(resolveAppearance(next, key).sizeScale, resolveAppearance(style, key).sizeScale);
  }
  assert.equal(next.spokenWord.shadowEnabled, true);
  assert.equal(next.upcomingWord.letterSpacing, 3);
});

test('base size edits retain relative sizing for both scale-only and absolute saved states', () => {
  const style = fresh();
  style.fontSize = 60;
  style.activeWord.sizeScale = 1.5;
  style.spokenWord.fontSize = 30;
  const next = apply(style, textStylePatch(style, 'all', { fontSize: 120 }));
  assert.equal(next.fontSize, 120);
  assert.equal(resolveAppearance(next, 'activeWord').fontSize, 180);
  assert.equal(resolveAppearance(next, 'spokenWord').fontSize, 60);
  assert.equal(resolveAppearance(next, 'upcomingWord').fontSize, 120);
  assert.equal(next.activeWord, style.activeWord, 'Scale-only state needs no rewritten override');
});

test('per-state pixel sizing works with an older absolute override and remains allowlisted', () => {
  const style = fresh();
  style.activeWord.fontSize = 50;
  for (const fontSize of [8, 100, 1200]) {
    const next = apply(style, textStylePatch(style, 'current', { fontSize }));
    assert.equal(resolveAppearance(next, 'activeWord').fontSize, fontSize);
    assert.ok(next.activeWord.sizeScale >= .4 && next.activeWord.sizeScale <= 3);
    assert.deepEqual(next.spokenWord, style.spokenWord);
  }
});

test('all supported appearance fields survive scope patches without flattening neighbors', () => {
  const patch = { fontFamily: 'Georgia', fontWeight: 900, fontSize: 120, italic: true, letterSpacing: 2.5, textTransform: 'titlecase',
    color: '#112233', opacity: .6, strokeEnabled: true, strokeColor: '#223344', strokeOpacity: .3, strokeWidth: 3,
    shadowEnabled: true, shadowColor: '#334455', shadowOpacity: .4, shadowBlur: 15, shadowOffsetX: -4, shadowOffsetY: 8,
    bubble: true, bubbleColor: '#445566', bubbleOpacity: .7, padding: 12, radius: 22 };
  for (const scope of ['spoken', 'current', 'upcoming']) {
    const style = fresh(), next = apply(style, textStylePatch(style, scope, patch));
    assert.deepEqual(Object.fromEntries(Object.keys(patch).map(key => [key, textStyleAppearance(next, scope)[key]])), patch);
    for (const other of ['spoken', 'current', 'upcoming'].filter(item => item !== scope)) {
      assert.deepEqual(textStyleAppearance(next, other), textStyleAppearance(style, other));
    }
  }
});

test('mixed states are identified instead of displaying a false common setting', () => {
  const style = fresh();
  assert.equal(textStyleMixed(style, 'all', 'color'), true);
  assert.equal(textStyleMixed(style, 'all', 'fontWeight'), false);
  assert.equal(textStyleMixed(style, 'current', 'color'), false);
  const html = view({ style });
  assert.match(html, /Text color — mixed word colors/);
  assert.match(html, /Title Case/);
  assert.match(html, /aria-label="Base font size, px"/);
});

test('a shared per-state setting appears as the effective All words value', () => {
  const style = fresh();
  style.upcomingWord = { fontFamily: 'Georgia', fontWeight: 500, textTransform: 'titlecase' };
  Object.assign(style.activeWord, style.upcomingWord);
  Object.assign(style.spokenWord, style.upcomingWord);
  assert.equal(style.fontFamily, 'Arial', 'The old base can differ from all three explicit overrides');
  const all = textStyleAppearance(style, 'all');
  assert.equal(all.fontFamily, 'Georgia');
  assert.equal(all.fontWeight, style.fontWeight, 'All words exposes the actual numeric baseline');
  assert.equal(all.textTransform, 'titlecase');
  assert.equal(textStyleMixed(style, 'all', 'fontFamily'), false);
});

test('B toggles one weight step above the All words baseline rather than a fixed bold weight', () => {
  const style = fresh(); style.fontWeight = 500;
  assert.equal(style.activeWord.fontWeight, 700, 'Existing absolute weights do not mean B is enabled');
  assert.equal(textStyleBoldState(style, 'current'), false);
  const on = apply(style, textStyleBoldPatch(style, 'current'));
  assert.equal(on.fontWeight, 500);
  assert.equal(on.activeWord.fontWeightOffset, 100);
  assert.equal(resolveAppearance(on, 'activeWord').fontWeight, 600);
  assert.equal(textStyleBoldState(on, 'current'), true);
  assert.deepEqual(on.spokenWord, style.spokenWord);
  const off = apply(on, textStyleBoldPatch(on, 'current'));
  assert.equal(off.activeWord.fontWeightOffset, 0);
  assert.equal(resolveAppearance(off, 'activeWord').fontWeight, 500);
  assert.equal(textStyleBoldState(off, 'current'), false);
});

test('changing the numeric All words weight keeps a relative B following its new baseline', () => {
  const style = fresh(); style.fontWeight = 500;
  const on = apply(style, textStyleBoldPatch(style, 'current'));
  const next = apply(on, textStylePatch(on, 'all', { fontWeight: 700 }));
  assert.equal(next.fontWeight, 700);
  assert.equal(next.activeWord.fontWeightOffset, 100);
  assert.equal(resolveAppearance(next, 'activeWord').fontWeight, 800);
  assert.equal(textStyleAppearance(next, 'all').fontWeight, 700);
  assert.equal(resolveAppearance(next, 'spokenWord').fontWeight, 700);
  assert.equal(resolveAppearance(next, 'upcomingWord').fontWeight, 700);
});

test('All words B leaves the baseline and unrelated appearance fields intact', () => {
  const style = fresh(); style.fontWeight = 400;
  style.upcomingWord = { color: '#112233', fontWeight: 300, radius: 19 };
  const before = structuredClone(style), patch = textStyleBoldPatch(style, 'all');
  assert.equal(Object.hasOwn(patch, 'fontWeight'), false);
  const next = apply(style, patch);
  assert.equal(next.fontWeight, 400);
  for (const key of ['spokenWord', 'activeWord', 'upcomingWord']) {
    assert.equal(next[key].fontWeightOffset, 100);
    assert.equal(resolveAppearance(next, key).fontWeight, 500);
    const { fontWeightOffset: _offset, ...saved } = next[key];
    assert.deepEqual(saved, before[key]);
  }
  assert.deepEqual(style, before);
});

test('per-state numeric weight selection clears relative B to an absolute override', () => {
  const style = apply(fresh(), textStyleBoldPatch(fresh(), 'current'));
  const next = apply(style, textStylePatch(style, 'current', { fontWeight: 900 }));
  assert.equal(next.activeWord.fontWeightOffset, null);
  assert.equal(textStyleBoldState(next, 'current'), false);
  assert.equal(resolveAppearance(next, 'activeWord').fontWeight, 900);
  assert.equal(resolveAppearance({ ...next, fontWeight: 300 }, 'activeWord').fontWeight, 900);
  assert.deepEqual(next.spokenWord, style.spokenWord);
});

test('All words B shows mixed only when some states have the relative step enabled', () => {
  const style = fresh();
  style.activeWord.fontWeightOffset = 0;
  style.spokenWord.fontWeightOffset = null;
  assert.equal(textStyleBoldState(style, 'all'), false, 'Zero and legacy absolute are both off');
  style.activeWord.fontWeightOffset = 100;
  assert.equal(textStyleBoldState(style, 'all'), 'mixed');
  assert.equal(textStyleBoldState(apply(style, textStyleBoldPatch(style, 'all')), 'all'), true);
});

test('at the maximum baseline B cannot turn on but an existing on or mixed step can turn off', () => {
  const style = fresh(); style.fontWeight = 1000;
  assert.equal(textStyleBoldDisabled(style, 'current'), true);
  assert.equal(textStyleBoldDisabled(style, 'all'), true);
  style.activeWord.fontWeightOffset = 100;
  assert.equal(textStyleBoldDisabled(style, 'current'), false);
  assert.equal(textStyleBoldDisabled(style, 'all'), false);
  const off = apply(style, textStyleBoldPatch(style, 'all'));
  assert.equal(off.fontWeight, 1000);
  assert.equal(textStyleBoldState(off, 'all'), false);
  assert.equal(textStyleBoldDisabled(off, 'all'), true);
  for (const key of ['spokenWord', 'activeWord', 'upcomingWord']) assert.equal(resolveAppearance(off, key).fontWeight, 1000);
});

test('the rendered weight list is numeric and B uses relative state and a clear step tooltip', () => {
  const style = fresh(); style.fontWeight = 500;
  const html = view({ style });
  const select = html.match(/<select[^>]*aria-label="Font weight"[\s\S]*?<\/select>/)?.[0];
  const options = [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
  assert.deepEqual(options, ['100', '200', '300', '400', '500', '600', '700', '800', '900', '1000']);
  assert.doesNotMatch(select, /Regular|Bold|Mixed/);
  assert.match(html.match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /aria-pressed="false"/);
  assert.match(html, /One step bolder \(\+100\) than All words \(500\)/);
  const on = apply(style, textStyleBoldPatch(style, 'current'));
  assert.match(view({ style: on, scope: 'current' }).match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /aria-pressed="true"/);
  style.fontWeight = 1000;
  assert.match(view({ style }).match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /disabled/);
});

test('the real toolbar starts compact with each advanced control closed', () => {
  const html = view({});
  for (const name of ['All words', 'Past', 'Current', 'Next', 'Spacing', 'Outline', 'Shadow', 'Bubble', 'Layout']) assert.match(html, new RegExp(`>${name}<`));
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /Letter spacing, px|Word spacing, %|Whole caption background|X offset, px/);
  assert.match(html, /aria-label="Font family"/);
  assert.match(html, /aria-label="Bold"/);
  assert.match(html, /aria-label="Italic"/);
  assert.match(html, /aria-label="Font weight"/);
  assert.match(html, /aria-label="Text case"/);
  assert.match(html, /aria-label="Text opacity, %"/);
});
