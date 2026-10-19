import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import * as timing from '../webview-ui/src/lib/transcript/timing.ts';
import * as edit from '../webview-ui/src/lib/transcript/edit.ts';
import * as parser from '../webview-ui/src/lib/transcript/parser.ts';
import * as segments from '../webview-ui/src/lib/transcript/segments.ts';
import * as types from '../webview-ui/src/lib/types.ts';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { compile } = require('svelte/compiler'), ts = require('typescript');
const urls = Object.fromEntries(['WordTimeline', 'TranscriptPreview'].map(name => [name, new URL(`../webview-ui/src/components/${name}.svelte`, import.meta.url)]));
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
    const target = specifier.endsWith('.svelte') ? './WordTimeline.mjs' : new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, urls[name]).href;
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
      if (specifier === 'svelte') return { tick: async () => {}, onDestroy: callback => destructors.push(callback) };
      if (specifier.endsWith('/transcript/timing')) return timing;
      if (specifier.endsWith('/transcript/edit')) return edit;
      if (specifier.endsWith('/transcript/parser')) return parser;
      if (specifier.endsWith('/transcript/segments')) return segments;
      if (specifier.endsWith('/types')) return types;
      return {};
    },
  }, { filename: `${name}.svelte` });
  for (const effect of effects) effect();
  return { ...output, runEffect: index => effects[index](), destroyComponent: () => { for (const destructor of destructors) destructor(); } };
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
  const changes = [], selections = [], seeks = [];
  h = controller('TranscriptPreview', { ...transcriptProps(captions), ...options, frameRate: fps,
    onUpdate: value => { changes.push(clone(value)); h.setCaptions(value); }, onSelect: value => selections.push(value), onSeek: value => seeks.push(value) }, `
    export { beginTextEdit, saveInlineText, cancelTextEdit, textKeydown, textCaretOffset, focusTextEditor, beginTimingEdit, inputCaptionTime, saveInlineTiming, cancelTimingEdit, timingBlur, timingKeydown, timingRange, updateCaption, splitCaption, mergeNext, choose, undo };
    export function setCaptions(value) { captions = value; }
    export function setDraft(value) { draftText = value; }
    export function inspect() { return { rows: sentenceRows, captions, editingRowKey, editingError, editingCaret, timingRowKey, timingError, draftStart, draftEnd, canUndo, selectedWordOffset, error }; }
  `);
  return { ...h, changes, selections, seeks };
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
  assert.equal((html.match(/aria-label="Selected sentence word timing"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Edit caption 1 text"/);
  assert.match(html, /aria-label="Edit caption 1 start time"/);
  assert.match(html, /aria-label="Edit caption 1 end time"/);
  assert.doesNotMatch(html, /Show in Premiere|Edit caption text|Save text|Save caption timing|<summary>Caption timing|<summary>Split &amp; merge|<summary>Split & merge|Split clip before word|word-timing__phrase|Drag edges or use arrows|Word timing playhead|type="range"|>−1f<|>\+1f<|>Set</);
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

test('edge keyboard edits target an unselected word and pointer cancellation creates no Undo point', () => {
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

test('inline text commits once, preserves timed native links and remains undoable', () => {
  const h = transcriptController(), row = h.inspect().rows[0], original = clone(row.caption);
  h.beginTextEdit(row); h.setDraft('One TWO three');
  assert.equal(h.saveInlineText(row), true);
  assert.equal(h.saveInlineText(row), true, 'The blur following Enter cannot commit twice');
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0][0].text, 'One TWO three');
  assert.deepEqual(h.changes[0][0].words.map(word => [word.startTime, word.endTime]), original.words.map(word => [word.startTime, word.endTime]));
  assert.equal(h.changes[0][0].clipNodeId, original.clipNodeId); assert.deepEqual(h.changes[0][0].position, original.position);
  h.undo(); assert.equal(h.changes.length, 2); assert.deepEqual(h.changes[1][0], original);
});

test('inline text Escape cancels, blank drafts cannot save, and stale reads cannot overwrite newer timing', () => {
  const h = transcriptController(), row = h.inspect().rows[0];
  h.beginTextEdit(row); h.setDraft('unsaved words'); h.textKeydown(keyEvent('Escape'), row);
  assert.equal(h.changes.length, 0); assert.equal(h.inspect().editingRowKey, null);
  h.beginTextEdit(row); h.setDraft('   ');
  assert.equal(h.saveInlineText(row), false); assert.equal(h.changes.length, 0);
  assert.match(h.inspect().editingError, /cannot be empty/); assert.equal(h.inspect().editingRowKey, row.key);
  h.cancelTextEdit(); h.beginTextEdit(row); h.setDraft('new words here');
  const newer = clone(row.caption); newer.words[0].endTime -= 1 / 24; h.setCaptions([newer]);
  assert.equal(h.saveInlineText(row), false); assert.equal(h.changes.length, 0);
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

test('word timing still enters the transcript Undo path as one completed edit', () => {
  const transcript = transcriptController(), original = clone(transcript.inspect().captions[0]);
  const words = wordController(original);
  words.inputTime('startTime', numericEvent(31 / 24));
  transcript.updateCaption(words.changes[0], 'Word timing saved.');
  assert.equal(transcript.changes.length, 1); assert.equal(transcript.changes[0][0].words[1].startTime, 31 / 24);
  transcript.undo(); assert.deepEqual(transcript.changes[1][0], original);
});

test('inline timestamp Enter and Escape stay separate from text drafts, and overlap is rejected', () => {
  const first = cue(), second = { ...cue(), id: 'second', startTime: 4, endTime: 7.75,
    words: cue().words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 })) };
  const h = transcriptController([first, second]), row = h.inspect().rows[0];
  h.beginTimingEdit(row, 'endTime'); h.inputCaptionTime('endTime', numericEvent(5));
  assert.equal(h.saveInlineTiming(row), false); assert.equal(h.changes.length, 0); assert.match(h.inspect().timingError, /overlaps/);
  h.timingKeydown(keyEvent('Escape'), row); assert.equal(h.inspect().timingRowKey, null);
  h.beginTimingEdit(row, 'endTime'); h.inputCaptionTime('endTime', numericEvent(first.endTime - 1 / 24));
  h.timingKeydown(keyEvent('Enter'), row); h.saveInlineTiming(row);
  assert.equal(h.changes.length, 1); assert.equal(h.changes[0][0].endTime, first.endTime - 1 / 24);
  h.undo(); assert.deepEqual(h.changes[1][0], first);
});

test('a blank caption timestamp remains an invalid draft and cannot erase saved timing', () => {
  const h = transcriptController(), row = h.inspect().rows[0];
  h.beginTimingEdit(row, 'startTime'); h.inputCaptionTime('startTime', numericEvent(NaN));
  assert.equal(h.saveInlineTiming(row), false); assert.equal(h.changes.length, 0);
  assert.match(h.inspect().timingError, /valid start and end/); assert.equal(h.inspect().timingRowKey, row.key);
  h.cancelTimingEdit(); h.beginTimingEdit(row, 'startTime');
  assert.equal(h.saveInlineTiming(row), true); assert.equal(h.changes.length, 0);
});

test('real SSR integrates compact Split and Merge actions with first-word and native-link guards', () => {
  const caption = unlinked(cue()), props = transcriptProps([caption]);
  const button = (html, label) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))[0];
  const first = render(TranscriptPreview, { props: { ...props, selectedWord: 0 } }).body;
  assert.match(button(first, 'Split clip before selected word'), /disabled/);
  const interior = render(TranscriptPreview, { props: { ...props, selectedWord: 1 } }).body;
  assert.doesNotMatch(button(interior, 'Split clip before selected word'), /disabled/);
  assert.match(interior, /title="Split clip before “two”"/);
  assert.match(button(interior, 'Merge with next caption'), /disabled/);
  assert.doesNotMatch(interior, /Split &amp; merge|Split & merge|Split clip before word/);
  const linked = render(TranscriptPreview, { props: { ...transcriptProps(), selectedWord: 1 } }).body;
  assert.match(button(linked, 'Split clip before selected word'), /disabled/);
  assert.match(linked, /Razor tool/);
  const next = unlinked(cue()); next.id = 'next'; next.startTime = 4; next.endTime = 7.75; next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  assert.doesNotMatch(button(render(TranscriptPreview, { props: transcriptProps([caption, next]) }).body, 'Merge with next caption'), /disabled/);
  next.clipNodeId = 'applied-next';
  assert.match(button(render(TranscriptPreview, { props: transcriptProps([caption, next]) }).body, 'Merge with next caption'), /disabled/);
});

