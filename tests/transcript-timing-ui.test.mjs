import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as timing from '../webview-ui/src/lib/transcript/timing.ts';
import * as numericInput from '../webview-ui/src/lib/numeric-input.ts';
import * as scrubbableNumber from '../webview-ui/src/lib/scrubbable-number.ts';
import * as edit from '../webview-ui/src/lib/transcript/edit.ts';
import * as parser from '../webview-ui/src/lib/transcript/parser.ts';
import * as segments from '../webview-ui/src/lib/transcript/segments.ts';
import * as lines from '../webview-ui/src/lib/transcript/lines.ts';
import * as types from '../webview-ui/src/lib/types.ts';
import * as typingModule from '../webview-ui/src/lib/transcript/typing.ts';
import * as pauseLines from '../webview-ui/src/lib/native-effect/pause-lines.ts';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { compile } = require('svelte/compiler'), ts = require('typescript');
const urls = Object.fromEntries(['WordTimeline', 'TranscriptPreview', 'ScrubbableNumber'].map(name => [name, new URL(`../webview-ui/src/components/${name}.svelte`, import.meta.url)]));
const sources = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, readFileSync(url, 'utf8')]));
const compiled = Object.fromEntries(Object.entries(sources).map(([name, source]) => {
  const result = compile(source, { generate: 'server', filename: `${name}.svelte` });
  assert.deepEqual(result.warnings, [], `${name} compiles without accessibility warnings`);
  return [name, result];
}));
const folder = mkdtempSync(join(tmpdir(), 'better-captions-transcript-timing-'));
after(() => rmSync(folder, { recursive: true, force: true }));
symlinkSync(fileURLToPath(new URL('../webview-ui/node_modules', import.meta.url)), join(folder, 'node_modules'), 'dir');
for (const [name, result] of Object.entries(compiled)) {
  const code = result.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, (_match, quote, specifier) => {
    const target = specifier.endsWith('.svelte') ? './' + specifier.split('/').at(-1).replace('.svelte', '.mjs') : new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, urls[name]).href;
    return `from ${quote}${target}${quote}`;
  });
  writeFileSync(join(folder, `${name}.mjs`), code);
}
const { default: WordTimeline } = await import(pathToFileURL(join(folder, 'WordTimeline.mjs')));
const { default: TranscriptPreview } = await import(pathToFileURL(join(folder, 'TranscriptPreview.mjs')));
const { render } = await import(pathToFileURL(require.resolve('svelte/server')));
const clone = value => JSON.parse(JSON.stringify(value));
const cue = (fps = 24) => ({ id: 'cue', text: 'one two three', startTime: 0, endTime: 90 / fps,
  clipNodeId: 'native-clip', projectItemId: 'native-item', mediaPath: '/caption.mov',
  position: { x: .25, y: .75 }, words: ['one', 'two', 'three'].map((text, i) => ({ text, startTime: i * 30 / fps, endTime: (i + 1) * 30 / fps })) });
const wordProps = (caption = cue(), fps = 24) => ({ caption, fps, currentTime: 45 / fps, selectedWord: 1, onSelectWord() {}, onChange() {}, onSeek() {} });
const transcriptProps = (captions = [cue()]) => ({ frameRate: 24, sequenceId: 'sequence', captions, currentTime: .5, maxChars: 50,
  selectedId: captions[0]?.id, onSeek() {}, onSelect() {}, onMaxCharsChange() {}, onUpdate() {} });

