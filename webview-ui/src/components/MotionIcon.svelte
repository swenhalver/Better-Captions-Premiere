<script lang="ts">
  import LucideIcon from './LucideIcon.svelte';
  let {name}:{name:'clock'|'previous'|'next'|'key'}=$props();
  const icons={clock:'timer',previous:'chevron-left',next:'chevron-right',key:'diamond'} as const;
</script>
<span class="motion-icon"><LucideIcon name={icons[name]}/></span>
<style>.motion-icon{display:inline-flex;inline-size:1.1rem;block-size:1.1rem;font-size:1.1rem;flex-shrink:0;}</style>
