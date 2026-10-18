import { DEFAULT_STYLE, type StyleConfig } from '../types.ts';
import { validateCharacterLimit } from '../transcript/parser.ts';

/** Old word counts are not character counts; keep captions as-is and use the character default. */
export function restoreSessionStyle(value?: Partial<StyleConfig> & { maxWords?: unknown }): StyleConfig {
  const { maxWords: _legacyWordLimit, ...saved } = value ?? {};
  let maxChars = DEFAULT_STYLE.maxChars;
  try { if (saved.maxChars !== undefined) maxChars = validateCharacterLimit(saved.maxChars); } catch { /* Invalid old settings use the default. */ }
  return { ...DEFAULT_STYLE, ...saved, maxChars,
    activeWord: { ...DEFAULT_STYLE.activeWord, ...saved.activeWord },
    spokenWord: { ...DEFAULT_STYLE.spokenWord, ...saved.spokenWord } };
}
