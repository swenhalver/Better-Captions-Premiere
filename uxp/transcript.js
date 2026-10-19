'use strict';
const ppro = require('premierepro');
const { mapTranscript, hasWords, parseNativeTranscript, validateTranscriptRange, intersectTranscriptRegion } = require('./transcript-core.js');

async function readNative(item) {
  // A source without a transcript can throw on export. Fetch reports this as
  // missing; Transcribe creates the native transcript through Premiere itself.
  try { return await ppro.Transcript.exportToJSON(item); } catch { return null; }
}

async function audioPlan(sequence, range) {
  const result = [];
  for (let index = 0; index < await sequence.getAudioTrackCount(); index++) {
    const track = await sequence.getAudioTrack(index);
    if (await track.isMuted()) continue;
    const clips = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    for (const clip of clips) {
      if (await clip.isDisabled()) continue;
      const region = { start: (await clip.getStartTime()).seconds, end: (await clip.getEndTime()).seconds, in: (await clip.getInPoint()).seconds, out: (await clip.getOutPoint()).seconds };
      const mappedRegion = range ? intersectTranscriptRegion(region, range) : region;
      if (!mappedRegion) continue;
      const item = ppro.ClipProjectItem.cast(await clip.getProjectItem());
      if (await item.isSequence()) throw new Error('This sequence contains nested audio. Open the dialogue sequence and transcribe there first.');
      if (await clip.isSpeedReversed()) throw new Error('Reversed audio cannot provide forward spoken-word timestamps.');
      const path = await item.getMediaFilePath();
      result.push({ item, track: index, region, mappedRegion, path, key: path || item });
    }
  }
  return result;
}
function planRevision(plan) {
  return JSON.stringify(plan.map(entry => ({ track: entry.track, region: entry.region, path: entry.path || '', name: String(entry.item.name || '') })));
}

async function transcript(sequence, shouldTranscribe, range) {
  if (!sequence) throw new Error('Open a sequence in Premiere before creating captions.');
  // A static sequence transcript is valid for a full fetch but may end before
  // newly appended audio. Extensions must always map the current source clips.
  if (!range) {
    const sequenceItem = ppro.ClipProjectItem.cast(await sequence.getProjectItem());
    const sequenceJSON = await readNative(sequenceItem);
    if (hasWords(sequenceJSON)) return JSON.stringify(parseNativeTranscript(sequenceJSON));
  }
  const plan = await audioPlan(sequence, range), revision = range ? planRevision(plan) : null;
  const cache = new Map(), segments = [], skippedAudioClips = [];
  let missing = 0, attempted = 0, enabled = 0;
  for (const entry of plan) {
      const { item, mappedRegion, key } = entry;
      enabled++;
      const skipped = reason => skippedAudioClips.push({ name: String(item.name || 'Audio clip'), track: entry.track, start: mappedRegion.start, end: mappedRegion.end, reason });
      // Reused sources are read/transcribed once, then mapped for each edit.
      let json;
      if (cache.has(key)) json = cache.get(key);
      else {
        json = await readNative(item);
        let savedEmpty = false;
        if (range) { try { savedEmpty = !hasWords(json) && !!parseNativeTranscript(json); } catch {} }
        if (!hasWords(json) && shouldTranscribe && !savedEmpty) {
          attempted++;
          const ok = await ppro.Transcript.transcribeClipProjectItem(item);
          if (!ok) throw new Error('Premiere could not transcribe ' + item.name + '. Check its language pack and Speech to Text preferences.');
          // A failed export is an error. A valid empty transcript can be music
          // or ambient audio and is reported separately from spoken dialogue.
          try { json = await ppro.Transcript.exportToJSON(item); }
          catch (error) { throw new Error('Premiere could not export the native transcript for ' + item.name + ': ' + (error.message || String(error))); }
          parseNativeTranscript(json);
        }
        cache.set(key, json);
      }
      if (!hasWords(json)) {
        let validEmpty = false;
        try { parseNativeTranscript(json); validEmpty = true; } catch {}
        if (shouldTranscribe || validEmpty) skipped('Premiere detected no spoken words.'); else missing++;
        continue;
      }
      const mapped = mapTranscript(json, mappedRegion);
      if (!mapped.length) skipped('No transcribed words occur in this timeline range.');
      segments.push(...mapped);
  }
  if (range && planRevision(await audioPlan(sequence, range)) !== revision) throw new Error('The sequence audio changed during transcription. Extend the captions again from the current timeline.');
  if (!segments.length) {
    if (!shouldTranscribe && missing) return null;
    throw new Error(!enabled ? 'This sequence has no enabled audio clips to transcribe.' : attempted ? 'Premiere completed transcription but detected no spoken words in the enabled audio clips.' : 'No transcribed words occur in the enabled audio clips.');
  }
  if (missing && !shouldTranscribe) throw new Error('Some enabled audio clips have no native transcript yet. Use Transcribe in Premiere to complete them.');
  return JSON.stringify({ language: 'Premiere preferences', segments, source: 'Premiere Pro Speech to Text', timing: 'sequence', skippedAudioClips, ...(range ? { range } : {}) });
}

module.exports = {
  fetchTranscript: sequence => transcript(sequence, false),
  transcribe: sequence => transcript(sequence, true),
  transcribeRange: async (sequence, beginSeconds, endSeconds) => transcript(sequence, true, validateTranscriptRange(beginSeconds, endSeconds)),
};
