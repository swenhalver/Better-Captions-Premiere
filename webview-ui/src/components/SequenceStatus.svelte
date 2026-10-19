<script lang="ts">
  import { tick } from "svelte";
  import type { SessionState } from "../lib/types";
  interface Props { session: SessionState | null; onRefresh: () => void; onTranscribe: () => void; onExtend?: () => void; isDemo?: boolean; isBusy?: boolean; saveStatus?: string; }
  let { session, onRefresh, onTranscribe, onExtend, isDemo = false, isBusy = false, saveStatus = "" }: Props = $props();
  let linked = $derived(session?.captions.some((caption) => caption.clipNodeId) ?? false);
  let ready = $derived(!!session && (session.hasTranscript || session.captions.length > 0));
  let sequenceName = $derived(isDemo ? "A little more human · Sample sequence" : session?.sequenceName ?? "No active sequence");
  let transcribeDisabled = $derived(isDemo || isBusy || !session || linked);
  let transcribeTitle = $derived(isDemo ? "Available in the installed Premiere panel" : linked ? "Edit the linked transcript below" : "Use Premiere’s built-in Speech to Text");
  let stateText = $derived(session?.isLoading ? "Transcribing…" : saveStatus === "Saving changes…" ? "Saving…" : saveStatus === "Save failed" ? "Save failed" : ready ? `${session?.captions.length} ${session?.captions.length === 1 ? "caption" : "captions"}` : "No transcript");
  let menuOpen = $state(false);
  let actions = $state<HTMLDivElement>();
  let actionsButton = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  const componentId = $props.id();
  const menuId = `${componentId}-sequence-actions`;

  $effect(() => {
    session?.sequenceId;
    ready;
    menuOpen = false;
  });

  function menuItems() { return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')) : []; }
  async function openMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    await tick();
    if (menuOpen) (menuItems()[0] ?? menu)?.focus();
  }
  function closeMenu(restoreFocus = false) {
    menuOpen = false;
    if (restoreFocus) actionsButton?.focus();
  }
  function outsidePointer(event: PointerEvent) {
    if (menuOpen && !actions?.contains(event.target as Node)) closeMenu();
  }
  function menuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
    if (event.key === "Tab") { closeMenu(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[next].focus();
  }
  function runAction(action: () => void) { closeMenu(true); action(); }
</script>

<svelte:window onpointerdown={outsidePointer} />

<header class="sequence-status" class:sequence-status--ready={ready} aria-label="Better Captions">
  {#if !ready}
    <div class="sequence-status__title"><h1>Better Captions</h1>{#if isDemo}<span class="sequence-status__demo">Browser demo</span>{/if}</div>
  {/if}
  <div class="sequence-status__identity">
    {#if !ready}<svg class="sequence-status__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="1"/><path d="M6 4.5v11M14 4.5v11M2.5 8h3.5M14 8h3.5M2.5 12h3.5M14 12h3.5"/></svg>{/if}
    <div class="sequence-status__name" title={sequenceName}>{sequenceName}{#if !ready}<span class="sequence-status__detail">{session ? `${session.frameWidth} × ${session.frameHeight} · ${Number(session.frameRate.toFixed(3))} fps` : "Open a sequence in Premiere Pro"}</span>{/if}</div>
    {#if ready}
      <span class="sequence-status__state" role="status">{stateText}</span>
      <div class="sequence-status__actions-menu" bind:this={actions}>
        <button class="caption-button caption-button--icon" bind:this={actionsButton} onclick={openMenu} aria-label="Sequence actions" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} title="Sequence actions"><svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="16" cy="10" r="1.3"/></svg></button>
        {#if menuOpen}
          <div class="sequence-status__menu" bind:this={menu} id={menuId} role="menu" aria-label="Sequence actions" tabindex="-1" onkeydown={menuKeydown}>
            <button class="sequence-status__menu-item" role="menuitem" tabindex="-1" onclick={() => runAction(onRefresh)} disabled={isBusy} title="Refresh sequence without replacing caption edits">Refresh sequence</button>
            {#if onExtend}<button class="sequence-status__menu-item" role="menuitem" tabindex="-1" onclick={() => runAction(onExtend!)} disabled={isBusy || isDemo} title="Append dialogue from added footage and keep existing caption edits">Extend captions</button>{/if}
            <button class="sequence-status__menu-item" role="menuitem" tabindex="-1" onclick={() => runAction(onTranscribe)} disabled={transcribeDisabled} title={transcribeTitle}>Transcribe again</button>
            {#if linked}<p class="sequence-status__menu-help">Edit the linked transcript below.</p>{/if}
          </div>
        {/if}
      </div>
    {:else}
      <button class="caption-button caption-button--icon" onclick={onRefresh} disabled={isBusy} aria-label="Refresh sequence" title="Refresh sequence without replacing caption edits"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .3 5M16 3v4h-4"/></svg></button>
    {/if}
  </div>
  {#if !ready}
    <div class="sequence-status__actions">
      <button class="caption-button caption-button--primary" onclick={onTranscribe} disabled={transcribeDisabled} title={transcribeTitle}>{session?.isLoading ? "Transcribing…" : "Transcribe in Premiere"}</button>
      <span class="sequence-status__state" role="status">{session?.isLoading ? "Reading timed words…" : stateText}</span>
    </div>
  {/if}
  {#if isDemo}<p class="sequence-status__notice">{ready ? "Browser demo · " : ""}Synthetic captions. Native actions require Premiere.</p>{/if}
</header>
<style>
  .sequence-status { flex-shrink: 0; padding: var(--caption-space-m) var(--caption-space-l); border-block-end: 1px solid var(--color-panel-border); background: var(--color-surface); }
  .sequence-status--ready { padding-block: var(--caption-space-xs); }
  .sequence-status__title { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-s); margin-block-end: var(--caption-space-s); & h1 { font-size: var(--caption-type-m); font-weight: 600; } }
  .sequence-status__demo { font-size: var(--caption-type-xs); color: var(--color-panel-secondary); border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); padding: .1rem .4rem; }
  .sequence-status__identity { display: flex; align-items: center; gap: var(--caption-space-s); margin-block-end: var(--caption-space-m); .sequence-status--ready & { margin-block-end: 0; } }
  .sequence-status__icon { inline-size: 1.45rem; block-size: 1.45rem; color: var(--color-panel-secondary); flex-shrink: 0; }
  .sequence-status__name { flex: 1; font-weight: 600; min-inline-size: 0; overflow-wrap: anywhere; .sequence-status--ready & { font-size: var(--caption-type-s); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
  .sequence-status__detail { display: block; font-size: var(--caption-type-xs); font-weight: 400; color: var(--color-panel-secondary); margin-block-start: .1rem; font-variant-numeric: tabular-nums; }
  .sequence-status__actions { display: flex; align-items: center; gap: var(--caption-space-s); & > button { flex: 1; } }
  .sequence-status__state { flex-shrink: 0; font-size: var(--caption-type-xs); color: var(--color-panel-secondary); white-space: nowrap; }
  .sequence-status__actions-menu { position: relative; flex-shrink: 0; }
  .sequence-status__menu { position: absolute; z-index: 20; inset-block-start: calc(100% + var(--caption-space-xs)); inset-inline-end: 0; inline-size: max-content; max-inline-size: min(18rem, calc(100vw - 2 * var(--caption-space-l))); padding: var(--caption-space-xs); border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-surface-raised); }
  .sequence-status__menu-item { display: block; inline-size: 100%; min-block-size: 2.25rem; padding: var(--caption-space-s); border: 0; border-radius: var(--caption-radius); background: transparent; color: var(--color-panel-text); text-align: start; font-size: var(--caption-type-s); cursor: pointer; &:hover:enabled { background: var(--color-surface-overlay); } &:disabled { opacity: .5; cursor: default; } }
  .sequence-status__menu-help { max-inline-size: 18rem; padding: var(--caption-space-xs) var(--caption-space-s); font-size: var(--caption-type-xs); color: var(--color-panel-secondary); }
  .sequence-status__notice { margin-block-start: var(--caption-space-s); font-size: var(--caption-type-xs); color: var(--color-panel-secondary); }
</style>
