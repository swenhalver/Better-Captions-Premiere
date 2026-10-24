export interface PopupRect { left: number; right: number; top: number; bottom: number; width: number; height: number; }
export interface PopupPlacement { left: number; width: number; maxHeight: number; top?: number; bottom?: number; }

/** Viewport coordinates for a fixed popup, with room to scroll on either side. */
export function popupPlacement(anchor: PopupRect, viewport: { width: number; height: number }, width: number, height: number, gap = 4, edge = 8): PopupPlacement {
  const fittedWidth = Math.max(0, Math.min(width, viewport.width - edge * 2));
  const below = Math.max(0, viewport.height - edge - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - edge);
  const upwards = below < height && above > below;
  return {
    left: Math.max(edge, Math.min(anchor.left, viewport.width - fittedWidth - edge)),
    width: fittedWidth,
    maxHeight: Math.min(height, upwards ? above : below),
    ...(upwards ? { bottom: viewport.height - anchor.top + gap } : { top: anchor.bottom + gap }),
  };
}

export interface AnchorPopupOptions {
  width?: number | (() => number);
  maxHeight?: number;
  gap?: number;
  onHidden?: () => void;
}

/** Track a portaled popup even when a nested panel scrolls or the toolbar reflows. */
export function trackAnchoredPopup(anchor: HTMLElement, popup: HTMLElement, options: AnchorPopupOptions = {}) {
  const doc = anchor.ownerDocument, view = doc.defaultView;
  if (!view) return { update() {}, destroy() {} };
  const ancestors: HTMLElement[] = [];
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
  const clipping = ancestors.filter(parent => /auto|scroll|hidden|clip/.test(`${view.getComputedStyle(parent).overflowX} ${view.getComputedStyle(parent).overflowY}`));
  let disposed = false, frame = 0, last = '';
  function update() {
    if (disposed) return;
    const rect = anchor.getBoundingClientRect();
    const hidden = !anchor.isConnected || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= view!.innerHeight || rect.right <= 0 || rect.left >= view!.innerWidth || clipping.some(parent => {
      const bounds = parent.getBoundingClientRect(), style = view!.getComputedStyle(parent);
      return (/auto|scroll|hidden|clip/.test(style.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) ||
        (/auto|scroll|hidden|clip/.test(style.overflowX) && (rect.right <= bounds.left || rect.left >= bounds.right));
    });
    if (hidden) { options.onHidden?.(); return; }
    const desiredWidth = typeof options.width === 'function' ? options.width() : options.width ?? 340;
    // Measure at the intended width first: wrapping can change the popup's height.
    const width = Math.max(0, Math.min(desiredWidth, view!.innerWidth - 16));
    if (popup.style.width !== `${width}px`) popup.style.width = `${width}px`;
    const height = Math.min(options.maxHeight ?? Infinity, popup.scrollHeight + popup.offsetHeight - popup.clientHeight);
    const placed = popupPlacement(rect, { width: view!.innerWidth, height: view!.innerHeight }, desiredWidth, height, options.gap);
    const signature = JSON.stringify(placed);
    if (signature === last) return;
    last = signature;
    popup.style.left = `${placed.left}px`;
    popup.style.width = `${placed.width}px`;
    popup.style.maxHeight = `${placed.maxHeight}px`;
    popup.style.top = placed.top === undefined ? 'auto' : `${placed.top}px`;
    popup.style.bottom = placed.bottom === undefined ? 'auto' : `${placed.bottom}px`;
  }
  // Scroll does not bubble. Capture handles scrolling inside the panel as well
  // as the document; direct ancestor listeners also cover embedded host scrollers.
  doc.addEventListener('scroll', update, true);
  for (const parent of ancestors) parent.addEventListener('scroll', update, { passive: true });
  view.addEventListener('resize', update);
  view.visualViewport?.addEventListener('resize', update);
  view.visualViewport?.addEventListener('scroll', update);
  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(update) : null;
  for (const element of [anchor, popup, ...ancestors]) observer?.observe(element);
  // ResizeObserver misses position-only changes (for example another section
  // opening above the toolbar). While open, compare bounds once per paint.
  function follow() { if (disposed) return; update(); frame = view!.requestAnimationFrame(follow); }
  update();
  frame = view.requestAnimationFrame(follow);
  return {
    update,
    destroy() {
      if (disposed) return;
      disposed = true;
      view.cancelAnimationFrame(frame);
      observer?.disconnect();
      doc.removeEventListener('scroll', update, true);
      for (const parent of ancestors) parent.removeEventListener('scroll', update);
      view.removeEventListener('resize', update);
      view.visualViewport?.removeEventListener('resize', update);
      view.visualViewport?.removeEventListener('scroll', update);
    },
  };
}
