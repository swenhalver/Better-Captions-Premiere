import type { CaptionItem } from '../types';

interface MonitorOptions { currentTime?: number; selectedId?: string | null; frameRate: number; duration: number; preservePlayhead?: boolean; }
/** Prefer Premiere's current caption frame; otherwise show the editor's selected phrase. */
export function programMonitorPosition(captions: CaptionItem[], playhead: unknown, options: MonitorOptions) {
  const { frameRate, duration } = options;
  if (!captions.length || !Number.isFinite(frameRate) || frameRate <= 0 || !Number.isFinite(duration) || duration <= 0) throw new Error('No valid caption frame is available to show in Premiere.');
  const inCaption = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < duration && captions.some(caption => value >= caption.startTime && value < caption.endTime);
  const selected = captions.find(caption => caption.id === options.selectedId) ?? captions[0];
  const firstWord = selected.words[0];
  const selectedTime = firstWord ? (firstWord.startTime + firstWord.endTime) / 2 : (selected.startTime + selected.endTime) / 2;
  let meaningfulTime = inCaption(playhead) ? playhead : inCaption(options.currentTime) ? options.currentTime : selectedTime;
  const containing = captions.find(caption => meaningfulTime >= caption.startTime && meaningfulTime < caption.endTime);
  const speech = containing?.words[0];
  // Frame alignment can put an empty frame before speech for pop/typewriter.
  if (speech && (Math.floor(meaningfulTime * frameRate + 1e-7) + .5) / frameRate < speech.startTime) meaningfulTime = (speech.startTime + speech.endTime) / 2;
  const finalFrame = Math.max(0, Math.ceil(duration * frameRate - 1e-7) - 1);
  const targetFrame = Math.min(finalFrame, Math.max(0, Math.floor(meaningfulTime * frameRate + 1e-7)));
  const refreshFrame = targetFrame < finalFrame ? targetFrame + 1 : Math.max(0, targetFrame - 1);
  return { time: targetFrame / frameRate, refreshTime: refreshFrame / frameRate };
}

/** Two completed seeks invalidate the Program Monitor's cached relinked-media frame. */
export async function refreshProgramMonitor(hostApi: any, captions: CaptionItem[], sequenceId: string, options: MonitorOptions) {
  const info = await hostApi.getActiveSequenceInfo();
  if (!info || info.id !== sequenceId) throw new Error('The active sequence changed before the Program Monitor could be refreshed.');
  let position: { time: number; refreshTime: number };
  if (options.preservePlayhead) {
    if (!Number.isFinite(options.frameRate) || options.frameRate <= 0 || !Number.isFinite(options.duration) || options.duration <= 0) throw new Error('Premiere did not expose valid sequence frame timing for a Program Monitor refresh.');
    if (typeof info.playhead !== 'number' || !Number.isFinite(info.playhead) || info.playhead < 0) throw new Error('Premiere did not expose its current playhead. The Program Monitor refresh did not move it.');
    position = { time: info.playhead, refreshTime: info.playhead + 1 / options.frameRate < options.duration ? info.playhead + 1 / options.frameRate : Math.max(0, info.playhead - 1 / options.frameRate) };
  } else position = programMonitorPosition(captions, info.playhead, options);
  if (position.refreshTime !== position.time) await hostApi.showInPremiere(position.refreshTime, sequenceId);
  await hostApi.showInPremiere(position.time, sequenceId);
  return position.time;
}
