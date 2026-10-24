import type { SessionState } from '../types.ts';
import { resolveAppearance } from '../appearance.ts';
import { validateNativeDocument, type NativeColor, type NativeWordStyle } from './contract.ts';
import { encodeNativeTransportText } from './encode.ts';
import { nativePanelSequenceId } from './panel.ts';
import { nativeLineStyles } from './line-styles.ts';

function color(hex: string, alpha = 1): NativeColor {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Native captions need six-digit colors.');
  return { r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255, a: alpha };
}

/** Initial creation only. Existing native instances use exact-revision edits.
 * Font-space measurement is supplied by the installed font engine, in pixels;
 * the movie renderer's percentage must never become a native pixel count. */
export function prepareNativeCreation(session: SessionState, measuredSpace: number) {
  if (session.nativeClipId) throw new Error('This session already has a native caption clip.');
  if (!session.captions.length || !Number.isFinite(session.frameRate) || session.frameRate <= 0) throw new Error('Transcribe a sequence before creating native captions.');
  if (!Number.isFinite(measuredSpace) || measuredSpace < 0 || measuredSpace > 4096) throw new Error('The selected font spacing could not be measured.');
  const style = session.style;
  if (style.backgroundEnabled || style.textAlign !== 'center') throw new Error('Native captions currently require centered text without a whole-caption background. The original captions were preserved.');
  if (session.animation.preset !== 'karaoke') throw new Error('Choose Karaoke before creating a native effect. Other panel animation presets remain available with movie captions.');
  const states = ['upcomingWord', 'activeWord', 'spokenWord'] as const;
  const appearances = states.map(state => resolveAppearance(style, state));
  if (!appearances.every(a => a.textTransform === appearances[0].textTransform && a.letterSpacing === 0) || !['none', 'titlecase', 'uppercase', 'lowercase'].includes(appearances[0].textTransform)) throw new Error('Native captions support shared text case and zero letter spacing. The original captions were preserved.');
  const position = session.captions[0].position ?? { x: style.positionX, y: style.positionY };
  if (session.captions.some(c => {const effective = c.position ?? {x:style.positionX,y:style.positionY};return effective.x !== position.x || effective.y !== position.y;})) throw new Error('These captions use different positions. Keep their original clips or give them one initial position.');
  const wordStyle = (index: number): NativeWordStyle => {
    const a = appearances[index], raw = style[states[index]];
    return { fontFamily: a.fontFamily, fontSize: a.fontSize, sizeScale: 1, fontWeight: a.fontWeight, ...(raw?.fontWeightOffset === 0 || raw?.fontWeightOffset === 100 ? {fontWeightOffset:raw.fontWeightOffset} : {}), italic: a.italic, ...(raw?.underline===undefined?{}:{underline:a.underline}),
      opacity: a.opacity, color: color(a.color), bubble: a.bubble, ...(a.bubbleFillSpaces ? {bubbleFillSpaces:true} : {}), bubbleColor: color(a.bubbleColor, a.bubbleOpacity), padding: a.padding, ...(raw?.paddingTop===undefined?{}:{paddingTop:a.paddingTop}), ...(raw?.paddingRight===undefined?{}:{paddingRight:a.paddingRight}), ...(raw?.paddingBottom===undefined?{}:{paddingBottom:a.paddingBottom}), ...(raw?.paddingLeft===undefined?{}:{paddingLeft:a.paddingLeft}), ...(raw?.radiusTL===undefined?{}:{radiusTL:a.radiusTL}), ...(raw?.radiusTR===undefined?{}:{radiusTR:a.radiusTR}), ...(raw?.radiusBR===undefined?{}:{radiusBR:a.radiusBR}), ...(raw?.radiusBL===undefined?{}:{radiusBL:a.radiusBL}), ...(raw?.marginTop===undefined?{}:{marginTop:a.marginTop}), ...(raw?.marginRight===undefined?{}:{marginRight:a.marginRight}), ...(raw?.marginBottom===undefined?{}:{marginBottom:a.marginBottom}), ...(raw?.marginLeft===undefined?{}:{marginLeft:a.marginLeft}),  ...(raw?.bubblePaddingInline===undefined?{}:{bubblePaddingInline:a.bubblePaddingInline}), ...(raw?.bubblePaddingBlock===undefined?{}:{bubblePaddingBlock:a.bubblePaddingBlock}), radius: a.radius,
      outlineWidth: a.strokeEnabled ? a.strokeWidth : 0, outlineColor: color(a.strokeColor, a.strokeOpacity),
      shadowBlur: a.shadowBlur, shadowX: a.shadowOffsetX, shadowY: a.shadowOffsetY, shadowColor: color(a.shadowColor, a.shadowEnabled ? a.shadowOpacity : 0) };
  };
  const lineStyles = nativeLineStyles(style.lineStyles);
  const captions = session.captions.map((caption, captionIndex) => {
    if (!caption.words.length) throw new Error('A caption has no timed words.');
    return { id: caption.id, manualSplit: !!caption.manualSplit,
      start: Math.min(...caption.words.map(w => w.startTime)), end: Math.max(...caption.words.map(w => w.endTime)),
      words: caption.words.map((w, wordIndex) => {
        // Seed old session splits once. Subsequent native grouping follows word
        // boundaries, so an explicit join must take precedence over the flag.
        const lineBreakBefore = w.lineBreakBefore ?? (captionIndex > 0 && caption.manualSplit && wordIndex === 0 ? 'break' : undefined);
        return { text: w.text, start: w.startTime, end: w.endTime, endOfSentence: !!w.endOfSentence, ...(lineBreakBefore === undefined ? {} : { lineBreakBefore }), ...(w.pauseLinesRemoved === undefined ? {} : { pauseLinesRemoved: w.pauseLinesRemoved }) };
      }) };
  });
  const document = validateNativeDocument({ version: 1, binaryVersion: 10, animationAuthority: 'premiere-effect', sequenceId: nativePanelSequenceId(session.sequenceId), timeOriginSeconds: 0,
    captions, style: { upcoming: wordStyle(0), current: wordStyle(1), spoken: wordStyle(2), baseFontWeight: style.fontWeight,
      wordSpacing: measuredSpace * (style.wordSpacing ?? 100) / 100, lineHeight: style.lineHeight, titleCase: appearances[0].textTransform === 'titlecase', ...(['uppercase','lowercase'].includes(appearances[0].textTransform) ? {letterCase:appearances[0].textTransform} : {}), ...(lineStyles ? {lineStyles} : {}) } });
  const endFrame = Math.ceil(Math.max(...captions.map(c => c.end)) * session.frameRate - 1e-7);
  if (endFrame < 1 || endFrame > 1000000) throw new Error('This caption duration exceeds native creation limits.');
  const width = Math.round(session.frameWidth * style.maxWidth);
  const largestFont = Math.max(...appearances.map(a => a.fontSize));
  const phraseChars = Math.min(style.maxChars, Math.max(...session.captions.map(c => c.words.map(w => w.text).join(' ').length)));
  const estimatedLines = Math.max(1, Math.ceil(phraseChars * largestFont * .52 / width));
  const height = Math.min(session.frameHeight, Math.max(150, Math.ceil(largestFont * style.lineHeight * estimatedLines + 32)));
  return { document, documentText: encodeNativeTransportText(document), startFrame: 0, endFrame, sourceInTicks: '0',
    geometry: { position: [position.x, position.y], width, height, maxChars: style.maxChars } };
}

export function nativeOutputKind(session: SessionState): 'native-effect' | 'generated-movie' | 'new-native' {
  return session.nativeClipId ? 'native-effect' : session.captions.some(c => c.clipNodeId) ? 'generated-movie' : 'new-native';
}
