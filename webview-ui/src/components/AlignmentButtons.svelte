<script lang="ts">
  interface Props {value:'left'|'center'|'right'|null;disabled?:boolean;onChange:(value:'left'|'center'|'right')=>void;}
  let {value,disabled=false,onChange}:Props=$props();
  // Lucide text-align-start / text-align-center / text-align-end (ISC license).
  const options=[{value:'left',label:'Align left',path:'M21 5H3M15 12H3M17 19H3'},{value:'center',label:'Align center',path:'M21 5H3M17 12H7M19 19H5'},{value:'right',label:'Align right',path:'M21 5H3M21 12H9M21 19H7'}] as const;
</script>
<div class="alignment" role="group" aria-label="Caption alignment">
  {#each options as option}<button class="alignment__button" aria-label={option.label} title={option.label} aria-pressed={value===option.value} {disabled} onclick={()=>onChange(option.value)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={option.path}/></svg></button>{/each}
</div>
<style>
  .alignment {display:flex;}
  .alignment__button {display:grid;place-items:center;inline-size:2.25rem;min-block-size:2.25rem;padding:var(--caption-space-xs);border:1px solid var(--color-panel-border);background:var(--color-input);color:var(--color-panel-secondary);cursor:pointer;&+& {border-inline-start:0;}& svg {inline-size:1.25rem;block-size:1.25rem;}&[aria-pressed="true"] {background:var(--color-selection);color:var(--color-accent);}&:hover:enabled {color:var(--color-panel-text);}&:focus-visible {outline:1px solid var(--color-accent);outline-offset:-2px;}&:disabled {opacity:.5;cursor:default;}}
</style>
