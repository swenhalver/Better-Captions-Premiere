'use strict';
function sequenceKey(value) { return String(value).replace(/[{}]/g, '').toLowerCase(); }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function timedWord(word) {
  return record(word) && word.type === 'word' && typeof word.text === 'string' && !!word.text.trim() && Number.isFinite(word.start) && word.start >= 0 && Number.isFinite(word.duration) && word.duration > 0 && Number.isFinite(word.start + word.duration);
}
function parseNativeTranscript(json) {
  let value;
  try { value = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw new Error('Premiere returned invalid native transcript JSON.'); }
  if (!record(value) || !Array.isArray(value.segments) || value.segments.some(segment => !record(segment) || !Array.isArray(segment.words) || segment.words.some(word => !timedWord(word) && !(record(word) && word.type === 'punctuation' && typeof word.text === 'string' && !!word.text.trim())))) throw new Error('Premiere returned an invalid native transcript structure or word timing.');
  return value;
}
function mapTranscript(json, region) {
  const input = parseNativeTranscript(json);
  if (!record(region) || !['start', 'end', 'in', 'out'].every(key => Number.isFinite(region[key]) && region[key] >= 0) || region.end <= region.start || region.out <= region.in) throw new Error('Reversed or invalid audio timing cannot be transcribed automatically.');
  const scale = (region.end - region.start) / (region.out - region.in);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Reversed or invalid audio timing cannot be transcribed automatically.');
  const segments = [];
  for (const segment of input.segments) {
    const words = [], timed = []; let prefix = [], previousIncluded = false;
    for (const word of segment.words) {
      if (word.type === 'punctuation') {
        if (/^[“‘([{]+$/.test(word.text.trim()) || !words.length && /^["']+$/.test(word.text.trim())) prefix.push(word);
        else if (previousIncluded) words.push({ ...word, start: timed[timed.length - 1].start + timed[timed.length - 1].duration, duration: 0 });
        continue;
      }
      const start = Math.max(word.start, region.in), end = Math.min(word.start + word.duration, region.out);
      if (end <= start) { previousIncluded = false; prefix = []; continue; }
      const mappedStart = Math.max(region.start, Math.min(region.end, region.start + (start - region.in) * scale));
      const mappedEnd = Math.max(region.start, Math.min(region.end, region.start + (end - region.in) * scale));
      if (mappedEnd <= mappedStart) { previousIncluded = false; prefix = []; continue; }
      words.push(...prefix.map(mark => ({ ...mark, start: mappedStart, duration: 0 }))); prefix = [];
      const mapped = { ...word, start: mappedStart, duration: mappedEnd - mappedStart };
      words.push(mapped); timed.push(mapped); previousIncluded = true;
    }
    if (timed.length) {
      const start = timed.reduce((value, word) => Math.min(value, word.start), Infinity), end = timed.reduce((value, word) => Math.max(value, word.start + word.duration), -Infinity);
      segments.push({ ...segment, start, duration: end - start, words });
    }
  }
  return segments;
}
function hasWords(json) {
  if (!json) return false;
  try { return parseNativeTranscript(json).segments.some(segment => segment.words.some(timedWord)); } catch { return false; }
}
module.exports = { sequenceKey, mapTranscript, hasWords, parseNativeTranscript };
