import type { TextTransform } from './types';

/** Display-only case conversion shared by layout, painting and the type sample. */
export function transformCaptionText(text: string, transform: TextTransform, precedingText = ''): string {
  if (transform === 'uppercase') return text.toUpperCase();
  if (transform === 'lowercase') return text.toLowerCase();
  if (transform !== 'titlecase') return text;
  const title = (value: string) => value.toLowerCase().replace(
    /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}\p{M}]+)*/gu,
    word => word.replace(/\p{L}/u, letter => letter.toUpperCase()),
  );
  // A wrapped fragment keeps its place in the original word. Starting a new
  // visual line must not capitalize the middle of an existing word.
  return title(precedingText + text).slice(title(precedingText).length);
}
