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
}

export interface CaptionWord {
  text: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
}

export type AnimationPreset = "fade" | "pop" | "typewriter" | "karaoke" | "bounce";

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
  textTransform: "none" | "uppercase" | "lowercase";
  maxWords: number;
}

export interface AnimationConfig {
  preset: AnimationPreset;
  fadeInDuration: number;
  fadeOutDuration: number;
  highlightColor: string;
}

export interface SessionState {
  sequenceId: string;
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
  frameRate: number;
  frameWidth: number;
  frameHeight: number;
}

export const DEFAULT_STYLE: StyleConfig = {
  fontFamily: "Arial",
  fontSize: 128,
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
  backgroundEnabled: true,
  backgroundColor: "#000000",
  backgroundOpacity: 0.6,
  backgroundPadding: 12,
  backgroundRadius: 8,
  positionX: 0.5,
  positionY: 0.85,
  textAlign: "center",
  maxWidth: 0.8,
  lineHeight: 1.3,
  textTransform: "none",
  maxWords: 6,
};

export const DEFAULT_ANIMATION: AnimationConfig = {
  preset: "karaoke",
  fadeInDuration: 0.15,
  fadeOutDuration: 0.15,
  highlightColor: "#FFD700",
};
