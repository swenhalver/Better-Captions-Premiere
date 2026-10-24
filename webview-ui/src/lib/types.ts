import type { RenderBounds } from './export/bounds';
export type { RenderBounds } from './export/bounds';
export interface MotionSample { time: number; scaleX: number; scaleY: number; }
export interface MotionProfile { signature: string; watchSignature?: string; watchError?: string; samples: MotionSample[]; }

export interface TranscriptWord {
  text: string;
  start: number;
  duration: number;
  confidence: number;
  eos: boolean;
  type: "word" | "punctuation";
  tags: string[];
}

export interface TranscriptSegment {
  duration: number;
  language: string;
  speaker: string;
  start: number;
  words: TranscriptWord[];
}

export interface TranscriptSpeaker {
  id: string;
  name: string;
}

export interface TranscriptJSON {
  language: string;
  segments: TranscriptSegment[];
  speakers: TranscriptSpeaker[];
}

export interface CaptionItem {
  id: string;
  words: CaptionWord[];
  text: string;
  startTime: number;
  endTime: number;
  speaker?: string;
  clipNodeId?: string;
  projectItemId?: string;
  mediaPath?: string;
  position?: { x: number; y: number };
  timingEstimated?: boolean;
  renderBounds?: RenderBounds;
  motionProfile?: MotionProfile;
  layoutOverflow?: boolean;
  /** Explicit regrouping changes displayed phrases without replacing native clips. */
  groupingMaxChars?: number;
  renderSegments?: CaptionSegment[];
  /** Explicit transcript splits stay separate on subsequent applies. */
  manualSplit?: boolean;
  captionBundle?: boolean;
  /** Native layers only: the timeline time of the layer's source zero. A moved
   * or trimmed layer can place preserved source words before sequence zero;
   * validation then allows times down to this floor instead of 0. */
  timelineFloor?: number;
}

export interface CaptionSegment {
  id: string;
  words: CaptionWord[];
  text: string;
  startTime: number;
  endTime: number;
}

export interface CaptionWord {
  text: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  endOfSentence?: boolean;
  /** Absent follows automatic grouping; explicit values override every automatic boundary.
   * 'break' is a manual split; 'join' and 'edge' (the hard edges of a merged
   * line) are merge markers that a reflow clears. 'edge' renders like 'break'. */
  lineBreakBefore?: 'break' | 'join' | 'edge';
  /** Deleted derived pause rows before this word, an integer from 0 to 8. Absent means zero. */
  pauseLinesRemoved?: number;
}

export type AnimationPreset = "fade" | "pop" | "typewriter" | "karaoke" | "bounce";
export type TextTransform = "none" | "uppercase" | "lowercase" | "titlecase";

export interface WordAppearance {
  /** 0 inherits the shared weight, 100 is one step bolder; null/absent keeps an absolute override. */
  fontWeightOffset?: 0 | 100 | null; // 100 means the next installed heavier weight above All words.
  fontSize?: number;
  italic?: boolean;
  letterSpacing?: number;
  textTransform?: TextTransform;
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  fontFamily: string;
  fontWeight: number;
  sizeScale: number;
  color: string;
  opacity: number;
  bubble: boolean;
  /** Color the following interword gap, without extending past a line end. */
  bubbleFillSpaces?: boolean;
  underline?: boolean;
  bubbleColor: string;
  bubbleOpacity: number;
  padding: number;
  bubblePaddingInline?: number;
  bubblePaddingBlock?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  radiusTL?: number;
  radiusTR?: number;
  radiusBR?: number;
  radiusBL?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;

  radius: number;
}

