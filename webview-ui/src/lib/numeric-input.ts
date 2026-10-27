import { boundedNumber } from './scrubbable-number.ts';

/** Parse a complete decimal without turning an empty or partial draft into zero. */
export function numericInputValue(input: Pick<HTMLInputElement, 'value'>): number {
  const text = input.value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
  const value = Number(text);
  return Number.isFinite(value) ? value : NaN;
}

/**
 * Use normal text editing in host webviews: their native number widget does not
 * reliably support forward Delete. Keep numeric validation and arrow stepping.
 */
export function numericInput(node: HTMLInputElement, options: { managedKeys?: boolean } = {}) {
  let baseline = node.value, committed = node.value;
  const numberAttribute = (name: string) => {
    const text = node.getAttribute(name);
    return text === null || text.trim() === '' ? undefined : numericInputValue({ value: text });
  };
  const emit = (type: string) => node.dispatchEvent(new Event(type, { bubbles: true }));
  const focus = () => { baseline = committed = node.value; };
  const change = (event: Event) => {
    if (!Number.isFinite(numericInputValue(node))) {
      node.value = baseline;
      event.stopImmediatePropagation();
    } else if (node.value === committed) {
      event.stopImmediatePropagation();
    } else {
      committed = node.value;
      // Component validation may restore an out-of-range value. Capture its
      // result after that handler, and suppress a second change on Enter blur.
      queueMicrotask(() => { baseline = committed = node.value; });
    }
  };
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || node.disabled || node.readOnly) return;
    if (event.key === 'Enter' && !options.managedKeys) {
      event.preventDefault(); emit('change'); node.blur();
    } else if (event.key === 'Escape' && !options.managedKeys) {
      event.preventDefault(); node.value = baseline; node.blur();
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const step = numberAttribute('step') ?? 1;
      const min = numberAttribute('min'), max = numberAttribute('max');
      const current = numericInputValue(node), previous = numericInputValue({ value: baseline });
      const next = boundedNumber((Number.isFinite(current) ? current : Number.isFinite(previous) ? previous : 0) + (event.key === 'ArrowUp' ? 1 : -1) * (Number.isFinite(step) && step > 0 ? step : 1),
        { min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined });
      node.value = String(next); emit('input'); emit('change');
    }
  };
  // Capture validation before component handlers, leaving Backspace, Delete,
  // selection shortcuts, and caret movement entirely to the text input.
  node.addEventListener('focus', focus);
  node.addEventListener('change', change, true);
  node.addEventListener('keydown', key);
  return { destroy() {
    node.removeEventListener('focus', focus);
    node.removeEventListener('change', change, true);
    node.removeEventListener('keydown', key);
  } };
}
