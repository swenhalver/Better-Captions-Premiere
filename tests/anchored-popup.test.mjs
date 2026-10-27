import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { popupPlacement, trackAnchoredPopup } from '../webview-ui/src/lib/anchored-popup.ts';

const rect = (left = 100, top = 200, width = 35, height = 35) => ({ left, top, width, height, right: left + width, bottom: top + height });
class TrackedTarget extends EventTarget {
  listeners = new Set();
  addEventListener(type, listener, options) { super.addEventListener(type, listener, options); this.listeners.add(`${type}:${!!(typeof options === 'boolean' ? options : options?.capture)}`); }
  removeEventListener(type, listener, options) { super.removeEventListener(type, listener, options); this.listeners.delete(`${type}:${!!(typeof options === 'boolean' ? options : options?.capture)}`); }
}
function fixture() {
  const observers = [], frames = new Map(); let nextFrame = 0;
  const view = new TrackedTarget(), doc = new TrackedTarget();
  Object.assign(view, {
    innerWidth: 800, innerHeight: 700, visualViewport: new TrackedTarget(),
    getComputedStyle: element => element.computed ?? { overflowX: 'visible', overflowY: 'visible' },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class { elements = []; disconnected = false; constructor(callback) { this.callback = callback; observers.push(this); } observe(element) { this.elements.push(element); } disconnect() { this.disconnected = true; } },
  });
  doc.defaultView = view;
  const element = (bounds, parentElement = null, computed) => Object.assign(new TrackedTarget(), { bounds, parentElement, ownerDocument: doc, computed, isConnected: true, style: {}, getBoundingClientRect() { return this.bounds; } });
  const root = element(rect(0, 0, 800, 700)), panel = element(rect(10, 50, 700, 600), root, { overflowX: 'hidden', overflowY: 'auto' });
  const anchor = element(rect(), panel), popup = element(rect());
  Object.assign(popup, { scrollHeight: 220, offsetHeight: 222, clientHeight: 220 });
  function paint() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }
  return { view, doc, root, panel, anchor, popup, observers, frames, paint };
}

test('popup fits the viewport and flips above its parent when below has less room', () => {
  assert.deepEqual(popupPlacement(rect(770, 600), { width: 800, height: 700 }, 340, 220), { left: 452, width: 340, maxHeight: 220, bottom: 104 });
  assert.deepEqual(popupPlacement(rect(12, 20), { width: 280, height: 180 }, 340, 440), { left: 8, width: 264, maxHeight: 113, top: 59 });
});

test('popup follows nested panel scroll immediately and the document uses capture for non-bubbling scroll', () => {
  const f = fixture(), tracking = trackAnchoredPopup(f.anchor, f.popup);
  assert.equal(f.popup.style.top, '239px');
  assert.equal(f.doc.listeners.has('scroll:true'), true);
  f.anchor.bounds = rect(100, 150); f.panel.dispatchEvent(new Event('scroll'));
  assert.equal(f.popup.style.top, '189px');
  f.anchor.bounds = rect(90, 125); f.doc.dispatchEvent(new Event('scroll'));
  assert.equal(f.popup.style.top, '164px'); assert.equal(f.popup.style.left, '90px');
  tracking.destroy();
});

test('position-only parent reflow is tracked, and popup content resize can change the opening side', () => {
  const f = fixture(), tracking = trackAnchoredPopup(f.anchor, f.popup);
  f.anchor.bounds = rect(180, 380); f.paint();
  assert.equal(f.popup.style.top, '419px'); assert.equal(f.popup.style.left, '180px');
  f.popup.scrollHeight = 480; f.observers[0].callback();
  assert.equal(f.popup.style.top, 'auto'); assert.equal(f.popup.style.bottom, '324px');
  assert.ok(f.observers[0].elements.includes(f.anchor)); assert.ok(f.observers[0].elements.includes(f.panel)); assert.ok(f.observers[0].elements.includes(f.popup));
  tracking.destroy();
});

test('viewport resize updates width and placement, including the font picker dynamic minimum width', () => {
  const f = fixture(), tracking = trackAnchoredPopup(f.anchor, f.popup, { width: () => Math.max(250, f.anchor.bounds.width), maxHeight: 300, gap: 3 });
  assert.equal(f.popup.style.width, '250px');
  f.view.innerWidth = 230; f.view.dispatchEvent(new Event('resize'));
  assert.equal(f.popup.style.width, '214px'); assert.equal(f.popup.style.left, '8px');
  f.view.innerHeight = 350; f.view.visualViewport.dispatchEvent(new Event('resize'));
  assert.equal(f.popup.style.bottom, '153px');
  tracking.destroy();
});

test('a popup closes when its parent disappears into the panel clip rather than floating over unrelated content', () => {
  const f = fixture(); let hidden = 0;
  const tracking = trackAnchoredPopup(f.anchor, f.popup, { onHidden: () => hidden++ });
  f.anchor.bounds = rect(100, 10); f.panel.dispatchEvent(new Event('scroll'));
  assert.equal(hidden, 1);
  tracking.destroy();
});

test('destroy cancels tracking, disconnects observation and removes every event listener', () => {
  const f = fixture(), tracking = trackAnchoredPopup(f.anchor, f.popup);
  tracking.destroy(); tracking.destroy();
  for (const node of [f.doc, f.panel, f.root, f.view, f.view.visualViewport]) assert.equal(node.listeners.size, 0);
  assert.equal(f.observers[0].disconnected, true); assert.equal(f.frames.size, 0);
  f.anchor.bounds = rect(5, 5); f.panel.dispatchEvent(new Event('scroll')); tracking.update(); f.paint();
  assert.equal(f.popup.style.top, '239px');
});

test('production style dialogs, demo buttons and font picker all use the shared anchor tracker', () => {
  const toolbar = readFileSync(new URL('../webview-ui/src/components/TextStyleToolbar.svelte', import.meta.url), 'utf8');
  const ribbon = readFileSync(new URL('../webview-ui/src/components/ImpeccableRibbon.svelte', import.meta.url), 'utf8');
  const font = readFileSync(new URL('../webview-ui/src/components/FontPicker.svelte', import.meta.url), 'utf8');
  assert.match(toolbar, /use:portal=\{popoverTrigger\}/);
  assert.match(toolbar, /tracking\?\.destroy\(\)/);
  assert.equal((ribbon.match(/use:anchorDetails/g) ?? []).length, 5);
  assert.match(ribbon, /portaledPopovers\.get\(dialog\)\?\.contains\(target\)/);
  assert.match(font, /trackAnchoredPopup\(input, node/);
});
