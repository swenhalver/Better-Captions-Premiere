<script lang="ts">
  import type { CaptionItem } from '../lib/types';
  import { moveWordEdge, wordEdgeLimits, type WordEdge } from '../lib/transcript/timing';
  interface Props { caption: CaptionItem; fps: number; currentTime: number; selectedWord?: number; onSelectWord?: (index: number) => void; onChange: (caption: CaptionItem) => void; onSeek: (time: number) => void; }
  let { caption, fps, currentTime, selectedWord = 0, onSelectWord = () => {}, onChange, onSeek }: Props = $props();
  let zoom = $state(1), problem = $state(''), draft = $state<CaptionItem | null>(null);
  let lane: HTMLDivElement;
  const shown = $derived(draft ?? caption);
  const index = $derived(Math.max(0, Math.min(selectedWord, shown.words.length - 1)));
  const word = $derived(shown.words[index]);
  const duration = $derived(shown.endTime - shown.startTime);
  const percent = (time: number) => (time - shown.startTime) / duration * 100;
  function choose(i: number) { onSelectWord(i); onSeek(caption.words[i].startTime); }
  function edit(edge: WordEdge, seconds: number) {
    try { problem = ''; onChange(moveWordEdge(caption, index, edge, seconds, fps)); }
    catch (e) { problem = e instanceof Error ? e.message : String(e); }
  }
  function keyboard(event: KeyboardEvent, edge: WordEdge) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const limits = wordEdgeLimits(caption, index, edge, fps);
    const target = event.key === 'Home' ? limits.min / fps : event.key === 'End' ? limits.max / fps : word[edge] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 1) / fps;
    edit(edge, target);
  }
  function drag(event: PointerEvent, edge: WordEdge) {
    if (event.button !== 0) return;
    event.preventDefault(); const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const original = caption, rect = lane.getBoundingClientRect(), i = index;
    const move = (e: PointerEvent) => { try { draft = moveWordEdge(original, i, edge, original.startTime + (e.clientX - rect.left) / rect.width * duration, fps); problem = ''; } catch (e) { problem = e instanceof Error ? e.message : String(e); } };
    const finish = (e: PointerEvent) => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', finish); if (e.type !== 'pointercancel' && draft) onChange(draft); draft = null; };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', finish);
  }
</script>