// Execute the real component controllers. Only the Svelte rune/effect runtime
// is replaced; derived reads remain lazy when callbacks update their props.
function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    transformers: { before: [context => file => {
      const lazy = new Map();
      function collect(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
          const name = node.initializer.expression.getText(file);
          if (name === '$derived' || name === '$derived.by') lazy.set(node.name.text, name);
        }
        ts.forEachChild(node, collect);
      }
      collect(file);
      const call = name => ts.factory.createCallExpression(ts.factory.createIdentifier(name), undefined, []);
      let shadowed = new Set();
      function bindingNames(name, target) {
        if (ts.isIdentifier(name)) target.add(name.text);
        else for (const element of name.elements) if (ts.isBindingElement(element)) bindingNames(element.name, target);
      }
      function visit(node) {
        if (ts.isFunctionLike(node)) {
          const outer = shadowed; shadowed = new Set(outer);
          for (const parameter of node.parameters) bindingNames(parameter.name, shadowed);
          const result = ts.visitEachChild(node, visit, context);
          shadowed = outer;
          return result;
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && lazy.has(node.name.text)) {
          const value = ts.visitNode(node.initializer.arguments[0], visit);
          return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
            lazy.get(node.name.text) === '$derived.by' ? value : ts.factory.createArrowFunction(undefined, undefined, [], undefined, ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), value));
        }
        if (ts.isShorthandPropertyAssignment(node) && lazy.has(node.name.text) && !shadowed.has(node.name.text)) return ts.factory.createPropertyAssignment(node.name, call(node.name.text));
        if (ts.isIdentifier(node) && lazy.has(node.text) && !shadowed.has(node.text) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) return call(node.text);
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(file, visit);
    }] },
  }).outputText;
}
function controller(name, props, extension) {
  const output = {}, effects = [], destructors = [];
  const script = sources[name].match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(transpile(script + extension), {
    exports: output, Error, Math, JSON, setTimeout, clearTimeout, $props: () => props, $state: value => value, $effect: effect => effects.push(effect),
    require(specifier) {
      if (specifier === 'svelte') return { tick: async () => {}, onDestroy: callback => destructors.push(callback), untrack: fn => fn() };
      if (specifier.endsWith('/transcript/timing')) return timing;
      if (specifier.endsWith('/numeric-input')) return numericInput;
      if (specifier.endsWith('/scrubbable-number')) return scrubbableNumber;
      if (specifier.endsWith('/control-scroll-lock')) return { lockControlScroll: () => () => {} };
      if (specifier.endsWith('/transcript/edit')) return edit;
      if (specifier.endsWith('/transcript/parser')) return parser;
      if (specifier.endsWith('/transcript/segments')) return segments;
      if (specifier.endsWith('/transcript/lines')) return lines;
      if (specifier.endsWith('/transcript/typing')) return typingModule;
      if (specifier.endsWith('/native-effect/pause-lines')) return pauseLines;
      if (specifier.endsWith('/types')) return types;
      return {};
    },
  }, { filename: `${name}.svelte` });
  for (const effect of effects) effect();
  return { ...output, runEffect: index => effects.at(index)(), destroyComponent: () => { for (const destructor of destructors) destructor(); } };
}
function wordController(caption = cue(), fps = 24, selectedWord = 1, options = {}) {
  let h;
  const changes = [], selections = [], seeks = [];
  h = controller('WordTimeline', { ...wordProps(caption, fps), ...options, selectedWord,
    onChange: value => { changes.push(clone(value)); h.setCaption(value); }, onSelectWord: value => selections.push(value), onSeek: value => seeks.push(value) }, `
    export { inputTime, inputRange, secondsValue, blurTime, keyboard, drag, choose, splitSelected, mergeSelected, wheelZoom };
    export function setCaption(value) { caption = value; }
    export function setLane(value) { lane = value; }
    export function setZoom(value) { zoom = value; }
    export function inspect() { return { shown, index, word, problem, zoom, laneWidth }; }
  `);
  return { ...h, changes, selections, seeks };
}
function transcriptController(captions = [cue()], fps = 24, options = {}) {
  let h;
  const changes = [], selections = [], seeks = [], labels = [];
  h = controller('TranscriptPreview', { ...transcriptProps(captions), ...options, frameRate: fps,
    onUpdate: (value, label) => { changes.push(clone(value)); labels.push(label); h.setCaptions(value); }, onSelect: value => { selections.push(value); h.setSelectedId(value); }, onSeek: value => seeks.push(value) }, `
    export { addLine, deleteLine, wordBoundaryAtCaret, trackTextCaret, changeCharacterLimit, beginTextEdit, saveInlineText, cancelTextEdit, textKeydown, textCaretOffset, focusTextEditor, beginTimingEdit, inputCaptionTime, saveInlineTiming, cancelTimingEdit, timingBlur, timingKeydown, timingRange, updateCaption, splitCaption, mergeNext, choose };
    export function setCaptions(value) { captions = value; }
    export function setSelectedId(value) { selectedId = value; }
    export function setDraft(value) { draftText = value; }
    export { choosePause, deletePause, beginPauseEdit };
    export function setQuery(value) { query = value; }
    export function setList(value) { listEl = value; }
    export { revealSelection };
    export function setPauseSettings(value) { pauseSettings = value; }
    export function setSequenceId(value) { sequenceId = value; }
    export function setNativeLayerKey(value) { nativeLayerKey = value; }
    export function inspect() { return { newLineOptions, rows: sentenceRows, allRows: transcriptRows, filteredRows, pauses: pauseRows, selectedPause, selectedLane, sentenceCount, captions, editingRowKey, editingError, editingCaret, caretSplitIndex, timingRowKey, timingError, draftStart, draftEnd, selectedWordOffset, selectedLine: selectedRow, error, notice, draftText }; }
  `);
  return { ...h, changes, selections, seeks, labels };
}
const numericEvent = value => ({ currentTarget: { valueAsNumber: value, value: String(value) } });
const keyEvent = (key, extra = {}) => ({ key, preventDefault() {}, ...extra });
const unlinked = caption => { const next = clone(caption); delete next.clipNodeId; delete next.projectItemId; delete next.mediaPath; return next; };
function pointerFixture() {
  const listeners = new Map(); let captured = null;
  const target = { focus() {}, setPointerCapture: id => { captured = id; }, hasPointerCapture: id => captured === id, releasePointerCapture: () => { captured = null; },
    addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  return { target, listeners, get captured() { return captured; }, event: (extra = {}) => ({ button: 0, pointerId: 3, clientX: 450, currentTarget: target, preventDefault() {}, ...extra }) };
}
function wheelFixture(width = 280) {
  const h = wordController(), listeners = new Map(), options = new Map(), scale = () => h.inspect().zoom === 'fit' ? 1 : h.inspect().zoom;
  const container = { clientWidth: width, clientHeight: 90, scrollLeft: 0, isConnected: true,
    get scrollWidth() { return width * scale(); },
    addEventListener: (name, callback, configuration) => { listeners.set(name, callback); options.set(name, configuration); }, removeEventListener: name => listeners.delete(name) };
  h.setLane({ getBoundingClientRect: () => ({ left: 100 - container.scrollLeft, width: width * scale() }) });
  const action = h.wheelZoom(container);
  const event = (extra = {}) => ({ clientX: 100 + width * .75, deltaX: 0, deltaY: -40, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false,
    prevented: false, preventDefault() { this.prevented = true; }, ...extra });
  return { h, container, listeners, options, event, destroy: () => { action.destroy(); h.destroyComponent(); } };
}

test('real transcript SSR shows each sentence once with one word lane and no redundant controls', () => {
  const html = render(TranscriptPreview, { props: transcriptProps() }).body;
  assert.equal((html.match(/one two three/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Selected line word timing"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Edit line 1 text"/);
  assert.match(html, /aria-label="Edit line 1 start time"/);
  assert.match(html, /aria-label="Edit line 1 end time"/);
  assert.doesNotMatch(html, /Show in Premiere|Edit caption text|Save text|Save caption timing|<summary>Caption timing|<summary>Split &amp; merge|<summary>Split & merge|Split line before word|word-timing__phrase|Drag edges or use arrows|Word timing playhead|type="range"|>−1f<|>\+1f<|>Set</);
  assert.equal((html.match(/role="slider"/g) ?? []).length, 6, 'Both edges are reachable for all three words');
});

test('real lane SSR keeps a Premiere-driven marker, native frame spinners and two compact columns', () => {
  const fps = 30000 / 1001, caption = cue(fps);
  const html = render(WordTimeline, { props: wordProps(caption, fps) }).body;
  const inputs = [...html.matchAll(/<input\b[^>]*type="number"[^>]*>/g)].map(match => match[0]);
  assert.equal(inputs.length, 2);
  for (const input of inputs) assert.equal(Number(input.match(/step="([^"]+)"/)[1]), 1 / fps);
  assert.match(html, /word-timing__playhead[^>]*aria-hidden="true"[^>]*left: 50%/);
  assert.match(html, /word-timing__lane[^>]*style="width: 100%;"/);
  assert.match(html, /<option[^>]*value="fit"[^>]*selected[^>]*>Fit content<\/option>/);
  assert.doesNotMatch(render(WordTimeline, { props: { ...wordProps(caption, fps), currentTime: -1 } }).body, /word-timing__playhead/);
  assert.match(compiled.WordTimeline.css.code, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(compiled.WordTimeline.css.code, /inline-size:min\(\.8rem,25%\)/, 'Edge targets leave the middle of short words available for whole-word dragging');
  assert.match(compiled.WordTimeline.css.code, /word-timing__time[^{}]*\{min-inline-size:0;input[^{}]*\{inline-size:100%;min-inline-size:0/);
});

test('Fit content is the responsive default and numeric zoom scales with the available panel width', () => {
  const h = wordController();
  assert.equal(h.inspect().zoom, 'fit'); assert.equal(h.inspect().laneWidth, '100%');
  for (const zoom of [1, 1.5, 2, 3, 4]) { h.setZoom(zoom); assert.equal(h.inspect().laneWidth, `${100 * zoom}%`); }
  h.setZoom('fit'); assert.equal(h.inspect().laneWidth, '100%');
  const longer = cue(); longer.words = Array.from({ length: 12 }, (_, i) => ({ text: `word${i}`, startTime: i, endTime: i + 1 })); longer.endTime = 12;
  h.setCaption(longer); assert.equal(h.inspect().laneWidth, '100%', 'Fit content adapts without measuring a container');
  h.setZoom(1); assert.equal(h.inspect().laneWidth, '100%');
});

test('lane wheel zoom skips duplicate 100%, preserves the pointer anchor and respects Fit/400% limits', async () => {
  for (const width of [280, 360, 900]) {
    const f = wheelFixture(width);
    try {
      assert.equal(f.options.get('wheel').passive, false);
      for (const zoom of [1.5, 2, 3, 4, 4]) {
        const event = f.event(); await f.listeners.get('wheel')(event);
        assert.equal(event.prevented, true); assert.equal(f.h.inspect().zoom, zoom);
        assert.ok(Math.abs((f.container.scrollLeft + width * .75) / f.container.scrollWidth - .75) < 1e-8, 'The same content remains beneath the pointer after each real zoom step');
      }
      for (const zoom of [3, 2, 1.5, 'fit', 'fit']) {
        await f.listeners.get('wheel')(f.event({ deltaY: 40 }));
        assert.equal(f.h.inspect().zoom, zoom);
      }
      assert.equal(f.container.scrollLeft, 0);
      f.h.setZoom(1); await f.listeners.get('wheel')(f.event());
      assert.equal(f.h.inspect().zoom, 1.5, 'Manual 100% has no dead wheel step before 150%');
    } finally { f.destroy(); }
    assert.equal(f.listeners.size, 0, 'The action removes its scoped nonpassive listener');
  }
});

test('wheel zoom coalesces small deltas and leaves horizontal, Shift and browser zoom untouched', async () => {
  const f = wheelFixture();
  try {
    for (const extra of [{ deltaX: 50, deltaY: 2 }, { deltaY: 0 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      const event = f.event(extra); await f.listeners.get('wheel')(event);
      assert.equal(event.prevented, false); assert.equal(f.h.inspect().zoom, 'fit'); assert.equal(f.container.scrollLeft, 0);
    }
    for (let i = 0; i < 3; i++) { await f.listeners.get('wheel')(f.event({ deltaY: -10 })); assert.equal(f.h.inspect().zoom, 'fit'); }
    await f.listeners.get('wheel')(f.event({ deltaY: -10 })); assert.equal(f.h.inspect().zoom, 1.5);
    await f.listeners.get('wheel')(f.event({ deltaY: -3, deltaMode: 1 })); assert.equal(f.h.inspect().zoom, 2, 'Line-mode wheel deltas are normalized');
    await f.listeners.get('wheel')(f.event({ deltaY: 1, deltaMode: 2 })); assert.equal(f.h.inspect().zoom, 1.5, 'Page-mode wheel deltas are normalized');
  } finally { f.destroy(); }
});

test('native numeric steps advance exact frames despite readable fractional-rate seconds', () => {
  for (const fps of [24, 25, 30000 / 1001, 60000 / 1001, 60, 240]) for (const edge of ['startTime', 'endTime']) for (const direction of [-1, 1]) {
    const caption = cue(fps); caption.words[0].endTime = 29 / fps; caption.words[1].startTime = 31 / fps; caption.words[1].endTime = 59 / fps; caption.words[2].startTime = 61 / fps;
    const h = wordController(caption, fps), before = h.inspect().word[edge], value = h.secondsValue(before), range = h.inputRange(edge);
    const position = (value - range.min) * fps;
    assert.ok(Math.abs(position - Math.round(position)) < 1e-8, 'The displayed value sits on the actual native spinner step base');
    const event = numericEvent(value + direction / fps);
    h.inputTime(edge, event);
    const after = h.changes.at(-1);
    assert.equal(after.words[1][edge], (Math.round(before * fps) + direction) / fps);
    assert.deepEqual(after.words[0], caption.words[0]); assert.deepEqual(after.words[2], caption.words[2]);
    assert.equal(event.currentTarget.value, String(h.secondsValue(after.words[1][edge])));
    edit.validateCaptions([after]);
  }
});

test('immediate number edits keep neighbors fixed, clamp to three frames and preserve gaps', () => {
  const h = wordController();
  h.inputTime('startTime', numericEvent(100));
  assert.equal(h.changes.at(-1).words[1].startTime, 57 / 24);
  assert.equal(h.changes.at(-1).words[0].endTime, 30 / 24);
  h.inputTime('endTime', numericEvent(-100));
  assert.equal(h.changes.at(-1).words[1].endTime, 60 / 24);
  assert.equal(h.changes.at(-1).words[2].startTime, 60 / 24);
  for (const word of h.changes.at(-1).words) assert.ok((word.endTime - word.startTime) * 24 >= 3 - 1e-7);
  const caption = cue(); caption.words[1].startTime = 35 / 24;
  const gap = wordController(caption);
  gap.inputTime('startTime', numericEvent(34 / 24));
  assert.equal(gap.changes[0].words[0].endTime, 30 / 24);
  assert.equal(gap.changes[0].words[1].startTime, 34 / 24);
  const count = gap.changes.length;
  gap.inputTime('startTime', numericEvent(NaN));
  assert.equal(gap.changes.length, count, 'A temporarily blank number cannot corrupt timing');
  const blank = { currentTarget: { value: '' } };
  gap.blurTime('startTime', blank);
  assert.equal(blank.currentTarget.value, String(gap.secondsValue(gap.inspect().word.startTime)));
});

test('an unselected word starts and completes an edge drag in the same gesture', () => {
  const h = wordController(cue(), 24, 0), listeners = new Map(); let captured;
  h.setLane({ getBoundingClientRect: () => ({ left: 0, width: 900 }) });
  const target = { focus() {}, setPointerCapture: id => { captured = id; }, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  h.drag({ button: 0, pointerId: 7, clientX: 300, currentTarget: target, preventDefault() {} }, 'startTime', 1);
  assert.deepEqual(h.selections, [1]); assert.equal(captured, 7); assert.equal(h.changes.length, 0);
  listeners.get('pointermove')({ pointerId: 7, clientX: 400 });
  assert.equal(h.inspect().shown.words[1].startTime, 40 / 24);
  listeners.get('pointerup')({ pointerId: 7, type: 'pointerup' });
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0].words[1].startTime, 40 / 24);
  assert.equal(h.changes[0].words[0].endTime, 30 / 24);
  assert.equal(h.changes[0].words[0].startTime, 0);
  assert.equal(listeners.size, 0); assert.deepEqual(h.seeks, [], 'Dragging does not add an unrelated seek');
});

test('edge keyboard edits target an unselected word and pointer cancellation creates no edit', () => {
  const h = wordController(cue(), 24, 0);
  h.keyboard(keyEvent('ArrowRight'), 'startTime', 2);
  assert.equal(h.changes[0].words[2].startTime, 61 / 24);
  assert.deepEqual(h.selections, [2]);
  h.keyboard(keyEvent('End'), 'startTime', 2);
  assert.equal(h.changes[1].words[2].startTime, 87 / 24);
  const listeners = new Map(), target = { focus() {}, setPointerCapture() {}, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) };
  h.setLane({ getBoundingClientRect: () => ({ left: 0, width: 900 }) });
  h.drag({ button: 0, pointerId: 1, clientX: 300, currentTarget: target, preventDefault() {} }, 'startTime', 1);
  listeners.get('pointermove')({ pointerId: 1, clientX: 450 });
  listeners.get('pointercancel')({ pointerId: 1, type: 'pointercancel' });
  assert.equal(h.changes.length, 2);
});

test('inline text commits once, preserves timed native links', () => {
  const h = transcriptController(), row = h.inspect().rows[0], original = clone(row.caption);
  h.beginTextEdit(row); h.setDraft('One TWO three');
  assert.equal(h.saveInlineText(row), true);
  assert.equal(h.saveInlineText(row), true, 'The blur following Enter cannot commit twice');
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0][0].text, 'One TWO three');
  assert.deepEqual(h.changes[0][0].words.map(word => [word.startTime, word.endTime]), original.words.map(word => [word.startTime, word.endTime]));
  assert.equal(h.changes[0][0].clipNodeId, original.clipNodeId); assert.deepEqual(h.changes[0][0].position, original.position);
});

test('inline text Escape cancels, a blank draft leaves a timed blank line, and stale reads cannot overwrite newer timing', () => {
  const h = transcriptController(), row = h.inspect().rows[0];
  h.beginTextEdit(row); h.setDraft('unsaved words'); h.textKeydown(keyEvent('Escape'), row);
  assert.equal(h.changes.length, 0); assert.equal(h.inspect().editingRowKey, null);
  h.beginTextEdit(row); h.setDraft('   ');
  assert.equal(h.saveInlineText(row), true); assert.equal(h.inspect().editingRowKey, null);
  assert.deepEqual(h.changes[0][0].words.map(word => [word.text, word.startTime, word.endTime]), [['', 0, 90 / 24]]);
  assert.equal(h.labels[0], 'Edit transcript');
  // The blank row shows no placeholder: a hidden space keeps its height, and
  // the button keeps its accessible name.
  const blankHtml = render(TranscriptPreview, { props: transcriptProps(h.changes[0]) }).body;
  assert.match(blankHtml, /<button class="transcript-editor__cue-text[^"]*" aria-label="Edit line 1 text"[^>]*>(<!--[^>]*-->)*<span aria-hidden="true">(&nbsp;|\u00a0)<\/span>(<!--[^>]*-->)*<\/button>/);
  assert.doesNotMatch(blankHtml, /Blank line/);
  // The blank row stays addressable and takes new text in the same time.
  const blank = h.inspect().rows[0];
  h.beginTextEdit(blank); assert.equal(h.inspect().draftText, ''); h.setDraft('back again');
  assert.equal(h.saveInlineText(blank), true);
  const retyped = h.changes[1][0].words;
  assert.deepEqual(retyped.map(word => word.text), ['back', 'again']);
  assert.equal(retyped[0].startTime, 0); assert.equal(retyped.at(-1).endTime, 90 / 24);
  const current = h.inspect().rows[0];
  h.beginTextEdit(current); h.setDraft('new words here');
  const newer = clone(h.inspect().captions[0]); delete newer.renderSegments; newer.words[0].endTime -= 1 / 24; h.setCaptions([newer]);
  assert.equal(h.saveInlineText(current), false); assert.equal(h.changes.length, 2);
  assert.match(h.inspect().editingError, /changed while you were editing/);
});

test('inline typing retains the clicked caret and native IME composition without input chrome', () => {
  const h = transcriptController(), row = h.inspect().rows[0], textNode = {};
  let end, selected, focused = false;
  const document = { caretPositionFromPoint: () => ({ offsetNode: textNode, offset: 6 }),
    createRange: () => ({ selectNodeContents() {}, setEnd: (_node, offset) => { end = offset; }, toString: () => row.caption.text.slice(0, end) }) };
  h.beginTextEdit(row, { detail: 1, clientX: 30, clientY: 20, currentTarget: { ownerDocument: document, contains: node => node === textNode } });
  const textarea = { style: {}, value: row.caption.text, scrollHeight: 39, focus: () => { focused = true; }, setSelectionRange: (...values) => { selected = values; } };
  h.focusTextEditor(textarea);
  assert.equal(focused, true); assert.deepEqual(selected, [6, 6]); assert.equal(textarea.style.blockSize, '39px');
  h.setDraft('one two three more');
  h.textKeydown(keyEvent('Enter', { metaKey: true, isComposing: true }), row);
  assert.equal(h.changes.length, 0); assert.equal(h.inspect().editingRowKey, row.key);
  h.textKeydown(keyEvent('Escape', { isComposing: true }), row);
  assert.equal(h.inspect().editingRowKey, row.key, 'Escape first belongs to the native IME');
  assert.match(compiled.TranscriptPreview.css.code, /transcript-editor__cue-input[^{}]*\{[^}]*padding: 0;[^}]*resize: none;[^}]*border: 0;[^}]*background: transparent/);
});

test('inline sentence edits preserve the rest of a bundled native clip and its container timing', () => {
  const caption = cue(); caption.captionBundle = true;
  caption.renderSegments = [{ id: 'first', text: 'one', words: [caption.words[0]], startTime: 0, endTime: caption.words[0].endTime },
    { id: 'rest', text: 'two three', words: caption.words.slice(1), startTime: caption.words[1].startTime, endTime: caption.endTime }];
  const h = transcriptController([caption]), row = h.inspect().rows[1];
  h.beginTextEdit(row); h.setDraft('second third'); h.textKeydown(keyEvent('Enter', { metaKey: true }), row);
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0][0].text, 'one second third');
  assert.deepEqual(h.changes[0][0].words[0], caption.words[0]);
  assert.equal(h.changes[0][0].startTime, caption.startTime); assert.equal(h.changes[0][0].endTime, caption.endTime);
  assert.equal(h.changes[0][0].clipNodeId, caption.clipNodeId);
});

