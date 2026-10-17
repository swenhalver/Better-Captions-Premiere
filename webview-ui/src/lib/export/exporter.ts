import type { CaptionItem, StyleConfig, AnimationConfig, MotionProfile } from '../types';
import { CaptionRenderer } from '../canvas/engine';
import { validateCaptions } from '../transcript/edit';
import { textAreaBounds, type RenderBounds } from './bounds';

export interface ExportProgress { current: number; total: number; percent: number; caption?: number; captions?: number; }
export interface ExportDimensions { width: number; height: number; }
export interface CaptionFramePlan { caption: CaptionItem; startFrame: number; endFrame: number; frames: number; }
export interface CaptionFrameSink {
  begin(id: string): Promise<string>;
  write(folder: string, frames: string[], start: number): Promise<unknown>;
  finish(folder: string, frameRate: number, count: number, bounds:RenderBounds): Promise<string>;
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
    // Phrase grouping adds a short reading tail after the last spoken word.
    // Saved sessions may contain that tail past the sequence's final frame.
    // Trim only this bounded padding; a real speech or caption overrun stays an error.
    const lastWordEnd = source.words[source.words.length - 1].endTime;
    const generatedTail = source.endTime - lastWordEnd;
    const wordsFit = source.words.every(word => word.endTime <= duration + 1e-6);
    const trimTail = source.endTime > duration && generatedTail >= 0 && generatedTail <= .120001 && wordsFit;
    if (source.endTime > duration + 1e-6 && !trimTail) throw new Error(`Caption ${index + 1} extends beyond the sequence. Adjust its end time.`);
    const startFrame = floorFrame(source.startTime);
    const nextStart = index + 1 < captions.length ? floorFrame(captions[index + 1].startTime) : sequenceFrames;
    const endFrame = Math.min(ceilFrame(trimTail ? duration : source.endTime), nextStart, sequenceFrames);
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

export function motionScaleAt(profile:MotionProfile|undefined,time:number):{scaleX:number;scaleY:number}{
  if(!profile?.samples.length)return {scaleX:1,scaleY:1};
  let low=0,high=profile.samples.length-1;
  while(low<high){const middle=Math.floor((low+high)/2);if(profile.samples[middle].time<time)low=middle+1;else high=middle;}
  const after=profile.samples[low],before=profile.samples[Math.max(0,low-1)];
  const sample=Math.abs(before.time-time)<=Math.abs(after.time-time)?before:after;
  if(![sample.scaleX,sample.scaleY].every(value=>Number.isFinite(value)&&value>=.01&&value<=100))throw new Error('Keep caption box width and height between 1% and 10000% for reflow.');
  return sample;
}

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
      const boxWidth=Math.max(1,Math.round(width*style.maxWidth));
      let measuredHeight=0;
      const measurements=new Map<string,{width:number;height:number}>();
      // A measure-only pass considers every distinct native size sample. It
      // reserves all word states/entrances without storing any image frames.
      for(let frame=0;frame<cue.frames;frame++){
        const time=(cue.startFrame+frame+.5)/frameRate,{scaleX,scaleY}=motionScaleAt(cue.caption.motionProfile,time),key=scaleX+'|'+scaleY;
        if(!measurements.has(key)){
          renderer.resize(width*scaleX,height*scaleY);
          const layout=renderer.renderFrame(cue.caption,time,style,animation,{width:boxWidth*scaleX,height:height*scaleY,measureOnly:true});
          if(layout){measurements.set(key,layout);measuredHeight=Math.max(measuredHeight,layout.height/scaleY);}
        }
        if(frame%32===0){throwIfAborted(signal);await new Promise(resolve=>setTimeout(resolve,0));}
      }
      const bounds=textAreaBounds(width,height,style.maxWidth,cue.caption.position?.x??style.positionX,cue.caption.position?.y??style.positionY,measuredHeight,cue.caption.renderBounds);
      const layoutOverflow=[...measurements.entries()].some(([key,layout])=>{const [x,y]=key.split('|').map(Number);return layout.width>bounds.width*x+1e-6||layout.height>bounds.height*y+1e-6;});
      canvas.width=bounds.width;canvas.height=bounds.height;
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
        const {scaleX,scaleY}=motionScaleAt(cue.caption.motionProfile,time);
        renderer.resize(width*scaleX,height*scaleY);
        ctx.save();ctx.scale(1/scaleX,1/scaleY);
        renderer.renderFrame(cue.caption, time, style, animation,{width:bounds.width*scaleX,height:bounds.height*scaleY});
        ctx.restore();
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        if (!base64) throw new Error('The caption canvas did not return a PNG frame.');
        // A batch is capped both by frame count and encoded size, including at 4K.
        if (batch.length && (batch.length >= 32 || batchBytes + base64.length > 16 * 1024 * 1024)) await flush();
        batch.push(base64); batchBytes += base64.length; current++;
        onProgress?.({ current, total, percent: Math.round(current / total * 100), caption: cueIndex + 1, captions: plan.length });
        if (frame % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await flush(); throwIfAborted(signal);
      const mediaPath = await sink.finish(folder, frameRate, cue.frames,bounds);
      result.push({ ...cue.caption, mediaPath,renderBounds:bounds,layoutOverflow });
    }
    return result;
  } finally { canvas.width = 0; canvas.height = 0; }
}
