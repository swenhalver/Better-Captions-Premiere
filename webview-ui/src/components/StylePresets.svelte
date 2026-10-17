<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { AnimationConfig, StyleConfig } from '../lib/types';
  import { addStylePreset, capturePresetLook, changeStylePreset, validatePresetLibrary, type PresetLibrary, type PresetLook } from '../lib/style-presets';
  interface Props {
    style: StyleConfig; animation: AnimationConfig; disabled?: boolean; isDemo?: boolean;
    load: () => Promise<PresetLibrary>; save: (library: PresetLibrary) => Promise<PresetLibrary>;
    onApply: (look: PresetLook) => Promise<void>;
  }
  let { style, animation, disabled = false, isDemo = false, load, save, onApply }: Props = $props();
  let library = $state<PresetLibrary | null>(null);
  let selectedId = $state('');
  let mode = $state<'save' | 'manage' | null>(null);
  let confirm = $state<'replace' | 'delete' | null>(null);
  let name = $state('');
  let busy = $state(false);
  let error = $state('');
  let status = $state('');
  let reloadNeeded = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();
  const selected = $derived(library?.presets.find(p => p.id === selectedId));
  const sorted = $derived([...(library?.presets ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
  const explanation = (problem: unknown) => problem instanceof Error ? problem.message : String(problem);

  async function reload() {
    busy = true; error = ''; status = ''; mode = null; confirm = null;
    try {
      library = validatePresetLibrary(await load());
      if (!library.presets.some(p => p.id === selectedId)) selectedId = library.presets[0]?.id ?? '';
      reloadNeeded = false;
    } catch (problem) { error = `Presets could not be loaded. ${explanation(problem)}`; reloadNeeded = true; library = null; }
    finally { busy = false; }
  }
  onMount(() => { void reload(); });
  async function edit(next: 'save' | 'manage') {
    mode = next; confirm = null; name = next === 'save' ? '' : selected?.name ?? ''; error = ''; status = '';
    await tick(); nameInput?.focus();
  }
  function cancel() { mode = null; confirm = null; error = ''; }
  async function commit(action: 'save' | 'rename' | 'replace' | 'delete') {
    if (busy || disabled || !library || reloadNeeded) return;
    busy = true; error = ''; status = '';
    let writing = false;
    try {
      const id = action === 'save' ? `preset-${crypto.randomUUID()}` : selectedId;
      const oldName = selected?.name;
      const next = action === 'save' ? addStylePreset(library, name, capturePresetLook(style, animation), id) :
        changeStylePreset(library, id, action === 'delete' ? 'delete' : action === 'rename' ? { name } : { look: capturePresetLook(style, animation) });
      writing = true;
      library = validatePresetLibrary(await save(next));
      selectedId = action === 'delete' ? library.presets[0]?.id ?? '' : id;
      const savedName = library.presets.find(p => p.id === id)?.name;
      status = action === 'delete' ? `Deleted “${oldName}”.` : action === 'rename' ? `Renamed to “${savedName}”.` : `Saved “${savedName}”.`;
      mode = null; confirm = null;
    } catch (problem) { error = explanation(problem); reloadNeeded = writing; }
    finally { busy = false; }
  }
  async function apply() {
    if (!selected || busy || disabled || reloadNeeded) return;
    busy = true; error = ''; status = ''; mode = null; confirm = null;
    const preset = selected;
    try { await onApply({ style: preset.style, animation: preset.animation }); status = `Applied “${preset.name}” to all captions. Update the Program Monitor to render it.`; }
    catch (problem) { error = `The preset could not be fully applied. ${explanation(problem)}`; }
    finally { busy = false; }
  }
</script>

<section class="caption-section style-presets" aria-label="Style presets" aria-busy={busy}>
  <fieldset disabled={busy || disabled || reloadNeeded}>
    <div class="style-presets__picker">
      <label class="caption-field"><span>Style preset</span><select bind:value={selectedId} onchange={() => { cancel(); status = ''; }} disabled={!library?.presets.length}>
        {#if !library?.presets.length}<option value="">{busy ? 'Loading presets…' : 'No saved presets'}</option>{/if}
        {#each sorted as preset (preset.id)}<option value={preset.id}>{preset.name}</option>{/each}
      </select></label>
      <button class="caption-button" onclick={apply} disabled={!selected}>Apply</button>
    </div>
    <div class="style-presets__actions">
      <button class="caption-button" onclick={() => edit('save')} disabled={!library}>Save preset…</button>
      <button class="caption-button" onclick={() => edit('manage')} disabled={!selected}>Manage…</button>
    </div>
    <p class="caption-help">Past, current & next words, layout and animation. {isDemo ? 'Saved in this browser.' : 'Available across projects on this computer.'}</p>
    {#if mode}
      <form class="style-presets__form" onsubmit={(event) => { event.preventDefault(); if (!confirm) void commit(mode === 'save' ? 'save' : 'rename'); }}>
        <label class="caption-field"><span>Preset name</span><input bind:this={nameInput} bind:value={name} maxlength="80" autocomplete="off" placeholder="e.g. Brand captions" required /></label>
        {#if confirm}
          <p class="caption-help">{confirm === 'delete' ? `Delete “${selected?.name}” from your saved presets? Captions already using it keep their look.` : `Replace “${selected?.name}” with the current caption style?`}</p>
          <div class="style-presets__actions">
            <button type="button" class="caption-button" onclick={() => commit(confirm === 'delete' ? 'delete' : 'replace')}>{confirm === 'delete' ? 'Delete preset' : 'Replace preset'}</button>
            <button type="button" class="caption-button" onclick={() => confirm = null}>Keep preset</button>
          </div>
        {:else}
          <div class="style-presets__actions">
            <button class="caption-button caption-button--primary" type="submit">{mode === 'save' ? 'Save' : 'Rename'}</button>
            <button class="caption-button" type="button" onclick={cancel}>Cancel</button>
          </div>
          {#if mode === 'manage'}<div class="style-presets__actions">
            <button class="caption-button" type="button" onclick={() => confirm = 'replace'}>Replace with current style…</button>
            <button class="caption-button" type="button" onclick={() => confirm = 'delete'}>Delete…</button>
          </div>{/if}
        {/if}
      </form>
    {/if}
  </fieldset>
  {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
  {#if reloadNeeded}<button class="caption-button" onclick={reload} disabled={busy || disabled}>Reload presets</button>{/if}
  {#if status}<p class="caption-message" role="status">{status}</p>{/if}
</section>

<style>
  .style-presets { padding: var(--caption-space-m) var(--caption-space-l); }
  fieldset { border: 0; margin: 0; padding: 0; min-inline-size: 0; display: flex; flex-direction: column; gap: var(--caption-space-s); }
  .style-presets__picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--caption-space-s); }
  .style-presets__actions { display: flex; flex-wrap: wrap; gap: var(--caption-space-s); }
  .style-presets__form { display: flex; flex-direction: column; gap: var(--caption-space-s); padding-block-start: var(--caption-space-s); }
  .caption-message { padding: var(--caption-space-s) 0 0; }
  .caption-message--error { padding: var(--caption-space-s); margin-block: var(--caption-space-s); }
</style>