test('inline timestamp editing keeps untouched times exact and commits one frame only on blur', () => {
  const fps = 30000 / 1001, caption = cue(fps); caption.endTime += .12;
  const h = transcriptController([caption], fps), row = h.inspect().rows[0];
  h.beginTimingEdit(row, 'startTime');
  assert.equal(h.saveInlineTiming(row), true); assert.equal(h.changes.length, 0, 'Opening a timestamp never quantizes the source');
  h.beginTimingEdit(row, 'startTime');
  const range = h.timingRange(row, 'startTime');
  assert.ok(Math.abs(range.min) < 1e-8);
  h.inputCaptionTime('startTime', numericEvent(1 / fps));
  assert.equal(h.changes.length, 0, 'Caption timing remains a draft until blur or Enter');
  const inside = {}, parent = { contains: target => target === inside };
  h.timingBlur({ currentTarget: { parentElement: parent }, relatedTarget: inside }, row);
  assert.equal(h.changes.length, 0, 'Tabbing between Start and End keeps one draft');
  h.timingBlur({ currentTarget: { parentElement: parent }, relatedTarget: null }, row);
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0][0].startTime, 1 / fps);
  assert.equal(h.changes[0][0].endTime, caption.endTime);
  assert.equal(h.changes[0][0].clipNodeId, caption.clipNodeId);
  edit.validateCaptions(h.changes[0]);
});

test('word timing enters the transcript as one completed edit', () => {
  const transcript = transcriptController(), original = clone(transcript.inspect().captions[0]);
  const words = wordController(original);
  words.inputTime('startTime', numericEvent(31 / 24));
  transcript.updateCaption(words.changes[0], 'Word timing saved.');
  assert.equal(transcript.changes.length, 1); assert.equal(transcript.changes[0][0].words[1].startTime, 31 / 24);
});

test('inline timestamp Enter and Escape stay separate from text drafts, and overlap is rejected', () => {
  const first = cue(), second = { ...cue(), id: 'second', startTime: 4, endTime: 7.75,
    words: cue().words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 })) };
  const h = transcriptController([first, second]), row = h.inspect().rows[0];
  h.beginTimingEdit(row, 'endTime'); h.inputCaptionTime('endTime', numericEvent(5));
  assert.equal(h.saveInlineTiming(row), false); assert.equal(h.changes.length, 0); assert.match(h.inspect().timingError, /overlap/);
  h.timingKeydown(keyEvent('Escape'), row); assert.equal(h.inspect().timingRowKey, null);
  h.beginTimingEdit(row, 'endTime'); h.inputCaptionTime('endTime', numericEvent(first.endTime - 1 / 24));
  h.timingKeydown(keyEvent('Enter'), row); h.saveInlineTiming(row);
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0][0].endTime, first.endTime - 1 / 24);
});

test('a blank caption timestamp remains an invalid draft and cannot erase saved timing', () => {
  const h = transcriptController(), row = h.inspect().rows[0];
  h.beginTimingEdit(row, 'startTime'); h.inputCaptionTime('startTime', numericEvent(NaN));
  assert.equal(h.saveInlineTiming(row), false); assert.equal(h.changes.length, 0);
  assert.match(h.inspect().timingError, /valid start and end/); assert.equal(h.inspect().timingRowKey, row.key);
  h.cancelTimingEdit(); h.beginTimingEdit(row, 'startTime');
  assert.equal(h.saveInlineTiming(row), true); assert.equal(h.changes.length, 0);
});

test('real SSR enables line operations independently of storage links', () => {
  const caption = unlinked(cue()), props = transcriptProps([caption]);
  const button = (html, label) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))[0];
  const first = render(TranscriptPreview, { props: { ...props, selectedWord: 0 } }).body;
  assert.match(button(first, 'Split line before selected word'), /disabled/);
  const interior = render(TranscriptPreview, { props: { ...props, selectedWord: 1 } }).body;
  assert.doesNotMatch(button(interior, 'Split line before selected word'), /disabled/);
  assert.match(interior, /title="Split line before “two”"/);
  assert.match(button(interior, 'Merge with next line'), /disabled/);
  assert.doesNotMatch(interior, /Split &amp; merge|Split & merge|Split line before word/);
  const linked = render(TranscriptPreview, { props: { ...transcriptProps(), selectedWord: 1 } }).body;
  assert.doesNotMatch(button(linked, 'Split line before selected word'), /disabled/);
  assert.doesNotMatch(linked, /Razor tool/);
  const next = unlinked(cue()); next.id = 'next'; next.startTime = 4; next.endTime = 7.75; next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  assert.doesNotMatch(button(render(TranscriptPreview, { props: transcriptProps([caption, next]) }).body, 'Merge with next line'), /disabled/);
  next.clipNodeId = 'applied-next';
  assert.doesNotMatch(button(render(TranscriptPreview, { props: transcriptProps([caption, next]) }).body, 'Merge with next line'), /disabled/);
});

test('the lane splits before its selected word using the sentence offset, as one edit', () => {
  const caption = unlinked(cue()); caption.words = ['one', 'two', 'three', 'four', 'five', 'six'].map((text, i) => ({ text, startTime: i * 30 / 24, endTime: (i + 1) * 30 / 24 }));
  caption.text = caption.words.map(word => word.text).join(' '); caption.endTime = 180 / 24; caption.captionBundle = true;
  caption.renderSegments = [0, 3].map(start => ({ id: `segment-${start}`, text: caption.words.slice(start, start + 3).map(word => word.text).join(' '), words: caption.words.slice(start, start + 3), startTime: caption.words[start].startTime, endTime: caption.words[start + 2].endTime }));
  const transcript = transcriptController([caption]), row = transcript.inspect().rows[1];
  transcript.choose(row);
  assert.equal(transcript.inspect().selectedWordOffset, 2, 'The lane starts at the previous line\'s last word');
  const lane = wordController(segments.captionSegmentLane(caption, row.segment).caption, 24, 2, { wordOffset: transcript.inspect().selectedWordOffset, onSplitBefore: transcript.splitCaption });
  lane.splitSelected();
  assert.equal(transcript.changes.length, 1);
  const [stored] = transcript.changes[0], rows = lines.transcriptLines(transcript.changes[0]);
  assert.equal(transcript.changes[0].length, 1, 'Split is a line break, preserving storage');
  assert.deepEqual(rows.map(row => lines.transcriptLineCaption(transcript.changes[0], row).text), ['one two three', 'four', 'five six']);
  assert.equal(stored.id, caption.id);
  assert.deepEqual(stored.words.map(word => [word.text, word.startTime, word.endTime]), caption.words.map(word => [word.text, word.startTime, word.endTime]));
  assert.equal(stored.words[4].lineBreakBefore, 'break');
  assert.equal(transcript.selections.at(-1), caption.id);
  edit.validateCaptions(transcript.changes[0]);
});

test('a line\'s last word can be retimed past the line ending into the next line', () => {
  const caption = cue(); caption.words = ['one', 'two', 'three', 'four', 'five', 'six'].map((text, i) => ({ text, startTime: i * 30 / 24, endTime: (i + 1) * 30 / 24 - (i === 2 ? 12 / 24 : 0), isActive: false }));
  caption.text = caption.words.map(word => word.text).join(' '); caption.startTime = 0; caption.endTime = 180 / 24; caption.captionBundle = true;
  caption.renderSegments = [0, 3].map(start => ({ id: `segment-${start}`, text: caption.words.slice(start, start + 3).map(word => word.text).join(' '), words: caption.words.slice(start, start + 3), startTime: caption.words[start].startTime, endTime: caption.words[start + 2].endTime }));
  const transcript = transcriptController([caption]), row = transcript.inspect().rows[0];
  transcript.choose(row);
  const lane = segments.captionSegmentLane(caption, row.segment);
  assert.deepEqual([lane.start, lane.end, lane.focusStart, lane.focusEnd], [0, 4, 0, 3]);
  assert.deepEqual(lane.caption.words.map(word => word.text), ['one', 'two', 'three', 'four']);
  assert.equal(lane.caption.endTime, caption.words[3].endTime);
  const words = wordController(lane.caption, 24, 2);
  words.keyboard(keyEvent('End'), 'endTime', 2);
  assert.equal(words.changes[0].words[2].endTime, caption.words[3].startTime, 'The last word reaches the next line\'s first word');
  transcript.updateCaption(words.changes[0], 'Word timing saved.');
  assert.equal(transcript.changes.length, 1);
  assert.equal(transcript.changes[0][0].words[2].endTime, 90 / 24);
  assert.deepEqual(transcript.changes[0][0].words.slice(3), caption.words.slice(3));
  assert.equal(transcript.changes[0][0].endTime, caption.endTime);
  edit.validateCaptions(transcript.changes[0]);
  const html = render(WordTimeline, { props: { ...wordProps(lane.caption, 24), selectedWord: 2, focusStart: lane.focusStart, focusEnd: lane.focusEnd } }).body;
  assert.match(html, /aria-label="four, next line,/);
  assert.equal((html.match(/word-timing__word--neighbour/g) ?? []).length, 1);
});

test('compact actions refuse protected or disabled changes even when called directly', () => {
  let splits = 0, merges = 0;
  const first = wordController(cue(), 24, 0, { onSplitBefore: () => splits++ });
  first.splitSelected(); assert.equal(splits, 0);
  const protectedLane = wordController(cue(), 24, 1, { splitDisabled: true, onSplitBefore: () => splits++, mergeDisabled: true, onMergeNext: () => merges++ });
  protectedLane.splitSelected(); protectedLane.mergeSelected(); assert.equal(splits, 0); assert.equal(merges, 0);
  const protectedTranscript = transcriptController();
  protectedTranscript.splitCaption(1); assert.equal(protectedTranscript.changes.length, 1); assert.equal(protectedTranscript.changes[0][0].clipNodeId, cue().clipNodeId);
  const disabled = transcriptController([unlinked(cue())], 24, { disabled: true });
  disabled.splitCaption(1); disabled.mergeNext(); assert.equal(disabled.changes.length, 0);
  const invalid = transcriptController([unlinked(cue())]);
  invalid.splitCaption(0); assert.equal(invalid.changes.length, 0); assert.match(invalid.inspect().error, /interior word/);
});

test('compact Merge joins lines across storage without removing native links', () => {
  const first = cue(), next = unlinked(cue()); next.id = 'next'; next.startTime = 4; next.endTime = 7.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  for (const linked of [false, true]) {
    if (linked) next.clipNodeId = 'linked-next';
    const transcript = transcriptController([first, next]);
    const lane = wordController(first, 24, 1, { onMergeNext: transcript.mergeNext });
    lane.mergeSelected();
    assert.equal(transcript.changes.length, 1); assert.equal(transcript.changes[0].length, 2);
    assert.equal(transcript.changes[0][0].clipNodeId, first.clipNodeId);
    assert.equal(transcript.changes[0][1].clipNodeId, next.clipNodeId);
    const rows = lines.transcriptLines(transcript.changes[0]);
    assert.equal(rows.length, 1);
    assert.equal(lines.transcriptLineCaption(transcript.changes[0], rows[0]).text, 'one two three one two three');
    assert.deepEqual(transcript.changes[0].flatMap(c => c.words).map(w => [w.text,w.startTime,w.endTime]), [first,next].flatMap(c => c.words).map(w => [w.text,w.startTime,w.endTime]));
  }
});

test('whole-word drag in free space preserves duration, keeps neighbors fixed and suppresses its trailing seek', () => {
  const caption = cue(); caption.words[1].startTime = 35 / 24; caption.words[1].endTime = 55 / 24;
  const h = wordController(caption, 24, 0), pointer = pointerFixture();
  h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  h.drag(pointer.event(), null, 1);
  pointer.listeners.get('pointermove')(pointer.event({ pointerId: 99, clientX: 480 }));
  assert.equal(h.inspect().shown.words[1].startTime, caption.words[1].startTime, 'Another pointer cannot alter this gesture');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 452 }));
  assert.equal(h.inspect().shown.words[1].startTime, caption.words[1].startTime, 'A small click wobble stays a click');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 480 }));
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 480 }));
  assert.equal(h.changes.length, 1); assert.equal(pointer.listeners.size, 0); assert.equal(pointer.captured, null);
  assert.equal(h.changes[0].words[1].startTime, 38 / 24); assert.equal(h.changes[0].words[1].endTime, 58 / 24);
  assert.deepEqual(h.changes[0].words[0], caption.words[0]); assert.deepEqual(h.changes[0].words[2], caption.words[2]);
  h.choose(1, { preventDefault() {} }); assert.deepEqual(h.seeks, [], 'The click generated after a drag cannot seek');
  h.choose(1); assert.deepEqual(h.seeks, [38 / 24], 'A later deliberate click still seeks normally');
});

