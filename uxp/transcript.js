'use strict';
const ppro = require('premierepro');
const { mapTranscript, hasWords, parseNativeTranscript } = require('./transcript-core.js');

async function readNative(item) {
  // A source without a transcript can throw on export. Fetch reports this as
  // missing; Transcribe creates the native transcript through Premiere itself.
  try { return await ppro.Transcript.exportToJSON(item); } catch { return null; }
}

async function transcript(sequence, shouldTranscribe) {
  if (!sequence) throw new Error('Open a sequence in Premiere before creating captions.');
  const sequenceItem = ppro.ClipProjectItem.cast(await sequence.getProjectItem());
  // Static sequence transcripts already contain sequence-relative word times.
  const sequenceJSON = await readNative(sequenceItem);
  if (hasWords(sequenceJSON)) return JSON.stringify(parseNativeTranscript(sequenceJSON));

  const cache = new Map(), segments = [], skippedAudioClips = [];
  let missing = 0, attempted = 0, enabled = 0;
  for (let index = 0; index < await sequence.getAudioTrackCount(); index++) {
    const track = await sequence.getAudioTrack(index);
    if (await track.isMuted()) continue;
    const clips = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    for (const clip of clips) {
      if (await clip.isDisabled()) continue;
      const item = ppro.ClipProjectItem.cast(await clip.getProjectItem());
      if (await item.isSequence()) throw new Error('This sequence contains nested audio. Open the dialogue sequence and transcribe there first.');
      if (await clip.isSpeedReversed()) throw new Error('Reversed audio cannot provide forward spoken-word timestamps.');
      enabled++;
      const region = { start: (await clip.getStartTime()).seconds, end: (await clip.getEndTime()).seconds, in: (await clip.getInPoint()).seconds, out: (await clip.getOutPoint()).seconds };
      const skipped = reason => skippedAudioClips.push({ name: String(item.name || clip.name || 'Audio clip'), track: index, start: region.start, end: region.end, reason });
      // Files can be used repeatedly at different in/out points or speeds.
      // Cache only the source transcript and map each timeline clip separately.
      const key = (await item.getMediaFilePath()) || item;
      let json;
      if (cache.has(key)) json = cache.get(key);
      else {
        json = await readNative(item);
        if (!hasWords(json) && shouldTranscribe) {
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
      const mapped = mapTranscript(json, region);
      if (!mapped.length) skipped('No transcribed words occur in this timeline range.');
      segments.push(...mapped);
    }
  }
  if (!segments.length) {
    if (!shouldTranscribe && missing) return null;
    throw new Error(!enabled ? 'This sequence has no enabled audio clips to transcribe.' : attempted ? 'Premiere completed transcription but detected no spoken words in the enabled audio clips.' : 'No transcribed words occur in the enabled audio clips.');
  }
  if (missing && !shouldTranscribe) throw new Error('Some enabled audio clips have no native transcript yet. Use Transcribe in Premiere to complete them.');
  return JSON.stringify({ language: 'Premiere preferences', segments, source: 'Premiere Pro Speech to Text', timing: 'sequence', skippedAudioClips });
}

module.exports = {
  fetchTranscript: sequence => transcript(sequence, false),
  transcribe: sequence => transcript(sequence, true),
};
