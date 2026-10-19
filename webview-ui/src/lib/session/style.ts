import { DEFAULT_STYLE, type StyleConfig } from '../types.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';

/** Old word counts are not character counts; keep captions as-is and use the character default. */
export function restoreSessionStyle(value?: Partial<StyleConfig> & { maxWords?: unknown }): StyleConfig {
  const { maxWords: _legacyWordLimit, ...saved } = value ?? {};
  let maxChars = DEFAULT_STYLE.maxChars;
  try { if (saved.maxChars !== undefined) maxChars = validateCharacterLimit(saved.maxChars); } catch { /* Invalid old settings use the default. */ }
  const style = { ...DEFAULT_STYLE, ...saved, maxChars,
    activeWord: { ...DEFAULT_STYLE.activeWord, ...saved.activeWord },
    spokenWord: { ...DEFAULT_STYLE.spokenWord, ...saved.spokenWord } };
  // Old sessions did not store word spacing. Keep their output unchanged until
  // the editor explicitly chooses the new normal spacing or a custom amount.
  if (value !== undefined && (typeof saved.wordSpacing !== 'number' || !Number.isFinite(saved.wordSpacing) || saved.wordSpacing < 0 || saved.wordSpacing > 300)) delete style.wordSpacing;
  return style;
}