test('the lane splits before its selected word using the sentence offset, with one Undo point', () => {
  const caption = unlinked(cue()); caption.words = ['one', 'two', 'three', 'four', 'five', 'six'].map((text, i) => ({ text, startTime: i * 30 / 24, endTime: (i + 1) * 30 / 24 }));
  caption.text = caption.words.map(word => word.text).join(' '); caption.endTime = 180 / 24; caption.captionBundle = true;
  caption.renderSegments = [0, 3].map(start => ({ id: `segment-${start}`, text: caption.words.slice(start, start + 3).map(word => word.text).join(' '), words: caption.words.slice(start, start + 3), startTime: caption.words[start].startTime, endTime: caption.words[start + 2].endTime }));
  const transcript = transcriptController([caption]), row = transcript.inspect().rows[1];
  transcript.choose(row);
  assert.equal(transcript.inspect().selectedWordOffset, 3);
  const lane = wordController({ ...caption, ...row.segment }, 24, 1, { wordOffset: transcript.inspect().selectedWordOffset, onSplitBefore: transcript.splitCaption });
  lane.splitSelected();
  assert.equal(transcript.changes.length, 1);
  const [left, right] = transcript.changes[0];
  assert.deepEqual(left.words.map(word => word.text), ['one', 'two', 'three', 'four']);
  assert.deepEqual(right.words.map(word => word.text), ['five', 'six']);
  assert.equal(left.id, caption.id); assert.notEqual(right.id, caption.id);
  assert.equal(left.manualSplit, true); assert.equal(right.manualSplit, true);
  assert.equal(left.endTime, right.startTime); assert.deepEqual(right.position, caption.position);
  assert.equal(transcript.selections.at(-1), right.id, 'The selected word stays in the newly split right clip');
  edit.validateCaptions(transcript.changes[0]);
  transcript.undo(); assert.deepEqual(transcript.changes[1], [caption]);
});

