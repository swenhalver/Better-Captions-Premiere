import type { CaptionItem, StyleConfig, AnimationConfig } from '../types';
import { CaptionRenderer } from '../canvas/engine';
import { validateCaptions } from '../transcript/edit';

export interface ExportProgress { current: number; total: number; percent: number; caption?: number; captions?: number; }
export interface ExportDimensions { width: number; height: number; }
export interface CaptionFramePlan { caption: CaptionItem; startFrame: number; endFrame: number; frames: number; }
export interface CaptionFrameSink {
  begin(id: string): Promise<string>;
  write(folder: string, frames: string[], start: number): Promise<unknown>;
  finish(folder: string, frameRate: number, count: number): Promise<string>;
}

/** Full sequence dimensions keep the preview's frame location and Premiere Motion aligned. */
export function calculateExportDimensions(_style: StyleConfig, sequenceWidth: number, sequenceHeight: number): ExportDimensions {
  if (![sequenceWidth, sequenceHeight].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('The sequence needs valid dimensions up to 8192 pixels.');
  return { width: sequenceWidth, height: sequenceHeight };
}

/** Cover each phrase with whole frames, sharing an edge when rounding would overlap. */
export function planCaptionFrames(captions: CaptionItem[], frameRate: number, duration: number): CaptionFramePlan[] {
  validateCaptions(captions);
  if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 240) throw new Error('The sequence needs a valid frame rate.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The sequence duration is empty.');
  const floorFrame = (time: number) => Math.floor(time * frameRate + 1e-7);
  const ceilFrame = (time: number) => Math.ceil(time * frameRate - 1e-7);
  const sequenceFrames = ceilFrame(duration);
  return captions.map((source, index) => {
    if (source.endTime > duration + 1e-6) throw new Error(`Caption ${index + 1} extends beyond the sequence. Adjust its end time.`);
    const startFrame = floorFrame(source.startTime);
    const nextStart = index + 1 < captions.length ? floorFrame(captions[index + 1].startTime) : sequenceFrames;
    const endFrame = Math.min(ceilFrame(source.endTime), nextStart, sequenceFrames);
    if (endFrame <= startFrame) throw new Error(`Caption ${index + 1} is shorter than one sequence frame after alignment. Merge it or adjust its timing.`);
    const startTime = startFrame / frameRate, endTime = endFrame / frameRate;
    const words = source.words.map((word, wordIndex) => {
      const start = Math.max(startTime, word.startTime), end = Math.min(endTime, word.endTime);
      if (end <= start) throw new Error(`Caption ${index + 1}, word ${wordIndex + 1} does not fit after frame alignment. Merge it or adjust the phrase boundary.`);
      return { ...word, startTime: start, endTime: end };
    });
    return { caption: { ...source, startTime, endTime, words, position: source.position ? { ...source.position } : undefined }, startFrame, endFrame, frames: endFrame - startFrame };
  });
}

function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error('Caption generation cancelled before timeline changes.'); }

/** Stream bounded PNG batches. Only verified ProRes movies survive each phrase render. */
export async function exportFrames(
  captions: CaptionItem[], style: StyleConfig, animation: AnimationConfig,
  sequenceWidth: number, sequenceHeight: number, frameRate: number, duration: number,
  sink: CaptionFrameSink, onProgress?: (progress: ExportProgress) => void, signal?: AbortSignal,
): Promise<CaptionItem[]> {
  const { width, height } = calculateExportDimensions(style, sequenceWidth, sequenceHeight);
  const plan = planCaptionFrames(captions, frameRate, duration);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Could not create a transparent caption canvas.');
  // Wait for the three requested font variants before measuring or rendering words.
  if (document.fonts) {
    const variants = [{ fontFamily: style.fontFamily, fontWeight: style.fontWeight, sizeScale: 1 }, style.activeWord, style.spokenWord];
    await Promise.all(variants.map(v => document.fonts.load(`${v.fontWeight} ${style.fontSize * v.sizeScale}px "${v.fontFamily || style.fontFamily}"`)));
    await document.fonts.ready;
  }
  const renderer = new CaptionRenderer(ctx, width, height), total = plan.reduce((sum, cue) => sum + cue.frames, 0);
  const result: CaptionItem[] = []; let current = 0;
  try {
    for (let cueIndex = 0; cueIndex < plan.length; cueIndex++) {
      throwIfAborted(signal);
      const cue = plan[cueIndex], folder = await sink.begin(cue.caption.id);
      let batch: string[] = [], batchBytes = 0, batchStart = 0;
      const flush = async () => {
        if (!batch.length) return;
        throwIfAborted(signal);
        await sink.write(folder, batch, batchStart);
        batchStart += batch.length; batch = []; batchBytes = 0;
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      for (let frame = 0; frame < cue.frames; frame++) {
        throwIfAborted(signal);
        // Sample the middle of the frame so a sub-frame speech onset is represented fairly.
        const time = (cue.startFrame + frame + .5) / frameRate;
        renderer.renderFrame(cue.caption, time, style, animation);
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        if (!base64) throw new Error('The caption canvas did not return a PNG frame.');
        // A batch is capped both by frame count and encoded size, including at 4K.
        if (batch.length && (batch.length >= 32 || batchBytes + base64.length > 16 * 1024 * 1024)) await flush();
        batch.push(base64); batchBytes += base64.length; current++;
        onProgress?.({ current, total, percent: Math.round(current / total * 100), caption: cueIndex + 1, captions: plan.length });
        if (frame % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await flush(); throwIfAborted(signal);
      const mediaPath = await sink.finish(folder, frameRate, cue.frames);
      result.push({ ...cue.caption, mediaPath });
    }
    return result;
  } finally { canvas.width = 0; canvas.height = 0; }
}
