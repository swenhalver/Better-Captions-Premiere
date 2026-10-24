<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { lockControlScroll } from '../lib/control-scroll-lock';
  import { boundedNumber, parsedNumber, scrubbedNumber, scrubMultiplier } from '../lib/scrubbable-number';

  interface Props {
    value: number | null;
    min?: number;
    max?: number;
    step?: number;
    label: string;
    disabled?: boolean;
    decimals?: number;
    variant?: 'field' | 'hot';
    placeholder?: string;
    zeroLabel?: string;
    title?: string;
    inputRealtime?: boolean;
    onReset?: () => void;
    defaultValue?: number;
    onChange: (value: number) => void;
    onDragState?: (dragging: boolean) => void;
  }
  let { value, min, max, step = 1, label, disabled = false, decimals, variant = 'field', placeholder = 'Mixed', zeroLabel, title, inputRealtime = false, onReset, defaultValue, onChange, onDragState }: Props = $props();
  let editing = $state(false);
  let draft = $state('');
  let preview = $state<number | null>(null);
  let dragging = $state(false);
  let input = $state<HTMLInputElement>();
  let trigger = $state<HTMLButtonElement>();
  let pointer: { id: number; x: number; start: number } | null = null;
  let suppressClick = false;
  let lastInputValue: number | null = null;
  let lastPress: { at: number; x: number; y: number } | null = null;
  let suppressResetClick = false;
  let suppressNativeDoubleClick = false;
  let suppressDoubleClick = false;
  const resetEnabled = $derived(typeof onReset === 'function' || defaultValue !== undefined && Number.isFinite(defaultValue));
  let unlockScroll: (()=>void)|undefined;
  const shown = $derived(dragging ? preview : value);
  const text = $derived(shown === null ? placeholder : shown === 0 && zeroLabel ? zeroLabel : decimals === undefined ? String(Number(shown.toFixed(6))) : shown.toFixed(decimals));

  $effect(() => {
    if (disabled) {
      lastPress = null;
      finishPointer();
      editing = false;
    }
  });

  onDestroy(finishPointer);

  function publish(next: number) {
    if (next === preview) return;
    preview = next;
    onChange(next);
  }
  async function edit() {
    if (disabled) return;
    draft = value === null ? '' : String(value);
    lastInputValue = value;
    editing = true;
    await tick();
    if (!editing || disabled) return;
    input?.focus({preventScroll:true});
    input?.select();
  }
  function resetGesture(node: HTMLElement) {
    const press = (event: PointerEvent) => {
      if (disabled || !resetEnabled || event.button !== 0 || event.isPrimary === false || event.pointerType === 'touch') return;
      const at = Date.now(), previous = lastPress;
      suppressResetClick = false;
      suppressNativeDoubleClick = false;
      if (previous && at - previous.at <= 500 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 5 && !suppressDoubleClick) {
        lastPress = null;
        resetControl(event);
        suppressResetClick = suppressNativeDoubleClick = true;
        event.stopImmediatePropagation();
      } else lastPress = { at, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (lastPress && Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) >= 3) lastPress = null;
    };
    const clickAfterReset = (event: MouseEvent) => {
      if (!suppressResetClick) return;
      suppressResetClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const doubleClickAfterReset = (event: MouseEvent) => {
      if (!suppressNativeDoubleClick) return;
      suppressNativeDoubleClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    node.addEventListener('pointerdown', press, true);
    node.addEventListener('pointermove', move, true);
    node.addEventListener('click', clickAfterReset, true);
    node.addEventListener('dblclick', doubleClickAfterReset, true);
    return { destroy() {
      lastPress = null;
      node.removeEventListener('pointerdown', press, true);
      node.removeEventListener('pointermove', move, true);
      node.removeEventListener('click', clickAfterReset, true);
      node.removeEventListener('dblclick', doubleClickAfterReset, true);
    } };
  }
  function click(_event: MouseEvent) {
    if (disabled) return;
    if (suppressClick) { suppressClick = false; return; }
    void edit();
  }
  function resetControl(event: MouseEvent) {
    if (disabled || !resetEnabled || dragging || suppressDoubleClick) return;
    event.preventDefault();
    event.stopPropagation();
    lastPress = null;
    // Cancel the draft before unmount/blur so it cannot overwrite the reset.
    editing = false;
    draft = '';
    lastInputValue = null;
    finishPointer();
    if (onReset) onReset();
    else if (defaultValue !== undefined && Number.isFinite(defaultValue)) {
      const next = boundedNumber(defaultValue, { min, max });
      if (next !== value) onChange(next);
    }
  }
  function commit() {
    if (!editing) return;
    editing = false;
    if (inputRealtime && draft === (value === null ? '' : String(value))) return;
    const next = parsedNumber(draft, { min, max });
    if (next !== null && next !== value && (!inputRealtime || next !== lastInputValue)) onChange(next);
  }
  function inputValue(event: Event) {
    if (!inputRealtime || disabled) return;
    const next = parsedNumber((event.currentTarget as HTMLInputElement).value);
    if (next === null || decimals === 0 && !Number.isInteger(next) || min !== undefined && next < min || max !== undefined && next > max || next === lastInputValue) return;
    lastInputValue = next;
    if (next !== value) onChange(next);
  }
  function finishPointer() {
    unlockScroll?.();
    unlockScroll=undefined;
    const id = pointer?.id;
    pointer = null;
    if (id !== undefined && trigger?.hasPointerCapture(id)) trigger.releasePointerCapture(id);
    if (dragging) {
      dragging = false;
      onDragState?.(false);
    }
  }
  function pointerDown(event: PointerEvent) {
    if (disabled || event.button !== 0 || pointer) return;
    event.preventDefault();
    suppressDoubleClick = false;
    if(trigger)unlockScroll=lockControlScroll(trigger);
    trigger?.focus({preventScroll:true});
    pointer = { id: event.pointerId, x: event.clientX, start: value ?? boundedNumber(0, { min, max }) };
    preview = value;
    suppressClick = false;
    trigger?.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (!pointer || event.pointerId !== pointer.id || disabled) return;
    const delta = event.clientX - pointer.x;
    if (!dragging && Math.abs(delta) < 3) return;
    event.preventDefault();
    if (!dragging) {
      dragging = true;
      suppressClick = true;
      suppressDoubleClick = true;
      lastPress = null;
      onDragState?.(true);
    }
    publish(scrubbedNumber(pointer.start, delta, step, event, { min, max }));
  }
  function keyDown(event: KeyboardEvent) {
    if (disabled) return;
    lastPress = null;
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (direction) {
      event.preventDefault();
      const next = boundedNumber((value ?? 0) + direction * step * scrubMultiplier(event), { min, max });
      if (next !== value) onChange(next);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void edit();
    }
  }
  function inputKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
      void tick().then(() => trigger?.focus({preventScroll:true}));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      void tick().then(() => trigger?.focus({preventScroll:true}));
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      const next = boundedNumber((parsedNumber(draft) ?? value ?? 0) + direction * step * scrubMultiplier(event), { min, max });
      draft = String(next);
      if (inputRealtime) lastInputValue = next;
      if (next !== value) onChange(next);
    }
  }