test('whole-word dragging shortens at either fixed neighbor and reversing restores the original duration', () => {
  const caption = cue(); caption.words[1].startTime = 35 / 24; caption.words[1].endTime = 55 / 24;
  const h = wordController(caption), pointer = pointerFixture();
  h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  h.drag(pointer.event(), null, 1);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 550 }));
  assert.equal(h.inspect().shown.words[1].startTime, 45 / 24); assert.equal(h.inspect().shown.words[1].endTime, 60 / 24);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 350 }));
  assert.equal(h.inspect().shown.words[1].startTime, 30 / 24); assert.equal(h.inspect().shown.words[1].endTime, 45 / 24);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 750 }));
  assert.equal(h.inspect().shown.words[1].startTime, 57 / 24); assert.equal(h.inspect().shown.words[1].endTime, 60 / 24, 'A right collision stops at three frames');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 150 }));
  assert.equal(h.inspect().shown.words[1].startTime, 30 / 24); assert.equal(h.inspect().shown.words[1].endTime, 33 / 24, 'A left collision stops at three frames');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 450 }));
  assert.equal(h.inspect().shown.words[1].startTime, 35 / 24); assert.equal(h.inspect().shown.words[1].endTime, 55 / 24, 'Each move uses the original drag snapshot rather than the shortened draft');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 550 }));
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 550 }));
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0].words[1].startTime, 45 / 24); assert.equal(h.changes[0].words[1].endTime, 60 / 24);
  assert.deepEqual(h.changes[0].words[0], caption.words[0]); assert.deepEqual(h.changes[0].words[2], caption.words[2]);
  edit.validateCaptions([h.changes[0]]);
});

test('whole-word clicks still seek, and canceled, lost-capture or unmounted drags never commit', () => {
  const caption = cue(); caption.words[1].startTime = 35 / 24; caption.words[1].endTime = 55 / 24;
  const click = wordController(caption), pointer = pointerFixture(); click.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  click.drag(pointer.event(), null, 1);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 452 }));
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 452 }));
  click.choose(1); assert.deepEqual(click.seeks, [35 / 24]); assert.equal(click.changes.length, 0);
  for (const reason of ['pointercancel', 'lostpointercapture', 'unmount']) {
    const h = wordController(caption), gesture = pointerFixture(); h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
    h.drag(gesture.event(), null, 1); gesture.listeners.get('pointermove')(gesture.event({ clientX: 480 }));
    if (reason === 'unmount') h.destroyComponent(); else gesture.listeners.get(reason)(gesture.event({ type: reason }));
    assert.equal(h.changes.length, 0); assert.equal(gesture.listeners.size, 0); assert.equal(gesture.captured, null);
  }
});

test('edge dragging uses a pointer delta rather than jumping to the center of a wide handle', () => {
  const h = wordController(), pointer = pointerFixture(); h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  h.drag(pointer.event({ clientX: 310 }), 'startTime', 1);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 320 }));
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 320 }));
  assert.equal(h.changes[0].words[1].startTime, 31 / 24, 'Ten pixels translates one frame regardless of where the handle was grabbed');
});

test('starting a timing drag blurs inline text, and stale text or timing cannot be overwritten', () => {
  const h = wordController(), pointer = pointerFixture(); let focused = false;
  pointer.target.focus = () => { focused = true; };
  h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  h.drag(pointer.event({ clientX: 310 }), 'startTime', 1);
  assert.equal(focused, true, 'Explicit focus lets an inline sentence receive its normal blur');
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 320 }));
  const newer = cue(); newer.words[1].text = 'edited'; newer.text = 'one edited three'; h.setCaption(newer);
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 320 }));
  assert.equal(h.changes.length, 0); assert.match(h.inspect().problem, /changed during the drag/);
  assert.equal(h.inspect().shown.words[1].text, 'edited');
});

test('a completed timing drag preserves concurrent placement and word-style metadata', () => {
  const h = wordController(), pointer = pointerFixture(); h.setLane({ getBoundingClientRect: () => ({ width: 900 }) });
  h.drag(pointer.event({ clientX: 310 }), 'startTime', 1);
  pointer.listeners.get('pointermove')(pointer.event({ clientX: 320 }));
  const newer = cue(); newer.position = { x: .4, y: .6 }; newer.words[1].fontFamily = 'Georgia'; h.setCaption(newer);
  pointer.listeners.get('pointerup')(pointer.event({ type: 'pointerup', clientX: 320 }));
  assert.equal(h.changes.length, 1); assert.deepEqual(h.changes[0].position, newer.position); assert.equal(h.changes[0].words[1].fontFamily, 'Georgia');
  assert.equal(h.changes[0].words[1].startTime, 31 / 24);
});

test('smart line fit is a button that reports the measured estimate beside an always-editable limit',()=>{
 const calls=[];
 const props={...transcriptProps(),lineFitCapacity:24,onSmartLineFit(){calls.push(1);}};
 const html=render(TranscriptPreview,{props}).body;
 assert.match(html,/<button type="button" class="caption-button transcript-editor__smart-fit[^"]*"[^>]*>Smart line fit<\/button>/);
 assert.match(html,/5% safety margin/);
 assert.doesNotMatch(html,/type="checkbox"|readonly|Characters per line \(estimated\)|Undo edit/);
 assert.match(html,/<button[^>]*aria-label="Characters per line"[^>]*aria-valuenow="50"/);
 assert.match(html,/50 characters/);
 // Without a measurement the button stays clickable, so the click can explain why.
 const unavailable=render(TranscriptPreview,{props:{...props,lineFitCapacity:null}}).body;
 assert.match(unavailable,/<button[^>]*transcript-editor__smart-fit[^>]*>Smart line fit<\/button>/);
 assert.doesNotMatch(unavailable,/<button[^>]*transcript-editor__smart-fit[^>]*disabled/);
 const locked=render(TranscriptPreview,{props:{...props,disabled:true}}).body;
 assert.match(locked,/<button[^>]*transcript-editor__smart-fit[^>]*disabled/);
 const noHandler=render(TranscriptPreview,{props:{...props,onSmartLineFit:undefined}}).body;
 assert.match(noHandler,/Smart line fit/,'the button is always part of the grouping section');
});


test('pending inline drafts keep native reconnect paused until saved or cancelled, even after invalid blur', () => {
  const states = [], h = transcriptController(undefined,24,{onEditingChange:value=>states.push(value)});
  const row = h.inspect().rows[0];
  h.beginTextEdit(row);
  h.runEffect(0);
  assert.equal(states.at(-1),true);
  h.setDraft('other words');
  const newer = clone(row.caption); newer.words[0].endTime -= 1 / 24; h.setCaptions([newer]);
  assert.equal(h.saveInlineText(row),false);
  h.runEffect(0);
  assert.equal(states.at(-1),true,'invalid blur keeps reconnect paused');
  h.cancelTextEdit();
  h.runEffect(0);
  assert.equal(states.at(-1),false);
  assert.equal(h.inspect().editingRowKey,null);
  h.beginTimingEdit(row,'endTime');
  h.inputCaptionTime('endTime',numericEvent(NaN));
  assert.equal(h.saveInlineTiming(row),false);
  h.runEffect(0);
  assert.equal(states.at(-1),true,'invalid timing keeps reconnect paused');
  h.destroyComponent();
  assert.equal(states.at(-1),false,'unmount clears the parent guard');
});


test('character limit changes immediately without a separate regroup action', () => {
  const changes = [];
  const h = transcriptController([cue()], 24, { onMaxCharsChange: value => changes.push(value) });
  h.changeCharacterLimit(24); h.changeCharacterLimit(30);
  assert.deepEqual(changes, [24, 30]);
  const html = render(TranscriptPreview, { props: transcriptProps() }).body;
  assert.match(html, /role="spinbutton"[^>]*aria-label="Characters per line"|role="spinbutton"[^>]*aria-valuemin="15"/);
  assert.match(html, /aria-valuemin="15"[^>]*aria-valuemax="150"/);
  assert.doesNotMatch(html, />Regroup<|Apply the character limit/);
});

function characterScrubber(options = {}) {
  const changes = [];
  const h = controller('ScrubbableNumber', { label: 'Characters per line', value: 30, min: 15, max: 150, step: 1, decimals: 0,
    inputRealtime: true, defaultValue: 56, onChange: value => changes.push(value), ...options }, `
    export { edit, inputValue, commit, inputKeyDown, pointerDown, pointerMove, finishPointer, click, resetControl, resetGesture };
    export function inspect() { return { editing, draft }; }
    export function setDraft(value) { draft = value; }
  `);
  return { ...h, changes };
}

test('character typing publishes valid drafts immediately and keeps incomplete drafts editable', async () => {
  const h = characterScrubber(); await h.edit();
  for (const value of ['1', '15', '150', '', '-', '12.5', '151', '45']) h.inputValue({ currentTarget: { value } });
  assert.deepEqual(h.changes, [15, 150, 45]);
  h.setDraft('45'); h.commit(); assert.deepEqual(h.changes, [15, 150, 45], 'blur does not publish the last input twice');
  const legacy = characterScrubber({ value: 253 }); await legacy.edit(); legacy.commit();
  assert.deepEqual(legacy.changes, [], 'opening and leaving a legacy value does not clamp it');
});

