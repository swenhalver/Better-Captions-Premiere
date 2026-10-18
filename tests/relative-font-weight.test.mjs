import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, DEFAULT_ANIMATION } from '../webview-ui/src/lib/types.ts';
import { resolveAppearance } from '../webview-ui/src/lib/appearance.ts';
import { restoreSessionStyle } from '../webview-ui/src/lib/session/style.ts';
import { capturePresetLook, applyPresetLook, validatePresetLook } from '../webview-ui/src/lib/style-presets.ts';
import { validateStylePatch } from '../webview-ui/src/lib/agent-bridge.ts';

test('relative bold follows the shared baseline while old absolute weights keep their meaning', () => {
  const style = structuredClone(DEFAULT_STYLE);
  style.fontWeight = 500;
  style.activeWord.fontWeightOffset = 100;
  style.spokenWord.fontWeightOffset = 0;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 600);
  assert.equal(resolveAppearance(style, 'spokenWord').fontWeight, 500);
  style.fontWeight = 700;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 800);
  assert.equal(resolveAppearance(style, 'spokenWord').fontWeight, 700);
  style.activeWord.fontWeightOffset = 0;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 700);
  style.activeWord.fontWeightOffset = null;
  style.activeWord.fontWeight = 450;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 450);
  delete style.activeWord.fontWeightOffset;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 450);
});

test('relative weight survives session JSON and preset save/apply without flattening the baseline relationship', () => {
  const style = structuredClone(DEFAULT_STYLE);
  style.fontWeight = 500;
  style.activeWord.fontWeightOffset = 100;
  style.spokenWord.fontWeightOffset = 0;
  const session = restoreSessionStyle(JSON.parse(JSON.stringify(style)));
  assert.equal(resolveAppearance(session, 'activeWord').fontWeight, 600);
  const preset = capturePresetLook(session, DEFAULT_ANIMATION);
  assert.equal(preset.style.activeWord.fontWeightOffset, 100);
  const restored = applyPresetLook(structuredClone(DEFAULT_STYLE), preset).style;
  restored.fontWeight = 800;
  assert.equal(resolveAppearance(restored, 'activeWord').fontWeight, 900);
  assert.equal(resolveAppearance(restored, 'spokenWord').fontWeight, 800);
  const legacy = structuredClone(preset);
  for (const key of ['activeWord', 'spokenWord', 'upcomingWord']) delete legacy.style[key].fontWeightOffset;
  assert.deepEqual(validatePresetLook(legacy), legacy);
});

test('relative bold clamps to the supported maximum and rejects unsupported hook/preset offsets', () => {
  const style = structuredClone(DEFAULT_STYLE);
  style.fontWeight = 1000;
  style.activeWord.fontWeightOffset = 100;
  assert.equal(resolveAppearance(style, 'activeWord').fontWeight, 1000);
  for (const value of [null, 0, 100]) validateStylePatch({ activeWord: { fontWeightOffset: value } });
  const preset = capturePresetLook(style, DEFAULT_ANIMATION);
  for (const value of [-100, 1, 200, '100', true]) {
    assert.throws(() => validateStylePatch({ activeWord: { fontWeightOffset: value } }));
    const invalid = structuredClone(preset); invalid.style.activeWord.fontWeightOffset = value;
    assert.throws(() => validatePresetLook(invalid));
  }
});
