<script lang="ts">
  import type {CaptionItem,StyleConfig} from '../lib/types';
  import {resolveAppearance} from '../lib/appearance';
  import {transformCaptionText} from '../lib/typography';
  let {caption,style,selectedWord,onSelect}:{caption:CaptionItem;style:StyleConfig;selectedWord:number;onSelect:(index:number)=>void}=$props();
  const alpha=(color:string,value:number)=>color+Math.round(value*255).toString(16).padStart(2,'0');
</script>
<div class="word-sample">
  {#each caption.words as word,i}
    {@const a=resolveAppearance(style,i<selectedWord?'spokenWord':i===selectedWord?'activeWord':'upcomingWord')}
    <button title="Select {word.text}" aria-pressed={i===selectedWord} onclick={()=>onSelect(i)} style:font-family={a.fontFamily} style:font-size="{Math.max(11,Math.min(30,a.fontSize/3))}px" style:font-weight={a.fontWeight} style:font-style={a.italic?'italic':'normal'} style:color={a.color} style:opacity={a.opacity} style:letter-spacing="{a.letterSpacing/3}px" style:background={a.bubble?alpha(a.bubbleColor,a.bubbleOpacity):'transparent'} style:border-radius="{a.radius/3}px" style:padding="{a.bubble?a.padding/3:2}px" style:text-shadow={a.shadowEnabled?`${a.shadowOffsetX/3}px ${a.shadowOffsetY/3}px ${a.shadowBlur/3}px ${alpha(a.shadowColor,a.shadowOpacity)}`:'none'} style:-webkit-text-stroke={a.strokeEnabled?`${a.strokeWidth/3}px ${alpha(a.strokeColor,a.strokeOpacity)}`:'0'}>{transformCaptionText(word.text,a.textTransform)}</button>
  {/each}
</div>
<p class="caption-help word-sample__label">Type sample · click a word to select it</p>
<style>.word-sample{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:.35rem;padding:var(--caption-space-l);background:var(--color-input);margin-inline:var(--caption-space-l)}.word-sample button{border:0;cursor:pointer;paint-order:stroke fill;min-inline-size:0;overflow-wrap:anywhere}.word-sample button:hover{outline:1px solid var(--color-panel-secondary)}.word-sample__label{text-align:center;padding:.4rem var(--caption-space-l)}</style>