test('character dragging and keyboard nudges update immediately within 15 to 150', async () => {
  const h = characterScrubber();
  const event = { button: 0, pointerId: 1, clientX: 100, preventDefault() {} };
  h.pointerDown(event); h.pointerMove({ ...event, clientX: 110 }); h.pointerMove({ ...event, clientX: 500 }); h.pointerMove({ ...event, clientX: -100 }); h.finishPointer();
  assert.deepEqual(h.changes, [40, 150, 15]);
  const keys = characterScrubber(); await keys.edit();
  keys.inputKeyDown({ key: 'ArrowUp', preventDefault() {} }); keys.commit();
  assert.deepEqual(keys.changes, [31], 'input and commit publish one nudge');
  for (const key of ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight']) {
    let prevented = false; keys.inputKeyDown({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, false, key);
  }
});

test('caption grouping stays visible without an accordion or explanatory paragraphs', () => {
  for (const linked of [false, true]) for (const withSmartFit of [false, true]) {
    const caption = cue();
    if (!linked) delete caption.clipNodeId;
    const html = render(TranscriptPreview, { props: { ...transcriptProps([caption]), lineFitCapacity: 24, ...(withSmartFit ? { onSmartLineFit() {} } : {}) } }).body;
    const grouping = html.match(/<section[^>]*aria-label="Caption grouping"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(grouping, 'Grouping is an always-visible section');
    assert.match(grouping, /<h3[^>]*>Caption grouping<\/h3>/);
    assert.match(grouping, /\d+ characters · \d+ lines?/);
    assert.match(grouping, /<button[^>]*transcript-editor__smart-fit[^>]*>Smart line fit<\/button>/);
    assert.doesNotMatch(grouping, />Regroup</);
    assert.match(grouping, /role="spinbutton"/);
    assert.doesNotMatch(grouping, /readonly|type="checkbox"/);
    assert.doesNotMatch(grouping, /<details|<summary|caption-help|Includes spaces|A word longer|Regroup splits|Keyframes stay|Fits the selected width/);
  }
  const hidden = render(TranscriptPreview, { props: { ...transcriptProps(), groupingDisabled: true } }).body;
  assert.doesNotMatch(hidden, /aria-label="Caption grouping"/);
});


function gestureNode() {
  const node = new EventTarget();
  const emit = (type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { button: 0, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100, ...properties });
    node.dispatchEvent(event); return event;
  };
  return { node, emit };
}

test('double-click survives immediate button to input swap and resets exactly once', async () => {
  const h = characterScrubber(), dom = gestureNode(), action = h.resetGesture(dom.node);
  dom.emit('pointerdown'); h.click({ detail: 1 });
  assert.equal(h.inspect().editing, true, 'single click starts typing immediately');
  h.setDraft('120');
  assert.equal(dom.emit('pointerdown').defaultPrevented, true, 'second press resets even after input replaced button');
  assert.deepEqual(h.changes, [56]);
  assert.equal(dom.emit('click').defaultPrevented, true);
  assert.equal(dom.emit('dblclick').defaultPrevented, true, 'native double-click cannot reset again');
  h.commit(); assert.deepEqual(h.changes, [56], 'no stale draft overwrites reset');
  assert.equal(h.inspect().editing, false); action.destroy();
});

test('input double-click fallback cancels its draft before reset', async () => {
  const h = characterScrubber(); await h.edit(); h.setDraft('120');
  h.resetControl({ preventDefault() {}, stopPropagation() {} }); h.commit();
  assert.deepEqual(h.changes, [56]); assert.equal(h.inspect().editing, false);
});

test('dragging, distant clicks and disabled values cannot accidentally reset', () => {
  const h = characterScrubber(), dom = gestureNode(), action = h.resetGesture(dom.node);
  const event = { button: 0, pointerId: 1, clientX: 100, preventDefault() {} };
  dom.emit('pointerdown'); h.pointerDown(event); dom.emit('pointermove', { clientX: 110 }); h.pointerMove({ ...event, clientX: 110 }); h.finishPointer(); h.click({ detail: 1 });
  h.resetControl({ preventDefault() {}, stopPropagation() {} }); assert.deepEqual(h.changes, [40]);
  dom.emit('pointerdown', { clientX: 150 }); assert.deepEqual(h.changes, [40]); action.destroy();
  const disabled = characterScrubber({ disabled: true });
  disabled.click({ detail: 1 }); disabled.resetControl({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(disabled.changes, []); assert.equal(disabled.inspect().editing, false);
});

test('reset callback takes precedence over a numeric default', async () => {
  let resets = 0;
  const h = characterScrubber({ onReset: () => resets++ }); await h.edit(); h.setDraft('120');
  h.resetControl({ preventDefault() {}, stopPropagation() {} }); h.commit();
  assert.equal(resets, 1); assert.deepEqual(h.changes, []);
});

test('non-reset fields edit immediately and gesture cleanup removes reset listeners', () => {
  const plain = characterScrubber({ defaultValue: undefined }); plain.click({ detail: 1 });
  assert.equal(plain.inspect().editing, true);
  const h = characterScrubber(), dom = gestureNode(), action = h.resetGesture(dom.node);
  dom.emit('pointerdown'); action.destroy(); dom.emit('pointerdown'); assert.deepEqual(h.changes, []);
});


test('focused text caret overrides lane selection and splits edited text as one change', () => {
  const original = unlinked(cue());
  const h = transcriptController([original]);
  h.beginTextEdit(h.inspect().rows[0]);
  h.setDraft('ONE two three');
  h.trackTextCaret({ currentTarget: { selectionStart: 3 } });
  assert.equal(h.inspect().caretSplitIndex, 1);
  const lane = wordController(original, 24, 0, { caretSplitIndex: h.inspect().caretSplitIndex, onSplitBefore: h.splitCaption });
  lane.splitSelected();
  assert.equal(h.changes.length, 1);
  assert.deepEqual(lines.transcriptLines(h.changes[0]).map(row => lines.transcriptLineCaption(h.changes[0], row).text), ['ONE', 'two three']);
  assert.deepEqual(h.changes[0].flatMap(c => c.words).map(w => [w.startTime,w.endTime]), original.words.map(w => [w.startTime,w.endTime]));
  assert.equal(h.inspect().editingRowKey, null);
});

test('caret split snaps inside words, handles whitespace, and rejects empty sides', () => {
  const h = transcriptController([unlinked(cue())]);
  for (const [caret, index] of [[0,0],[1,0],[2,1],[3,1],[4,1],[5,1],[6,2],[7,2],[13,3]]) {
    assert.equal(h.wordBoundaryAtCaret('one two three', caret), index);
  }
  assert.equal(h.wordBoundaryAtCaret('one   two', 5), 1);
  h.beginTextEdit(h.inspect().rows[0]);
  h.trackTextCaret({currentTarget:{selectionStart:13}});
  assert.equal(h.inspect().caretSplitIndex, 0);
  wordController(unlinked(cue()),24,1,{caretSplitIndex:0,onSplitBefore:h.splitCaption}).splitSelected();
  assert.equal(h.changes.length,0);
  h.cancelTextEdit();
  assert.equal(h.inspect().caretSplitIndex,null);
});



test('the shown URL caret splits after the URL and preserves the following words', () => {
  const caption = unlinked(cue());
  caption.words = caption.words.map((word,i) => ({...word,text:['JunkYourVehicle.Net','and','booked'][i]}));
  caption.text = caption.words.map(word=>word.text).join(' ');
  const h = transcriptController([caption]);
  h.beginTextEdit(h.inspect().rows[0]);
  h.trackTextCaret({currentTarget:{selectionStart:'JunkYourVehicle.Net'.length}});
  h.splitCaption(h.inspect().caretSplitIndex);
  assert.deepEqual(lines.transcriptLines(h.changes[0]).map(row => lines.transcriptLineCaption(h.changes[0], row).text),['JunkYourVehicle.Net','and booked']);
});

test('a native line editor hands typing to Premiere history steps and follows Undo while it stays open', async () => {
  const caption = unlinked(cue()); caption.words = ['one', 'two', 'three', 'four', 'five', 'six'].map((text, i) => ({ text, startTime: i * 30 / 24, endTime: (i + 1) * 30 / 24, isActive: false }));
  caption.text = caption.words.map(word => word.text).join(' '); caption.endTime = 180 / 24; caption.captionBundle = true;
  const phrases = (value, starts) => starts.map((start, i) => { const words = value.words.slice(start, starts[i + 1] ?? value.words.length); return { id: `segment-${start}`, text: words.map(word => word.text).join(' '), words, startTime: words[0].startTime, endTime: words.at(-1).endTime }; });
  caption.renderSegments = phrases(caption, [0, 3]);
  const calls = []; let show;
  const typing = { open: (anchor, captions, text, caret, display) => { calls.push(['open', anchor.start, anchor.suffix, text, caret]); show = display; },
    input: (draft, caret) => calls.push(['input', draft, caret]), flush: () => calls.push(['flush']), hint: () => calls.push(['hint']), end: async mode => { calls.push(['end', mode]); } };
  const h = transcriptController([caption], 24, { typing }), row = h.inspect().rows[1];
  h.beginTextEdit(row);
  assert.deepEqual(calls.at(-1), ['open', 3, 0, 'four five six', 13]);
  // Cmd going down commits pending typing before Premiere runs the shortcut.
  h.textKeydown(keyEvent('Meta'), row); assert.deepEqual(calls.at(-1), ['flush']);
  assert.equal(h.inspect().editingRowKey, row.key, 'the bare Cmd key leaves the editor open');
  // A typing step regroups the phrases; the open row stays on exactly its words.
  const typed = clone(caption); typed.words[3].text = 'FOUR'; typed.text = typed.words.map(word => word.text).join(' '); typed.renderSegments = phrases(typed, [0, 4]);
  h.setCaptions([typed]);
  assert.deepEqual(clone(h.inspect().rows.map(item => [item.key, item.segment.text])), [['cue:line-0:before', 'one two three'], [row.key, 'FOUR five six']]);
  // Premiere Undo restored an earlier step: the open draft and caret follow it.
  show('four five', 4);
  assert.equal(h.inspect().draftText, 'four five'); assert.equal(h.inspect().editingCaret, 4);
  // A blank draft is valid typing: it would leave the line blank.
  h.setDraft('   ');
  h.textKeydown(keyEvent('Meta'), h.inspect().rows[1]); assert.equal(h.inspect().editingError, '');
  assert.equal(calls.filter(call => call[0] === 'end').length, 0);
  // Leaving merges the steps; the component never commits the text itself.
  h.setDraft('four five six seven');
  assert.equal(h.saveInlineText(h.inspect().rows[1]), true);
  assert.deepEqual(calls.at(-1), ['end', 'commit']); assert.equal(h.inspect().editingRowKey, null); assert.equal(h.changes.length, 0);
  // Escape undoes the steps instead.
  h.setCaptions([caption]); h.beginTextEdit(h.inspect().rows[1]); h.setDraft('four');
  h.textKeydown(keyEvent('Escape'), h.inspect().rows[1]);
  assert.deepEqual(calls.at(-1), ['end', 'cancel']); assert.equal(h.inspect().editingRowKey, null);
  // Scissors merge the typing first, then split the saved text at the same word.
  h.beginTextEdit(h.inspect().rows[1]);
  h.splitCaption(4);
  assert.deepEqual(calls.at(-1), ['end', 'commit']); assert.equal(h.changes.length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.changes.length, 1); assert.deepEqual(lines.transcriptLines(h.changes[0]).map(item => item.end-item.start), [3, 1, 2]);
});

test('cross-storage line merge and split each publish once and follow undo/redo snapshots without extra callbacks', () => {
  const first = unlinked(cue()), next = unlinked(cue());
  next.id = 'next'; next.startTime = 4; next.endTime = 7.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  const original = [first,next], h = transcriptController(original);
  h.mergeNext();
  assert.equal(h.changes.length,1);
  const merged = clone(h.changes[0]);
  assert.equal(h.inspect().rows.length,1);
  h.setCaptions(clone(original));
  assert.equal(h.inspect().rows.length,2); assert.equal(h.changes.length,1, 'Undo readback creates no new edit');
  h.setCaptions(merged);
  assert.equal(h.inspect().rows.length,1); assert.equal(h.changes.length,1, 'Redo readback creates no new edit');
  h.splitCaption(4);
  assert.equal(h.changes.length,2);
  assert.deepEqual(h.inspect().rows.map(row => lines.transcriptLineCaption(h.inspect().captions,row).text), ['one two three one','two three']);
  assert.equal(h.selections.at(-1),'next');
  assert.deepEqual(h.changes[1].map(c=>c.id),original.map(c=>c.id));
  h.setCaptions(merged);
  assert.ok(h.inspect().selectedLine, 'Undo keeps the merged line selected even though its owner is the previous storage container');
  assert.equal(h.inspect().selectedWordOffset,-3, 'the lane maps words against the parent selected storage id after Undo');
});

test('inline timing on a later line uses adjacent speech rather than its storage start', () => {
  const first = unlinked(cue()), next = unlinked(cue());
  first.words[2].endTime = 3.25; first.endTime = 3.25;
  next.id = 'next'; next.startTime = 4; next.endTime = 7.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  const h = transcriptController([first,next]), row = h.inspect().rows[1];
  h.beginTimingEdit(row,'startTime');
  assert.equal(h.timingRange(row,'startTime').min,3.25);
  h.inputCaptionTime('startTime',numericEvent(3.5));
  assert.equal(h.saveInlineTiming(row),true);
  assert.equal(h.changes.length,1);
  assert.equal(h.changes[0][1].words[0].startTime,3.5);
  assert.deepEqual(h.changes[0][0].words,first.words);
  assert.equal(h.selections.at(-1),'next');
});

test('cross-storage typing closes through its history callback before the line merge publishes', async () => {
  const first = unlinked(cue()), next = unlinked(cue());
  next.id = 'next'; next.startTime = 4; next.endTime = 7.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  const calls = [];
  const typing = { open: anchor => calls.push(['open',anchor.transcript,anchor.start,anchor.suffix]), input() {}, flush() {}, hint() {}, end: async mode => { calls.push(['end',mode]); } };
  const h = transcriptController([first,next],24,{typing});
  h.beginTextEdit(h.inspect().rows[0]);
  assert.deepEqual(calls[0],['open',true,0,3]);
  h.mergeNext();
  assert.deepEqual(calls.at(-1),['end','commit']);
  assert.equal(h.changes.length,0);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.changes.length,1); assert.equal(h.inspect().rows.length,1);
});

test('a typing commit that rewraps the host rows still splits the full pinned editor at its caret', async () => {
  const caption = unlinked(cue());
  caption.words = ['one','two','three','four','five','six'].map((text,index)=>({text,startTime:index,endTime:index+.5,isActive:false}));
  caption.text = caption.words.map(w=>w.text).join(' '); caption.endTime = 5.5;
  let h;
  const typing = { open() {}, input() {}, flush() {}, hint() {}, end: async () => {
    const words = clone(caption.words); words[0].text = 'ONE';
    const wrapped = lines.withTranscriptLines([{...caption,words,text:words.map(w=>w.text).join(' ')}], [0,2,4].map(start=>({start,end:start+2,key:'host-'+start})));
    h.setCaptions(wrapped);
  } };
  h = transcriptController([caption],24,{typing});
  h.beginTextEdit(h.inspect().rows[0]); h.setDraft('ONE two three four five six');
  h.trackTextCaret({currentTarget:{selectionStart:'ONE two three'.length}});
  h.splitCaption(h.inspect().caretSplitIndex);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.changes.length,1);
  assert.deepEqual(lines.transcriptLines(h.changes[0]).map(row=>lines.transcriptLineCaption(h.changes[0],row).text), ['ONE two three','four five six']);
  assert.equal(h.inspect().editingRowKey,null);
});

const pauseSettings = { blankLineSeconds: 1, visibleLines: 3 };
function pauseFixture() {
  const first = unlinked(cue()), next = unlinked(cue());
  first.endTime = first.words.at(-1).endTime = 3;
  next.id = 'next'; next.startTime = 8; next.endTime = 11.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 8, endTime: word.endTime + 8 }));
  return [first, next];
}

