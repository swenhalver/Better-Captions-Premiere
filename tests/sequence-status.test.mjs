import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../webview-ui/package.json', import.meta.url));
const { compile } = require('svelte/compiler');
const compiled = compile(readFileSync(new URL('../webview-ui/src/components/SequenceStatus.svelte', import.meta.url), 'utf8'), {
  generate: 'server', filename: 'SequenceStatus.svelte',
});
assert.deepEqual(compiled.warnings, [], 'The real component compiles without accessibility warnings');
const folder = mkdtempSync(join(tmpdir(), 'better-captions-sequence-status-'));
after(() => rmSync(folder, { recursive: true, force: true }));
symlinkSync(fileURLToPath(new URL('../webview-ui/node_modules', import.meta.url)), join(folder, 'node_modules'), 'dir');
writeFileSync(join(folder, 'SequenceStatus.mjs'), compiled.js.code.replace("'../lib/transcript/parser'",JSON.stringify(new URL('../webview-ui/src/lib/transcript/parser.ts',import.meta.url).href)).replace("'../lib/native-effect/pause-lines'",JSON.stringify(new URL('../webview-ui/src/lib/native-effect/pause-lines.ts',import.meta.url).href)));
const { default: SequenceStatus } = await import(pathToFileURL(join(folder, 'SequenceStatus.mjs')));
const { render } = await import(pathToFileURL(require.resolve('svelte/server')));
const session = patch => ({ sequenceId: 'sequence', sequenceName: 'A long sequence name for editing',
  frameWidth: 720, frameHeight: 1280, frameRate: 24, captions: [], hasTranscript: false, isLoading: false, ...patch });
const view = props => render(SequenceStatus, { props: { session: session(), onRefresh() {}, onTranscribe() {}, ...props } }).body;
const transcribeButton = html => html.match(/<button\b([^>]*)>Transcribe in Premiere<\/button>/)?.[1];

test('first transcription keeps the primary action and sequence information visible', () => {
  const html = view({});
  assert.match(html, /720 × 1280 · 24 fps/);
  assert.match(transcribeButton(html), /caption-button--primary/);
  assert.doesNotMatch(transcribeButton(html), /disabled/);
  assert.match(html, /No transcript/);
});

test('a ready transcript leaves one compact sequence row and hides the setup controls', () => {
  const html = view({ session: session({ hasTranscript: true, captions: [{ id: 'one' }] }) });
  assert.match(html, /sequence-status--ready/);
  assert.match(html, /title="A long sequence name for editing"/);
  assert.match(html, /1 line</);
  assert.match(html, /aria-label="Sequence actions" aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(html, /<h1|sequence-status__detail|720 ×|Transcribe in Premiere/);
  assert.doesNotMatch(html, /role="menu"/, 'Secondary actions start closed');
});

test('existing captions collapse setup even when a persisted transcript flag is absent', () => {
  const html = view({ session: session({ captions: [{ id: 'one' }, { id: 'two' }] }) });
  assert.match(html, /2 lines</);
  assert.doesNotMatch(html, /Transcribe in Premiere|sequence-status__detail/);
});

test('unavailable transcription stays disabled before setup', () => {
  for (const props of [{ session: null }, { isDemo: true }, { isBusy: true }]) {
    assert.match(transcribeButton(view(props)), /disabled/);
  }
});

test('transcription progress stays visible before and after a transcript already exists', () => {
  const initial = view({ session: session({ isLoading: true }), isBusy: true });
  assert.match(initial, /Transcribing…/);
  assert.match(initial, /Reading timed words…/);
  const repeated = view({ session: session({ hasTranscript: true, captions: [{ id: 'one' }], isLoading: true }), isBusy: true });
  assert.match(repeated, /Transcribing…/);
  assert.doesNotMatch(repeated, /<h1|720 ×|Transcribe in Premiere/);
});

test('compact mode preserves save feedback and synthetic-demo disclosure', () => {
  const ready = session({ hasTranscript: true, captions: [{ id: 'one' }] });
  assert.match(view({ session: ready, saveStatus: 'Saving changes…' }), /Saving…/);
  assert.match(view({ session: ready, saveStatus: 'Save failed' }), /Save failed/);
  assert.match(view({ session: ready, isDemo: true }), /Browser demo · Synthetic captions\. Native actions require Premiere\./);
});


test('header counts rendered lines across storage containers',()=>{
 const state=session();state.captions=[{id:'one',words:[],renderSegments:[{id:'line1'},{id:'line2'}]},{id:'two',words:[],renderSegments:[{id:'line2'},{id:'line3'}]}];
 assert.match(view({session:state}),/>3 lines</);
});


test('sequence count includes derived pause lines and saved deletions',()=>{
 const state=session({captions:[{id:'one',text:'Before.',startTime:0,endTime:1,words:[{text:'Before.',startTime:0,endTime:1}]},{id:'two',text:'After.',startTime:5,endTime:6,words:[{text:'After.',startTime:5,endTime:6}]}]});
 assert.match(view({session:state,pauseSettings:{blankLineSeconds:1,visibleLines:3}}),/>5 lines</);
 state.captions[1].words[0].pauseLinesRemoved=2;
 assert.match(view({session:state,pauseSettings:{blankLineSeconds:1,visibleLines:3}}),/>3 lines</);
});

test('a connected native layer with every line deleted stays a compact connected row, not a fresh transcription', () => {
  const html = view({ session: session({ nativeClipId: 'native-layer' }) });
  assert.match(html, /sequence-status--ready/);
  assert.match(html, /0 lines</);
  assert.doesNotMatch(html, /Transcribe in Premiere|No transcript/);
});
