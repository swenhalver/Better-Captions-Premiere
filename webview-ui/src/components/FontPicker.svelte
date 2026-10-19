<script lang="ts">
  import { tick } from 'svelte';
  import { searchFonts } from '../lib/font-catalog.ts';
  interface Props { value: string; fonts: string[]; placeholder?: string; loading?: boolean; error?: string; onOpen?: () => void; onRetry?: () => void; onSelect: (font: string) => void; }
  let { value, fonts, placeholder = 'Font family', loading = false, error = '', onOpen, onRetry, onSelect }: Props = $props();
  const id = $props.id();
  let input: HTMLInputElement;
  let popup: HTMLDivElement | undefined;
  let opened = $state(false), searching = $state(false), query = $state(''), active = $state(0);
  let position = $state('');
  let matches = $derived(searchFonts(fonts, searching ? query : ''));
  const optionId = (index: number) => `${id}-font-${index}`;
  function place() {
    if (!opened || !input) return;
    const rect = input.getBoundingClientRect(), width = Math.min(window.innerWidth - 16, Math.max(rect.width, 250));
    const below = window.innerHeight - rect.bottom - 8, above = rect.top - 8, up = below < 180 && above > below;
    const height = Math.max(80, Math.min(300, up ? above : below));
    position = `left:${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px;width:${width}px;max-height:${height}px;${up ? `bottom:${window.innerHeight - rect.top + 3}px` : `top:${rect.bottom + 3}px`}`;
  }
  function portal(node: HTMLDivElement) {
    popup = node; document.body.appendChild(node); place();
    return { destroy() { node.remove(); popup = undefined; } };
  }
  async function reveal() { await tick(); document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' }); }
  function open() {
    if (opened) return;
    searching = false; query = value; opened = true;
    active = Math.max(0, fonts.findIndex(font => font === value));
    onOpen?.(); place(); void reveal();
  }
  function close() { opened = false; searching = false; query = value; }
  function choose(font: string) { if (!input?.matches(':disabled')) onSelect(font); close(); input?.focus(); }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!opened) { open(); return; }
      active = Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))); void reveal();
    } else if (event.key === 'Enter' && opened) {
      event.preventDefault(); if (matches[active]) choose(matches[active]);
    } else if (event.key === 'Tab') {
      const exact = searching && fonts.find(font => font.toLocaleLowerCase() === query.trim().toLocaleLowerCase());
      if (exact && !input?.matches(':disabled')) onSelect(exact); close();
    }
  }
  function outside(event: PointerEvent) {
    const target = event.target as Node;
    if (opened && !input?.parentElement?.contains(target) && !popup?.contains(target)) close();
  }
</script>

<svelte:window onpointerdown={outside} onresize={place} onscroll={() => { if (opened) place(); }} />
<div class="font-picker">
  <input bind:this={input} class="font-picker__input" role="combobox" aria-label="Font family" aria-autocomplete="list" aria-expanded={opened} aria-controls={`${id}-fonts`} aria-activedescendant={opened && matches[active] ? optionId(active) : undefined} autocomplete="off" spellcheck="false" maxlength="4096" {placeholder} value={opened ? query : value} onclick={open} onfocus={() => { open(); input.select(); }} onblur={close} oninput={(event) => { query = event.currentTarget.value; searching = true; opened = true; active = 0; place(); }} onkeydown={keydown} />
  <button type="button" class="font-picker__toggle" aria-label="Show installed fonts" aria-expanded={opened} tabindex="-1" onpointerdown={(event) => event.preventDefault()} onclick={() => { if (opened) close(); else { input.focus(); open(); } }}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>
</div>
{#if opened}
  <div class="font-picker__popup" style={position} use:portal>
    {#if loading && !fonts.length}<p class="font-picker__message" role="status">Loading installed fonts…</p>
    {:else if error}<div class="font-picker__message" role="status">Couldn’t load installed fonts. <button class="caption-button" onclick={() => onRetry?.()}>Retry</button></div>{/if}
    <div id={`${id}-fonts`} class="font-picker__list" role="listbox" aria-label="Installed fonts">
      {#each matches as font, index (font)}
        <button type="button" id={optionId(index)} class="font-picker__option" role="option" tabindex="-1" aria-selected={font === value} data-active={index === active} title={font} onpointerdown={(event) => event.preventDefault()} onpointermove={() => active = index} onclick={() => choose(font)}>{font}</button>
      {/each}
    </div>
    {#if !loading && !error && !matches.length}<p class="font-picker__message" role="status">No matching installed fonts.</p>{/if}
    {#if fonts.length}<div class="font-picker__count"><span aria-live="polite">{matches.length} {matches.length === 1 ? 'font' : 'fonts'}{searching ? ` of ${fonts.length}` : ''}</span><button type="button" class="font-picker__refresh" aria-label="Refresh installed fonts" disabled={loading} onpointerdown={(event) => event.preventDefault()} onclick={() => onRetry?.()}>{loading ? 'Loading…' : 'Refresh'}</button></div>{/if}
  </div>
{/if}

<style>
  .font-picker { display: flex; min-inline-size: 0; min-block-size: 2.25rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); &:focus-within { outline: 2px solid var(--color-accent); outline-offset: 1px; } }
  .font-picker__input { inline-size: 100%; min-inline-size: 0; min-block-size: 2.25rem; padding: .3rem .4rem; border: 0; background: transparent; color: var(--color-panel-text); font: inherit; font-size: var(--caption-type-s); &:focus { outline: none; } }
  .font-picker__toggle { display: grid; place-items: center; inline-size: 1.75rem; flex-shrink: 0; padding: .25rem; border: 0; background: transparent; color: var(--color-panel-secondary); cursor: pointer; & svg { inline-size: 1rem; block-size: 1rem; } &:hover { background: var(--color-surface-overlay); color: var(--color-panel-text); } }
  .font-picker__popup { position: fixed; z-index: 1000; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-panel-bg); color: var(--color-panel-text); font-family: inherit; font-size: var(--caption-type-s); }
  .font-picker__list { min-block-size: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-color: var(--color-panel-border) var(--color-panel-bg); }
  .font-picker__option { display: block; inline-size: 100%; min-block-size: 2.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: .4rem .6rem; border: 0; border-radius: 0; background: transparent; color: inherit; text-align: start; font: inherit; cursor: pointer; &[aria-selected="true"] { color: var(--color-accent); } &[data-active="true"], &:hover { background: var(--color-selection); color: var(--color-accent); } }
  .font-picker__message { margin: 0; padding: .6rem; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); }
  .font-picker__count { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; gap: var(--caption-space-s); padding: .35rem .6rem; border-block-start: 1px solid var(--color-panel-border); color: var(--color-panel-secondary); font-size: var(--caption-type-xs); font-variant-numeric: tabular-nums; }
  .font-picker__refresh { min-block-size: 1.75rem; padding: .15rem .25rem; border: 0; background: transparent; color: var(--color-accent); font: inherit; cursor: pointer; &:hover:enabled { background: var(--color-surface-overlay); } &:disabled { opacity: .5; cursor: default; } }
</style>
