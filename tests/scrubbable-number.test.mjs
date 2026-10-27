import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedNumber, parsedNumber, scrubbedNumber } from '../webview-ui/src/lib/scrubbable-number.ts';

test('dragging uses the original value, including fine decimal steps and negative ranges', () => {
  assert.equal(scrubbedNumber(1.2, 3, .05), 1.35);
  assert.equal(scrubbedNumber(1.2, -13, .05), .55);
  assert.equal(scrubbedNumber(-2.5, -4, .5), -4.5);
  assert.equal(scrubbedNumber(12.35, 4, .5, { altKey: true }), 12.55);
  assert.equal(scrubbedNumber(12, -4, .5, { shiftKey: true }), -8);
  assert.equal(scrubbedNumber(12, 3, 1, { shiftKey: true, altKey: true }), 12.3);
});

test('dragging stops at the bounds without changing its anchor for a reverse drag', () => {
  const bounds = { min: 8, max: 400 };
  assert.equal(scrubbedNumber(390, 100, .5, {}, bounds), 400);
  assert.equal(scrubbedNumber(390, 10, .5, {}, bounds), 395);
  assert.equal(scrubbedNumber(8, -10, .5, {}, bounds), 8);
  assert.equal(boundedNumber(.1 + .2), .3);
});

test('exact input accepts decimals independently of drag step and ignores incomplete input', () => {
  assert.equal(parsedNumber(' 17.125 ', { min: 8, max: 400 }), 17.125);
  assert.equal(parsedNumber('401', { min: 8, max: 400 }), 400);
  assert.equal(parsedNumber('-5', { min: 8, max: 400 }), 8);
  for (const text of ['', ' ', '-', '.', 'NaN', 'Infinity', '12px']) assert.equal(parsedNumber(text), null);
  assert.throws(() => boundedNumber(Infinity), /finite number/);
});

// The component script itself, with runes as plain storage.
async function scrubbable(props) {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const vm = (await import('node:vm')).default;
  const ts = createRequire(new URL('../webview-ui/package.json', import.meta.url))('typescript');
  const numbers = await import('../webview-ui/src/lib/scrubbable-number.ts');
  const source = readFileSync(new URL('../webview-ui/src/components/ScrubbableNumber.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const exports = {}, destroy = [];
  vm.runInNewContext(ts.transpileModule(source + `
    export { edit, commit, inputValue, inputKeyDown, resetControl };
    export function type(text) { draft = text; inputValue({ currentTarget: { value: text } }); }
    export const isEditing = () => editing;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, $state: value => value, $derived: value => value, $effect() {}, $props: () => props,
    require(name) {
      if (name === 'svelte') return { tick: async () => {}, onDestroy: fn => destroy.push(fn) };
      if (name === '../lib/control-scroll-lock') return { lockControlScroll: () => () => {} };
      return numbers;
    },
  });
  return { ...exports, destroy: () => destroy.forEach(fn => fn()) };
}
const event = () => ({ preventDefault() {}, stopPropagation() {} });

test('a typing session reports its start and, after the committed value, its end', async () => {
  const events = [], props = { value: 56, min: 15, max: 150, step: 1, decimals: 0, label: 'Characters per line', defaultValue: 56, inputRealtime: true,
    onChange: value => events.push('change ' + value), onEditState: active => events.push(active ? 'open' : 'close') };
  const typing = await scrubbable(props);
  await typing.edit();
  for (const text of ['4', '40', '4', '42']) typing.type(text);
  typing.commit();
  typing.commit(); // the blur after Enter
  assert.deepEqual(events, ['open', 'change 40', 'change 42', 'close'], 'realtime values preview; the end follows them once');
  const exact = await scrubbable({ ...props, inputRealtime: false });
  events.length = 0;
  await exact.edit(); exact.type('30'); exact.commit();
  assert.deepEqual(events, ['open', 'change 30', 'close'], 'a committed value precedes the end');
  for (const [name, finish] of [['Escape', ui => ui.inputKeyDown({ key: 'Escape', ...event() })], ['reset', ui => ui.resetControl(event())], ['unmount', ui => ui.destroy()]]) {
    const ui = await scrubbable({ ...props, value: 40 }); events.length = 0;
    await ui.edit(); finish(ui);
    if (name !== 'unmount') assert.equal(ui.isEditing(), false, name);
    ui.destroy();
    assert.equal(events.at(-1), 'close', 'Escape, double-click reset and unmount all end the session');
    assert.equal(events.filter(item => item === 'close').length, 1);
  }
  const reset = await scrubbable({ ...props, value: 40 }); events.length = 0;
  await reset.edit(); reset.resetControl(event());
  assert.deepEqual(events, ['open', 'change 56', 'close'], 'a reset while typing is one value inside the session');
});

test('the Characters per line control holds the native write for its whole drag or typing session', async () => {
  const { readFileSync } = await import('node:fs');
  const preview = readFileSync(new URL('../webview-ui/src/components/TranscriptPreview.svelte', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../webview-ui/src/main-webview.svelte', import.meta.url), 'utf8');
  const control = preview.match(/<ScrubbableNumber label="Characters per line"[^>]*\/>/)?.[0];
  assert.ok(control);
  assert.match(control, /onDragState=\{onCharacterLimitGesture\}/);
  assert.match(control, /onEditState=\{onCharacterLimitGesture\}/);
  assert.match(main.split('\n').find(line => line.includes('<TranscriptPreview ')), /onCharacterLimitGesture=\{setCharacterLimitGesture\}/);
  assert.equal(preview.match(/onEditState=/g).length, 1, 'no other transcript control changes behaviour');
});
