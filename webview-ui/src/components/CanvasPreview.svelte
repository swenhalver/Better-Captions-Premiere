<script lang="ts">
  import { onMount } from "svelte";
  import type { CaptionItem, StyleConfig, AnimationConfig } from "../lib/types";
  import { CaptionRenderer } from "../lib/canvas/engine";
  import { getCaptionAtTime, formatTime } from "../lib/transcript/parser";
  interface Props {
    captions: CaptionItem[]; currentTime: number; duration: number; style: StyleConfig;
    animation: AnimationConfig; disabled?: boolean; frameWidth: number; frameHeight: number; selectedId?: string | null;
    onTimeChange: (time: number) => void;
    onPositionChange: (position: { x: number; y: number } | null, scope: "global" | "caption") => void;
  }
  let { captions, currentTime, duration, style, animation, frameWidth, frameHeight, selectedId = null, disabled = false, onTimeChange, onPositionChange }: Props = $props();
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let renderer: CaptionRenderer | undefined;
  let ready = $state(false);
  let isPlaying = $state(false);
  let animFrameId = 0;
  let playStartTime = 0;
  let playStartOffset = 0;
  let scope = $state<"global" | "caption">("global");
  let dragPosition = $state<{ x: number; y: number } | null>(null);
  let dragging = false;
  let selected = $derived(captions.find((caption) => caption.id === selectedId));
  let position = $derived(dragPosition ?? (scope === "caption" && selected?.position ? selected.position : { x: style.positionX, y: style.positionY }));
  let currentCaption = $derived(getCaptionAtTime(captions, currentTime));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  function renderAtTime(time: number) {
    if (!renderer) return;
    let caption = getCaptionAtTime(captions, time);
    let previewStyle = style;
    if (dragPosition) {
      if (scope === "global") previewStyle = { ...style, positionX: dragPosition.x, positionY: dragPosition.y };
      else if (caption?.id === selectedId) caption = { ...caption, position: dragPosition };
    }
    renderer.renderFrame(caption, time, previewStyle, animation);
  }
  onMount(() => {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d", { alpha: true });
    if (!ctx) return;
    renderer = new CaptionRenderer(ctx, frameWidth, frameHeight);
    ready = true;
    return () => cancelAnimationFrame(animFrameId);
  });
  $effect(() => {
    // Svelte tracks the complete nested style and caption state used during drawing.
    JSON.stringify({ style, animation, captions, dragPosition });
    if (!ready || !canvasEl || !renderer) return;
    if (canvasEl.width !== frameWidth || canvasEl.height !== frameHeight) {
      canvasEl.width = frameWidth;
      canvasEl.height = frameHeight;
      renderer.resize(frameWidth, frameHeight);
    }
    renderAtTime(currentTime);
  });
  function stopPlayback() { isPlaying = false; cancelAnimationFrame(animFrameId); }
  function togglePlay() {
    if (isPlaying) return stopPlayback();
    if (!captions.length) return;
    isPlaying = true;
    playStartTime = performance.now();
    playStartOffset = currentTime >= duration ? 0 : currentTime;
    tick();
  }
  function tick() {
    if (!isPlaying) return;
    const time = playStartOffset + (performance.now() - playStartTime) / 1000;
    if (time >= duration) { onTimeChange(duration); stopPlayback(); return; }
    onTimeChange(time);
    animFrameId = requestAnimationFrame(tick);
  }
  function pointerPosition(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  function startDrag(event: PointerEvent) {
    if (disabled || !captions.length || (scope === "caption" && !selected)) return;
    stopPlayback();
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragPosition = pointerPosition(event);
  }
  function moveDrag(event: PointerEvent) { if (dragging) dragPosition = pointerPosition(event); }
  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    if (dragPosition) onPositionChange({ ...dragPosition }, scope);
    dragPosition = null;
  }
  function keyboardPosition(event: KeyboardEvent) {
    if (disabled) return;
    const delta = event.shiftKey ? .05 : .01;
    const next = { ...position };
    if (event.key === "ArrowLeft") next.x -= delta;
    else if (event.key === "ArrowRight") next.x += delta;
    else if (event.key === "ArrowUp") next.y -= delta;
    else if (event.key === "ArrowDown") next.y += delta;
    else return;
    event.preventDefault();
    onPositionChange({ x: clamp(next.x), y: clamp(next.y) }, scope);
  }
  function updateAxis(axis: "x" | "y", event: Event) {
    if (disabled) return;
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) onPositionChange({ ...position, [axis]: clamp(value / 100) }, scope);
  }
</script>

