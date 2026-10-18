<script lang="ts">let {name}:{name:'clock'|'previous'|'next'|'key'}=$props();</script>
<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  {#if name==='clock'}<circle cx="10" cy="11" r="6.3"/><path d="M7 2h6M10 2v2M10 7v4l2 1M15 5l2-2"/>{:else if name==='key'}<path d="m10 3 7 7-7 7-7-7z"/>{:else if name==='previous'}<path d="m12 5-5 5 5 5"/>{:else}<path d="m8 5 5 5-5 5"/>{/if}
</svg>
<style>svg{inline-size:1.1rem;block-size:1.1rem;flex-shrink:0}</style>
