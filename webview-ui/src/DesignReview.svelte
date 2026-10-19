<script lang="ts">
  import ToolbarDesign from './components/ToolbarDesign.svelte';
  import ImpeccableRibbon from './components/ImpeccableRibbon.svelte';
  import ImpeccableContext from './components/ImpeccableContext.svelte';
  let width=$state('774');
  const designs=[{variant:'ribbon',name:'Mac ribbon',description:'Impeccable ribbon subagent · closest to your reference. Shared segments, adjacent text and background colors, inline font, weight, size and alignment.'},{variant:'context',name:'Contextual inspector',description:'Impeccable context subagent · a compact type row and formatting strip, with an optional icon shelf for detailed settings.'},{variant:'inspector',name:'Two-row inspector',description:'A fixed two-row arrangement. Typeface controls stay above emphasis, color, case and alignment; details remain visible below.'}] as const;
</script>
<main class="design-review">
  <header class="design-review__header"><div><h1>Better Captions · toolbar designs</h1><p>Interactive design samples · synthetic text · no changes to your Premiere project</p></div><a href="/">Back to editor</a></header>
  <div class="design-review__controls"><p>Try typing, dragging numbers, changing word states and opening the detail tabs.</p><label>Panel width <select bind:value={width}><option value="360">360 px</option><option value="480">480 px</option><option value="774">774 px</option><option value="1100">1100 px</option></select></label></div>
  <div class="design-review__designs" style:max-inline-size={`${Number(width)/13}rem`}>
    {#each designs as design}<section class="design-review__option" aria-label={design.name}><div class="design-review__caption"><h2>{design.name}</h2>{#if design.variant==='ribbon'}<span>Recommended</span>{/if}<p>{design.description}</p></div>{#if design.variant==='ribbon'}<ImpeccableRibbon/>{:else if design.variant==='context'}<ImpeccableContext/>{:else}<ToolbarDesign variant="inspector"/>{/if}</section>{/each}
  </div>
</main>
<style>
  .design-review {min-block-size:100%;padding-block-end:3rem;background:var(--color-input);color:var(--color-panel-text);}
  .design-review__header {display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1.3rem 1.6rem;background:var(--color-panel-bg);border-block-end:1px solid var(--color-panel-border); & h1 {font-size:1.25rem;font-weight:600;margin:0;} & p {color:var(--color-panel-secondary);font-size:.9rem;margin:.25rem 0 0;} & a {color:var(--color-accent);white-space:nowrap;}}
  .design-review__controls {display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.6rem; & p {color:var(--color-panel-secondary);margin:0;} & label {display:flex;align-items:center;gap:.6rem;} & select {background:var(--color-surface-raised);color:var(--color-panel-text);border:1px solid var(--color-panel-border);border-radius:.3rem;padding:.35rem .6rem;}}
  .design-review__designs {inline-size:calc(100% - 2.4rem);margin-inline:auto;}
  .design-review__option {margin-block:1.6rem 2.7rem;}
  .design-review__caption {display:flex;align-items:center;flex-wrap:wrap;gap:.5rem .8rem;margin-block-end:.65rem; & h2 {font-size:1.15rem;font-weight:600;margin:0;} & span {color:var(--color-accent);font-size:.85rem;} & p {flex-basis:100%;color:var(--color-panel-secondary);margin:0;max-inline-size:72ch;font-size:.95rem;}}
</style>