/** How native caption words fill the lines between hard breaks; see native-effect/line-wrap.ts. */
export type LineWrap = 'fill' | 'balance' | 'pretty';
/** A slot of the visible caption window, in screen order: Line 1 is the top line. */
export type LinePositionKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
export const LINE_STYLE_FIELDS = ['fontFamily', 'fontWeight', 'fontWeightOffset', 'italic', 'underline', 'fontSize', 'color', 'opacity',
  'bubble', 'bubbleFillSpaces', 'bubbleColor', 'bubbleOpacity', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'strokeEnabled', 'strokeWidth', 'strokeColor', 'strokeOpacity', 'shadowEnabled', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'] as const;
export type LineStyleField = typeof LINE_STYLE_FIELDS[number];
/** Overrides a line takes while it sits in that slot; unset fields inherit Past/Current/Next. fontSize is in pixels. */
export type LineAppearance = Partial<Pick<WordAppearance, LineStyleField>>;
export type LineStyles = Partial<Record<LinePositionKey, LineAppearance>>;

export interface StyleConfig {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundPadding: number;
  backgroundRadius: number;
  positionX: number;
  positionY: number;
  textAlign: CanvasTextAlign;
  maxWidth: number;
  lineHeight: number;
  /** Font-space percentage; absent on older looks to preserve their original layout. */
  wordSpacing?: number;
  textTransform: TextTransform;
  maxChars: number;
  /** Native line wrap between hard breaks; new sessions use Pretty, saved absence means Fill. Not part of a look. */
  lineWrap?: LineWrap;
  activeWord: WordAppearance;
  spokenWord: WordAppearance;
  upcomingWord?: Partial<WordAppearance>;
  /** Native captions only: per line position overrides, winning over the word states. */
  lineStyles?: LineStyles;
}

export interface AnimationConfig {
  preset: AnimationPreset;
  fadeInDuration: number;
  fadeOutDuration: number;
  highlightColor: string;
}

export interface SessionState {
  sequenceId: string;
  /** Bind sidecar saves to the project that supplied this session. */
  projectPath?: string;
  /** Native documents live in this effect instance, never in legacy movie output. */
  nativeClipId?: string;
  sequenceName: string;
  transcriptJson: TranscriptJSON | null;
  captions: CaptionItem[];
  style: StyleConfig;
  animation: AnimationConfig;
  hasTranscript: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  frameRate: number;
  frameWidth: number;
  frameHeight: number;
}

export interface SequenceInfo {
  id: string;
  name: string;
  duration: number;
  playhead?: number;
  frameRate: number;
  frameWidth: number;
  frameHeight: number;
  projectPath?: string;
  tracks?: { index: number; name: string; clips: number; locked: boolean }[];
}

export const DEFAULT_MAX_CHARS = 56;
export const MAX_CAPTION_CHARS = 500;
export const DEFAULT_STYLE: StyleConfig = {
  fontFamily: "Arial",
  fontSize: 64,
  fontWeight: 700,
  textColor: "#FFFFFF",
  strokeEnabled: true,
  strokeColor: "#000000",
  strokeOpacity: 1,
  strokeWidth: 2,
  shadowEnabled: false,
  shadowColor: "#000000",
  shadowOpacity: 0.5,
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  backgroundEnabled: false,
  backgroundColor: "#000000",
  backgroundOpacity: 0.6,
  backgroundPadding: 12,
  backgroundRadius: 8,
  positionX: 0.5,
  positionY: 0.85,
  textAlign: "center",
  maxWidth: 0.8,
  lineHeight: 1.3,
  wordSpacing: 100,
  textTransform: "none",
  maxChars: DEFAULT_MAX_CHARS,
  lineWrap: 'pretty',
  activeWord: {fontFamily:"",fontWeight:700,sizeScale:1.15,color:"#171717",opacity:1,bubble:true,bubbleColor:"#FFD84D",bubbleOpacity:1,padding:10,radius:14},
  spokenWord: {fontFamily:"",fontWeight:700,sizeScale:1,color:"#AAAAAA",opacity:1,bubble:false,bubbleColor:"#333333",bubbleOpacity:1,padding:8,radius:10},
};

export const DEFAULT_ANIMATION: AnimationConfig = {
  preset: "karaoke",
  fadeInDuration: 0.15,
  fadeOutDuration: 0.15,
  highlightColor: "#FFD700",
};