</script>

<svelte:window onblur={() => { lastPress = null; finishPointer(); }}/>

<div use:resetGesture class="scrubbable-number" class:scrubbable-number--hot={variant === 'hot'} class:scrubbable-number--dragging={dragging} class:scrubbable-number--disabled={disabled}>
  {#if editing}
    <input class="scrubbable-number__input" bind:this={input} bind:value={draft} type="text" inputmode="decimal" aria-label={label} {title} {disabled} oninput={inputValue} onblur={commit} onkeydown={inputKeyDown} ondblclick={resetControl} />
  {:else}
    <button class="scrubbable-number__value" bind:this={trigger} type="button" role="spinbutton" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={min} aria-valuemax={max} aria-valuetext={value === null ? placeholder : value === 0 ? zeroLabel : undefined} {disabled} title={title ?? `${label} — drag to adjust; click to type. Shift: coarse, Alt: fine.${resetEnabled ? ' Double-click to reset.' : ''}`} onpointerdown={pointerDown} onpointermove={pointerMove} onpointerup={finishPointer} onpointercancel={finishPointer} onlostpointercapture={finishPointer} onkeydown={keyDown} onclick={click} ondblclick={resetControl}>{text}</button>
  {/if}
</div>

<style>
  .scrubbable-number { min-inline-size: 0; inline-size: 100%; font-variant-numeric: tabular-nums; }
  .scrubbable-number__value, .scrubbable-number__input { inline-size: 100%; min-inline-size: 0; min-block-size: 2.25rem; margin: 0; padding: .3rem .4rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); color: var(--color-panel-text); font: inherit; font-size: var(--caption-type-s); line-height: 1.25; text-align: start; font-variant-numeric: inherit; box-sizing: border-box; &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -1px; } &:disabled { cursor: default; } }
  .scrubbable-number__value { cursor: ew-resize; touch-action: none; user-select: none; &:hover:enabled { border-color: var(--color-accent); } }
  .scrubbable-number__input { cursor: text; }
  .scrubbable-number--hot { & .scrubbable-number__value { border-color: transparent; background: transparent; color: var(--color-accent); &:hover:enabled { text-decoration: underline; } } }
  .scrubbable-number--dragging { & .scrubbable-number__value { border-color: var(--color-accent); } }
  .scrubbable-number--disabled { opacity: .5; }
</style>
