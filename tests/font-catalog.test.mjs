import test from 'node:test';
import assert from 'node:assert/strict';
import { registerFontCatalog, fontWeightOptions, nextFontWeight, resolveFontWeight, searchFonts } from '../webview-ui/src/lib/font-catalog.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { DEFAULT_STYLE } from '../webview-ui/src/lib/types.ts';

const catalog = () => registerFontCatalog([
  { family: 'Arial', weights: [400, 700], italic: true },
  { family: 'Bebas Neue', weights: [400], italic: false },
  { family: 'Variable', weights: [350, 900], italic: false, variable: { min: 350, max: 900 } },
  { family: 'Book', weights: [380, 400.444, 700], italic: false },
]);
test('font choices retain actual discrete weights and variable ranges without inventing static faces', () => {
  catalog(); assert.deepEqual(fontWeightOptions('arial'), [400, 700]);
  assert.deepEqual(fontWeightOptions('Bebas Neue'), [400]);
  assert.deepEqual(fontWeightOptions('Variable'), [350, 400, 500, 600, 700, 800, 900]);
  assert.deepEqual(fontWeightOptions('Book'), [380, 400.444, 700]);
  assert.deepEqual(fontWeightOptions('Missing'), []);
});
test('relative B uses the next real heavier face and retains the shared baseline', () => {
  catalog(); const style = structuredClone(DEFAULT_STYLE);
  style.fontWeight = 400; style.activeWord.fontWeightOffset = 100;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 700);
  assert.equal(style.fontWeight, 400); assert.equal(style.activeWord.fontWeightOffset, 100);
  style.fontWeight = 700; assert.equal(nextFontWeight('Arial', 700), 700);
  assert.equal(nextFontWeight('Bebas Neue', 400), 400);
  assert.equal(nextFontWeight('Variable', 400), 500);
  assert.equal(resolveFontWeight('Arial', 800), 700);
  assert.equal(resolveFontWeight('Variable', 442.5), 442.5);
  assert.equal(resolveFontWeight('Missing', 600), 600, 'Missing metadata never rewrites saved style');
});
test('italic remains requested for a regular-only font instead of being removed by metadata', () => {
  catalog(); const style = structuredClone(DEFAULT_STYLE);
  style.activeWord = { ...style.activeWord, fontFamily: 'Bebas Neue', italic: true };
  const appearance = resolveAppearance(style, 'activeWord');
  assert.equal(appearance.italic, true); assert.equal(appearance.fontWeight, 400);
});
test('search covers every installed name and ranks prefix matches without truncating results', () => {
  const fonts = Array.from({ length: 1600 }, (_, i) => `Family ${String(i).padStart(4, '0')}`);
  assert.equal(searchFonts(fonts, '').length, 1600);
  assert.deepEqual(searchFonts(['Avenir Next', 'Next Avenir', 'AVENIR', 'Georgia'], 'avenir'), ['AVENIR', 'Avenir Next', 'Next Avenir']);
  assert.deepEqual(searchFonts(['Avenir Next', 'Avenir', 'Next'], 'avenir next'), ['Avenir Next']);
  assert.deepEqual(searchFonts(['Café', 'Other'], 'cafe\u0301'), ['Café']);
});
test('bad catalogue data cannot replace the previous valid list or invent generic weights', () => {
  catalog();
  for (const value of [[], [{ family: 'Arial', weights: [NaN], italic: false }], [{ family: 'A', weights: [400], italic: true }, { family: 'a', weights: [700], italic: true }], [{ family: 'A', weights: [400], italic: false, variable: { min: 900, max: 100 } }]]) assert.throws(() => registerFontCatalog(value), /invalid|duplicate|empty/);
  assert.deepEqual(fontWeightOptions('Arial'), [400, 700]);
});