<section class="canvas-preview" aria-label="Caption preview and frame position">
  <div class="canvas-preview__stage">
    <div class="canvas-preview__frame" style="aspect-ratio: {frameWidth} / {frameHeight}; --preview-aspect: {frameWidth / frameHeight}" role="slider" tabindex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="Caption frame position" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(position.y * 100)} aria-valuetext="X {Math.round(position.x * 100)} percent, Y {Math.round(position.y * 100)} percent. Drag or use arrow keys." onpointerdown={startDrag} onpointermove={moveDrag} onpointerup={finishDrag} onpointercancel={() => { dragging = false; dragPosition = null; }} onkeydown={keyboardPosition}>
      <canvas bind:this={canvasEl} width={frameWidth} height={frameHeight} aria-label="Captions rendered at the sequence frame size"></canvas>
      <div class="canvas-preview__safe-area" aria-hidden="true"></div>
      {#if currentCaption}
        <div class="canvas-preview__anchor" style="left: {(dragPosition ?? (currentCaption.position ?? { x: style.positionX, y: style.positionY })).x * 100}%; top: {(dragPosition ?? (currentCaption.position ?? { x: style.positionX, y: style.positionY })).y * 100}%" aria-hidden="true"></div>
      {:else}
        <p class="canvas-preview__empty">{captions.length ? "No caption at this time" : "Transcribe your sequence to begin"}</p>
      {/if}
    </div>
  </div>
  <div class="canvas-preview__transport">
    <button class="caption-button canvas-preview__play" onclick={togglePlay} disabled={disabled || !captions.length} aria-label={isPlaying ? "Pause caption preview" : "Play caption preview"}>{isPlaying ? "Pause" : "Play"}</button>
    <input {disabled} class="canvas-preview__scrubber" type="range" aria-label="Preview time" min="0" max={Math.max(.01, duration)} step=".01" value={currentTime} oninput={(event) => { stopPlayback(); onTimeChange(Number((event.target as HTMLInputElement).value)); }} />
    <span class="canvas-preview__time">{formatTime(currentTime)}</span>
  </div>
  <details class="canvas-preview__placement">
    <summary>Frame location <span class="canvas-preview__hint">Drag in preview</span></summary>
    <div class="canvas-preview__position-controls">
      <label class="caption-field caption-field--wide"><span>Apply position to</span><select {disabled} bind:value={scope}><option value="global">Global default</option><option value="caption" disabled={!selected}>Selected caption</option></select></label>
      <label class="caption-field"><span>X, % from left</span><input {disabled} type="number" min="0" max="100" step=".5" value={Number((position.x * 100).toFixed(2))} onchange={(event) => updateAxis("x", event)} /></label>
      <label class="caption-field"><span>Y, % from top</span><input {disabled} type="number" min="0" max="100" step=".5" value={Number((position.y * 100).toFixed(2))} onchange={(event) => updateAxis("y", event)} /></label>
      {#if scope === "caption" && selected?.position}<button class="caption-button caption-field--wide" disabled={disabled} onclick={() => onPositionChange(null, "caption")}>Use global position for this caption</button>{/if}
    </div>
    <p class="caption-help">{scope === "global" && selected?.position ? "This caption has its own position. Choose Selected caption to move it. " : ""}Full {frameWidth} × {frameHeight} frame. Preview plays captions without sequence audio. Arrow keys move 1%; Shift moves 5%.</p>
  </details>
</section>

<style>
  .canvas-preview { --preview-height: clamp(8rem, 27vh, 18rem); border-block-end: 1px solid var(--color-panel-border); }
  .canvas-preview__stage { display: flex; justify-content: center; background: var(--color-preview-stage); padding: var(--caption-space-s); }
  .canvas-preview__frame {
    position: relative; inline-size: min(100%, calc(var(--preview-height) * var(--preview-aspect))); max-block-size: var(--preview-height); overflow: hidden; cursor: crosshair; touch-action: none; background-color: var(--color-surface-raised);
    background-image: linear-gradient(45deg, #424242 25%, transparent 25%), linear-gradient(-45deg, #424242 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #424242 75%), linear-gradient(-45deg, transparent 75%, #424242 75%);
    background-size: 1rem 1rem; background-position: 0 0, 0 .5rem, .5rem -.5rem, -.5rem 0;
    &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    & canvas { display: block; inline-size: 100%; block-size: 100%; }
  }
  .canvas-preview__safe-area { position: absolute; inset: 5%; border: 1px dashed color-mix(in oklch, var(--color-panel-text) 17%, transparent); pointer-events: none; }
  .canvas-preview__anchor { position: absolute; inline-size: .45rem; block-size: .45rem; border-radius: 50%; border: 1px solid var(--color-panel-text); background: var(--color-accent); transform: translate(-50%, -50%); pointer-events: none; opacity: .65; }
  .canvas-preview__empty { position: absolute; inset: 0; display: grid; place-items: center; padding: var(--caption-space-m); color: var(--color-panel-secondary); text-align: center; pointer-events: none; }
  .canvas-preview__transport { display: flex; align-items: center; gap: var(--caption-space-s); padding: var(--caption-space-s) var(--caption-space-m); background: var(--color-surface); }
  .canvas-preview__play { min-inline-size: 3.6rem; }
  .canvas-preview__scrubber { flex: 1; min-inline-size: 0; accent-color: var(--color-accent); }
  .canvas-preview__time { font-family: ui-monospace, monospace; font-size: .8rem; }
  .canvas-preview__placement { padding: var(--caption-space-s) var(--caption-space-m); }
  .canvas-preview__placement > summary { cursor: pointer; font-size: .85rem; font-weight: 600; }
  .canvas-preview__hint { float: inline-end; font-weight: 400; font-size: .78rem; color: var(--color-panel-secondary); }
  .canvas-preview__position-controls { display: grid; grid-template-columns: 1fr 1fr; gap: var(--caption-space-s); margin-block: var(--caption-space-s); }
</style>