test('pause rows share transcript numbering, show muted labels that take typed text, and stay absent without native settings', () => {
  const captions = pauseFixture(), props = { ...transcriptProps(captions), pauseSettings };
  const html = render(TranscriptPreview, { props }).body;
  assert.match(html, /50 characters · 5 lines/);
  for (const number of [2,3,4]) {
    assert.match(html, new RegExp(`aria-label="Select pause line ${number}"`));
    assert.match(html, new RegExp(`aria-label="Delete pause line ${number}"`));
    assert.match(html, new RegExp(`aria-label="Add text to pause line ${number}"[^>]*>Pause<`));
    assert.doesNotMatch(html, new RegExp(`aria-label="Edit line ${number} (?:text|start time|end time)"`));
  }
  assert.match(html, /aria-label="Edit line 5 text"/);
  assert.match(html, /transcript-editor__cue--pause/);
  assert.match(html, /00:03\.00/); assert.match(html, /00:08\.00/);
  assert.doesNotMatch(render(TranscriptPreview, { props: transcriptProps(captions) }).body, /Delete pause line/);
  assert.doesNotMatch(render(TranscriptPreview, { props: { ...props, pauseSettings: null } }).body, /Delete pause line/);
});

test('pause selection seeks its start and hides word timing without selecting or editing speech', async () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings });
  const pause = h.inspect().pauses[1];
  await h.choosePause(pause);
  assert.deepEqual(h.seeks, [pause.startTime]);
  assert.deepEqual(h.selections, []); assert.deepEqual(h.changes, []);
  assert.equal(h.inspect().selectedPause.key, pause.key);
  assert.equal(h.inspect().selectedLane, null); assert.equal(h.inspect().editingRowKey, null);
  h.choose(h.inspect().rows[1]);
  assert.equal(h.inspect().selectedPause, undefined); assert.ok(h.inspect().selectedLane);
});

test('deleting a pause publishes one normal history edit, leaves all speech and neighboring times fixed, and rehydrates undo/redo', async () => {
  const original = pauseFixture(), h = transcriptController(original, 24, { pauseSettings });
  await h.deletePause(h.inspect().pauses[1]);
  assert.equal(h.changes.length, 1); assert.deepEqual(h.labels, ['Delete pause line']);
  const deleted = clone(h.changes[0]);
  assert.equal(h.inspect().pauses.length, 2); assert.equal(h.inspect().sentenceCount, 4);
  assert.equal(deleted[1].words[0].pauseLinesRemoved, 1);
  const strip = values => values.map(caption => ({ ...caption, renderSegments: undefined, words: caption.words.map(({ pauseLinesRemoved, ...word }) => word) }));
  assert.deepEqual(strip(deleted), strip(original));
  assert.deepEqual(h.inspect().pauses.map(row => [row.startTime,row.endTime]), [[3,4],[4,8]]);
  h.setCaptions(clone(original));
  assert.equal(h.inspect().pauses.length, 3); assert.equal(h.inspect().sentenceCount, 5);
  h.setCaptions(deleted);
  assert.equal(h.inspect().pauses.length, 2); assert.equal(h.changes.length, 1);
  await h.deletePause(h.inspect().pauses[0]); await h.deletePause(h.inspect().pauses[0]);
  assert.equal(h.inspect().pauses.length, 0); assert.equal(h.changes.length, 3);
  assert.equal(h.changes.at(-1)[1].words[0].pauseLinesRemoved, 3);
  assert.deepEqual(h.changes.at(-1)[0].words, original[0].words);
});

test('search uses full transcript row numbers even when pause rows are filtered', () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings });
  h.setQuery('pause');
  assert.equal(h.inspect().filteredRows.length, 3);
  assert.deepEqual(h.inspect().filteredRows.map(row => h.inspect().allRows.findIndex(item => item.key === row.key) + 1), [2,3,4]);
  h.setQuery('5 one');
  assert.deepEqual(h.inspect().filteredRows.map(row => h.inspect().allRows.findIndex(item => item.key === row.key) + 1), [5]);
  h.setPauseSettings(null);
  assert.equal(h.inspect().allRows.length, 2);
});

test('pause controls respect disabled deletion and text timing remains bounded by speech rather than pause rows', async () => {
  const original = pauseFixture(), h = transcriptController(original, 24, { pauseSettings, disabled: true });
  await h.deletePause(h.inspect().pauses[0]); assert.equal(h.changes.length, 0);
  const editable = transcriptController(original, 24, { pauseSettings });
  editable.beginTimingEdit(editable.inspect().rows[1], 'startTime');
  assert.equal(editable.timingRange(editable.inspect().rows[1], 'startTime').min, 3);
  editable.inputCaptionTime('startTime', numericEvent(7));
  assert.equal(editable.saveInlineTiming(editable.inspect().rows[1]), true);
  assert.deepEqual(editable.changes[0][0].words, original[0].words);
  assert.equal(editable.inspect().pauses.at(-1).endTime, 7);
});

// Add line on a native layer is one Undo step of its own: typing steps start
// only after Premiere confirms its write, and nothing typed meanwhile is lost.
function addLineFixture() {
  const calls = [], holds = [];
  const typing = { open: (anchor, captions, text) => calls.push(['open', anchor.start, text]), input: draft => calls.push(['input', draft]),
    flush() {}, hint() {}, end: async mode => { calls.push(['end', mode]); },
    // Pending edits before the line is added settle at once; the Add line write is held.
    settle: () => { calls.push(['settle']); return calls.filter(call => call[0] === 'settle').length % 2 ? Promise.resolve(true) : new Promise(resolve => holds.push(resolve)); } };
  const h = transcriptController(pauseFixture(), 24, { typing });
  h.choose(h.inspect().rows[0]);
  const added = () => h.inspect().rows.find(row => row.key === h.inspect().editingRowKey);
  return { h, calls, holds, added, settled: () => new Promise(resolve => setImmediate(resolve)) };
}
test('Add line opens its editor at once but starts typing steps only after Premiere confirms the Add line step', async () => {
  const { h, calls, holds, added, settled } = addLineFixture();
  await h.addLine('after');
  assert.deepEqual(h.labels, ['Add line']);
  const row = added(); assert.ok(row, 'the new line is open for typing'); assert.equal(h.inspect().draftText, '');
  assert.deepEqual(calls, [['settle'], ['settle']], 'no typing step can join the unconfirmed Add line write');
  h.setDraft('Fresh words');
  holds[0](true); await settled();
  assert.deepEqual(calls.slice(2), [['open', row.start, ''], ['input', 'Fresh words']], 'text typed meanwhile becomes the first typing step');
  // Leaving now merges the typing steps; the panel commits nothing itself.
  assert.equal(h.saveInlineText(added()), true);
  assert.deepEqual(calls.at(-1), ['end', 'commit']); assert.equal(h.changes.length, 1);
});
test('text saved before Add line is confirmed is written after it, as a separate Undo step', async () => {
  const { h, calls, holds, added, settled } = addLineFixture();
  await h.addLine('after');
  const row = added(); h.setDraft('Quick words');
  assert.equal(h.saveInlineText(row), true); assert.equal(h.inspect().editingRowKey, null);
  assert.equal(h.changes.length, 1, 'the text waits for the Add line step');
  holds[0](true); await settled();
  assert.deepEqual(h.labels, ['Add line', 'Edit transcript']);
  assert.deepEqual(lines.transcriptLines(h.changes[1]).map(item => lines.transcriptLineCaption(h.changes[1], item).text), ['one two three', 'Quick words', 'one two three']);
  assert.equal(calls.some(call => call[0] === 'open'), false, 'the closed editor opens no typing session');
  // A second Add line waits for the first and is its own step too.
  h.choose(h.inspect().rows[1]);
  await h.addLine('after');
  assert.deepEqual(h.labels, ['Add line', 'Edit transcript', 'Add line']);
});
test('Enter between words typed before Add line is confirmed splits that text after the confirmation', async () => {
  const { h, calls, holds, added, settled } = addLineFixture();
  await h.addLine('after');
  const row = added(); h.setDraft('left right');
  h.splitCaption(1 + row.start - lines.captionWordOffset(h.inspect().captions, h.inspect().selectedLine.caption.id));
  assert.equal(h.changes.length, 1, 'nothing is split before Premiere confirms Add line');
  holds[0](true); await settled();
  assert.deepEqual(calls.slice(2), [['open', row.start, ''], ['input', 'left right'], ['end', 'commit']], 'the typing is merged first, then split as usual');
});
test('if Premiere cannot confirm Add line, its editor saves text as an ordinary edit', async () => {
  const { h, calls, holds, added, settled } = addLineFixture();
  await h.addLine('after');
  holds[0](false); await settled();
  assert.equal(calls.some(call => call[0] === 'open'), false);
  h.setDraft('Plain save');
  assert.equal(h.saveInlineText(added()), true);
  assert.deepEqual(h.labels, ['Add line', 'Edit transcript']);
});

test('deleting a pause waits for native typing to finish before publishing its independent history edit', async () => {
  let finish;
  const calls = [], typing = { open() {}, input() {}, flush() {}, hint() {}, end: mode => { calls.push(mode); return new Promise(resolve => { finish = resolve; }); } };
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing });
  h.beginTextEdit(h.inspect().rows[0]);
  const deletion = h.deletePause(h.inspect().pauses[0]);
  assert.deepEqual(calls, ['commit']); assert.equal(h.changes.length, 0);
  finish(); await deletion;
  assert.equal(h.changes.length, 1); assert.deepEqual(h.labels, ['Delete pause line']);
  assert.equal(h.inspect().editingRowKey, null);
});

test('typing into a pause row adds a line in that slot; the other pause rows stay and Escape changes nothing', async () => {
  const original = pauseFixture(), h = transcriptController(original, 24, { pauseSettings });
  const pause = h.inspect().pauses[1];
  await h.beginPauseEdit(pause);
  const key = h.inspect().editingRowKey;
  assert.match(key, /^typing-pause:3:1$/); assert.equal(h.inspect().draftText, '');
  assert.deepEqual(clone(h.inspect().allRows.map(row => row.kind === 'pause' ? 'pause' : row.key === key ? 'typing' : 'text')), ['text', 'pause', 'typing', 'pause', 'text']);
  assert.deepEqual(h.seeks.at(-1), pause.startTime);
  h.textKeydown(keyEvent('Escape'), h.inspect().rows.find(row => row.key === key));
  assert.equal(h.inspect().editingRowKey, null); assert.equal(h.changes.length, 0); assert.equal(h.inspect().pauses.length, 3);
  await h.beginPauseEdit(h.inspect().pauses[1]);
  // Leaving an empty pause editor changes nothing either.
  assert.equal(h.saveInlineText(h.inspect().rows.find(row => row.key === h.inspect().editingRowKey)), true); assert.equal(h.changes.length, 0);
  await h.beginPauseEdit(h.inspect().pauses[1]);
  h.setDraft('A new thought');
  assert.equal(h.saveInlineText(h.inspect().rows.find(row => row.key === h.inspect().editingRowKey)), true);
  assert.equal(h.changes.length, 1); assert.deepEqual(h.labels, ['Edit transcript']);
  const typed = lines.transcriptWords(h.changes[0]);
  assert.deepEqual(typed.map(word => word.text), ['one', 'two', 'three', 'A', 'new', 'thought', 'one', 'two', 'three']);
  assert.equal(typed[3].startTime, 4); assert.equal(typed[5].endTime, 5); assert.equal(typed[3].lineBreakBefore, 'break'); assert.equal(typed[6].lineBreakBefore, 'break');
  assert.deepEqual(h.changes[0][0].words.slice(0, 3), original[0].words, 'speech before keeps its words and times');
  assert.deepEqual(h.changes[0].at(-1).words.slice(-3).map(({ lineBreakBefore, ...word }) => word), original[1].words, 'speech after keeps its words and times');
  // Visible lines (3) caps each pause on its own: the 3 s after the new line now shows three rows.
  assert.deepEqual(clone(h.inspect().allRows.map(row => row.kind)), ['text', 'pause', 'text', 'pause', 'pause', 'pause', 'text']);
  assert.deepEqual(clone(h.inspect().pauses.map(row => [row.startTime, row.endTime])), [[3, 4], [5, 6], [6, 7], [7, 8]]);
  assert.equal(h.inspect().editingRowKey, null);
});

