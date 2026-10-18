import { SvelteMap } from "svelte/reactivity";
import {
  type SessionState,
  type SequenceInfo,
  type TranscriptJSON,
  type StyleConfig,
  type AnimationConfig,
  type CaptionItem,
  DEFAULT_STYLE,
  DEFAULT_ANIMATION,
} from "../types";
import { parseTranscript } from "../transcript/parser";
import { restoreSessionStyle } from './style';
import { connectionKey } from '../clip-connections';

const STORAGE_KEY = "better-captions-sessions";

function reactiveSession(value: SessionState): SessionState {
  const session = $state<SessionState>(value);
  return session;
}

function createDefaultSession(info: SequenceInfo): SessionState {
  return reactiveSession({
    sequenceId: info.id,
    projectPath: info.projectPath,
    sequenceName: info.name,
    transcriptJson: null,
    captions: [],
    style: { ...DEFAULT_STYLE, activeWord: { ...DEFAULT_STYLE.activeWord }, spokenWord: { ...DEFAULT_STYLE.spokenWord } },
    animation: { ...DEFAULT_ANIMATION },
    hasTranscript: false,
    isLoading: false,
    currentTime: 0,
    duration: info.duration,
    frameRate: info.frameRate,
    frameWidth: info.frameWidth,
    frameHeight: info.frameHeight,
  });
}

function loadPersistedSessions(): Map<string, { style: StyleConfig; animation: AnimationConfig }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function persistSessions(sessions: Map<string, SessionState>) {
  // A different project's sessions are intentionally absent from the live map.
  // Keep their preferences when saving this project's current sessions.
  const serializable: Record<string, { style: StyleConfig; animation: AnimationConfig }> = Object.fromEntries(loadPersistedSessions());
  for (const [id, session] of sessions) {
    if (session.nativeClipId) continue;
    serializable[connectionKey({ id, projectPath: session.projectPath })] = {
      style: session.style,
      animation: session.animation,
    };
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // storage full or unavailable
  }
}

class SessionManager {
  sessions = new SvelteMap<string, SessionState>();
  activeSequenceId = $state<string | null>(null);
  private projectPath: string | null = null;
  saveHandler: ((session:SessionState)=>void) | null = null;
  persist() { persistSessions(this.sessions);const current=this.current;if(current)this.saveHandler?.(current); }
  restore(session:SessionState) { this.sessions.set(session.sequenceId,reactiveSession({...session,style:restoreSessionStyle(session.style),animation:{...DEFAULT_ANIMATION,...session.animation},isLoading:false}));this.activeSequenceId=session.sequenceId; }
  updateCaptions(captions:CaptionItem[]) { const s=this.current;if(!s)return;s.captions=captions;s.hasTranscript=captions.length>0;this.sessions.set(s.sequenceId,s);this.persist(); }

  current = $derived.by(() => {
    if (!this.activeSequenceId) return null;
    return this.sessions.get(this.activeSequenceId) ?? null;
  });

  constructor() {
    loadPersistedSessions();
  }

  activateSequence(info: SequenceInfo) {
    // Sequence GUIDs can survive Save As or project copies. Do not carry the
    // previous project's clip identities or edits into that new context.
    const projectPath = info.projectPath ?? '';
    if (this.projectPath !== null && this.projectPath !== projectPath) {
      this.sessions.clear();
      this.activeSequenceId = null;
    }
    this.projectPath = projectPath;
    if (!this.sessions.has(info.id)) {
      const session = createDefaultSession(info);
      const persisted = loadPersistedSessions();
      const saved = persisted.get(connectionKey(info)) ?? (!info.projectPath ? persisted.get(info.id) : undefined);
      if (saved) {
        session.style = restoreSessionStyle(saved.style);
        session.animation = { ...DEFAULT_ANIMATION, ...saved.animation };
      }
      this.sessions.set(info.id, session);
    } else {
      const session = this.sessions.get(info.id)!;
      session.sequenceName = info.name;
      session.projectPath = info.projectPath;
      session.duration = info.duration;
      session.frameRate = info.frameRate;
      session.frameWidth = info.frameWidth;
      session.frameHeight = info.frameHeight;
    }
    this.activeSequenceId = info.id;
  }

  deactivateSequence() {
    this.activeSequenceId = null;
  }

  setTranscript(json: TranscriptJSON) {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.transcriptJson = json;
    session.captions = parseTranscript(json, session.style.maxChars);
    for (const caption of session.captions) {
      const lastWord = caption.words[caption.words.length - 1];
      if (session.duration > 0 && lastWord?.endTime <= session.duration && caption.endTime > session.duration) caption.endTime = session.duration;
    }
    session.hasTranscript = true;
    session.isLoading = false;
    this.sessions.set(this.activeSequenceId, session);
  }

  clearTranscript() {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.transcriptJson = null;
    session.captions = [];
    session.hasTranscript = false;
    this.sessions.set(this.activeSequenceId, session);
  }

  setLoading(loading: boolean) {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.isLoading = loading;
    this.sessions.set(this.activeSequenceId, session);
  }

  updateStyle(updates: Partial<StyleConfig>) {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.style = { ...session.style, ...updates };
    this.sessions.set(this.activeSequenceId, session);
    this.persist();
  }

  updateAnimation(updates: Partial<AnimationConfig>) {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.animation = { ...session.animation, ...updates };
    this.sessions.set(this.activeSequenceId, session);
    this.persist();
  }

  setCurrentTime(time: number) {
    if (!this.activeSequenceId) return;
    const session = this.sessions.get(this.activeSequenceId);
    if (!session) return;
    session.currentTime = time;
    this.sessions.set(this.activeSequenceId, session);
  }
}

export const sessionManager = new SessionManager();
