<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { CaptionItem } from '../lib/types';
  import { moveWord, moveWordEdge, wordEdgeLimits, type WordEdge } from '../lib/transcript/timing';
  interface Props { caption: CaptionItem; fps: number; currentTime: number; selectedWord?: number; onSelectWord?: (index: number) => void; onChange: (caption: CaptionItem) => void; onSeek: (time: number) => void;
    wordOffset?: number; onSplitBefore?: (wordIndex: number) => void; splitDisabled?: boolean; splitTitle?: string; caretSplitIndex?: number | null;
    onMergeNext?: () => void; mergeDisabled?: boolean; mergeTitle?: string;
    /** Adds a line above ('before') or below ('after'); a problem string explains why that side has no room. */
    onAddLine?: (side: 'before' | 'after') => void; addLineDisabled?: boolean; addLineProblems?: { before: string; after: string } | null;
    /** Words outside this range belong to the neighbouring lines and are shown for retiming across the line ending. */
    focusStart?: number; focusEnd?: number;
  }
  let { caption, fps, currentTime, selectedWord = 0, onSelectWord = () => {}, onChange, onSeek,
    wordOffset = 0, onSplitBefore, splitDisabled = false, splitTitle, caretSplitIndex = null, onMergeNext, mergeDisabled = false, mergeTitle, onAddLine, addLineDisabled = false, addLineProblems = null, focusStart = 0, focusEnd = Infinity }: Props = $props();
  let zoom = $state<number | 'fit'>('fit'), problem = $state(''), draft = $state<CaptionItem | null>(null);
  let lane: HTMLDivElement;
  let cleanupDrag: (() => void) | undefined;
  let suppressWordClick = false, clickReset: ReturnType<typeof setTimeout> | undefined;
  let zoomRevision = 0;
  onDestroy(() => { zoomRevision++; cleanupDrag?.(); if (clickReset !== undefined) clearTimeout(clickReset); });
  const shown = $derived(draft ?? caption);
  const index = $derived(Math.max(0, Math.min(selectedWord, shown.words.length - 1)));
  const word = $derived(shown.words[index]);
  const duration = $derived(shown.endTime - shown.startTime);
  const laneWidth = $derived(`${(zoom === 'fit' ? 1 : zoom) * 100}%`);
  const percent = (time: number) => (time - shown.startTime) / duration * 100;
  function choose(i: number, event?: MouseEvent) {
    if (suppressWordClick) { suppressWordClick = false; event?.preventDefault(); return; }
    onSelectWord(i); onSeek(caption.words[i].startTime);
  }
  const splitIndex = $derived(caretSplitIndex ?? wordOffset + index);
  const splitAllowed = $derived(caretSplitIndex !== null ? splitIndex > 0 : index > focusStart && index < Math.min(focusEnd, shown.words.length));
  function splitSelected() { if (!splitDisabled && onSplitBefore && splitAllowed) onSplitBefore(splitIndex); }
  function mergeSelected() { if (!mergeDisabled) onMergeNext?.(); }
  const addLines = [
    { side: 'before', label: 'Add line above', icon: 'M4 14h16M4 19h16M12 3v7M8.5 6.5h7' },
    { side: 'after', label: 'Add line below', icon: 'M4 5h16M4 10h16M12 14v7M8.5 17.5h7' },
  ] as const;
  async function zoomAtPointer(container: HTMLDivElement, next: number | 'fit', clientX: number) {
    const currentLane = lane, before = currentLane.getBoundingClientRect(), revision = ++zoomRevision;
    const fraction = Math.max(0, Math.min(1, (clientX - before.left) / before.width));
    zoom = next;
    await tick();
    if (revision !== zoomRevision || lane !== currentLane || !container.isConnected) return;
    const after = currentLane.getBoundingClientRect();
    container.scrollLeft = Math.max(0, Math.min(container.scrollWidth - container.clientWidth,
      container.scrollLeft + after.left + fraction * after.width - clientX));
  }
  function wheelZoom(container: HTMLDivElement) {
    const levels = ['fit', 1.5, 2, 3, 4] as const;
    let accumulated = 0, reset: ReturnType<typeof setTimeout> | undefined;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight : 1);
      if (Math.sign(accumulated) !== Math.sign(delta)) accumulated = 0;
      accumulated += delta;
      if (reset !== undefined) clearTimeout(reset);
      reset = setTimeout(() => { accumulated = 0; reset = undefined; }, 160);
      if (Math.abs(accumulated) < 40) return;
      const direction = accumulated < 0 ? 1 : -1;
      accumulated = 0;
      const current = zoom === 1 ? 0 : levels.indexOf(zoom as typeof levels[number]);
      const next = levels[Math.max(0, Math.min(levels.length - 1, current + direction))];
      if (next !== zoom) return zoomAtPointer(container, next, event.clientX);
    };
    container.addEventListener('wheel', wheel, { passive: false });
    return { destroy() { zoomRevision++; if (reset !== undefined) clearTimeout(reset); container.removeEventListener('wheel', wheel); } };
  }
  function edit(edge: WordEdge, seconds: number) {
    try { problem = ''; const next = moveWordEdge(caption, index, edge, seconds, fps); onChange(next); return next; }
    catch (e) { problem = e instanceof Error ? e.message : String(e); }
  }
  function secondsValue(seconds: number) {
    return Number(seconds.toFixed(Math.min(6, Math.max(3, Math.ceil(Math.log10(fps)) + 1))));
  }
  function inputRange(edge: WordEdge) {
    const limits = wordEdgeLimits(shown, index, edge, fps), frame = Math.round(word[edge] * fps);
    const value = secondsValue(word[edge]);
    // Keep the native spinner's step base aligned with the readable value.
    // The edit still commits exact frames through moveWordEdge, including NTSC rates.
    return { min: value + (limits.min - frame) / fps, max: value + (limits.max - frame) / fps };
  }
  function inputTime(edge: WordEdge, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (!Number.isFinite(input.valueAsNumber)) return;
    const next = edit(edge, input.valueAsNumber);
    if (next) input.value = String(secondsValue(next.words[index][edge]));
  }
  function blurTime(edge: WordEdge, event: FocusEvent) { (event.currentTarget as HTMLInputElement).value = String(secondsValue(word[edge])); }
  function keyboard(event: KeyboardEvent, edge: WordEdge, wordIndex: number) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    onSelectWord(wordIndex);
    const limits = wordEdgeLimits(caption, wordIndex, edge, fps);
    const target = event.key === 'Home' ? limits.min / fps : event.key === 'End' ? limits.max / fps : caption.words[wordIndex][edge] + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : 1) / fps;
    try { problem = ''; onChange(moveWordEdge(caption, wordIndex, edge, target, fps)); }
    catch (e) { problem = e instanceof Error ? e.message : String(e); }
  }
  function timingIdentity(value: CaptionItem) {
    return JSON.stringify([value.id, value.startTime, value.endTime, value.clipNodeId, value.projectItemId, value.mediaPath,
      value.words.map(word => [word.text, word.startTime, word.endTime])]);
  }
  function drag(event: PointerEvent, edge: WordEdge | null, wordIndex: number) {
    if (event.button !== 0) return;
    cleanupDrag?.();
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    event.preventDefault();
    onSelectWord(wordIndex);
    target.setPointerCapture(event.pointerId);
    const original = caption, rect = lane.getBoundingClientRect(), i = wordIndex, pointerId = event.pointerId, startX = event.clientX;
    const span = original.endTime - original.startTime, identity = timingIdentity(original);
    let moved = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || (!edge && !moved && Math.abs(e.clientX - startX) < 3)) return;
      moved = true;
      const delta = (e.clientX - startX) / rect.width * span;
      try { draft = edge ? moveWordEdge(original, i, edge, original.words[i][edge] + delta, fps) : moveWord(original, i, original.words[i].startTime + delta, fps); problem = ''; }
      catch (e) { problem = e instanceof Error ? e.message : String(e); }
    };
    const cleanup = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', finish); target.removeEventListener('lostpointercapture', finish);
      cleanupDrag = undefined; draft = null;
      try { if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId); } catch { /* The pointer may already have been released. */ }
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const next = draft;
      cleanup();
      if (e.type !== 'pointerup' || !moved) return;
      if (!edge) { suppressWordClick = true; if (clickReset !== undefined) clearTimeout(clickReset); clickReset = setTimeout(() => { suppressWordClick = false; clickReset = undefined; }, 0); }
      if (next && next.words.some((word, j) => word.startTime !== original.words[j].startTime || word.endTime !== original.words[j].endTime)) {
        if (timingIdentity(caption) !== identity) { problem = 'This line changed during the drag. Try again.'; return; }
        onChange({ ...caption, timingEstimated: false, words: caption.words.map((word, j) => ({ ...word, startTime: next.words[j].startTime, endTime: next.words[j].endTime })) });
      }
    };
    cleanupDrag = cleanup;
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', finish); target.addEventListener('lostpointercapture', finish);
  }