<section class="word-timing" aria-label="Selected sentence word timing">
  <div class="word-timing__phrase">{#each shown.words as item, i}<button aria-pressed={i === index} onclick={() => choose(i)}>{item.text}</button>{/each}</div>
  <div class="word-timing__toolbar"><span>Words · one lane</span><label>Zoom <select aria-label="Word timeline zoom" bind:value={zoom}><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option></select></label></div>
  <div class="word-timing__scroll" role="region" aria-label="Word timeline; scroll horizontally">
    <div class="word-timing__lane" bind:this={lane} style:width="{Math.max(320, shown.words.length * 62) * zoom}px">
      <div class="word-timing__ruler"><span>{shown.startTime.toFixed(3)}s</span><span>{((shown.startTime + shown.endTime) / 2).toFixed(3)}s</span><span>{shown.endTime.toFixed(3)}s</span></div>
      {#each shown.words as item, i}<button class="word-timing__block" aria-label="{item.text}, {item.startTime.toFixed(3)} to {item.endTime.toFixed(3)} seconds" aria-pressed={i === index} style:left="{percent(item.startTime)}%" style:width="{(item.endTime - item.startTime) / duration * 100}%" onclick={() => choose(i)}>{item.text}</button>{/each}
      {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}{@const limits = wordEdgeLimits(shown,index,edge,fps)}<div class="word-timing__edge" role="slider" tabindex="0" aria-label="{edge === 'startTime' ? 'Start' : 'End'} boundary for {word.text}" aria-valuemin={limits.min} aria-valuemax={Math.max(limits.min,limits.max)} aria-valuenow={Math.round(word[edge]*fps)} aria-valuetext="{word[edge].toFixed(3)} seconds" style:left="{percent(word[edge])}%" onpointerdown={(event) => drag(event,edge)} onkeydown={(event) => keyboard(event,edge)}></div>{/each}
    </div>
  </div>
  <p class="caption-help">Drag edges or use arrows to move one frame. Connected edges cannot overlap.</p>
  <div class="word-timing__toolbar"><strong>{word.text}</strong><span>{Math.round((word.endTime-word.startTime)*fps)} frames</span></div>
  {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}<div class="word-timing__time"><label class="caption-field"><span>{edge === 'startTime' ? 'Start' : 'End'}, seconds</span><input type="number" step={1/fps} value={Number(word[edge].toFixed(6))} aria-label="Word {edge === 'startTime' ? 'start' : 'end'} in seconds" onchange={(event) => edit(edge,event.currentTarget.valueAsNumber)} /></label><button class="caption-button" aria-label="Move {edge === 'startTime' ? 'start' : 'end'} earlier one frame" onclick={() => edit(edge,word[edge]-1/fps)}>−1f</button><button class="caption-button" aria-label="Move {edge === 'startTime' ? 'start' : 'end'} later one frame" onclick={() => edit(edge,word[edge]+1/fps)}>+1f</button><button class="caption-button" title="Set boundary to playhead" onclick={() => edit(edge,currentTime)}>Set</button></div>{/each}
  <label class="caption-field"><span>Playhead · {currentTime.toFixed(3)}s</span><input aria-label="Word timing playhead" type="range" min={shown.startTime} max={Math.max(shown.startTime,shown.endTime-1/fps)} step={1/fps} value={currentTime} onchange={(event) => onSeek(event.currentTarget.valueAsNumber)} /></label>
  {#if problem}<p class="caption-message caption-message--error" role="alert">{problem}</p>{/if}
</section>
<style>
  .word-timing{display:flex;flex-direction:column;gap:var(--caption-space-s);min-inline-size:0}
  .word-timing__phrase{display:flex;flex-wrap:wrap;gap:.25rem}.word-timing__phrase button{font:inherit;background:transparent;color:var(--color-panel-text);border:1px solid transparent;border-radius:var(--caption-radius);padding:.3rem;cursor:pointer}.word-timing__phrase button[aria-pressed=true]{background:var(--color-selection);border-color:var(--color-accent)}.word-timing__phrase button:hover{background:var(--color-surface-raised)}
  .word-timing__toolbar{display:flex;justify-content:space-between;align-items:center;font-size:var(--caption-type-xs);gap:.5rem}.word-timing__toolbar select{background:var(--color-input);color:var(--color-panel-text);border:1px solid var(--color-panel-border);padding:.2rem}
  .word-timing__scroll{overflow-x:auto;border:1px solid var(--color-panel-border);padding:0 .45rem}.word-timing__lane{position:relative;block-size:5rem;min-inline-size:100%}.word-timing__ruler{display:flex;justify-content:space-between;padding-block:.4rem;font-size:var(--caption-type-xs);color:var(--color-panel-secondary);font-variant-numeric:tabular-nums}.word-timing__block{position:absolute;top:1.8rem;height:2.3rem;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:var(--color-surface-raised);border:1px solid var(--color-panel-border);color:var(--color-panel-text);padding:.3rem;font:inherit;cursor:pointer}.word-timing__block[aria-pressed=true]{background:var(--color-selection);border-color:var(--color-accent)}.word-timing__block:hover{filter:brightness(1.15)}.word-timing__edge{position:absolute;top:1.55rem;height:2.8rem;width:10px;margin-left:-5px;cursor:ew-resize;touch-action:none;border-inline:3px solid transparent;background:var(--color-accent);background-clip:content-box}.word-timing__time{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:.3rem;align-items:end}.word-timing__time button{padding-inline:.4rem;min-inline-size:0}.word-timing__time input{font-variant-numeric:tabular-nums}
</style>
