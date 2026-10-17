// Frame-based boundaries used by every timing interaction in the concept.
export function edgeLimits(caption, index, edge) {
  const word = caption.words[index];
  const previous = caption.words[index - 1];
  const next = caption.words[index + 1];
  if (edge === 'start') return {
    min: previous ? (previous.end === word.start ? previous.start + 1 : previous.end) : caption.start,
    max: word.end - 1,
    linked: Boolean(previous && previous.end === word.start),
  };
  return {
    min: word.start + 1,
    max: next ? (next.start === word.end ? next.end - 1 : next.start) : caption.end,
    linked: Boolean(next && next.start === word.end),
  };
}

export function moveEdge(caption, index, edge, requested) {
  if (!['start', 'end'].includes(edge) || !Number.isFinite(requested)) return {changed:false, invalid:true};
  const limits = edgeLimits(caption, index, edge);
  const value = Math.max(limits.min, Math.min(limits.max, Math.round(requested)));
  const word = caption.words[index];
  const changed = word[edge] !== value;
  if (limits.linked) caption.words[index + (edge === 'start' ? -1 : 1)][edge === 'start' ? 'end' : 'start'] = value;
  word[edge] = value;
  return {changed, value, limited:value !== Math.round(requested), linked:limits.linked};
}

export function validCaption(caption) {
  return caption.words.every((word, i) => Number.isInteger(word.start) && Number.isInteger(word.end)
    && word.end - word.start >= 1 && word.start >= caption.start && word.end <= caption.end
    && (!i || caption.words[i-1].end <= word.start));
}
