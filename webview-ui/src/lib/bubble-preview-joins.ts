/** Round only a filled word-background run's outer ends, including each wrapped row. */
export function bubblePreviewJoins(words: readonly { left: number; baseline: number; bubble: boolean; fillSpaces: boolean }[]): { before: boolean[]; after: boolean[] } {
  const before = words.map(() => false), after = words.map(() => false);
  for (let index = 0; index + 1 < words.length; index++) {
    const a = words[index], b = words[index + 1];
    // Background padding can overlap neighboring rows. A zero-size inline
    // baseline marker measures the physical text row independently of that box.
    const sameLine = b.left > a.left && Math.abs(a.baseline - b.baseline) < .75;
    if (a.bubble && a.fillSpaces && b.bubble && sameLine) {
      after[index] = true;
      before[index + 1] = true;
    }
  }
  return { before, after };
}
