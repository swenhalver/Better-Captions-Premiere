<script lang="ts">
  import { onMount } from "svelte";
  import type { CaptionItem, StyleConfig, AnimationConfig } from "../lib/types";
  import { CaptionRenderer } from "../lib/canvas/engine";
  import { getCaptionAtTime, formatTime } from "../lib/transcript/parser";

  interface Props {
    captions: CaptionItem[];
    currentTime: number;
    duration: number;
    style: StyleConfig;
    animation: AnimationConfig;
    frameWidth: number;
    frameHeight: number;
    onTimeChange: (time: number) => void;
  }

  let {
    captions,
    currentTime,
    duration,
    style,
    animation,
    frameWidth,
    frameHeight,
    onTimeChange,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let renderer: CaptionRenderer | undefined;
  let ctx: CanvasRenderingContext2D | undefined;
  let isPlaying = $state(false);
  let animFrameId = 0;
  let playStartTime = 0;
  let playStartOffset = 0;

  const CANVAS_WIDTH = 480;
  const CANVAS_HEIGHT = 120;

  function getCaptionStyle(): StyleConfig {
    const scale = CANVAS_WIDTH / Math.max(frameWidth, 1);
    return {
      ...style,
      fontSize: style.fontSize * scale,
      strokeWidth: style.strokeWidth * scale,
      backgroundPadding: style.backgroundPadding * scale,
      shadowBlur: style.shadowBlur * scale,
      shadowOffsetX: style.shadowOffsetX * scale,
      shadowOffsetY: style.shadowOffsetY * scale,
      positionX: 0.5,
      positionY: 0.5,
    };
  }

  function renderAtTime(time: number) {
    if (!renderer) return;
    const caption = getCaptionAtTime(captions, time);
    renderer.renderFrame(caption, time, getCaptionStyle(), animation);
  }

  onMount(() => {
    if (!canvasEl) return;
    canvasEl.width = CANVAS_WIDTH;
    canvasEl.height = CANVAS_HEIGHT;
    ctx = canvasEl.getContext("2d", { alpha: true })!;
    renderer = new CaptionRenderer(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
    renderAtTime(currentTime);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  });

  $effect(() => {
    const _ct = currentTime;
    const _ff = style.fontFamily;
    const _fs = style.fontSize;
    const _fw = style.fontWeight;
    const _tc = style.textColor;
    const _se = style.strokeEnabled;
    const _sc = style.strokeColor;
    const _so = style.strokeOpacity;
    const _sw = style.strokeWidth;
    const _she = style.shadowEnabled;
    const _shc = style.shadowColor;
    const _sho = style.shadowOpacity;
    const _sb = style.shadowBlur;
    const _sox = style.shadowOffsetX;
    const _soy = style.shadowOffsetY;
    const _be = style.backgroundEnabled;
    const _bc = style.backgroundColor;
    const _bo = style.backgroundOpacity;
    const _bp = style.backgroundPadding;
    const _mw = style.maxWidth;
    const _ta = style.textAlign;
    const _tt = style.textTransform;
    const _ap = animation.preset;
    const _fi = animation.fadeInDuration;
    const _fo = animation.fadeOutDuration;
    const _hc = animation.highlightColor;
    const _cl = captions.length;

    if (!renderer || isPlaying) return;
    renderAtTime(_ct);
  });

  function togglePlay() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    isPlaying = true;
    playStartTime = performance.now();
    playStartOffset = currentTime;
    tick();
  }

  function stopPlayback() {
    isPlaying = false;
    cancelAnimationFrame(animFrameId);
  }

  function tick() {
    if (!isPlaying) return;
    const elapsed = (performance.now() - playStartTime) / 1000;
    let newTime = playStartOffset + elapsed;
    if (newTime >= duration) {
      newTime = 0;
      playStartTime = performance.now();
      playStartOffset = 0;
    }

    renderAtTime(newTime);
    onTimeChange(newTime);

    animFrameId = requestAnimationFrame(tick);
  }

  function handleScrub(e: MouseEvent) {
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onTimeChange(ratio * duration);
  }

  function handleScrubMove(e: MouseEvent) {
    if (e.buttons !== 1) return;
    handleScrub(e);
  }

  let progressPercent = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
</script>

<div class="flex flex-col border-b border-panel-border">
  <div class="relative flex items-center justify-center overflow-hidden py-2 checkerboard-bg">
    <canvas
      bind:this={canvasEl}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      style="width: {CANVAS_WIDTH}px; height: {CANVAS_HEIGHT}px; max-width: 100%;"
    ></canvas>
    {#if captions.length === 0}
      <div class="absolute inset-0 flex items-center justify-center">
        <span class="text-[13px] text-white/40">No captions to preview</span>
      </div>
    {/if}
  </div>

  <div class="px-3 py-2 bg-surface flex items-center gap-2">
    <button
      onclick={togglePlay}
      class="p-1 rounded hover:bg-panel-hover-bg text-panel-text transition-colors border-none bg-transparent cursor-pointer"
      title={isPlaying ? "Pause" : "Play"}
      aria-label={isPlaying ? "Pause" : "Play"}
    >
      {#if isPlaying}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
      {/if}
    </button>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="flex-1 h-3 bg-panel-border rounded-full cursor-pointer relative group"
      onmousedown={handleScrub}
      onmousemove={handleScrubMove}
    >
      <div
        class="absolute inset-y-0 left-0 bg-accent rounded-full"
        style="width: {progressPercent}%"
      ></div>
      <div
        class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
        style="left: {progressPercent}%"
      ></div>
    </div>

    <span class="text-[12px] text-panel-secondary font-mono min-w-[80px] text-right">
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  </div>
</div>

<style>
  .checkerboard-bg {
    background-image:
      linear-gradient(45deg, #808080 25%, transparent 25%),
      linear-gradient(-45deg, #808080 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #808080 75%),
      linear-gradient(-45deg, transparent 75%, #808080 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
    background-color: #c0c0c0;
  }
</style>