test('native typing into a pause row anchors an empty range that follows typing steps and Undo while open', async () => {
  const calls = [], typing = { open: (anchor, captions, text, caret) => calls.push(['open', anchor, text, caret]), input() {}, flush() {}, hint() {}, end: async mode => { calls.push(['end', mode]); } };
  const original = pauseFixture(), h = transcriptController(original, 24, { pauseSettings, typing });
  const pause = h.inspect().pauses[2];
  await h.beginPauseEdit(pause);
  const [, anchor, text, caret] = calls[0], key = h.inspect().editingRowKey;
  assert.equal(anchor.start, 3); assert.equal(anchor.suffix, 3); assert.deepEqual(anchor.window, { startTime: 5, endTime: 8 }); assert.equal(text, ''); assert.equal(caret, 0);
  // A typing step inserts the words; the open row is exactly those words.
  h.setCaptions(typingModule.applyTypingText(original, anchor, 'Fresh words here.'));
  assert.equal(h.inspect().editingRowKey, key);
  const row = h.inspect().rows.find(item => item.key === key);
  assert.equal(lines.transcriptLineCaption(h.inspect().captions, row).text, 'Fresh words here.');
  assert.deepEqual(clone(h.inspect().pauses.map(item => [item.startTime, item.endTime])), [[3, 4], [4, 5]]);
  // Premiere Undo back past the step: the editor stays open on the empty pause slot.
  h.setCaptions(clone(original));
  assert.equal(h.inspect().editingRowKey, key);
  assert.deepEqual(clone(h.inspect().allRows.map(item => item.kind === 'pause' ? 'pause' : item.key === key ? 'typing' : 'text')), ['text', 'pause', 'pause', 'typing', 'text']);
  h.setDraft('Fresh words here.');
  assert.equal(h.saveInlineText(h.inspect().rows.find(item => item.key === key)), true);
  assert.deepEqual(calls.at(-1), ['end', 'commit']); assert.equal(h.changes.length, 0, 'typing steps hold the text; the component writes nothing itself');
});

test('the blur before a pause deletion click finishes its typing history merge before deletion publishes', async () => {
  let finish;
  const calls = [], typing = { open() {}, input() {}, flush() {}, hint() {}, end: mode => { calls.push(mode); return new Promise(resolve => { finish = resolve; }); } };
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing });
  h.beginTextEdit(h.inspect().rows[0]);
  assert.equal(h.saveInlineText(h.inspect().rows[0]), true, 'textarea blur closes the editor first');
  const deletion = h.deletePause(h.inspect().pauses[0]);
  await Promise.resolve();
  assert.deepEqual(calls, ['commit']); assert.equal(h.changes.length, 0);
  finish(); await deletion;
  assert.equal(h.changes.length, 1); assert.deepEqual(h.labels, ['Delete pause line']);
});
test('Add line between touching lines takes time from the last word above and leaves every other word alone', async () => {
  const first = unlinked(cue()), next = unlinked(cue());
  next.id = 'next'; next.startTime = 3.75; next.endTime = 7.5;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 3.75, endTime: word.endTime + 3.75 }));
  const h = transcriptController([first, next], 24);
  h.choose(h.inspect().rows[0]);
  await h.addLine('after');
  assert.equal(h.inspect().error, '');
  assert.deepEqual(h.labels, ['Add line']);
  const words = h.changes[0].flatMap(caption => caption.words);
  assert.equal(words.length, 7);
  assert.ok(words[2].endTime < 3.75, 'the last word above gives up its end');
  assert.deepEqual(words.slice(0, 2), first.words.slice(0, 2));
  assert.deepEqual([words[3].text, words[3].startTime, words[3].endTime], ['', words[2].endTime, 3.75]);
  assert.deepEqual(words.slice(4).map(({ text, startTime, endTime }) => ({ text, startTime, endTime })), next.words.map(({ text, startTime, endTime }) => ({ text, startTime, endTime })));
});

// A line list of 40px rows showing three rows at a time, in place of the DOM.
function scrollingList(h) {
  const list = { scrollTop: 0, clientTop: 0, clientHeight: 120, scrolls: 0, querySelector: () => null,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: selector => h.inspect().allRows.map((row, index) => ({ dataset: selector === '[data-row-key]' ? { rowKey: row.key } : { captionId: row.line?.caption.id }, offsetHeight: 40,
      getBoundingClientRect: () => ({ top: index * 40 - list.scrollTop }), scrollIntoView() { throw new Error('Only the line list may scroll, never the panel around it.'); } })) };
  let top = 0;
  return new Proxy(list, { set(target, name, value) { if (name === 'scrollTop') { target.scrolls++; top = value; } target[name] = value; return true; }, get(target, name) { return name === 'scrollTop' ? top : target[name]; } });
}
function longTranscript(count = 10) {
  return Array.from({ length: count }, (_, i) => ({ id: `line-${i}`, text: `word${i} more`, startTime: i, endTime: i + 1,
    words: [{ text: `word${i}`, startTime: i, endTime: i + .5 }, { text: 'more', startTime: i + .5, endTime: i + 1 }] }));
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('editing a line leaves the line list where the user scrolled it, through typing, saving and Premiere confirming', async () => {
  const h = transcriptController(longTranscript()), list = scrollingList(h);
  h.setList(list); h.revealSelection(); await settle();
  h.choose(h.inspect().rows[7]); h.revealSelection(); await settle();
  assert.equal(list.scrollTop, 7 * 40 + 40 - 120, 'Choosing a line below the list scrolls it just into view');
  const row = h.inspect().rows[7];
  h.beginTextEdit(row); h.revealSelection(); await settle();
  h.setDraft('word7 more and then some'); h.revealSelection(); await settle();
  list.scrollTop = 40; const scrolls = list.scrolls;
  assert.equal(h.saveInlineText(row), true); h.revealSelection(); await settle();
  // Premiere confirms the edit: the same transcript arrives again as new objects.
  h.setCaptions(clone(h.inspect().captions)); h.revealSelection(); await settle();
  assert.equal(h.changes.length, 1);
  assert.equal(h.inspect().selectedLine.key, row.key, 'The edited line stays selected');
  assert.equal(list.scrollTop, 40, 'The list stays where the user scrolled it');
  assert.equal(list.scrolls, scrolls, 'Nothing scrolled after the edit');
});

test('a line edited above the selection shifts row keys but not the selection or scroll', async () => {
  const h = transcriptController(longTranscript()), list = scrollingList(h);
  h.setList(list); h.choose(h.inspect().rows[5]); h.revealSelection(); await settle();
  const selected = h.inspect().selectedLine, scrolls = list.scrolls;
  // An Undo in Premiere adds a word to an earlier line while line 6 stays selected.
  const next = clone(h.inspect().captions); next[2].words.splice(1, 0, { text: 'extra', startTime: 2.25, endTime: 2.5 }); next[2].words[0].endTime = 2.25; next[2].words[2].startTime = 2.5; next[2].text = 'word2 extra more';
  h.setCaptions(next); h.revealSelection(); await settle();
  assert.equal(h.inspect().selectedLine.caption.id, selected.caption.id);
  assert.equal(list.scrolls, scrolls);
});

test('the line list keeps its place while Premiere re-reads the pause settings after confirming a typing step', async () => {
  let anchor;
  const typing = { open: at => { anchor = at; }, input() {}, flush() {}, hint() {}, end: async () => {} };
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing, nativeLayerKey: 'layer-a', selectedId: 'next' }), list = scrollingList(h);
  list.clientHeight = 80;
  // The browser keeps scrollTop within the content at every layout.
  const layout = () => { const bottom = Math.max(0, h.inspect().allRows.length * 40 - list.clientHeight); if (list.scrollTop > bottom) list.scrollTop = bottom; };
  h.setList(list);
  const row = h.inspect().rows[1], keys = [...h.inspect().allRows].map(item => item.key), cadence = h.inspect().newLineOptions.cadence;
  h.beginTextEdit(row); h.revealSelection(); await settle(); layout();
  assert.equal(list.scrollTop, 4 * 40 + 40 - 80, 'The last line, below three pause rows, is in view');
  const scrolls = list.scrolls;
  // A typing step is written, then Premiere confirms it with a new document
  // revision, and the pause controls are unknown until they are read again.
  h.setDraft('one two'); h.setCaptions(typingModule.applyTypingText(h.inspect().captions, anchor, 'one two')); layout();
  h.setPauseSettings(null); h.revealSelection(); await settle(); layout();
  assert.deepEqual([...h.inspect().allRows].map(item => item.key), keys, 'The pause rows stay while the settings are read again');
  assert.equal(h.inspect().newLineOptions.cadence, cadence, 'Add line keeps the pause cadence meanwhile');
  h.setPauseSettings({ ...pauseSettings }); h.revealSelection(); await settle(); layout();
  assert.equal(list.scrollTop, 120, 'The list did not jump above the line being typed');
  assert.equal(list.scrolls, scrolls);
  assert.equal(h.inspect().editingRowKey, row.key);
});

// main-webview passes one constant typing bridge whatever layer is connected.
const typingBridge = { open() {}, input() {}, flush() {}, hint() {}, end: async () => {}, settle: async () => true };
test('newly confirmed pause settings replace the kept ones at once', () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing: typingBridge, nativeLayerKey: 'layer-a' });
  assert.equal(h.inspect().pauses.length, 3);
  h.setPauseSettings(null);
  assert.equal(h.inspect().pauses.length, 3);
  const settings = { blankLineSeconds: 5, visibleLines: 4 };
  h.setPauseSettings(settings);
  assert.equal(h.inspect().pauses.length, 1, 'A new pause length applies immediately');
  assert.equal(h.inspect().newLineOptions.cadence, pauseLines.pauseCadence(h.inspect().captions, 5), 'and so does its Add line cadence');
  h.setPauseSettings(null);
  assert.equal(h.inspect().pauses.length, 1, 'The newest settings are the ones kept');
});

test('another layer in the same sequence never shows the last layer\'s pause rows', () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing: typingBridge, nativeLayerKey: 'layer-a' });
  assert.equal(h.inspect().pauses.length, 3);
  // Premiere switches to another caption clip; its controls are not read yet.
  h.setPauseSettings(null); h.setNativeLayerKey('layer-b');
  assert.equal(h.inspect().pauses.length, 0);
  assert.equal(h.inspect().newLineOptions.cadence, pauseLines.pauseCadence(h.inspect().captions, 0));
  h.setPauseSettings({ blankLineSeconds: 5, visibleLines: 3 });
  assert.equal(h.inspect().pauses.length, 1, 'The new layer\'s own settings apply');
  // Back and forth with no read of the rows in between: only the layer effect
  // (the component's last) sees layer A.
  h.setPauseSettings(null); h.setNativeLayerKey('layer-a'); h.runEffect(-1); h.setNativeLayerKey('layer-b');
  assert.equal(h.inspect().pauses.length, 0);
});

test('a reconnected layer waits for a fresh read instead of resurrecting its old pause rows', () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing: typingBridge, nativeLayerKey: 'layer-a' });
  h.setPauseSettings(null); h.setNativeLayerKey(null);
  assert.equal(h.inspect().pauses.length, 0, 'Without a native layer the pause rows go');
  h.setNativeLayerKey('layer-a');
  assert.equal(h.inspect().pauses.length, 0, 'The same layer reconnecting starts without them');
  h.setPauseSettings(pauseSettings);
  assert.equal(h.inspect().pauses.length, 3, 'and gets them back from its fresh read');
  // The rows are not read while disconnected; only the layer effect runs.
  h.setPauseSettings(null); h.setNativeLayerKey(null); h.runEffect(-1); h.setNativeLayerKey('layer-a');
  assert.equal(h.inspect().pauses.length, 0);
});

test('a sequence switch drops the kept pause rows, and captions without a native layer keep their own settings only', () => {
  const h = transcriptController(pauseFixture(), 24, { pauseSettings, typing: typingBridge, nativeLayerKey: 'layer-a' });
  h.setPauseSettings(null); h.setSequenceId('other');
  assert.equal(h.inspect().pauses.length, 0, 'Another sequence never shows the last one\'s pause rows');
  h.setSequenceId('sequence');
  assert.equal(h.inspect().pauses.length, 0);
  const fresh = transcriptController(pauseFixture(), 24, { typing: typingBridge, nativeLayerKey: 'layer-a' });
  assert.equal(fresh.inspect().pauses.length, 0, 'A freshly opened panel starts without pause rows');
  const plain = transcriptController(pauseFixture(), 24, { pauseSettings });
  assert.equal(plain.inspect().pauses.length, 3, 'Supplied settings still show without a layer');
  plain.setPauseSettings(null);
  assert.equal(plain.inspect().pauses.length, 0, 'and nothing is kept for them');
});

test('choosing, adding or splitting to another line still brings it into view', async () => {
  const h = transcriptController(longTranscript(), 24, { selectedId: 'line-0' }), list = scrollingList(h);
  h.setList(list); h.revealSelection(); await settle();
  assert.equal(list.scrollTop, 0);
  h.choose(h.inspect().rows[9]); h.revealSelection(); await settle();
  assert.equal(list.scrollTop, 9 * 40 + 40 - 120);
  h.choose(h.inspect().rows[1]); h.revealSelection(); await settle();
  assert.equal(list.scrollTop, 40, 'A line above the list scrolls to its top edge');
  h.splitCaption(1); h.revealSelection(); await settle();
  assert.equal(h.inspect().selectedLine.start, 3, 'Split selects its right half');
  assert.equal(list.scrollTop, 40, 'The new line below is already in view');
  h.choose(h.inspect().rows[10]); h.revealSelection(); await settle();
  await h.addLine('after'); h.revealSelection(); await settle();
  assert.equal(h.inspect().selectedLine.start, h.inspect().rows.at(-1).start, 'Add line selects the new last line');
  assert.equal(list.scrollTop, (h.inspect().allRows.length) * 40 - 120, 'The new line scrolls into view');
});

