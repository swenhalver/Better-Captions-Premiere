<script lang="ts">
  import { onMount } from "svelte";
  import * as webviewAPI from "./webview-api";
  import { setSequenceCallbacks } from "./webview-api";
  import { initWebview } from "./webview-setup";
  import { sessionManager } from "./lib/session/manager.svelte";
  import { validateStylePatch, validateCaptionPatch, type AgentHandler } from "./lib/agent-bridge";
  import { retime, validateCaptions } from "./lib/transcript/edit";
  import type { TranscriptJSON, SequenceInfo, SessionState, StyleConfig, CaptionItem, AnimationConfig } from "./lib/types";
  import SequenceStatus from "./components/SequenceStatus.svelte";
  import TranscriptPreview from "./components/TranscriptPreview.svelte";
  import CanvasPreview from "./components/CanvasPreview.svelte";
  import StylePanel from "./components/StylePanel.svelte";
  import WordStates from "./components/WordStates.svelte";
  import AnimationPanel from "./components/AnimationPanel.svelte";
  import ExportButton from "./components/ExportButton.svelte";

  const { api } = initWebview(webviewAPI);
  let sequenceInfo = $state<SequenceInfo | null>(null);
  let selectedId = $state<string | null>(null);
  let fonts = $state<string[]>([]);
  let error = $state("");
  let isRefreshing = $state(false);
  let isSyncing = $state(false);
  let timelineBusy = $state(false);
  let timelineStatus = $state("");
  let saveStatus = $state("");
  let saveError = "";
  let saveQueue: Promise<void> = Promise.resolve();
  let exportButton: ExportButton | undefined = $state();
  let transcriptionBackup = $state<SessionState | null>(null);
  const loaded = new Set<string>();
  const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem);

  function save(session: SessionState) {
    const snapshot = plain(session);
    saveStatus = "Saving changes…";
    saveQueue = saveQueue.then(async () => {
      try { await api.saveSession(snapshot); saveError = ""; saveStatus = "All changes saved"; }
      catch (problem) { saveError = message(problem); saveStatus = "Save failed"; error = `Your changes could not be saved: ${saveError}`; }
    });
  }
  async function flushSave() { await saveQueue; if (saveError) throw new Error(saveError); }
  function selectFirst() {
    const session = sessionManager.current;
    if (!session) { selectedId = null; return; }
    if (!session.captions.some((caption) => caption.id === selectedId)) selectedId = session.captions[0]?.id ?? null;
  }
  async function refreshSequence() {
    if (isRefreshing || timelineBusy) return;
    isRefreshing = true;
    error = "";
    try {
      await flushSave();
      const info = await api.getActiveSequenceInfo();
      sequenceInfo = info;
      if (!info) { sessionManager.deactivateSequence(); selectedId = null; return; }
      sessionManager.activateSequence(info);
      if (!loaded.has(info.id)) {
        const stored = await api.loadSession(info.id);
        if (stored && stored.sequenceId === info.id) {
          if (stored.captions?.length) validateCaptions(stored.captions);
          sessionManager.restore(stored as SessionState);
          sessionManager.activateSequence(info);
          saveStatus = "Saved caption session loaded";
        } else if (!sessionManager.current?.captions.length) {
          const raw = await api.fetchTranscriptJSON(info.id);
          if (raw) {
            sessionManager.setTranscript(JSON.parse(raw as string) as TranscriptJSON);
            sessionManager.setCurrentTime(sessionManager.current?.captions[0]?.startTime ?? 0);
            sessionManager.persist();
          }
        }
        loaded.add(info.id);
      }
      selectFirst();
    } catch (problem) { error = message(problem); }
    finally { isRefreshing = false; }
    return getState();
  }
  async function transcribe() {
    const current = sessionManager.current;
    if (!current || api.isDemo || current.isLoading || timelineBusy) return;
    error = "";
    const id = current.sequenceId;
    if (current.captions.some((caption) => caption.clipNodeId)) { error = "Edit linked captions in the transcript below. Replacing their native transcript would remove timeline identities."; return; }
    transcriptionBackup = current.captions.length ? plain(current) : null;
    sessionManager.setLoading(true);
    try {
      const raw = await api.transcribeSequence(id);
      if (sessionManager.current?.sequenceId !== id) throw new Error("The sequence changed during transcription. Refresh to return to the intended sequence.");
      const transcript: TranscriptJSON = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!transcript || !Array.isArray(transcript.segments)) throw new Error("Complete native transcription in Premiere, then import the sequence transcript.");
      sessionManager.setTranscript(transcript);
      const next = sessionManager.current!;
      if (!next.captions.length) throw new Error("No timed words were found in Premiere’s native transcript.");
      validateCaptions(next.captions);
      selectedId = next.captions[0].id;
      sessionManager.setCurrentTime(next.captions[0].startTime);
      sessionManager.persist();
      await flushSave();
    } catch (problem) {
      if (transcriptionBackup && sessionManager.current?.sequenceId === id) sessionManager.restore(transcriptionBackup);
      error = message(problem);
    } finally {
      const session = sessionManager.sessions.get(id);
      if (session) session.isLoading = false;
    }
  }
  function restoreTranscription() {
    if (!transcriptionBackup || transcriptionBackup.sequenceId !== sessionManager.current?.sequenceId) return;
    if (sessionManager.current.captions.some((caption) => caption.clipNodeId)) { error = "Restore the previous transcription before applying captions to Premiere."; return; }
    sessionManager.restore(transcriptionBackup);
    transcriptionBackup = null;
    sessionManager.persist();
    selectFirst();
  }
  function updateStyle(patch: Partial<StyleConfig>) {
    if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const updates = validateStylePatch(patch);
    sessionManager.updateStyle({ ...updates, ...(updates.activeWord ? { activeWord: { ...session.style.activeWord, ...updates.activeWord } } : {}), ...(updates.spokenWord ? { spokenWord: { ...session.style.spokenWord, ...updates.spokenWord } } : {}) });
  }
  function handleStyle(patch: Partial<StyleConfig>) { try { updateStyle(patch); } catch (problem) { error = message(problem); } }
  function updateCaptions(captions: CaptionItem[]) {
    if (captions.length) validateCaptions(captions);
    sessionManager.updateCaptions(captions);
    selectFirst();
  }
  async function recordApplied(captions: CaptionItem[], sequenceId?: string) {
    const id = sequenceId ?? sessionManager.current?.sequenceId;
    if (!id) throw new Error("Premiere applied the clips, but their sequence identity was unavailable. Review the timeline before retrying.");
    const target = sessionManager.sessions.get(id);
    if (!target) throw new Error("Premiere applied the clips, but the caption session closed before its links could be saved. Review the timeline before retrying.");
    validateCaptions(captions);
    if (sessionManager.current?.sequenceId === id) updateCaptions(captions);
    else { target.captions = captions; target.hasTranscript = captions.length > 0; save(target); }
    await flushSave();
    if (sessionManager.current?.sequenceId !== id) throw new Error("The active sequence changed. Applied clip links were saved for the previous sequence; return to it and refresh before continuing.");
  }
  function positionCaption(position: { x: number; y: number } | null, scope: "global" | "caption") {
    if (timelineBusy) return;
    const session = sessionManager.current;
    if (!session) return;
    if (scope === "global" && position) handleStyle({ positionX: position.x, positionY: position.y });
    else if (scope === "caption") updateCaptions(session.captions.map((caption) => caption.id === selectedId ? { ...caption, position: position ?? undefined } : caption));
  }
  async function showInPremiere(time: number) {
    const id = sessionManager.current?.sequenceId;
    if (!id) return;
    try { await api.showInPremiere(time, id); } catch (problem) { error = message(problem); }
  }
  async function syncTimeline() {
    const session = sessionManager.current;
    if (!session || api.isDemo || isSyncing || timelineBusy) return;
    const id = session.sequenceId;
    const before = plain(session.captions);
    isSyncing = true; error = ""; timelineStatus = "Reading Premiere clip timing…";
    try {
      const readback = await api.readTimeline(before, id);
      if (sessionManager.current?.sequenceId !== id) throw new Error("The sequence changed before timing could be synced.");
      if (JSON.stringify(sessionManager.current.captions) !== JSON.stringify(before)) throw new Error("The captions were edited while Premiere timing was being read. Sync again to keep those edits.");
      const cues = new Map<string, { id: string; start: number; end: number; path?: string; projectItemId?: string; missing?: boolean }>((readback.cues ?? []).map((cue: { id: string; start: number; end: number; path?: string; projectItemId?: string; missing?: boolean }) => [cue.id, cue]));
      let synced = 0, missing = 0;
      const updated = before.map((caption) => {
        if (!caption.clipNodeId) return caption;
        const cue = cues.get(caption.id);
        if (!cue || cue.missing) { missing++; return caption; }
        synced++;
        return { ...retime(caption, cue.start, cue.end), mediaPath: cue.path ?? caption.mediaPath, projectItemId: cue.projectItemId ?? caption.projectItemId };
      });
      updateCaptions(updated); await flushSave();
      timelineStatus = `${synced} caption timings synced.${missing ? ` ${missing} linked clips were not found; their saved timings were kept.` : ""}`;
    } catch (problem) { error = message(problem); timelineStatus = ""; }
    finally { isSyncing = false; }
  }
  function getState(): SessionState | null { return sessionManager.current ? plain(sessionManager.current) : null; }
  function validateAnimation(patch: Partial<AnimationConfig>): Partial<AnimationConfig> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Expected an animation object.");
    for (const [key, value] of Object.entries(patch)) {
      if (key === "preset") {
        if (typeof value !== "string" || !["fade", "pop", "typewriter", "karaoke", "bounce"].includes(value)) throw new Error("Invalid caption animation preset.");
      } else if (key === "fadeInDuration" || key === "fadeOutDuration") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) throw new Error("Animation fades must be finite seconds between 0 and 5.");
      } else if (key === "highlightColor") {
        if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Animation colors must be six-digit hex values.");
      } else throw new Error("Unknown caption animation option: " + key);
    }
    return patch;
  }
  const agent: AgentHandler = {
    getState,
    async patchStyle(patch) { updateStyle(patch); await flushSave(); return getState(); },
    async patchAnimation(patch: Partial<AnimationConfig>) { if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish."); sessionManager.updateAnimation(validateAnimation(patch)); await flushSave(); return getState(); },
    async setCaptions(captions) {
      if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish.");
      const current = sessionManager.current;
      if (!current) throw new Error("No active caption session.");
      updateCaptions(validateCaptionPatch(captions, current.captions));
      await flushSave(); return getState();
    },
    async refresh() { if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish."); return refreshSequence(); },
    async apply() {
      if (timelineBusy || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
      if (api.isDemo) throw new Error("Apply captions from the installed Premiere panel.");
      if (!exportButton) throw new Error("Caption controls are not ready.");
      await flushSave(); await exportButton.apply(); await flushSave(); return getState();
    },
  };
  onMount(() => {
    sessionManager.saveHandler = save;
    setSequenceCallbacks(() => { void refreshSequence(); }, () => sessionManager.deactivateSequence());
    (window as unknown as { betterCaptionsAgent: AgentHandler }).betterCaptionsAgent = agent;
    const stopAgentBridge = api.startAgentBridge(agent);
    void refreshSequence().then(() => api.getFonts()).then((available) => { fonts = available; }).catch(() => { fonts = ["Arial", "Helvetica", "Georgia", "Verdana", "Impact"]; });
    return () => {
      stopAgentBridge();
      sessionManager.saveHandler = null;
      setSequenceCallbacks(() => {}, () => {});
      delete (window as unknown as { betterCaptionsAgent?: AgentHandler }).betterCaptionsAgent;
    };
  });
</script>

<main class="caption-app">
  <SequenceStatus session={sessionManager.current} onRefresh={() => { void refreshSequence(); }} onTranscribe={() => { void transcribe(); }} isDemo={api.isDemo} isBusy={isRefreshing || isSyncing || timelineBusy || !!sessionManager.current?.isLoading} {saveStatus} />
  {#if error}<p class="caption-message caption-message--error caption-app__error" role="alert">{error}</p>{/if}
  {#if sessionManager.current}
    {@const session = sessionManager.current}
    <div class="caption-app__preview">
      <CanvasPreview captions={session.captions} currentTime={session.currentTime} duration={session.duration} style={session.style} animation={session.animation} frameWidth={session.frameWidth} frameHeight={session.frameHeight} {selectedId} disabled={timelineBusy} onTimeChange={(time) => sessionManager.setCurrentTime(time)} onPositionChange={positionCaption} />
    </div>
    <div class="caption-app__content">
      <fieldset class="caption-app__editor" disabled={timelineBusy}>

      {#if transcriptionBackup && transcriptionBackup.sequenceId === session.sequenceId}<div class="caption-app__backup"><button class="caption-button" onclick={restoreTranscription} disabled={session.captions.some((caption) => caption.clipNodeId)} title="Restore before applying the replacement captions to Premiere">Restore transcription before last replacement</button></div>{/if}
      <div class="caption-app__timeline-sync"><button class="caption-button" onclick={() => { void syncTimeline(); }} disabled={api.isDemo || isSyncing || !session.captions.some((caption) => caption.clipNodeId)}>{isSyncing ? "Syncing…" : "Sync timing from Premiere"}</button><p class="caption-help">After moving or trimming generated clips in Premiere, sync their timing back to this editor.</p>{#if timelineStatus}<p class="caption-message" role="status">{timelineStatus}</p>{/if}</div>
      <TranscriptPreview sequenceId={session.sequenceId} captions={session.captions} currentTime={session.currentTime} maxWords={session.style.maxWords} {selectedId} onSelect={(id) => selectedId = id} onSeek={(time) => sessionManager.setCurrentTime(time)} onMaxWordsChange={(maxWords) => handleStyle({ maxWords })} onUpdate={updateCaptions} onShowInPremiere={showInPremiere} isDemo={api.isDemo} />
      <WordStates style={session.style} {fonts} onUpdate={handleStyle} />
      <StylePanel style={session.style} {fonts} onUpdate={handleStyle} />
      <AnimationPanel animation={session.animation} onUpdate={(patch) => sessionManager.updateAnimation(patch)} />
      </fieldset>
      <ExportButton bind:this={exportButton} captions={session.captions} style={session.style} animation={session.animation} frameWidth={session.frameWidth} frameHeight={session.frameHeight} frameRate={session.frameRate} duration={session.duration} sequenceName={session.sequenceName} sequenceId={session.sequenceId} tracks={sequenceInfo?.tracks ?? []} hostApi={api} onUpdated={recordApplied} onBusy={(busy) => timelineBusy = busy} disabled={isRefreshing || isSyncing || session.isLoading} />
    </div>
  {:else}<div class="caption-app__empty"><p>Open a sequence in Premiere Pro to create captions.</p><p>Your transcription, word styling and frame positions will be saved with its caption session.</p></div>{/if}
</main>
<style>
  .caption-app { display: flex; flex-direction: column; block-size: 100%; overflow: hidden; }
  .caption-app__preview { flex-shrink: 0; }
  .caption-app__editor { border: 0; padding: 0; margin: 0; min-inline-size: 0; }
  .caption-app__content { flex: 1; min-block-size: 0; overflow-y: auto; }
  .caption-app__error { flex-shrink: 0; max-block-size: 8rem; overflow-y: auto; }
  .caption-app__empty { margin: auto; padding: var(--caption-space-l); text-align: center; color: var(--color-panel-secondary); & p + p { margin-block-start: var(--caption-space-m); font-size: .85rem; } }
  .caption-app__timeline-sync { padding: var(--caption-space-m); border-block-end: 1px solid var(--color-panel-border); & button { inline-size: 100%; margin-block-end: var(--caption-space-s); } }
  .caption-app__backup { padding: var(--caption-space-s) var(--caption-space-m); & button { inline-size: 100%; } }
</style>
