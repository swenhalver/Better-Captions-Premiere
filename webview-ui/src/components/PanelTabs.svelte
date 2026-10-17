<script lang="ts">
  interface Props {
    name: string; label: string; value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void; compact?: boolean;
  }
  let { name, label, value, options, onChange, compact = false }: Props = $props();
  function navigate(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft") next = (index + options.length - 1) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    document.getElementById(`${name}-tab-${options[next].value}`)?.focus();
  }
</script>
<div class="panel-tabs" class:panel-tabs--compact={compact} role="tablist" aria-label={label}>
  {#each options as option, index}
    <button class="panel-tabs__tab" id="{name}-tab-{option.value}" role="tab" aria-selected={value === option.value} aria-controls="{name}-panel-{option.value}" tabindex={value === option.value ? 0 : -1} onclick={() => onChange(option.value)} onkeydown={(event) => navigate(event, index)}>{option.label}</button>
  {/each}
</div>
<style>
  .panel-tabs { display: flex; gap: var(--caption-space-l); padding-inline: var(--caption-space-l); border-block-end: 1px solid var(--color-panel-border); background: var(--color-surface); }
  .panel-tabs__tab { padding: .8rem .15rem; border: 0; border-block-end: 2px solid transparent; background: transparent; color: var(--color-panel-secondary); font: inherit; font-weight: 600; cursor: pointer; }
  .panel-tabs__tab:hover { color: var(--color-panel-text); }
  .panel-tabs__tab[aria-selected="true"] { color: var(--color-accent); border-block-end-color: var(--color-accent); }
  .panel-tabs--compact { gap: .25rem; padding: .25rem; margin: var(--caption-space-m) var(--caption-space-l); border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); }
  .panel-tabs--compact .panel-tabs__tab { flex: 1; padding: .45rem .2rem; border: 0; border-radius: var(--caption-radius); font-size: var(--caption-type-s); }
  .panel-tabs--compact .panel-tabs__tab[aria-selected="true"] { background: var(--color-selection); color: var(--color-panel-text); }
</style>
