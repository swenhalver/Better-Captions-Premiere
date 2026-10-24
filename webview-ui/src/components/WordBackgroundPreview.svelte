<script lang="ts">
  import LucideIcon from './LucideIcon.svelte';
  interface Props {
    enabled: boolean | null;
    color: string | null;
    opacity: number | null;
    textColor: string | null;
    textOpacity: number | null;
    outlined: boolean | null;
    outlineColor: string | null;
    outlineOpacity: number | null;
  }
  let { enabled, color, opacity, textColor, textOpacity, outlined, outlineColor, outlineOpacity }: Props = $props();
</script>

<span class="word-background-preview" class:word-background-preview--enabled={enabled === true} aria-hidden="true">
  {#if enabled && color !== null && opacity !== null}
    <span class="word-background-preview__color" style:background-color={color} style:opacity={opacity}></span>
  {/if}
  {#if enabled === false}
    <LucideIcon name="type-off"/>
  {:else if outlined === true}
    <LucideIcon name="outline" fill={textColor ?? 'currentColor'} stroke={outlineColor ?? 'currentColor'} fillOpacity={textOpacity ?? 1} strokeOpacity={outlineOpacity ?? 1}/>
  {:else}
    <LucideIcon name="type" stroke={textColor ?? 'currentColor'} strokeOpacity={textOpacity ?? 1}/>
  {/if}
</span>

<style>
  .word-background-preview {position:relative;isolation:isolate;display:grid;place-items:center;inline-size:100%;block-size:100%;overflow:hidden;border-radius:inherit;background:var(--word-background-base,var(--color-surface-raised));color:var(--color-panel-text);& :global(svg) {position:relative;inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .word-background-preview--enabled {background:repeating-conic-gradient(#888 0% 25%,#ccc 0% 50%) 0 0 / .5rem .5rem;}
  .word-background-preview__color {position:absolute;inset:0;pointer-events:none;}
</style>
