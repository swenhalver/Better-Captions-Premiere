<script lang="ts">
  // Official Lucide icon paths, covered by uxp/third-party-notices.txt (ISC).
  let { name, fill = 'none', stroke = 'currentColor', fillOpacity = 1, strokeOpacity = 1 }: { name: 'bold' | 'italic' | 'line-height' | 'outline' | 'reset' | 'chevron-down' | 'timer' | 'diamond' | 'chevron-left' | 'chevron-right' | 'a-arrow-down' | 'a-arrow-up' | 'underline'; fill?: string; stroke?: string; fillOpacity?: number; strokeOpacity?: number } = $props();
  const paths = {
    underline: ['M6 4v6a6 6 0 0 0 12 0V4'],
    bold: ['M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8'],
    italic: ['M19 4H10', 'M14 20H5', 'M15 4 9 20'],
    // Lucide list-chevrons-up-down, used for the line-height control.
    'line-height': ['M3 5h8', 'M3 12h8', 'M3 19h8', 'M15 8l3-3 3 3', 'M15 16l3 3 3-3'],
    outline: ['M14 16.5a.5.5 0 0 0 .5.5h.5a2 2 0 0 1 0 4H9a2 2 0 0 1 0-4h.5a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5V8a2 2 0 0 1-4 0V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-.5a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5Z'],
    reset: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
    'chevron-down': ['m6 9 6 6 6-6'],
    timer: ['M10 2h4', 'm12 14 3-3'],
    diamond: ['M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z'],
    'chevron-left': ['m15 18-6-6 6-6'],
    'chevron-right': ['m9 18 6-6-6-6'],
    'a-arrow-down': ['m14 12 4 4 4-4', 'M18 16V7', 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16', 'M3.304 13h6.392'],
    'a-arrow-up': ['m14 11 4-4 4 4', 'M18 16V7', 'm2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16', 'M3.304 13h6.392'],
  };
</script>
<svg viewBox="0 0 24 24" {fill} {stroke} fill-opacity={fillOpacity} stroke-opacity={strokeOpacity} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#each paths[name] as path}<path d={path}/>{/each}{#if name==='underline'}<line x1="4" x2="20" y1="20" y2="20"/>{/if}{#if name==='timer'}<circle cx="12" cy="14" r="8"/>{/if}</svg>
<style>
  svg {display:block;inline-size:1em;block-size:1em;flex-shrink:0;}
</style>