test('compact actions refuse protected or disabled changes even when called directly', () => {
  let splits = 0, merges = 0;
  const first = wordController(cue(), 24, 0, { onSplitBefore: () => splits++ });
  first.splitSelected(); assert.equal(splits, 0);
  const protectedLane = wordController(cue(), 24, 1, { splitDisabled: true, onSplitBefore: () => splits++, mergeDisabled: true, onMergeNext: () => merges++ });
  protectedLane.splitSelected(); protectedLane.mergeSelected(); assert.equal(splits, 0); assert.equal(merges, 0);
  const protectedTranscript = transcriptController();
  protectedTranscript.splitCaption(1); assert.equal(protectedTranscript.changes.length, 0); assert.match(protectedTranscript.inspect().error, /keyframes stay/);
  const disabled = transcriptController([unlinked(cue())], 24, { disabled: true });
  disabled.splitCaption(1); disabled.mergeNext(); assert.equal(disabled.changes.length, 0);
  const invalid = transcriptController([unlinked(cue())]);
  invalid.splitCaption(0); assert.equal(invalid.changes.length, 0); assert.match(invalid.inspect().error, /interior word/);
});

test('compact Merge retains its existing native-link protection and Undo behavior', () => {
  const first = cue(), next = unlinked(cue()); next.id = 'next'; next.startTime = 4; next.endTime = 7.75;
  next.words = next.words.map(word => ({ ...word, startTime: word.startTime + 4, endTime: word.endTime + 4 }));
  const transcript = transcriptController([first, next]);
  const lane = wordController(first, 24, 1, { onMergeNext: transcript.mergeNext });
  lane.mergeSelected(); assert.equal(transcript.changes.length, 1); assert.equal(transcript.changes[0].length, 1);
  assert.equal(transcript.changes[0][0].clipNodeId, first.clipNodeId); assert.equal(transcript.changes[0][0].endTime, next.endTime);
  transcript.undo(); assert.deepEqual(transcript.changes[1], [first, next]);
  next.clipNodeId = 'protected-next';
  const protectedTranscript = transcriptController([first, next]);
  protectedTranscript.mergeNext(); assert.equal(protectedTranscript.changes.length, 0); assert.match(protectedTranscript.inspect().error, /already linked/);
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

test('native smart line fit remains an accessible option and retains the fixed limit while enabled',()=>{
 const props={...transcriptProps(),smartLineFit:true,onSmartLineFitChange(){}};
 const html=render(TranscriptPreview,{props}).body;
 assert.match(html,/Smart line fit/);assert.match(html,/<input[^>]*type="checkbox"[^>]*checked/);
 assert.match(html,/<input[^>]*type="number"[^>]*value="50"[^>]*disabled/);
 assert.match(html,/5% safety margin/);
 const fixed=render(TranscriptPreview,{props:{...props,smartLineFit:false}}).body;
 assert.match(fixed,/50 characters/);assert.doesNotMatch(fixed,/<input[^>]*type="number"[^>]*value="50"[^>]*disabled/);
});


test('pending inline drafts keep native reconnect paused until saved or cancelled, even after invalid blur', () => {
  const states = [], h = transcriptController(undefined,24,{onEditingChange:value=>states.push(value)});
  const row = h.inspect().rows[0];
  h.beginTextEdit(row);
  h.runEffect(0);
  assert.equal(states.at(-1),true);
  h.setDraft('');
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
