<script lang="ts">
  import App from "./main-webview.svelte";
  import DesignReview from './DesignReview.svelte';
  let width = $state("360");
</script>

{#if new URLSearchParams(window.location.search).has('designs')}
  <DesignReview />
{:else}
<div class="browser-preview">
  <header class="browser-preview__toolbar">
    <div><strong>S-Captions</strong><p>Interactive interface review</p></div>
    <label class="browser-preview__size"><span>Panel width</span><select bind:value={width}><option value="280">280 px</option><option value="360">360 px</option><option value="480">480 px</option><option value="wide">Expanded</option></select></label>
  </header>
  <div class="browser-preview__stage"><div class="browser-preview__panel" style:max-inline-size={width === "wide" ? "100%" : `${Number(width) / 13}rem`}><App /></div></div>
</div>
{/if}

<style>
  .browser-preview { display: grid; grid-template-rows: auto minmax(0, 1fr); block-size: 100%; background: #161616; }
  .browser-preview__toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-l); padding: var(--caption-space-s) var(--caption-space-l); border-block-end: 1px solid var(--color-panel-border); }
  .browser-preview__toolbar strong { font-weight: 600; }
  .browser-preview__toolbar p { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); }
  .browser-preview__size { display: flex; align-items: center; gap: .5rem; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); }
  .browser-preview__size select { color: var(--color-panel-text); border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-surface); padding: .35rem .6rem; }
  .browser-preview__stage { display: flex; justify-content: center; min-block-size: 0; }
  .browser-preview__panel { inline-size: 100%; block-size: 100%; background: var(--color-panel-bg); border-inline: 1px solid var(--color-panel-border); }
</style>