</script>

<section class="word-timing" aria-label="Selected line word timing">
  <div class="word-timing__toolbar"><span>Words</span><div class="word-timing__actions">
    <button class="word-timing__action" aria-label={caretSplitIndex !== null ? "Split line at text cursor" : "Split line before selected word"} onpointerdown={(event) => event.preventDefault()} title={splitTitle ?? (caretSplitIndex !== null ? (splitIndex > 0 ? 'Split line at text cursor' : 'Place the text cursor between words to split') : wordOffset + index > 0 ? `Split line before “${word.text}”` : 'Select a word after the first word to split')} disabled={splitDisabled || !onSplitBefore || !splitAllowed} onclick={splitSelected}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.12 8.12 3.88 3.88m-3.88 3.88L20 4m-6 10 6 6"/></svg></button>
    <button class="word-timing__action" aria-label="Merge with next line" title={mergeTitle ?? 'Merge with next line'} disabled={mergeDisabled || !onMergeNext} onclick={mergeSelected}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 4v3c0 3 3 5 7 5M5 20v-3c0-3 3-5 7-5m0 0h8m-3-3 3 3-3 3"/></svg></button>
    {#if onAddLine && addLineProblems}{#each addLines as add (add.side)}{@const problem = addLineProblems[add.side]}
      <button class="word-timing__action" aria-label={add.label} title={problem || `${add.label} (Enter at the ${add.side === 'before' ? 'start' : 'end'} of the text)`} onpointerdown={(event) => event.preventDefault()} disabled={addLineDisabled || !!problem} onclick={() => onAddLine(add.side)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d={add.icon}/></svg></button>
    {/each}{/if}
    <label>Zoom <select aria-label="Word timeline zoom" bind:value={zoom}><option value="fit">Fit content</option><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option><option value={3}>300%</option><option value={4}>400%</option></select></label>
  </div></div>
  <div class="word-timing__scroll" role="region" aria-label="Word timeline; scroll horizontally" use:wheelZoom>
    <div class="word-timing__lane" bind:this={lane} style:width={laneWidth}>
      <div class="word-timing__ruler"><span>{shown.startTime.toFixed(3)}s</span><span>{((shown.startTime + shown.endTime) / 2).toFixed(3)}s</span><span>{shown.endTime.toFixed(3)}s</span></div>
      {#each shown.words as item, i}
        {@const neighbour = i < focusStart || i >= focusEnd}
        <div class="word-timing__word" class:word-timing__word--selected={i === index} class:word-timing__word--neighbour={neighbour} title={neighbour ? `“${item.text}” is in the ${i < focusStart ? 'previous' : 'next'} line` : undefined} style:left="{percent(item.startTime)}%" style:width="{(item.endTime - item.startTime) / duration * 100}%">
          <button class="word-timing__block" aria-label="{item.text}{neighbour ? `, ${i < focusStart ? 'previous' : 'next'} line` : ''}, {item.startTime.toFixed(3)} to {item.endTime.toFixed(3)} seconds" aria-pressed={i === index} onpointerdown={(event) => drag(event,null,i)} onclick={(event) => choose(i,event)}>{item.text}</button>
          {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}{@const limits = wordEdgeLimits(shown,i,edge,fps)}
            <div class="word-timing__edge" class:word-timing__edge--start={edge === 'startTime'} class:word-timing__edge--end={edge === 'endTime'} role="slider" tabindex="0" aria-label="{edge === 'startTime' ? 'Start' : 'End'} boundary for {item.text}" aria-valuemin={limits.min} aria-valuemax={Math.max(limits.min,limits.max)} aria-valuenow={Math.round(item[edge]*fps)} aria-valuetext="{item[edge].toFixed(3)} seconds" onfocus={() => onSelectWord(i)} onpointerdown={(event) => drag(event,edge,i)} onkeydown={(event) => keyboard(event,edge,i)}></div>
          {/each}
        </div>
      {/each}
      {#if currentTime >= shown.startTime && currentTime <= shown.endTime}<div class="word-timing__playhead" aria-hidden="true" style:left="{percent(currentTime)}%"></div>{/if}
    </div>
  </div>
  <div class="word-timing__toolbar"><strong>{word.text}</strong><span>{Math.round((word.endTime-word.startTime)*fps)} frames</span></div>
  <div class="word-timing__times">
    {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}{@const range = inputRange(edge)}
      <label class="word-timing__time caption-field"><span>{edge === 'startTime' ? 'Start' : 'End'}, seconds</span><input type="number" min={range.min} max={range.max} step={1/fps} value={secondsValue(word[edge])} aria-label="Word {edge === 'startTime' ? 'start' : 'end'} in seconds" oninput={(event) => inputTime(edge,event)} onblur={(event) => blurTime(edge,event)} /></label>
    {/each}
  </div>
  {#if problem}<p class="caption-message caption-message--error" role="alert">{problem}</p>{/if}
</section>
<style>
  .word-timing{display:flex;flex-direction:column;gap:var(--caption-space-s);min-inline-size:0}
  .word-timing__toolbar{display:flex;justify-content:space-between;align-items:center;font-size:var(--caption-type-xs);gap:.5rem}.word-timing__toolbar select{background:var(--color-input);color:var(--color-panel-text);border:1px solid var(--color-panel-border);padding:.2rem}
  .word-timing__actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:var(--caption-space-xs);label{display:flex;align-items:center;gap:var(--caption-space-xs);white-space:nowrap}}
  .word-timing__action{display:grid;place-items:center;inline-size:2rem;block-size:2rem;padding:.25rem;border:1px solid transparent;border-radius:var(--caption-radius);background:transparent;color:var(--color-panel-text);cursor:pointer;svg{inline-size:1.15rem;block-size:1.15rem}&:hover:enabled{border-color:var(--color-panel-border);background:var(--color-surface-raised)}&:disabled{opacity:.45;cursor:default}}
  .word-timing__scroll{overflow-x:auto;min-inline-size:0;border:1px solid var(--color-panel-border);padding:0 .45rem}
  .word-timing__lane{position:relative;block-size:5rem;min-inline-size:100%}
  .word-timing__ruler{display:flex;justify-content:space-between;padding-block:.4rem;font-size:var(--caption-type-xs);color:var(--color-panel-secondary);font-variant-numeric:tabular-nums}
  .word-timing__word{position:absolute;inset-block-start:1.8rem;block-size:2.3rem;&:hover .word-timing__edge{opacity:1}}
  .word-timing__word--selected .word-timing__edge{opacity:1}
  .word-timing__word--neighbour .word-timing__block{border-style:dashed;color:var(--color-panel-secondary);&[aria-pressed=false]{background:transparent}}
  .word-timing__block{position:absolute;inset:0;inline-size:100%;block-size:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;background:var(--color-surface-raised);border:1px solid var(--color-panel-border);color:var(--color-panel-text);padding:.3rem;font:inherit;cursor:grab;touch-action:none;&[aria-pressed=true]{background:var(--color-selection);border-color:var(--color-accent)}&:hover{filter:brightness(1.15)}&:active{cursor:grabbing}}
  .word-timing__playhead{position:absolute;inset-block:1.5rem .25rem;inline-size:1px;background:var(--color-panel-text);pointer-events:none;z-index:1}
  .word-timing__edge{position:absolute;inset-block:-.25rem;inline-size:min(.8rem,25%);cursor:ew-resize;touch-action:none;opacity:0;z-index:2;&::after{content:"";position:absolute;inset-block:0;inline-size:min(3px,100%);background:var(--color-accent)}&:focus-visible{opacity:1}}
  .word-timing__edge--start{inset-inline-start:0;&::after{inset-inline-start:0}}
  .word-timing__edge--end{inset-inline-end:0;&::after{inset-inline-end:0}}
  .word-timing__times{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--caption-space-s);min-inline-size:0}
  .word-timing__time{min-inline-size:0;input{inline-size:100%;min-inline-size:0;font-variant-numeric:tabular-nums}}
</style>