test('the open line editor keeps the row height while Unsaved comes and goes and when it closes', () => {
  const markup = sources.TranscriptPreview.split('</script>')[1], css = markup.split('<style>')[1];
  // Unsaved lives on the timestamp line, which every text row has, never under the text.
  const time = markup.match(/<div class="transcript-editor__cue-time">([\s\S]*?)<\/div>/)[1];
  assert.match(time, /\{#if editingRowKey === row\.key\}<span class="transcript-editor__text-pending" role="status">\{[^}]*'Unsaved' : ''\}<\/span>\{\/if\}/);
  const underEditor = markup.match(/<\/textarea>([\s\S]*?)\{:else\}/)[1];
  assert.doesNotMatch(underEditor, /text-pending|Unsaved/, 'Nothing transient sits under the text while it is being typed');
  assert.match(underEditor.trim(), /^\{#if editingError\}<p [^>]*>\{editingError\}<\/p>\{\/if\}$/);
  assert.match(css, /\.transcript-editor__text-pending \{[^}]*white-space: nowrap/);
  // The editor and the text it replaces lay out alike, so opening or closing it keeps the row height.
  const rule = name => css.match(new RegExp(`\\.transcript-editor__${name} \\{([^}]*)`))[1];
  for (const property of ['font-size', 'line-height', 'overflow-wrap']) {
    const value = text => text.match(new RegExp(`(?:^|;)\\s*${property}: ([^;]+)`))?.[1];
    assert.equal(value(rule('cue-input')), value(rule('cue-text')), property);
  }
});

// Delete line removes the selected line and its words as one "Delete line"
// step, after open editors and pending edits are written as steps of their own.
function threeLines() {
  const [first, last] = pauseFixture(), middle = unlinked(cue());
  middle.id = 'middle'; middle.text = 'four five'; middle.startTime = 4; middle.endTime = 5;
  middle.words = [{ text: 'four', startTime: 4, endTime: 4.5, lineBreakBefore: 'break' }, { text: 'five', startTime: 4.5, endTime: 5 }];
  return [first, middle, last];
}
const rowTexts = h => h.inspect().rows.map(row => lines.transcriptLineCaption(h.inspect().captions, row).text);
test('Delete line publishes one Delete line edit, keeps the gap’s pause rows and selects the next line without seeking', async () => {
  const settings = { blankLineSeconds: 1, visibleLines: 8 }, original = threeLines(), h = transcriptController(original, 24, { pauseSettings: settings });
  assert.equal(h.inspect().pauses.length, 1 + 3);
  h.choose(h.inspect().rows[1]);
  const seeks = h.seeks.length;
  await h.deleteLine();
  assert.equal(h.changes.length, 1); assert.deepEqual(h.labels, ['Delete line']);
  assert.deepEqual(rowTexts(h), ['one two three', 'one two three']);
  assert.equal(h.inspect().pauses.length, 4, 'the deleted line’s second is not a new pause row');
  assert.deepEqual(h.changes[0].map(caption => caption.id), ['cue', 'next'], 'the emptied container goes');
  assert.deepEqual(h.changes[0][0].words, original[0].words); assert.deepEqual(h.changes[0][1].words.slice(1), original[2].words.slice(1));
  assert.equal(h.inspect().selectedLine.key, h.inspect().rows[1].key); assert.equal(h.selections.at(-1), 'next');
  assert.equal(h.seeks.length, seeks, 'the playhead stays');
  assert.equal(h.inspect().notice, 'Line deleted.');
});
test('Delete line on a blank line removes the row instead of leaving it blank', async () => {
  const h = transcriptController(threeLines(), 24);
  h.choose(h.inspect().rows[1]);
  h.beginTextEdit(h.inspect().rows[1]); h.setDraft('');
  assert.equal(h.saveInlineText(h.inspect().rows[1]), true);
  assert.deepEqual(rowTexts(h), ['one two three', '', 'one two three'], 'clearing text keeps a timed blank line');
  h.choose(h.inspect().rows[1]);
  await h.deleteLine();
  assert.deepEqual(h.labels, ['Edit transcript', 'Delete line']);
  assert.deepEqual(rowTexts(h), ['one two three', 'one two three']);
  assert.ok(lines.transcriptWords(h.inspect().captions).every(word => word.text));
});
test('Delete line finishes native typing first, then deletes the line as typed once Premiere confirmed it', async () => {
  let finish;
  const calls = [], typing = { open() {}, input() {}, flush() {}, hint() {}, settle: async () => { calls.push('settle'); return true; },
    end: mode => { calls.push(mode); return new Promise(resolve => { finish = resolve; }); } };
  const h = transcriptController(threeLines(), 24, { typing });
  h.choose(h.inspect().rows[1]); h.beginTextEdit(h.inspect().rows[1]);
  const deletion = h.deleteLine();
  assert.deepEqual(calls, ['commit']); assert.equal(h.changes.length, 0, 'nothing is deleted while typing is merged');
  // Premiere confirms the typed text (as its own step) while the deletion waits.
  const typed = lines.replaceTranscriptLine(h.inspect().captions, h.inspect().rows[1], edit.replaceText(lines.transcriptLineCaption(h.inspect().captions, h.inspect().rows[1]), 'four six'));
  h.setCaptions(typed); finish(); await deletion;
  assert.deepEqual(calls, ['commit', 'settle', 'settle'], 'pending edits, then Delete line itself, are confirmed as steps of their own');
  assert.deepEqual(h.labels, ['Delete line']);
  assert.deepEqual(rowTexts(h), ['one two three', 'one two three']);
  assert.equal(h.inspect().editingRowKey, null);
});
test('a line changed by Premiere while pending edits are written is not deleted, nor is any other line', async () => {
  let h;
  const typing = { open() {}, input() {}, flush() {}, hint() {}, end: async () => {},
    // A Premiere Undo arrives while settling: the line comes back retimed.
    settle: async () => { const captions = clone(h.inspect().captions); captions[1].words[1].endTime = 4.9; h.setCaptions(captions); return true; } };
  h = transcriptController(threeLines(), 24, { typing });
  h.choose(h.inspect().rows[1]);
  await h.deleteLine();
  assert.equal(h.changes.length, 0); assert.match(h.inspect().error, /This line changed/);
  assert.equal(h.inspect().rows.length, 3);
});
test('the last remaining line can be deleted, leaving an empty transcript for one Delete line step', async () => {
  const h = transcriptController([unlinked(cue())], 24);
  h.choose(h.inspect().rows[0]);
  await h.deleteLine();
  assert.deepEqual(h.changes, [[]]); assert.deepEqual(h.labels, ['Delete line']);
  assert.equal(h.inspect().selectedLine, undefined); assert.equal(h.inspect().error, '');
  const empty = render(TranscriptPreview, { props: { ...transcriptProps([]), nativeLayerKey: 'layer' } }).body;
  assert.match(empty, /No lines left/); assert.match(empty, /Undo in Premiere brings them back/);
  assert.match(render(TranscriptPreview, { props: transcriptProps([]) }).body, /Ready for your first words/);
});
test('the selected words toolbar offers Delete line for text and blank lines, and disabled editing refuses it', async () => {
  const button = html => html.match(/<button[^>]*aria-label="Delete line"[^>]*>/)?.[0];
  const captions = threeLines();
  assert.doesNotMatch(button(render(TranscriptPreview, { props: transcriptProps(captions) }).body), /disabled/);
  const blank = clone(captions); blank[1].text = ''; blank[1].words = [{ text: '', startTime: 4, endTime: 5, lineBreakBefore: 'break' }];
  assert.ok(button(render(TranscriptPreview, { props: { ...transcriptProps(blank), selectedId: 'middle' } }).body));
  assert.match(button(render(TranscriptPreview, { props: { ...transcriptProps(captions), disabled: true } }).body), /disabled/);
  const h = transcriptController(captions, 24, { disabled: true });
  await h.deleteLine(); assert.equal(h.changes.length, 0);
});

// On a native layer, Delete line is confirmed as its own Undo step before
// anything else: edits before it must be confirmed first, and typing in another
// line starts only once Premiere confirms the deletion.
function deleteLineFixture(first = true) {
  const calls = [], holds = [];
  const typing = { open: (anchor, captions, text) => calls.push(['open', anchor.start, text]), input: draft => calls.push(['input', draft]),
    flush() {}, hint() {}, end: async mode => { calls.push(['end', mode]); },
    // Pending edits before the deletion settle as `first`; the Delete line write is held.
    settle: () => { calls.push(['settle']); return calls.filter(call => call[0] === 'settle').length % 2 ? Promise.resolve(first) : new Promise(resolve => holds.push(resolve)); } };
  const h = transcriptController(threeLines(), 24, { typing });
  h.choose(h.inspect().rows[1]);
  return { h, calls, holds, settled: () => new Promise(resolve => setImmediate(resolve)) };
}
test('Delete line deletes nothing when Premiere does not confirm the edits before it', async () => {
  const { h, calls } = deleteLineFixture(false);
  h.beginTextEdit(h.inspect().rows[1]);
  await h.deleteLine();
  assert.deepEqual(calls.map(call => call[0]), ['open', 'end', 'settle'], 'the typed text is committed by Premiere as before');
  assert.equal(h.changes.length, 0, 'no Delete line edit');
  assert.match(h.inspect().error, /nothing was deleted\. Try Delete line again/);
  assert.deepEqual(rowTexts(h), ['one two three', 'four five', 'one two three']);
  assert.equal(h.inspect().selectedLine.key, h.inspect().rows[1].key, 'the line stays selected');
});
test('typing in the next line right after Delete line waits for Premiere to confirm the deletion, then becomes its own typing steps', async () => {
  const { h, calls, holds, settled } = deleteLineFixture();
  await h.deleteLine();
  assert.deepEqual(h.labels, ['Delete line']);
  assert.deepEqual(calls, [['settle'], ['settle']], 'the deletion is written at once');
  const next = h.inspect().rows[1];
  h.beginTextEdit(next); h.setDraft('typed early');
  assert.equal(calls.some(call => call[0] === 'open'), false, 'no typing step can join the unconfirmed Delete line write');
  holds[0](true); await settled();
  assert.deepEqual(calls.slice(2), [['open', next.start, 'one two three'], ['input', 'typed early']], 'what was typed meanwhile becomes the first typing step');
  assert.equal(h.saveInlineText(h.inspect().rows.find(row => row.key === h.inspect().editingRowKey)), true);
  assert.deepEqual(calls.at(-1), ['end', 'commit'], 'closing merges the typing into Edit text');
  assert.deepEqual(h.labels, ['Delete line'], 'the panel publishes nothing else itself');
});
test('if Premiere cannot confirm Delete line, text typed in the next line is saved as a separate ordinary edit', async () => {
  const { h, calls, holds, settled } = deleteLineFixture();
  await h.deleteLine();
  h.beginTextEdit(h.inspect().rows[1]); h.setDraft('plain save');
  holds[0](false); await settled();
  assert.equal(calls.some(call => call[0] === 'open'), false);
  assert.equal(h.saveInlineText(h.inspect().rows[1]), true);
  assert.deepEqual(h.labels, ['Delete line', 'Edit transcript']);
  assert.deepEqual(rowTexts(h), ['one two three', 'plain save']);
});
test('Add line, Merge and another Delete line wait for Delete line to be confirmed', async () => {
  const { h, holds, settled } = deleteLineFixture();
  await h.deleteLine();
  h.choose(h.inspect().rows[0]);
  h.mergeNext();
  assert.deepEqual(h.labels, ['Delete line'], 'Merge waits');
  holds[0](true); await settled();
  assert.equal(h.changes.length, 2, 'merged after the confirmation, as an edit of its own');
  assert.deepEqual(rowTexts(h), ['one two three one two three']);
  const again = deleteLineFixture();
  await again.h.deleteLine();
  again.h.choose(again.h.inspect().rows[0]);
  const adding = again.h.addLine('after'), deleting = again.h.deleteLine();
  await again.settled();
  assert.equal(again.h.changes.length, 1, 'Add line and Delete line wait');
  again.holds[0](true); await adding;
  assert.deepEqual(again.h.labels, ['Delete line', 'Add line']);
  again.holds[1](true); await deleting;
  assert.deepEqual(again.h.labels, ['Delete line', 'Add line', 'Delete line']);
});
test('switching sequence or layer while earlier edits are confirmed deletes nothing', async () => {
  for (const change of [h => h.setSequenceId('other-sequence'), h => h.setNativeLayerKey('other-layer')]) {
    let h;
    const typing = { open() {}, input() {}, flush() {}, hint() {}, end: async () => {}, settle: async () => { change(h); return true; } };
    h = transcriptController(threeLines(), 24, { typing, nativeLayerKey: 'layer' });
    h.choose(h.inspect().rows[1]);
    await h.deleteLine();
    assert.equal(h.changes.length, 0); assert.equal(h.inspect().rows.length, 3);
  }
});
