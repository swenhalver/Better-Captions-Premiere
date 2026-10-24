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
const pickerUrl = new URL('../webview-ui/src/components/FontPicker.svelte', import.meta.url);
const picker = compile(readFileSync(pickerUrl, 'utf8'), { generate: 'server', filename: 'FontPicker.svelte' });
assert.deepEqual(picker.warnings, [], 'Compile the installed font picker without accessibility warnings');
const imports = base => (_match, quote, specifier) => `from ${quote}${specifier.endsWith('.svg?raw') ? 'data:text/javascript,'+encodeURIComponent('export default '+JSON.stringify(readFileSync(new URL(specifier.replace('?raw',''),base),'utf8'))) : specifier.endsWith('.svelte') ? specifier.replace(/\.svelte$/, '.mjs') : new URL(specifier.endsWith('.ts') ? specifier : `${specifier}.ts`, base).href}${quote}`;
writeFileSync(join(folder, 'FontPicker.mjs'), picker.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, imports(pickerUrl)));
const alignmentUrl=new URL('../webview-ui/src/components/AlignmentButtons.svelte',import.meta.url);
const alignment=compile(readFileSync(alignmentUrl,'utf8'),{generate:'server',filename:'AlignmentButtons.svelte'});
assert.deepEqual(alignment.warnings,[]);
writeFileSync(join(folder,'AlignmentButtons.mjs'),alignment.js.code);
const numberUrl = new URL('../webview-ui/src/components/ScrubbableNumber.svelte', import.meta.url);
const number = compile(readFileSync(numberUrl, 'utf8'), { generate: 'server', filename: 'ScrubbableNumber.svelte' });
assert.deepEqual(number.warnings, [], 'Compile the actual numeric control without accessibility warnings');
writeFileSync(join(folder, 'ScrubbableNumber.mjs'), number.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, imports(numberUrl)));
const hslaUrl = new URL('../webview-ui/src/components/HslaColorPicker.svelte', import.meta.url);
const hsla = compile(readFileSync(hslaUrl, 'utf8'), { generate: 'server', filename: 'HslaColorPicker.svelte' });
assert.deepEqual(hsla.warnings, [], 'Compile the actual HSLA control without accessibility warnings');
writeFileSync(join(folder, 'HslaColorPicker.mjs'), hsla.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, imports(hslaUrl)));
const iconUrl = new URL('../webview-ui/src/components/LucideIcon.svelte', import.meta.url);
const icon = compile(readFileSync(iconUrl, 'utf8'), { generate: 'server', filename: 'LucideIcon.svelte' });
assert.deepEqual(icon.warnings, []);
writeFileSync(join(folder, 'LucideIcon.mjs'), icon.js.code);
const backgroundUrl = new URL('../webview-ui/src/components/WordBackgroundPreview.svelte', import.meta.url);
const background = compile(readFileSync(backgroundUrl, 'utf8'), { generate: 'server', filename: 'WordBackgroundPreview.svelte' });
assert.deepEqual(background.warnings, []);
writeFileSync(join(folder, 'WordBackgroundPreview.mjs'), background.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, imports(backgroundUrl)));
const spacingUrl=new URL('../webview-ui/src/components/SpacingInspector.svelte',import.meta.url);
const spacing=compile(readFileSync(spacingUrl,'utf8'),{generate:'server',filename:'SpacingInspector.svelte'});
assert.deepEqual(spacing.warnings,[]);
writeFileSync(join(folder,'SpacingInspector.mjs'),spacing.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g,imports(spacingUrl)));
const code = compiled.js.code.replace(/from (["'])(\.\.?\/[^"']+)\1/g, imports(sourceUrl));
writeFileSync(join(folder, 'TextStyleToolbar.mjs'), code);
const { default: TextStyleToolbar, textStylePatch, textStyleAppearance, textStyleMixed,
  textStyleBoldState, textStyleBoldDisabled, textStyleBoldPatch, textStyleColorPatch, textStyleSizeStep, textStyleResetPatch } = await import(pathToFileURL(join(folder, 'TextStyleToolbar.mjs')));
const { default: awaitPicker } = await import(pathToFileURL(join(folder, 'HslaColorPicker.mjs')));
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

test('the rendered weight list contains only the selected font’s installed weights and B remains relative', () => {
  const style = fresh(); style.fontWeight = 500;
  const html = view({ style, fontCatalog: [{ family: 'Arial', weights: [400, 500, 700], italic: true }] });
  const select = html.match(/<select[^>]*aria-label="Font weight"[\s\S]*?<\/select>/)?.[0];
  const options = [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
  assert.deepEqual(options, ['400', '500', '700']);
  assert.doesNotMatch(select, /Regular|Bold|Mixed/);
  assert.match(html.match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /aria-pressed="false"/);
  assert.match(html, /Next supported weight above All words \(500\)/);
  const on = apply(style, textStyleBoldPatch(style, 'current'));
  assert.match(view({ style: on, scope: 'current' }).match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /aria-pressed="true"/);
  style.fontWeight = 1000;
  assert.match(view({ style }).match(/<button[^>]*aria-label="Bold"[^>]*>/)[0], /disabled/);
});

test('the installed font control is a searchable combobox and Italic stays enabled in native mode', () => {
  const html = view({ nativeMode: true, fontCatalog: [{ family: 'Arial', weights: [400, 700], italic: false }] });
  assert.match(html, /role="combobox"/); assert.match(html, /aria-autocomplete="list"/);
  assert.match(html, /aria-label="Show installed fonts"/); assert.doesNotMatch(html, /<datalist/);
  const italic = html.match(/<button[^>]*aria-label="Italic"[^>]*>/)[0];
  assert.doesNotMatch(italic, /disabled/); assert.match(italic, /synthetic slant/);
});

test('toolbar replaces detail tabs with exclusive shadow, spacing and layout popups',()=>{
 const html=view({nativeMode:true});
 assert.doesNotMatch(html,/role="tablist"|role="tab"|role="tabpanel"/);
 assert.match(html,/class="text-style__layout-controls[^"]*"[^>]*aria-label="Caption layout"/);
 assert.doesNotMatch(html,/aria-label="Layout controls"/);
 for(const label of ['Shadow settings','Padding and margin','Outline settings'])assert.match(html,new RegExp(`<button[^>]*aria-label="${label}"[^>]*aria-expanded="false"`));
 const source=readFileSync(sourceUrl,'utf8');
 assert.match(source,/{@render nativeLayout\?\.\(\)}/);
 assert.match(source,/Word spacing, px/);
 for(const field of ['shadowBlur','shadowOffsetX','shadowOffsetY','shadowOpacity'])assert.match(source,new RegExp(field));
});

test('left center and right alignment icons live in normal All words controls only',()=>{
 const html=view({style:{...fresh(),textAlign:'right'}});
 for(const name of ['Align left','Align center','Align right'])assert.match(html,new RegExp(`aria-label="${name}"`));
 assert.match(html,/<button[^>]*aria-label="Align right"[^>]*aria-pressed="true"/);
 assert.doesNotMatch(html,/<select[^>]*value="right"/);
 for(const scope of ['spoken','current','upcoming'])assert.doesNotMatch(view({scope}),/aria-label="Align (?:left|center|right)"/);
});

test('ribbon uses complete case option names while its closed trigger stays compact', () => {
  const html = view({});
  const select = html.match(/<select[^>]*aria-label="Text case"[\s\S]*?<\/select>/)?.[0];
  for (const label of ['As typed','UPPERCASE','lowercase','Title Case']) assert.ok(select.includes(label));
  assert.match(html, /aria-hidden="true">Aa/);
  assert.doesNotMatch(html, /type="color"/,'Foreground and word-background colors open the inline HSLA picker');
  assert.match(html, /aria-label="Line height"[^>]*aria-valuenow="1.3"/);
});

test('the color picker exposes a color field, hue strip, hex and separate alpha beneath it', () => {
  const HslaColorPicker = awaitPicker;
  const html = render(HslaColorPicker, {props:{value:'#993fa0',opacity:.6,label:'Word background',onChange(){}}}).body;
  for (const channel of ['saturation and brightness','hue','opacity','hex']) assert.match(html,new RegExp(`aria-label="Word background ${channel}"`));
  assert.equal((html.match(/type="range"/g)||[]).length,2);
  assert.doesNotMatch(html,/type="color"/);
  assert.match(html, /aria-label="Word background opacity, %" aria-valuenow="60"/);
});


test('alpha-only All words edits preserve every different word-state color', () => {
  for (const [kind,colorKey,opacityKey] of [['text','color','opacity'],['bubble','bubbleColor','bubbleOpacity'],['stroke','strokeColor','strokeOpacity'],['shadow','shadowColor','shadowOpacity']]) {
    const style=fresh();
    for (const [index,key] of ['spokenWord','activeWord','upcomingWord'].entries()) style[key]={...style[key],[colorKey]:['#ff0000','#00ff00','#0000ff'][index],[opacityKey]:[.2,.5,.8][index]};
    const shown=textStyleAppearance(style,'all');
    const patch=textStyleColorPatch(shown,kind,{color:shown[colorKey],opacity:.6});
    assert.equal(Object.hasOwn(patch,colorKey),false);
    const next=apply(style,textStylePatch(style,'all',patch));
    for (const key of ['spokenWord','activeWord','upcomingWord']) {
      assert.equal(next[key][colorKey],style[key][colorKey]);
      assert.equal(next[key][opacityKey],.6);
      if(kind==='bubble') assert.equal(next[key].bubble,style[key].bubble,'Opacity does not enable unrelated word backgrounds');
    }
  }
});

test('color-only All words edits preserve every different word-state opacity', () => {
  for (const [kind,colorKey,opacityKey] of [['text','color','opacity'],['bubble','bubbleColor','bubbleOpacity'],['stroke','strokeColor','strokeOpacity'],['shadow','shadowColor','shadowOpacity']]) {
    const style=fresh();
    for (const [index,key] of ['spokenWord','activeWord','upcomingWord'].entries()) style[key]={...style[key],[opacityKey]:[.2,.5,.8][index]};
    const shown=textStyleAppearance(style,'all');
    const patch=textStyleColorPatch(shown,kind,{color:'#983fab',opacity:shown[opacityKey]});
    assert.equal(Object.hasOwn(patch,opacityKey),false);
    const next=apply(style,textStylePatch(style,'all',patch));
    for (const key of ['spokenWord','activeWord','upcomingWord']) {
      assert.equal(next[key][colorKey],'#983fab');
      assert.equal(next[key][opacityKey],style[key][opacityKey]);
    }
  }
});

test('the normal ribbon retains the outline popup without an Outline tab', () => {
  const html=view({nativeMode:true});
  assert.match(html,/<button[^>]*aria-label="Outline settings"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(html,/role="tab"/);
});


test('font size arrows change exactly one pixel within the correct scope bounds', () => {
  const style=fresh();style.fontSize=60;style.activeWord={...style.activeWord,fontSize:90,sizeScale:1.5};
  const next=apply(style,textStyleSizeStep(style,'current',1));
  assert.equal(resolveAppearance(next,'activeWord').fontSize,91);
  assert.equal(next.fontSize,60);
  assert.deepEqual(next.spokenWord,style.spokenWord);
  assert.deepEqual(next.upcomingWord,style.upcomingWord);
  assert.equal(next.activeWord.color,style.activeWord.color);
  const base=apply(style,textStyleSizeStep(style,'all',-1));
  assert.equal(base.fontSize,59);
  assert.equal(base.activeWord.fontSize,90*59/60,'Base size keeps the saved proportional override');
  const low={...fresh(),fontSize:8},high={...fresh(),fontSize:400};
  assert.equal(textStyleSizeStep(low,'all',-1).fontSize,8);
  assert.equal(textStyleSizeStep(high,'all',1).fontSize,400);
  const current={...fresh(),activeWord:{...fresh().activeWord,fontSize:1200}};
  assert.equal(resolveAppearance(apply(current,textStyleSizeStep(current,'current',1)),'activeWord').fontSize,1200);
});

test('font size buttons surround the number without a visible px suffix and alignment comes last',()=>{
  const html=view({style:{...fresh(),fontSize:8}});
  assert.match(html,/<button[^>]*aria-label="Decrease font size"[^>]*disabled/);
  assert.match(html,/<button[^>]*aria-label="Increase font size"/);
  assert.ok(html.indexOf('aria-label="Decrease font size"')<html.indexOf('aria-label="Base font size, px"'));
  assert.ok(html.indexOf('aria-label="Increase font size"')>html.indexOf('aria-label="Base font size, px"'));
  assert.doesNotMatch(html,/aria-hidden="true">px<\/span>/);
  assert.match(html,/class="text-style__size-icon[^"]*" aria-hidden="true"/);
  const narrow=readFileSync(sourceUrl,'utf8').split('@container text-style (max-width: 47.99rem) {')[1]?.split('\n  }')[0]??'';
  assert.match(narrow,/\.text-style__size-step \{display:none;\}/);
  assert.match(narrow,/\.text-style__size-icon \{display:block;\}/);
  assert.ok(html.indexOf('aria-label="Align left"')>html.indexOf('aria-label="Line height"'));
  assert.ok(html.indexOf('aria-label="Align left"')>html.indexOf('aria-label="Padding and margin"'));
});

test('a separate padding-axis edit keeps legacy uniform padding and the other axis intact',()=>{
  const style=fresh();
  style.activeWord={...style.activeWord,padding:12,bubblePaddingBlock:4,color:'#9a23bc'};
  const before=structuredClone(style);
  const next=apply(style,textStylePatch(style,'current',{bubblePaddingInline:27}));
  assert.equal(next.activeWord.padding,12);
  assert.equal(next.activeWord.bubblePaddingInline,27);
  assert.equal(next.activeWord.bubblePaddingBlock,4);
  assert.equal(next.activeWord.color,'#9a23bc');
  assert.deepEqual(next.spokenWord,before.spokenWord);
  assert.deepEqual(next.upcomingWord,before.upcomingWord);
  assert.deepEqual(style,before);
});

test('All words axis changes preserve each state’s other axis and saved uniform fallback',()=>{
  const style=fresh();
  const keys=['spokenWord','activeWord','upcomingWord'];
  for(const [index,key] of keys.entries()) style[key]={...style[key],padding:index+6,bubblePaddingInline:index+10};
  const next=apply(style,textStylePatch(style,'all',{bubblePaddingBlock:3}));
  for(const key of keys){
    assert.equal(next[key].bubblePaddingBlock,3);
    assert.equal(next[key].bubblePaddingInline,style[key].bubblePaddingInline);
    assert.equal(next[key].padding,style[key].padding);
    assert.equal(next[key].color,style[key].color);
  }
});


test('Underline toggles one word scope without changing color, font or neighbors',()=>{
  const style=fresh();style.spokenWord={...style.spokenWord,underline:true};
  const before=structuredClone(style);
  const next=apply(style,textStylePatch(style,'current',{underline:true}));
  assert.equal(textStyleAppearance(next,'current').underline,true);
  assert.deepEqual(next.spokenWord,before.spokenWord);
  assert.deepEqual(next.upcomingWord,before.upcomingWord);
  assert.equal(next.activeWord.color,before.activeWord.color);
  assert.equal(next.activeWord.fontWeight,before.activeWord.fontWeight);
  assert.deepEqual(style,before);
});

test('Underline is mixed when scopes differ and All words changes only that decoration',()=>{
  const style=fresh();style.activeWord={...style.activeWord,underline:true};
  assert.equal(textStyleMixed(style,'all','underline'),true);
  const html=view({style});
  assert.match(html,/<button[^>]*aria-label="Underline"[^>]*aria-pressed="mixed"/);
  const next=apply(style,textStylePatch(style,'all',{underline:false}));
  for(const key of ['spokenWord','activeWord','upcomingWord']){
    assert.equal(next[key].underline,false);
    assert.equal(next[key].color,style[key]?.color);
    assert.equal(next[key].fontWeight,style[key]?.fontWeight);
  }
});


test('Outline icon previews the selected word text fill and outline stroke with independent alpha',()=>{
  const style=fresh();style.activeWord={...style.activeWord,color:'#a1b2c3',opacity:.4,strokeEnabled:true,strokeWidth:4,strokeColor:'#456789',strokeOpacity:.6};
  const before=structuredClone(style);
  const html=view({style,scope:'current'});
  const trigger=html.match(/<button[^>]*aria-label="Outline settings"[\s\S]*?<\/button>/)?.[0];
  assert.match(trigger,/<svg[^>]*fill="#a1b2c3"[^>]*stroke="#456789"[^>]*fill-opacity="0.4"[^>]*stroke-opacity="0.6"[^>]*stroke-width="2"/);
  assert.deepEqual(style,before);
});

test('Outline icon uses a neutral inherited preview for mixed word colors',()=>{
  const style=fresh();style.activeWord={...style.activeWord,color:'#a1b2c3',strokeColor:'#456789'};
  const html=view({style,scope:'all'});
  const trigger=html.match(/<button[^>]*aria-label="Outline settings"[\s\S]*?<\/button>/)?.[0];
  assert.match(trigger,/<svg[^>]*fill="none"[^>]*stroke="currentColor"/);
});


const backgroundTrigger=html=>html.match(/<button[^>]*aria-label="Word background and bubble settings"[\s\S]*?<\/button>/)?.[0];
test('word background preview uses exact selected color and alpha with the effective outlined text style',()=>{
  const style=fresh();style.activeWord={...style.activeWord,bubble:true,bubbleColor:'#5a35bc',bubbleOpacity:.27,color:'#a1b2c3',opacity:.4,strokeEnabled:true,strokeWidth:4,strokeColor:'#456789',strokeOpacity:.6};
  const before=structuredClone(style);
  const html=backgroundTrigger(view({style,scope:'current'}));
  assert.match(html,/word-background-preview--enabled/);
  assert.match(html,/background-color:\s*#5a35bc/);
  assert.match(html,/opacity:\s*0.27/);
  assert.match(html,/<svg[^>]*fill="#a1b2c3"[^>]*stroke="#456789"[^>]*fill-opacity="0.4"[^>]*stroke-opacity="0.6"/);
  assert.deepEqual(style,before);
  style.activeWord.strokeWidth=0;
  const plain=backgroundTrigger(view({style,scope:'current'}));
  assert.match(plain,/<svg[^>]*fill="none"[^>]*stroke="#a1b2c3"/,'A zero-width outline uses Lucide Type');
});

test('unchecked word background shows supplied Type Off on a neutral base without its saved color or checker',()=>{
  const style=fresh();style.activeWord={...style.activeWord,bubble:false,bubbleColor:'#5a35bc',color:'#a1b2c3',opacity:.4,strokeEnabled:false};
  const html=backgroundTrigger(view({style,scope:'current'}));
  assert.doesNotMatch(html,/background-color:\s*#5a35bc/);
  assert.match(html,/<path[^>]*d="M2,2L22,22"[^>]*stroke="var\(--color-error,#ffb4a9\)"[^>]*stroke-opacity="1"/);
  assert.doesNotMatch(html,/word-background-preview--enabled/);
  assert.match(html,/<svg[^>]*stroke="currentColor"[^>]*stroke-opacity="1"/);
});


test('inactive or invisible outlines use an unfilled neutral outline-control icon',()=>{
  for(const inactive of [{strokeEnabled:false,strokeWidth:4,strokeOpacity:1},{strokeEnabled:true,strokeWidth:0,strokeOpacity:1},{strokeEnabled:true,strokeWidth:4,strokeOpacity:0}]){
    const style=fresh();style.activeWord={...style.activeWord,color:'#a1b2c3',opacity:.4,strokeColor:'#456789',...inactive};
    const html=view({style,scope:'current'});
    const trigger=html.match(/<button[^>]*aria-label="Outline settings"[\s\S]*?<\/button>/)?.[0];
    assert.match(trigger,/<svg[^>]*fill="none"[^>]*stroke="currentColor"[^>]*fill-opacity="1"[^>]*stroke-opacity="1"/);
  }
});


test('scoped font-size reset follows current All words 20, not stale factory or scoped values',()=>{
  const style=fresh();style.fontSize=20;style.activeWord={...style.activeWord,fontSize:90,color:'#1a2b3c'};
  const before=structuredClone(style);
  assert.notEqual(DEFAULT_STYLE.fontSize,20);
  const next=apply(style,textStyleResetPatch(style,'current',['fontSize']));
  assert.equal(next.fontSize,20);
  assert.equal(textStyleAppearance(next,'current').fontSize,20);
  assert.equal(next.activeWord.sizeScale,1);
  assert.equal(next.activeWord.color,'#1a2b3c');
  assert.deepEqual(next.spokenWord,before.spokenWord);
  assert.deepEqual(next.upcomingWord,before.upcomingWord);
  const later=apply(next,textStylePatch(next,'all',{fontSize:32}));
  assert.equal(textStyleAppearance(later,'current').fontSize,32,'The reset state continues following later All words size changes');
  assert.deepEqual(style,before);
});

test('scoped spacing and alpha resets copy current All values without flattening unrelated fields',()=>{
  let style=fresh();
  style=apply(style,textStylePatch(style,'all',{paddingTop:17,shadowOpacity:.8}));
  style.activeWord={...style.activeWord,paddingTop:3,paddingRight:29,marginLeft:7,shadowOpacity:.2,shadowColor:'#123456'};
  const next=apply(style,textStyleResetPatch(style,'current',['paddingTop','shadowOpacity']));
  assert.equal(next.activeWord.paddingTop,17);
  assert.equal(next.activeWord.shadowOpacity,.8);
  assert.equal(next.activeWord.paddingRight,29);
  assert.equal(next.activeWord.marginLeft,7);
  assert.equal(next.activeWord.shadowColor,'#123456');
  assert.deepEqual(next.spokenWord,style.spokenWord);
  assert.deepEqual(next.upcomingWord,style.upcomingWord);
});

test('All words reset uses known factory values only for the requested fields',()=>{
  let style=fresh();style.fontSize=20;
  style=apply(style,textStylePatch(style,'all',{paddingTop:37,strokeWidth:9}));
  const next=apply(style,textStyleResetPatch(style,'all',['paddingTop','strokeWidth']));
  assert.equal(next.fontSize,20);
  assert.equal(next.strokeWidth,DEFAULT_STYLE.strokeWidth);
  for(const key of ['spokenWord','activeWord','upcomingWord']){
    assert.equal(next[key].paddingTop,resolveAppearance(DEFAULT_STYLE,key).paddingTop);
    assert.equal(next[key].strokeWidth,resolveAppearance(DEFAULT_STYLE,key).strokeWidth);
    assert.equal(next[key].color,style[key].color);
  }
});
