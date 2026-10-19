import { buildNativeGraphicsPlan, type NativeGraphicsPlanInput } from './plan.ts';
import { transformCaptionText } from '../typography.ts';

export interface NativeGraphicsXmlOptions {
  /** A new ID per export; never used to find or replace existing project items. */
  generationId: string;
  sequenceName?: string;
}

/** Escape ordinary XML 1.0 text. No DTD, scripts, media references or private payloads. */
function escapeXml(value: string): string {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    throw new Error('Native graphics XML contains an unsupported control character.');
  }
  for (const c of value) {
    const point = c.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new Error('Native graphics XML contains an incomplete Unicode character.');
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Create a NEW sequence of editable Premiere titles through Apple's public
 * FCP7 Text generator interchange format. Does not overwrite a timeline,
 * claim native API text writes, or turn legacy movie/effect links into links
 * to the new graphics. See prototypes/native-graphics/README.md for native
 * acceptance evidence and fidelity limits.
 */
export function buildNativeGraphicsXml(input: NativeGraphicsPlanInput, options: NativeGraphicsXmlOptions) {
  if (!options || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.generationId)) {
    throw new Error('Use a new generation ID of 1–64 letters, digits, hyphens or underscores.');
  }
  const sourcePlan = buildNativeGraphicsPlan(input).manifest;
  if (!sourcePlan.phrases.length) throw new Error('Add caption words before exporting native graphics.');
  const { numerator, denominator } = sourcePlan.sequence.frameRate;
  const ntsc = denominator === 1001 && numerator % 1000 === 0;
  if (denominator !== 1 && !ntsc) throw new Error('FCP XML requires an integer frame rate or an exact 1000/1001 NTSC rate.');
  const timebase = ntsc ? numerator / 1000 : numerator;
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
  const style = sourcePlan.source.style;
  if (typeof style.fontFamily !== 'string' || !style.fontFamily.trim() || style.fontFamily.length > 256) throw new Error('Choose a font family of at most 256 characters.');
  if (!Number.isFinite(style.fontSize) || style.fontSize < 1 || style.fontSize > 4096) throw new Error('Font size must be between 1 and 4096.');
  if (!Number.isInteger(style.fontWeight) || style.fontWeight < 100 || style.fontWeight > 1000) throw new Error('Font weight must be between 100 and 1000.');
  if (typeof style.textColor !== 'string' || !/^#[\da-f]{6}$/i.test(style.textColor)) throw new Error('Choose a six-digit hexadecimal text color for native graphics.');
  if (!['left', 'center', 'right'].includes(style.textAlign)) throw new Error('Native graphics supports left, center or right alignment.');
  if (!['none', 'uppercase', 'lowercase', 'titlecase'].includes(style.textTransform)) throw new Error('Unsupported text case conversion.');

  // Measured in Premiere 26.5.2 at 1080p: XML 72 -> native 162.
  // This resolution-based normalization is an importer calibration, NOT an
  // Adobe API contract. Other sizes/platforms require native verification.
  const xmlFontSize = Number((style.fontSize * 480 / sourcePlan.sequence.frameHeight).toFixed(6));
  if (xmlFontSize <= 0 || xmlFontSize > 1000) throw new Error('This font/sequence size exceeds the FCP Text generator size range.');
  const nativeBold = style.fontWeight >= 600;
  const alignment = { left: 1, center: 2, right: 3 }[style.textAlign as 'left' | 'center' | 'right'];
  const channels = [1, 3, 5].map(index => parseInt(style.textColor.slice(index, index + 2), 16));
  const sequenceName = options.sequenceName ?? `Better Captions graphics ${options.generationId}`;
  if (typeof sequenceName !== 'string' || !sequenceName.trim() || sequenceName.length > 200) throw new Error('Sequence name must contain 1–200 characters.');
  const sequenceId = `bc-graphics-${options.generationId}`;
  const clips = sourcePlan.phrases.map(phrase => ({
    phraseId: phrase.id,
    xmlId: `${sequenceId}-${phrase.ordinal}`,
    name: `BCG ${options.generationId} ${phrase.ordinal}`,
    text: transformCaptionText(phrase.text, style.textTransform),
    startFrame: phrase.startFrame,
    endFrame: phrase.endFrame,
  }));
  const parameter = (id: string, name: string, value: string) => `<parameter><parameterid>${id}</parameterid><name>${name}</name><value>${value}</value></parameter>`;
  const items = clips.map(clip => {
    const duration = clip.endFrame - clip.startFrame;
    return `      <generatoritem id="${clip.xmlId}">
        <name>${escapeXml(clip.name)}</name><duration>${duration}</duration>${rate}
        <in>0</in><out>${duration}</out><start>${clip.startFrame}</start><end>${clip.endFrame}</end>
        <enabled>TRUE</enabled><anamorphic>FALSE</anamorphic><alphatype>black</alphatype>
        <effect><name>Text</name><effectid>Text</effectid><effectcategory>Text</effectcategory><effecttype>generator</effecttype><mediatype>video</mediatype>
          ${parameter('str', 'Text', escapeXml(clip.text))}
          ${parameter('fontname', 'Font', escapeXml(style.fontFamily))}
          ${parameter('fontsize', 'Size', String(xmlFontSize))}
          ${parameter('fontstyle', 'Style', nativeBold ? '2' : '1')}
          ${parameter('fontalign', 'Alignment', String(alignment))}
          ${parameter('fontcolor', 'Font Color', `<alpha>255</alpha><red>${channels[0]}</red><green>${channels[1]}</green><blue>${channels[2]}</blue>`)}
          ${parameter('origin', 'Origin', '<horiz>0</horiz><vert>0</vert>')}
        </effect>
        <sourcetrack><mediatype>video</mediatype></sourcetrack>
      </generatoritem>`;
  }).join('\n');
  const durationFrames = clips.at(-1)!.endFrame;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="5">
  <sequence id="${sequenceId}">
    <name>${escapeXml(sequenceName)}</name><duration>${durationFrames}</duration>${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media><video>
      <format><samplecharacteristics>${rate}<width>${sourcePlan.sequence.frameWidth}</width><height>${sourcePlan.sequence.frameHeight}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
      <track><enabled>TRUE</enabled><locked>FALSE</locked></track>
      <track>
${items}
        <enabled>TRUE</enabled><locked>FALSE</locked>
      </track>
    </video></media>
  </sequence>
</xmeml>
`;
  const warnings = [
    'Import graphics.xml into Premiere as a new sequence. Verify its native text, timing and font before use; generating XML is not host readback.',
    'Only phrase text, frame timing, font family, regular/bold, size, alignment and solid text color are requested. Missing fonts may be substituted by Premiere.',
    'Font-size normalization is calibrated from Premiere 26.5.2 at 1080p; verify other frame sizes and hosts.',
    'Titles start at the center. Saved position, text-box dimensions, wrapping and geometry keys remain in sourcePlan only. Set placement and native keys in Effect Controls.',
    'Past/current/next word states, relative Bold, italic, stroke, shadow, bubbles, animation and dynamic reflow remain in sourcePlan only. They are not silently baked into movies.',
    'Native edits are independent. Export again to a NEW sequence; automatic reconnection, text updates and replacement of existing clips are not implemented.',
  ];
  if (![400, 700].includes(style.fontWeight)) warnings.push(`Weight ${style.fontWeight} is requested as ${nativeBold ? 'Bold' : 'Regular'} because FCP Text supports those styles. The exact weight remains in sourcePlan.`);
  const manifest = {
    format: 'better-captions-native-graphics-xml' as const,
    version: 1,
    generationId: options.generationId,
    sourcePlan,
    output: {
      interchange: 'fcp7-xmeml-5-text-generator',
      sequenceId, sequenceName, durationFrames, videoTrackIndex: 1,
      frameRate: sourcePlan.sequence.frameRate,
      frameWidth: sourcePlan.sequence.frameWidth, frameHeight: sourcePlan.sequence.frameHeight,
      clips,
      requestedAppearance: { fontFamily: style.fontFamily, nativeFontSize: style.fontSize, xmlFontSize, bold: nativeBold, alignment: style.textAlign, color: style.textColor, origin: { horiz: 0, vert: 0 } },
      createsShapes: false, appliesWordStates: false, appliesGeometryKeyframes: false,
      nativeImportVerified: false,
    },
    reconnection: { status: 'unbound' as const, policy: 'new-sequence-only', nativeLinks: [] },
    warnings,
  };
  return { xml, manifest };
}
