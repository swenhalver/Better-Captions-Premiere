<script lang="ts">
  import { onMount, tick } from "svelte";
  import * as webviewAPI from "./webview-api";
  import { setSequenceCallbacks, setTimelinePlayheadCallback } from "./webview-api";
  import { initWebview } from "./webview-setup";
  import type { NativeTransportAvailability } from "./webview-setup";
  import { createLiveOutput, retryableNativeRead, type LiveOutputStatus } from "./lib/live-output";
  import { startCaptionReconnect } from "./lib/reconnect";
  import { connectionKey, reconnectLegacyCaptions, nativeAboveDisabledBackups, sameSequenceId, type CaptionConnections } from "./lib/clip-connections";
  import { rehydrateNativePanel, prepareNativePanelUpdate, confirmNativePanelUpdate } from "./lib/native-effect/panel";
  import { extendNativeCaptions } from "./lib/native-effect/extension-workflow";
  import NativeEffectControls from './components/NativeEffectControls.svelte';
  import { nativeCaptionPhrases } from "./lib/native-effect/phrases";
  import { prepareNativeCreation, nativeOutputKind } from "./lib/native-effect/create";
  import { encodeNativeTransportText } from "./lib/native-effect/encode";
  import { sessionManager } from "./lib/session/manager.svelte";
  import { validateStylePatch, validateCaptionPatch, validateAreaRead, validateAreaEdit, type AgentHandler } from "./lib/agent-bridge";
  import { retime, validateCaptions } from "./lib/transcript/edit";
  import { refreshCaptionGroups } from "./lib/transcript/parser";
  import { captionLinks, confirmCaptionGeometry, createCaptionSelectionSync, legacyMotionBaseline, legacyMotionIdentity, panelVisibilityMessage, startProgramMonitorWatcher, type CaptionGeometryCue, type CaptionLink, type MotionWatchContext, type ReflowStatus } from "./lib/program-monitor";
  import type { TranscriptJSON, SequenceInfo, SessionState, StyleConfig, CaptionItem, AnimationConfig, MotionProfile } from "./lib/types";
  import TextAreaControls from "./components/TextAreaControls.svelte";
  import PanelTabs from "./components/PanelTabs.svelte";
  import SequenceStatus from "./components/SequenceStatus.svelte";
  import TranscriptPreview from "./components/TranscriptPreview.svelte";
  import TextStyleToolbar from "./components/TextStyleToolbar.svelte";
  import { registerFontCatalog, type InstalledFont } from './lib/font-catalog.ts';
  import AnimationPanel from "./components/AnimationPanel.svelte";
  import StylePresets from "./components/StylePresets.svelte";
  import { applyPresetLook, type PresetLook } from "./lib/style-presets";
  import ExportButton from "./components/ExportButton.svelte";

  const { api } = initWebview(webviewAPI);
  let activeTab = $state("transcript");
  let wordState = $state<'all' | 'spoken' | 'current' | 'upcoming'>("all");
  let selectedWord = $state(0);
  let contentEl: HTMLDivElement | undefined = $state();
  async function changeWorkspace(value: string) { activeTab = value; selectionHint = null; await tick(); if (contentEl) contentEl.scrollTop = 0; }
  function changeWordState(value: typeof wordState) { wordState = value; }
  let sequenceInfo = $state<SequenceInfo | null>(null);
  let selectedId = $state<string | null>(null);
  let fonts = $state<string[]>([]);
  let fontCatalog = $state<InstalledFont[]>([]);
  let fontsLoading = $state(false), fontsError = $state('');
  async function refreshFonts() {
    if (fontsLoading) return;
    fontsLoading = true; fontsError = '';
    try { fontCatalog = registerFontCatalog(await api.getFontCatalog()); fonts = fontCatalog.map(font => font.family); }
    catch { fontsError = 'Couldn’t load installed fonts.'; }
    finally { fontsLoading = false; }
  }
  let error = $state("");
  let selectionHint = $state<{ sequenceId: string; captionId: string } | null>(null);
  let isRefreshing = $state(false);
  let isSyncing = $state(false);
  let timelineBusy = $state(false);
  let exportBusy = $state(false);
  let areaBusy = $state(false);
  let agentAreaBusy = $state(false);
  let areaControlRevision = $state("");
  let areaActionRevision = 0;
  let timelineStatus = $state("");
  let reflowStatus = $state<ReflowStatus>({ phase: "idle", message: "" });
  let motionWatcher: ReturnType<typeof startProgramMonitorWatcher> | null = null;
  let nativeSelection: { sequenceId: string; captionId: string; clipNodeId: string } | null = null;
  let selectingCaption = false;
  let selectionRevision = 0;
  let watcherRevision = 0;
  let hostPanelVisible = $state(true);
  let documentVisible = $state(!document.hidden);
  let automaticReflow = false;
  let automaticOutput = $state(false);
  let outputPhase = $state<'idle' | 'preparing' | 'rendering' | 'committing'>('idle');
  let nativeAvailable = $state(true);
  let liveStatus = $state<LiveOutputStatus>({ phase: 'idle', message: '' });
  let liveOutput: ReturnType<typeof createLiveOutput> | null = null;
  let reconnect: ReturnType<typeof startCaptionReconnect> | null = null;
  let nativeBinding = $state.raw<ReturnType<typeof rehydrateNativePanel>['binding'] | null>(null);
  let connectionStatus = $state("");
  let connectionRevision = "";
  let lastDocumentRead = 0;
  let reconnectGeneration = 0;
  const legacySessions = new Map<string, SessionState>();
  const editsLocked = $derived(timelineBusy && !(automaticOutput && outputPhase !== 'committing'));
  const legacyBaselines = new Map<string, { signature?: string; changed?: boolean; error?: string }>();
  let locationScope = $state<"global" | "caption">("global");
  let appliedSignatures = $state<Record<string, string>>({});
  let saveStatus = $state("");
  let saveError = "";
  let saveQueue: Promise<void> = Promise.resolve();
  let exportButton: ExportButton | undefined = $state();
  let transcriptionBackup = $state<SessionState | null>(null);
  const loaded = new Set<string>();
  let statusSequenceId: string | null = null;
  const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem);
  $effect(() => {
    // Read the render inputs, readiness and visibility reactively. Playback and
    // selection alone never change outputSignature or schedule a new render.
    const session = sessionManager.current;
    if (session) { outputSignature(session); appliedSignatures[outputKey(session)]; }
    void timelineBusy; void isRefreshing; void isSyncing; void hostPanelVisible; void documentVisible; void nativeAvailable; void exportButton;
    liveOutput?.notify();
  });
  $effect(() => {
    const active = sessionManager.current;
    const id = active ? outputKey(active) : null;
    if (id === statusSequenceId) return;
    statusSequenceId = id;
    timelineStatus = "";
    selectionHint = null;
    nativeSelection = null;
    areaControlRevision = "";
    reflowStatus = { phase: "idle", message: "" };
  });
  $effect(() => { if (selectionHint && (selectionHint.sequenceId !== sessionManager.current?.sequenceId || selectionHint.captionId !== selectedId)) selectionHint = null; });

  function save(session: SessionState) {
    // A native document belongs to its effect instance. Never overwrite a
    // sequence's legacy sidecar with that layer's transcript or style.
    if (session.nativeClipId) return;
    const snapshot = plain(session);
    saveStatus = "Saving changes…";
    saveQueue = saveQueue.then(async () => {
      try { await api.saveSession(snapshot); saveError = ""; saveStatus = "All changes saved"; }
      catch (problem) { saveError = message(problem); saveStatus = "Save failed"; error = `Your changes could not be saved: ${saveError}`; }
    });
  }
  async function flushSave() { await saveQueue; if (saveError) throw new Error(saveError); }
  async function applyNativeOutput() {
    const binding = nativeBinding, session = sessionManager.current;
    if (!binding || !session?.nativeClipId || binding.snapshot.locator.clipNodeId !== session.nativeClipId) throw new Error('Select the intended native caption layer.');
    if (typeof api.writeNativeCaptionDocument !== 'function') throw new Error('The installed native caption bridge needs updating.');
    const edited = plain(session), prepared = prepareNativePanelUpdate(binding, edited);
    const documentText = encodeNativeTransportText(prepared);
    let submitted = false;
    timelineBusy = true;
    try {
      submitted = true;
      const result = await api.writeNativeCaptionDocument({ ...plain(binding.snapshot), ...(edited.style.maxChars === binding.baseline.style.maxChars ? {} : { grouping: { before: binding.clip.maxChars!, value: edited.style.maxChars } }) }, documentText, session.sequenceId);
      if (!result?.ok || !result.readbackVerified) throw new Error('Premiere did not confirm the caption document.');
      const confirmed = confirmNativePanelUpdate(binding, prepared, edited, result);
      // Keep newer edits in the editor, while their next write uses the freshly
      // confirmed revision instead of replaying an obsolete setter.
      if (nativeBinding === binding) nativeBinding = confirmed;
      if (sessionManager.current === session) appliedSignatures[outputKey(session)] = outputSignature(edited);
    } catch (problem) {
      if (!submitted || retryableNativeRead(problem)) throw problem;
      throw Object.assign(new Error('The caption change could not be confirmed. Further automatic changes are paused to protect this layer.'), { code: 'BC_OUTPUT_UNCONFIRMED', recoverable: false, outputApplied: true, cause: problem });
    } finally { timelineBusy = exportBusy || areaBusy || agentAreaBusy; }
  }
  const unconfirmedCreations = new Set<string>();
  async function createNativeOutput() {
    const session = sessionManager.current;
    if (!session || session.nativeClipId || timelineBusy || api.isDemo) throw new Error('Native caption creation is not available right now.');
    if (unconfirmedCreations.has(outputKey(session))) throw new Error('Inspect and reconnect the native clip before creating another one.');
    const edited = plain(session), info = sequenceInfo;
    if (!info || info.id !== session.sequenceId || info.projectPath !== session.projectPath) throw new Error('Refresh the intended sequence before creating native captions.');
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) throw new Error('The installed font could not be measured.');
    measure.font = `${edited.style.fontWeight} ${edited.style.fontSize}px "${edited.style.fontFamily.replace(/["\\]/g, '')}"`;
    const prepared = prepareNativeCreation(edited, measure.measureText(' ').width);
    const {document: nativeDocument, ...request} = prepared;
    await flushSave();
    timelineBusy = true; let submitted = false;
    try {
      // Creation is never retried after an ambiguous native response.
      submitted = true;
      const result = await api.createNativeCaptionDocument(request, session.sequenceId);
      if (!result?.ok || !result.readbackVerified || !result.connection) throw new Error('Premiere did not confirm the new native caption clip.');
      const recovered = rehydrateNativePanel(result.connection, info);
      if (result.connection.documentText !== request.documentText) throw new Error('The new native caption document differs from the requested transcript.');
      if (sessionManager.current !== session) throw new Error('The active caption session changed during creation.');
      legacySessions.set(outputKey(session), edited);
      const next = {...recovered.session, projectPath:session.projectPath, nativeClipId:result.connection.clipNodeId};
      nativeBinding = recovered.binding;
      sessionManager.current = next;
      appliedSignatures[outputKey(next)] = outputSignature(next);
      connectionStatus = 'Connected to native effect';
      selectFirst();
    } catch (problem) {
      if (!submitted || retryableNativeRead(problem)) throw problem;
      unconfirmedCreations.add(outputKey(session));
      throw Object.assign(new Error('Native caption creation could not be confirmed. Automatic creation is paused; inspect the timeline before creating another clip.'), {code:'BC_OUTPUT_UNCONFIRMED',recoverable:false,outputApplied:true,cause:problem});
    } finally { timelineBusy = exportBusy || areaBusy || agentAreaBusy; }
  }
  async function createNativeFromButton() {
    try { error = ''; await createNativeOutput(); } catch (problem) { error = message(problem); }
  }
  function watchRevisionChanged() { motionWatcher?.notifyRevision(++watcherRevision); }
  function markOutputEdited(_id: string) {
    if (automaticOutput) exportButton?.supersede();
    watchRevisionChanged();
  }
  function setTimelineBusy(busy: boolean) {
    exportBusy = busy;
    timelineBusy = exportBusy || areaBusy || agentAreaBusy;
    if (busy && !automaticReflow) motionWatcher?.reset();
  }
  function setAreaBusy(busy: boolean) { areaBusy = busy; timelineBusy = exportBusy || areaBusy || agentAreaBusy; }
  function setAgentAreaBusy(busy: boolean) { agentAreaBusy = busy; timelineBusy = exportBusy || areaBusy || agentAreaBusy; }
  function selectFirst() {
    const session = sessionManager.current;
    if (!session) { selectedId = null; return; }
    if (!session.captions.some((caption) => caption.id === selectedId)) selectedId = session.captions[0]?.id ?? null;
  }
  function outputKey(session: SessionState) { return connectionKey({ id: session.sequenceId, projectPath: session.projectPath }); }
  function sessionLoaded(session: SessionState) {
    return loaded.has(connectionKey({ id: session.sequenceId, projectPath: session.projectPath }));
  }
  function connectionReady(allowPendingEdits = false) {
    const session = sessionManager.current;
    return !api.isDemo && nativeAvailable && hostPanelVisible && !document.hidden && !timelineBusy && !isRefreshing && !isSyncing && !session?.isLoading && !isEditingTranscript()
      && (allowPendingEdits || !session?.captions.length || appliedSignatures[outputKey(session)] === outputSignature(session));
  }
  async function readConnections(info: SequenceInfo, includeDocuments = true): Promise<CaptionConnections | null> {
    if (api.isDemo || typeof api.readCaptionConnections !== 'function') return null;
    const session = legacySessions.get(connectionKey(info)) ?? sessionManager.current;
    const links = session?.nativeClipId ? [] : captionLinks(session?.captions ?? []);
    return await api.readCaptionConnections(info.id, plain(links), { includeDocuments }) as CaptionConnections;
  }
  function acceptConnections(snapshot: CaptionConnections, info: SequenceInfo): boolean {
    // Validation includes the project and sequence even for an empty saved session.
    const key = connectionKey(info);
    const current = sessionManager.current;
    const legacy = current?.nativeClipId ? legacySessions.get(key) : current;
    const plan = reconnectLegacyCaptions(legacy?.captions ?? [], snapshot, info);
    const selectedNative = snapshot.selectedClipNodeIds.length === 1 ? snapshot.native.find(item => item.clipNodeId === snapshot.selectedClipNodeIds[0]) : undefined;
    const retainedNative = snapshot.native.find(item => item.clipNodeId === (nativeBinding?.snapshot.locator.clipNodeId ?? current?.nativeClipId));
    const native = selectedNative ?? (!plan.selectedId ? retainedNative : undefined) ?? nativeAboveDisabledBackups(snapshot)
      ?? (!legacy?.captions.length && snapshot.native.length === 1 && !snapshot.selectedClipNodeIds.length ? snapshot.native[0] : undefined);
    if (native) {
      if (!native.documentText || !native.revision) {
        const bound = nativeBinding?.clip;
        if (!bound || native.maxChars !== bound.maxChars || ['clipNodeId', 'startTicks', 'endTicks', 'inTicks', 'outTicks'].some(key => native[key as keyof typeof native] !== bound[key as keyof typeof bound])) return true;
      } else if (!nativeBinding || nativeBinding.snapshot.revision !== native.revision || nativeBinding.clip.maxChars !== native.maxChars) {
        const recovered = rehydrateNativePanel({ ...native, documentText: native.documentText, revision: native.revision }, info);
        if (current && !current.nativeClipId) legacySessions.set(key, plain(current));
        const session = { ...recovered.session, projectPath: info.projectPath, nativeClipId: native.clipNodeId };
        nativeBinding = recovered.binding;
        sessionManager.restore(session);
        const restored = sessionManager.current!;
        appliedSignatures[outputKey(restored)] = outputSignature(restored);
        selectFirst();
        nativeSelection = null;
        watchRevisionChanged();
      }
      sessionManager.setCurrentTime(snapshot.playhead);
      connectionStatus = 'Connected to native caption layer';
    } else {
      if (nativeBinding && (plan.selectedId || !retainedNative)) {
        nativeBinding = null;
        if (legacy) sessionManager.restore(plain(legacy));
        else { sessionManager.sessions.delete(info.id); sessionManager.activateSequence(info); }
        const restored = sessionManager.current!;
        appliedSignatures[outputKey(restored)] = outputSignature(restored);
      }
      if (legacy && plan.changed) {
        legacy.captions = plan.captions;
        if (!sessionManager.current?.nativeClipId) {
          sessionManager.updateCaptions(plan.captions);
          legacySessions.set(key, plain(sessionManager.current!));
        }
      }
      if (plan.selectedId && !sessionManager.current?.nativeClipId) {
        selectedId = plan.selectedId;
        const caption = plan.captions.find(item => item.id === selectedId)!;
        nativeSelection = { sequenceId: info.id, captionId: selectedId, clipNodeId: caption.clipNodeId! };
        sessionManager.setCurrentTime(snapshot.playhead);
      }
      connectionStatus = plan.ambiguous.length ? 'Several clips match these captions. Select the intended clip.'
        : plan.unresolved.length ? 'Some caption clips are missing. Their saved edits are preserved.'
        : snapshot.native.length && !legacy?.captions.length ? 'Select a Better Captions layer to edit it.'
        : snapshot.legacy.length && !legacy?.captions.length ? 'The caption edit file is missing. Existing video captions are preserved.' : '';
    }
    connectionRevision = snapshot.connectionRevision ?? '';
    return false;
  }
  async function inspectConnections() {
    const generation = reconnectGeneration;
    const info = await api.getActiveSequenceInfo();
    if (generation !== reconnectGeneration) return;
    if (!info || !sequenceInfo || connectionKey(info) !== connectionKey(sequenceInfo)) { await refreshSequence(info); return; }
    const current = sessionManager.current;
    const before = current ? outputSignature(current) : '';
    let snapshot = await readConnections(info, false);
    if (generation !== reconnectGeneration || !connectionReady() || (current && outputSignature(current) !== before)) return;
    if (!snapshot) return;
    const previousRevision = connectionRevision;
    const needsDocument = acceptConnections(snapshot, info);
    if (needsDocument || nativeBinding && ((snapshot.connectionRevision ?? '') !== previousRevision || Date.now() - lastDocumentRead >= 30000)) {
      snapshot = await readConnections(info, true);
      if (generation !== reconnectGeneration || !connectionReady() || (current && sessionManager.current === current && outputSignature(current) !== before)) return;
      if (snapshot) { acceptConnections(snapshot, info); lastDocumentRead = Date.now(); }
    }
  }
  async function refreshSequence(capturedInfo?: SequenceInfo | null) {
    if (isRefreshing || timelineBusy) return;
    isRefreshing = true;
    const generation = ++reconnectGeneration;
    watchRevisionChanged();
    error = "";
    try {
      await flushSave();
      const info = capturedInfo === undefined ? await api.getActiveSequenceInfo() : capturedInfo;
      if (generation !== reconnectGeneration) return;
      const contextChanged = !info || !sequenceInfo || connectionKey(info) !== connectionKey(sequenceInfo);
      if (sequenceInfo && info && sequenceInfo.projectPath !== info.projectPath) { loaded.clear(); legacySessions.clear(); legacyBaselines.clear(); transcriptionBackup = null; }
      sequenceInfo = info;
      if (contextChanged) {
        nativeBinding = null; connectionRevision = ''; connectionStatus = '';
        nativeSelection = null; areaControlRevision = ''; selectionHint = null; selectedId = null;
        ++selectionRevision; motionWatcher?.reset();
      }
      if (!info) { sessionManager.deactivateSequence(); selectedId = null; return; }
      sessionManager.activateSequence(info);
      const key = connectionKey(info);
      if (!loaded.has(key)) {
        const stored = await api.loadSession(info.id);
        if (generation !== reconnectGeneration) return;
        if (stored && sameSequenceId(stored.sequenceId, info.id)) {
          if (stored.captions?.length) validateCaptions(stored.captions);
          sessionManager.restore({ ...stored, sequenceId: info.id, projectPath: info.projectPath } as SessionState);
          sessionManager.activateSequence(info);
          saveStatus = "Saved caption session loaded";
        }
        const connections = await readConnections(info);
        if (generation !== reconnectGeneration) return;
        if (connections) { acceptConnections(connections, info); lastDocumentRead = Date.now(); }
        if (!stored && !sessionManager.current?.captions.length && !connections?.native.length && !connections?.legacy.length) {
          const raw = await api.fetchTranscriptJSON(info.id);
          if (generation !== reconnectGeneration) return;
          if (raw) {
            sessionManager.setTranscript(JSON.parse(raw as string) as TranscriptJSON);
            sessionManager.setCurrentTime(sessionManager.current?.captions[0]?.startTime ?? 0);
            sessionManager.persist();
          }
        }
        const restored = sessionManager.current;
        // Opening an already linked session must not rewrite its existing media.
        // New transcripts and subsequent edits are picked up by live output.
        if (restored?.captions.length && restored.captions.every(caption => caption.clipNodeId && caption.projectItemId && caption.mediaPath)) {
          appliedSignatures[outputKey(restored)] = outputSignature(restored);
        }
        loaded.add(key);
      } else {
        const connections = await readConnections(info);
        if (generation !== reconnectGeneration) return;
        if (connections) { acceptConnections(connections, info); lastDocumentRead = Date.now(); }
      }
      selectFirst();
    } catch (problem) { error = message(problem); }
    finally { isRefreshing = false; liveOutput?.notify(); }
    return getState();
  }
  async function transcribe() {
    const current = sessionManager.current;
    if (!current || api.isDemo || current.isLoading || timelineBusy) return;
    if (current.nativeClipId) { error = 'Edit this layer’s existing transcript below.'; return; }
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
  async function extendCaptions() {
    const session=sessionManager.current, info=sequenceInfo;
    if(!session?.nativeClipId||!nativeBinding||!info||api.isDemo||timelineBusy||isSyncing||isRefreshing)return;
    isSyncing=true; error=''; timelineStatus='Reading added footage…';
    try {
      // Commit pending inline text/style changes first, then protect that exact document.
      if(appliedSignatures[outputKey(session)]!==outputSignature(session))await applyNativeOutput();
      if(sessionManager.current!==session||appliedSignatures[outputKey(session)]!==outputSignature(session))throw new Error('The caption changed while saving. Try Extend captions again.');
      const binding=nativeBinding;
      if(!binding)throw new Error('Reconnect the caption layer before extending.');
      const signature=outputSignature(session);
      const current=()=>sessionManager.current===session&&nativeBinding===binding&&outputSignature(session)===signature;
      const result=await extendNativeCaptions(binding,api,session.sequenceId,current);
      if(result.changed){
        const recovered=rehydrateNativePanel(result.connection as typeof binding.clip,info);
        nativeBinding=recovered.binding;
        sessionManager.restore({...recovered.session,projectPath:session.projectPath,nativeClipId:session.nativeClipId,currentTime:session.currentTime});
        const next=sessionManager.current!;
        appliedSignatures[outputKey(next)]=outputSignature(next);
        if(!next.captions.some(caption=>caption.id===selectedId))selectFirst();
        watchRevisionChanged();
        timelineStatus=result.appendedWords ? `Added ${result.appendedWords} words. Existing edits preserved.` : 'Caption clip extended. Existing edits preserved.';
      }else timelineStatus='No new dialogue beyond the current caption clip.';
    }catch(problem){
      error=message(problem);timelineStatus='';
      const failure=problem as {code?:string};
      if(failure.code==='BC_OUTPUT_UNCONFIRMED'||failure.code==='BC_NATIVE_PENDING')liveOutput?.block(outputKey(session),error);
    }finally{isSyncing=false;liveOutput?.notify();}
  }
  function restoreTranscription() {
    if (!transcriptionBackup || transcriptionBackup.sequenceId !== sessionManager.current?.sequenceId) return;
    if (sessionManager.current.captions.some((caption) => caption.clipNodeId)) { error = "Restore the previous transcription before applying captions to Premiere."; return; }
    sessionManager.restore(transcriptionBackup);
    transcriptionBackup = null;
    sessionManager.persist();
    selectFirst();
  }
  function outputSignature(session: SessionState): string {
    const { maxChars: _groupingLimit, ...style } = session.style;
    return JSON.stringify({
      nativeClipId: session.nativeClipId, ...(session.nativeClipId ? { maxChars: session.style.maxChars } : {}),
      captions: session.captions.map((caption) => ({ id: caption.id, text: caption.text, startTime: caption.startTime, endTime: caption.endTime, position: caption.position, words: caption.words.map((word) => ({ text: word.text, startTime: word.startTime, endTime: word.endTime })), renderSegments: caption.renderSegments })),
      style, animation: session.animation, frameWidth: session.frameWidth, frameHeight: session.frameHeight, frameRate: session.frameRate,
    });
  }
  function recordMonitorApplied(_captions: CaptionItem[], sequenceId?: string, options?: { captionIds?: string[] }) {
    const id = sequenceId ?? sessionManager.current?.sequenceId;
    const session = id ? sessionManager.sessions.get(id) : undefined;
    if (!session || !id || options?.captionIds?.length) return;
    motionWatcher?.reset();
    appliedSignatures[outputKey(session)] = outputSignature(session);
  }
  function updateStyle(patch: Partial<StyleConfig>) {
    if (editsLocked) throw new Error("Wait for Premiere to finish placing the captions.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    const updates = validateStylePatch(patch);
    const next = { ...updates, ...(updates.activeWord ? { activeWord: { ...session.style.activeWord, ...updates.activeWord } } : {}), ...(updates.spokenWord ? { spokenWord: { ...session.style.spokenWord, ...updates.spokenWord } } : {}), ...(updates.upcomingWord ? { upcomingWord: { ...session.style.upcomingWord, ...updates.upcomingWord } } : {}) };
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), style: { ...plain(session.style), ...next } });
    sessionManager.updateStyle(next);
    if (nativeBinding && updates.maxChars !== undefined) sessionManager.updateCaptions(nativeCaptionPhrases(plain(session.captions), updates.maxChars));
    if (before !== outputSignature(session)) markOutputEdited(session.sequenceId);
  }
  function handleStyle(patch: Partial<StyleConfig>) { try { updateStyle(patch); } catch (problem) { error = message(problem); } }
  function changeCharacterLimit(maxChars: number) {
    try {
      updateStyle({ maxChars });
      const session = sessionManager.current;
      if (session) updateCaptions(nativeBinding ? plain(session.captions) : refreshCaptionGroups(plain(session.captions), maxChars));
    } catch (problem) { error = message(problem); }
  }
  async function applyStylePreset(look: PresetLook) {
    if (editsLocked || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    const next = applyPresetLook(session.style, look);
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), style: next.style, animation: next.animation });
    session.style = next.style;
    session.animation = next.animation;
    sessionManager.persist();
    if (before !== outputSignature(session)) markOutputEdited(session.sequenceId);
    await flushSave();
    if (sessionManager.current?.sequenceId !== session.sequenceId) throw new Error("The preset was applied to the previous sequence. Return to that sequence to review it.");
  }
  function updateCaptions(captions: CaptionItem[], markEdited = true) {
    if (markEdited && editsLocked) throw new Error("Wait for Premiere to finish placing the captions.");
    if (captions.length) validateCaptions(captions);
    captions = nativeBinding ? nativeCaptionPhrases(captions, sessionManager.current!.style.maxChars) : refreshCaptionGroups(captions);
    if (nativeBinding && markEdited) prepareNativePanelUpdate(nativeBinding, { ...plain(sessionManager.current!), captions });
    sessionManager.updateCaptions(captions);
    if (markEdited && sessionManager.current) markOutputEdited(sessionManager.current.sequenceId);
    selectFirst();
  }
  async function recordApplied(captions: CaptionItem[], sequenceId?: string) {
    const id = sequenceId ?? sessionManager.current?.sequenceId;
    if (!id) throw new Error("Premiere applied the clips, but their sequence identity was unavailable. Review the timeline before retrying.");
    const target = sessionManager.sessions.get(id);
    if (!target) throw new Error("Premiere applied the clips, but the caption session closed before its links could be saved. Review the timeline before retrying.");
    validateCaptions(captions);
    if (sessionManager.current?.sequenceId === id) updateCaptions(captions, false);
    else { target.captions = captions; target.hasTranscript = captions.length > 0; save(target); }
    await flushSave();
    if (sessionManager.current?.sequenceId !== id) throw new Error("The active sequence changed. Applied clip links were saved for the previous sequence; return to it and refresh before continuing.");
  }
  function positionCaption(position: { x: number; y: number } | null, scope: "global" | "caption") {
    if (editsLocked) return;
    const session = sessionManager.current;
    if (!session) return;
    if (scope === "global" && position) handleStyle({ positionX: position.x, positionY: position.y });
    else if (scope === "caption") updateCaptions(session.captions.map((caption) => caption.id === selectedId ? { ...caption, position: position ?? undefined } : caption));
  }
  function updatePositionAxis(axis: "x" | "y", event: Event) {
    const session = sessionManager.current;
    if (!session || editsLocked) return;
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const selected = session.captions.find((caption) => caption.id === selectedId);
    const position = locationScope === "caption" && selected?.position ? selected.position : { x: session.style.positionX, y: session.style.positionY };
    positionCaption({ ...position, [axis]: Math.max(0, Math.min(1, value / 100)) }, locationScope);
  }
  async function seekCaption(time: number): Promise<boolean> {
    const session = sessionManager.current;
    if (!session || timelineBusy) return false;
    selectionHint = null;
    const caption = session.captions.find((item) => Math.abs(item.startTime - time) < .0001 || time >= item.startTime && time < item.endTime);
    const word = caption?.words[0];
    const target = word && Math.abs(time-caption!.startTime)<.0001 ? (word.startTime + word.endTime) / 2 : time;
    sessionManager.setCurrentTime(target);
    if (caption) selectedId = caption.id;
    if (api.isDemo) return false;
    const request = ++selectionRevision;
    nativeSelection = null;
    selectingCaption = true;
    watchRevisionChanged();
    try {
      if (!caption?.clipNodeId) { await showInPremiere(target); return false; }
      const selection = api as typeof api & { selectCaptionClip?: (caption: CaptionItem, sequenceId: string) => Promise<unknown> };
      if (!selection.selectCaptionClip) throw new Error("Update Better Captions to select the caption in the Program Monitor.");
      await api.showInPremiere(target,session.sequenceId);
      const result = await selection.selectCaptionClip(plain(caption), session.sequenceId) as { ok?: boolean; time?: number } | undefined;
      if (!result?.ok) throw new Error("Premiere did not confirm the caption selection. Try selecting it again.");
      if (sessionManager.current?.sequenceId === session.sequenceId && selectionRevision === request) {
        nativeSelection = { sequenceId: session.sequenceId, captionId: caption.id, clipNodeId: caption.clipNodeId };
        if (typeof result?.time === "number" && Number.isFinite(result.time)) sessionManager.setCurrentTime(result.time);
        return true;
      }
      return false;
    } catch (problem) { error = message(problem); }
    finally { if (selectionRevision === request) selectingCaption = false; }
    return false;
  }
  async function selectSelectedCaption() {
    const session = sessionManager.current;
    const selected = session?.captions.find((caption) => caption.id === selectedId);
    if (!session || !selected?.clipNodeId || api.isDemo || timelineBusy) return;
    error = "";
    if (await seekCaption(selected.startTime)) selectionHint = { sequenceId: session.sequenceId, captionId: selected.id };
  }
  async function areaChanged() {
    const session = sessionManager.current;
    const caption = session?.captions.find(item=>item.id===selectedId);
    if (!api.isDemo && session && caption?.clipNodeId) {
      await api.selectCaptionClip(plain(caption),session.sequenceId);
      if (sessionManager.current?.sequenceId===session.sequenceId && selectedId===caption.id) nativeSelection={sequenceId:session.sequenceId,captionId:caption.id,clipNodeId:caption.clipNodeId};
    }
    watchRevisionChanged();
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
  function isEditingTranscript(): boolean {
    const active = document.activeElement;
    return document.hasFocus() && active instanceof HTMLElement && !!active.closest(".transcript-editor__edit") && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  }
  function selectionPauseReason(): string | null {
    const session = sessionManager.current;
    if (api.isDemo) return "demo";
    if (session?.nativeClipId) return "native-effect";
    if (!hostPanelVisible) return "host-hidden";
    if (document.hidden) return "document-hidden";
    if (selectingCaption) return "selecting-caption";
    if (isEditingTranscript()) return "editing-transcript";
    if (timelineBusy) return "timeline-busy";
    if (!nativeAvailable) return "waiting-for-premiere";
    if (session && appliedSignatures[outputKey(session)] !== outputSignature(session)) return "caption-edits-pending";
    if (isRefreshing) return "refreshing";
    if (isSyncing) return "syncing";
    if (!session) return "no-session";
    if (!session.hasTranscript) return "no-transcript";
    if (session.isLoading) return "loading";
    if (!session.captions.some(caption => caption.clipNodeId)) return "no-linked-captions";
    return null;
  }
  function motionPauseReason(requireBaseline = true): string | null {
    const paused = selectionPauseReason();
    if (paused) return paused;
    const session = sessionManager.current!;
    const caption = session.captions.find(item => item.id === selectedId);
    if (!caption?.clipNodeId) return "selected-caption-unlinked";
    if (nativeSelection?.sequenceId !== session.sequenceId || nativeSelection.captionId !== caption.id || nativeSelection.clipNodeId !== caption.clipNodeId) return "native-selection-mismatch";
    if (requireBaseline && !caption.motionProfile?.watchSignature && !legacyBaselines.get(legacyMotionIdentity(session.sequenceId, caption))?.signature) return "legacy-baseline-unarmed";
    return null;
  }
  function rememberLegacyBaseline(key: string, value: { signature?: string; changed?: boolean; error?: string }) {
    if (!legacyBaselines.has(key) && legacyBaselines.size >= 64) legacyBaselines.delete(legacyBaselines.keys().next().value!);
    legacyBaselines.set(key, value);
  }
  async function ensureLegacyBaseline() {
    if (motionPauseReason(false)) return;
    const session = sessionManager.current!, caption = session.captions.find(item => item.id === selectedId)!;
    if (caption.motionProfile?.watchSignature) return;
    const id = session.sequenceId, key = legacyMotionIdentity(id, caption), known = legacyBaselines.get(key);
    if (known?.error) throw new Error(known.error);
    if (known?.signature) return;
    const captured = plain(caption), current = () => {
      const active = sessionManager.current, selected = active?.captions.find(item => item.id === selectedId);
      return !motionPauseReason(false) && active?.sequenceId === id && selected && legacyMotionIdentity(id, selected) === key;
    };
    try {
      // Reject an unknown rendered baseline before starting any native profile work.
      if (typeof captured.motionProfile?.signature !== 'string' || !captured.motionProfile.signature || captured.motionProfile.signature.length > 4096 || !Array.isArray(captured.motionProfile.samples) || !captured.motionProfile.samples.length || captured.motionProfile.samples.length > 100000) throw new Error('This older caption needs a fresh rendered text-box baseline.');
      const payload = { ...captionLinks([captured])[0], startTime: captured.startTime, endTime: captured.endTime, renderBounds: captured.renderBounds } as CaptionItem;
      const result = await api.readCaptionMotion([payload], id);
      if (!current()) return;
      const cue = result?.cues?.find((item: { id: string }) => item.id === captured.id);
      if (!result?.ok || !cue?.motionProfile || cue.clipNodeId !== captured.clipNodeId || cue.projectItemId !== captured.projectItemId || cue.path !== captured.mediaPath) throw new Error('The older caption timeline link changed. Refresh the sequence to reconnect it.');
      const baseline = legacyMotionBaseline(captured.motionProfile, cue.motionProfile as MotionProfile);
      rememberLegacyBaseline(key, baseline);
    } catch (problem) {
      if (!current()) return;
      if (retryableNativeRead(problem)) throw problem;
      const detail = message(problem).slice(0, 1000);
      rememberLegacyBaseline(key, { error: detail });
      throw new Error(detail);
    }
  }
  function motionContext(): MotionWatchContext | null {
    if (motionPauseReason()) return null;
    const session = sessionManager.current!, caption = session.captions.find(item => item.id === selectedId)!;
    return {
      sequenceId: session.sequenceId, captionId: caption.id, clipNodeId: caption.clipNodeId!,
      savedSignature: caption.motionProfile?.watchSignature ?? legacyBaselines.get(legacyMotionIdentity(session.sequenceId, caption))?.signature,
      revision: JSON.stringify({ words: caption.words, position: caption.position, style: session.style, animation: session.animation }),
    };
  }
  function watchedCaption(context: MotionWatchContext): CaptionItem {
    const session = sessionManager.current;
    const caption = session?.captions.find((item) => item.id === context.captionId);
    if (!session || session.sequenceId !== context.sequenceId || selectedId !== context.captionId || !caption || caption.clipNodeId !== context.clipNodeId) throw new Error("The selected caption changed.");
    return caption;
  }
  async function readMotionSignature(context: MotionWatchContext): Promise<string> {
    const caption = plain(watchedCaption(context));
    const geometryAPI = api as unknown as { readCaptionGeometry?: (captions: (CaptionLink & { startTime: number; endTime: number })[], sequenceId: string) => Promise<{ ok: boolean; cues: CaptionGeometryCue[] }> };
    if (!geometryAPI.readCaptionGeometry) throw new Error("Update Better Captions to enable Program Monitor text-box reflow.");
    const result = await geometryAPI.readCaptionGeometry([{ ...captionLinks([caption])[0], startTime: caption.startTime, endTime: caption.endTime }], context.sequenceId);
    const cue = result?.cues?.find(item => item.id === context.captionId);
    if (!result?.ok) throw new Error("Premiere did not confirm the selected caption's text-box dimensions.");
    const receipt = confirmCaptionGeometry(caption, watchedCaption(context), cue);
    if (receipt.controlRevision) areaControlRevision = JSON.stringify([context.sequenceId, context.captionId, context.clipNodeId, receipt.controlRevision]);
    return receipt.watchSignature;
  }
  async function reflowCaption(context: MotionWatchContext) {
    watchedCaption(context);
    if (timelineBusy || isRefreshing || isSyncing || sessionManager.current?.isLoading || !exportButton) throw new Error("Wait for the current caption operation to finish.");
    await flushSave();
    watchedCaption(context);
    automaticReflow = true; automaticOutput = true;
    try { await exportButton.apply({ captionIds: [context.captionId], automatic: true }); await flushSave(); }
    finally { automaticReflow = false; automaticOutput = false; }
  }
  function runtimeState() {
    const session = sessionManager.current, caption = session?.captions.find(item => item.id === selectedId);
    return {
      reflow: { phase: reflowStatus.phase, message: reflowStatus.message.slice(0, 1000), pauseReason: motionPauseReason(), watcher: motionWatcher?.diagnostics() ?? null },
      visibility: { hostPanelVisible, documentHidden: document.hidden, documentVisibilityState: document.visibilityState },
      fonts: { count: fonts.length, loading: fontsLoading, error: fontsError },
      selectedId, nativeSelection: nativeSelection ? { ...nativeSelection } : null,
      liveOutput: { ...liveStatus, ...liveOutput?.diagnostics(), nativeAvailable },
      connection: { status: connectionStatus, kind: session?.nativeClipId ? 'native-effect' : 'generated-movie', clipNodeId: session?.nativeClipId, reconnect: reconnect?.diagnostics() ?? null },
      busy: { timeline: timelineBusy, export: exportBusy, area: areaBusy, refreshing: isRefreshing, syncing: isSyncing, loading: !!session?.isLoading },
      hasSavedWatchSignature: !!caption?.motionProfile?.watchSignature,
    };
  }
  function getState(): (SessionState & { runtime: ReturnType<typeof runtimeState> }) | null {
    const session = sessionManager.current;
    return session ? { ...plain(session), runtime: runtimeState() } : null;
  }
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
  function updateAnimation(patch: Partial<AnimationConfig>) {
    if (editsLocked) throw new Error("Wait for Premiere to finish placing the captions.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), animation: { ...plain(session.animation), ...validateAnimation(patch) } });
    sessionManager.updateAnimation(validateAnimation(patch));
    if (before !== outputSignature(session)) markOutputEdited(session.sequenceId);
  }
  function handleAnimation(patch: Partial<AnimationConfig>) { try { updateAnimation(patch); } catch (problem) { error = message(problem); } }
  function agentAreaCaption(captionId: string) {
    const session = sessionManager.current;
    const caption = session?.captions.find(item => item.id === captionId);
    if (!session || !caption?.clipNodeId || !caption.projectItemId || !caption.mediaPath) throw new Error("Choose an applied caption in the active sequence.");
    return { sequenceId: session.sequenceId, caption: plain(caption), frameRate: session.frameRate };
  }
  function confirmAgentAreaCaption(captured: ReturnType<typeof agentAreaCaption>) {
    const current = agentAreaCaption(captured.caption.id);
    const link = (value: ReturnType<typeof agentAreaCaption>) => JSON.stringify([value.sequenceId, value.caption.id,
      value.caption.clipNodeId, value.caption.projectItemId, value.caption.mediaPath, value.caption.startTime, value.caption.endTime, value.caption.renderBounds]);
    if (link(current) !== link(captured)) throw new Error("The caption link changed while its area controls were being prepared.");
  }
  async function runAgentArea(payload: unknown, edit: boolean) {
    if (timelineBusy || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
    if (api.isDemo) throw new Error("Edit caption keyframes from the installed Premiere panel.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const request = edit ? validateAreaEdit(payload, session.captions) : validateAreaRead(payload, session.captions);
    const captured = agentAreaCaption(request.captionId);
    setAgentAreaBusy(true);
    try {
      const info = await api.getActiveSequenceInfo();
      confirmAgentAreaCaption(captured);
      if (!info || info.id !== captured.sequenceId || !Number.isFinite(info.playhead)) throw new Error("Premiere did not confirm the active sequence and playhead.");
      if ('edit' in request) {
        const result = await api.editCaptionArea(captured.caption, captured.sequenceId, request.edit);
        confirmAgentAreaCaption(captured);
        const selection = await api.selectCaptionClip(captured.caption, captured.sequenceId);
        confirmAgentAreaCaption(captured);
        if (!selection?.ok) throw new Error("The keyframe edit completed, but Premiere did not confirm the caption selection.");
        selectedId = captured.caption.id;
        nativeSelection = { sequenceId: captured.sequenceId, captionId: captured.caption.id, clipNodeId: captured.caption.clipNodeId! };
        areaControlRevision = JSON.stringify([captured.sequenceId, captured.caption.id, 'agent-edit', ++areaActionRevision]);
        if (Number.isFinite(selection.time)) sessionManager.setCurrentTime(selection.time);
        watchRevisionChanged();
        return result;
      }
      const at = request.frame ?? Math.max(0, Math.round((info.playhead! - captured.caption.startTime) * captured.frameRate));
      let result = await api.readCaptionArea(captured.caption, captured.sequenceId, at);
      confirmAgentAreaCaption(captured);
      if (request.frame === undefined) {
        const nativeFrame = Math.max(0, Math.min(result.count - 1, Math.round((info.playhead! - result.startTime) * result.frameRate)));
        if (nativeFrame !== result.frame) {
          result = await api.readCaptionArea(captured.caption, captured.sequenceId, nativeFrame);
          confirmAgentAreaCaption(captured);
        }
      }
      return result;
    } finally { setAgentAreaBusy(false); }
  }
  const agent: AgentHandler = {
    getState,
    async patchStyle(patch) { updateStyle(patch); await flushSave(); return getState(); },
    async patchAnimation(patch: Partial<AnimationConfig>) { updateAnimation(patch); await flushSave(); return getState(); },
    readArea: payload => runAgentArea(payload, false),
    editArea: payload => runAgentArea(payload, true),
    async setCaptions(captions) {
      if (editsLocked) throw new Error("Wait for Premiere to finish placing the captions.");
      const current = sessionManager.current;
      if (!current) throw new Error("No active caption session.");
      updateCaptions(validateCaptionPatch(captions, current.captions));
      await flushSave(); return getState();
    },
    async refresh() { if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish."); return refreshSequence(); },
    async apply() {
      if (timelineBusy || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
      if (api.isDemo) throw new Error("Apply captions from the installed Premiere panel.");
      if (nativeBinding) { await applyNativeOutput(); return getState(); }
      if (sessionManager.current && nativeOutputKind(sessionManager.current) === "new-native") { await createNativeOutput(); return getState(); }
      if (!exportButton) throw new Error("Caption controls are not ready.");
      await flushSave(); await exportButton.apply(); await flushSave(); return getState();
    },
  };
  function followTimelinePlayhead(value: unknown) {
    const session = sessionManager.current;
    if (api.isDemo || !session || !hostPanelVisible || !documentVisible || isRefreshing || session.isLoading || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const position = value as { sequenceId?: unknown; projectPath?: unknown; time?: unknown };
    if (typeof position.sequenceId !== 'string' || typeof position.projectPath !== 'string' || typeof position.time !== 'number' || !Number.isFinite(position.time) || position.time < 0) return;
    if (!sameSequenceId(position.sequenceId, session.sequenceId) || position.projectPath !== session.projectPath) return;
    // Following the CTI is display state only. It does not select/seek a clip,
    // save captions, or invalidate their rendered/native document signature.
    if (session.currentTime !== position.time) sessionManager.setCurrentTime(position.time);
  }
  onMount(() => {
    sessionManager.saveHandler = save;
    setSequenceCallbacks(() => { ++reconnectGeneration; reconnect?.notify(); }, () => { ++reconnectGeneration; reconnect?.notify(); });
    setTimelinePlayheadCallback(followTimelinePlayhead);
    (window as unknown as { betterCaptionsAgent: AgentHandler }).betterCaptionsAgent = agent;
    const stopAgentBridge = api.startAgentBridge(agent);
    liveOutput = createLiveOutput({
      current() {
        const session = sessionManager.current;
        if (api.isDemo || !session?.hasTranscript || !session.captions.length || !sessionLoaded(session)) return null;
        const signature = outputSignature(session);
        return { sequenceId: outputKey(session), signature,
          needed: appliedSignatures[outputKey(session)] !== signature,
          ready: nativeAvailable && hostPanelVisible && documentVisible && !timelineBusy && !isRefreshing && !isSyncing && !session.isLoading && !!(nativeBinding || nativeOutputKind(session) === "new-native" || exportButton) };
      },
      async apply(context) {
        await flushSave();
        const session = sessionManager.current;
        if (!session || outputKey(session) !== context.sequenceId || outputSignature(session) !== context.signature || !(nativeBinding || nativeOutputKind(session) === "new-native" || exportButton)) throw Object.assign(new Error('A newer edit replaced this render.'), { code: 'BC_RENDER_SUPERSEDED' });
        if (nativeBinding) { automaticOutput = true; try { await applyNativeOutput(); } finally { automaticOutput = false; } return; }
        if (nativeOutputKind(session) === 'new-native') { await createNativeOutput(); return; }
        if (!exportButton) throw new Error('Caption controls are not ready.');
        automaticOutput = true;
        try { await exportButton.apply({ automatic: true }); await flushSave(); }
        finally { automaticOutput = false; }
      },
      supersede() { if (automaticOutput) exportButton?.supersede(); },
      onStatus(status) { if (liveStatus.phase !== status.phase || liveStatus.message !== status.message) liveStatus = status; },
    });
    let wasWaiting = false;
    reconnect = startCaptionReconnect({
      ready: () => connectionReady(true),
      inspect: inspectConnections,
      onError(problem) { connectionStatus = retryableNativeRead(problem) ? 'Waiting for Premiere. Reconnection will resume automatically.' : message(problem); },
    });
    const availabilityAPI = api as typeof api & { onTransportAvailability?: (listener: (state: NativeTransportAvailability) => void) => () => void };
    const stopAvailability = availabilityAPI.onTransportAvailability?.(state => {
      nativeAvailable = state.state === 'ready';
      if (nativeAvailable && wasWaiting) { motionWatcher?.reset(); liveOutput?.notify(); reconnect?.notify(); }
      wasWaiting = state.state === 'waiting';
    });
    const selectionSync = createCaptionSelectionSync({
      current() {
        const session = sessionManager.current;
        if (selectionPauseReason() || !session) return null;
        return { sequenceId: session.sequenceId, captions: captionLinks(session.captions), revision: selectionRevision };
      },
      async read(context) {
        nativeSelection = null;
        const selectionAPI = api as unknown as { readCaptionSelection?: (captions: CaptionLink[], sequenceId: string) => Promise<{ ok: boolean; captionId: string | null; clipNodeId?: string; time: number }> };
        if (!selectionAPI.readCaptionSelection) throw new Error("Update Better Captions to follow Program Monitor caption selection.");
        return await selectionAPI.readCaptionSelection(context.captions, context.sequenceId);
      },
      accept(selection, context) {
        if (selection.captionId === null || !selection.clipNodeId) { nativeSelection = null; return; }
        nativeSelection = { sequenceId: context.sequenceId, captionId: selection.captionId, clipNodeId: selection.clipNodeId };
        if (selectedId !== selection.captionId) selectedWord = 0;
        selectedId = selection.captionId;
        if (sessionManager.current?.currentTime !== selection.time) sessionManager.setCurrentTime(selection.time);
      },
    });
    motionWatcher = startProgramMonitorWatcher({
      beforeRead: async () => { await selectionSync.sync(); await ensureLegacyBaseline(); },
      current: motionContext, readSignature: readMotionSignature, apply: reflowCaption,
      interval: 750, stableFor: 750,
      onStatus(status) { if (status.phase !== reflowStatus.phase || status.message !== reflowStatus.message) reflowStatus = status; },
    });
    const updateVisibility = () => {
      documentVisible = !document.hidden;
      const visible = hostPanelVisible && documentVisible;
      if (!visible) { nativeSelection = null; selectionSync.invalidate(); }
      motionWatcher?.setVisible(visible);
      if (visible) { lastDocumentRead = 0; reconnect?.notify(); }
    };
    const receiveVisibility = (event: MessageEvent) => {
      const visible = panelVisibilityMessage(event.data ?? (event as unknown as { message?: unknown }).message);
      if (visible === null) return;
      hostPanelVisible = visible;
      updateVisibility();
    };
    window.addEventListener("message", receiveVisibility);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    void refreshSequence().then(() => { liveOutput?.notify(); void refreshFonts(); });
    return () => {
      window.removeEventListener("message", receiveVisibility);
      document.removeEventListener("visibilitychange", updateVisibility);
      selectionSync.stop();
      motionWatcher?.stop(); motionWatcher = null;
      liveOutput?.stop(); liveOutput = null; stopAvailability?.();
      reconnect?.stop(); reconnect = null; ++reconnectGeneration;
      stopAgentBridge();
      sessionManager.saveHandler = null;
      setSequenceCallbacks(() => {}, () => {});
      setTimelinePlayheadCallback(null);
      delete (window as unknown as { betterCaptionsAgent?: AgentHandler }).betterCaptionsAgent;
    };
  });
</script>

<main class="caption-app">
  <SequenceStatus session={sessionManager.current} onRefresh={() => { void refreshSequence(); }} onTranscribe={() => { void transcribe(); }} onExtend={sessionManager.current?.nativeClipId ? () => { void extendCaptions(); } : undefined} isDemo={api.isDemo} isBusy={isRefreshing || isSyncing || timelineBusy || !!sessionManager.current?.isLoading} {saveStatus} />
  {#if error}<div class="caption-app__error" role="alert"><p>{error}</p><button class="caption-button caption-button--icon" onclick={() => error = ""} aria-label="Dismiss error"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div>{/if}
  {#if sessionManager.current}
    {@const session = sessionManager.current}
    {@const selected = session.captions.find((caption) => caption.id === selectedId)}
    {@const position = locationScope === "caption" && selected?.position ? selected.position : { x: session.style.positionX, y: session.style.positionY }}
    <PanelTabs name="workspace" label="Caption workspace" value={activeTab} options={[{value:"transcript",label:"Transcript"},{value:"style",label:"Styling"}]} onChange={changeWorkspace} />
    <div class="caption-app__content" bind:this={contentEl}>
      <fieldset class="caption-app__editor" disabled={editsLocked || isSyncing || session.isLoading} aria-label="Caption editing controls">
        <div id="workspace-panel-transcript" role="tabpanel" aria-labelledby="workspace-tab-transcript" tabindex="0" hidden={activeTab !== "transcript"}>
          {#if session.isLoading}<div class="caption-app__loading" role="status"><p>Transcribing in Premiere…</p><p class="caption-help">Timed words will appear here when Premiere finishes.</p><div class="caption-app__skeleton"></div><div class="caption-app__skeleton"></div><div class="caption-app__skeleton"></div></div>{/if}
          {#if transcriptionBackup && transcriptionBackup.sequenceId === session.sequenceId}<div class="caption-app__backup"><button class="caption-button" onclick={restoreTranscription} disabled={session.captions.some((caption) => caption.clipNodeId)}>Restore previous transcription</button></div>{/if}
          <TranscriptPreview frameRate={session.frameRate} {selectedWord} onSelectWord={(index) => selectedWord = index} sequenceId={session.sequenceId} captions={session.captions} currentTime={session.currentTime} maxChars={session.style.maxChars} groupingDisabled={!!session.nativeClipId && nativeBinding?.clip.maxChars === undefined} onRegroup={session.nativeClipId ? () => updateCaptions(plain(session.captions)) : undefined} {selectedId} onSelect={(id) => { selectedId = id; selectedWord = 0; }} onSeek={seekCaption} onMaxCharsChange={changeCharacterLimit} onUpdate={updateCaptions} onShowInPremiere={seekCaption} isDemo={api.isDemo} disabled={editsLocked || isRefreshing || isSyncing || session.isLoading} />
        </div>
        <div id="workspace-panel-style" role="tabpanel" aria-labelledby="workspace-tab-style" tabindex="0" hidden={activeTab !== "style"}>
          {#key session.sequenceId}
            <StylePresets style={session.style} animation={session.animation} load={api.loadStylePresets} save={api.saveStylePresets} onApply={applyStylePreset} isDemo={api.isDemo} disabled={editsLocked || isRefreshing || isSyncing || session.isLoading} />
          {/key}
          <TextStyleToolbar style={session.style} {fonts} {fontCatalog} {fontsLoading} {fontsError} onRefreshFonts={() => { void refreshFonts(); }} scope={wordState} nativeMode={!!session.nativeClipId} onScopeChange={changeWordState} onUpdate={handleStyle} />
          {#if session.nativeClipId && nativeBinding}<NativeEffectControls snapshot={nativeBinding.snapshot} sequenceId={session.sequenceId} frameWidth={session.frameWidth} frameHeight={session.frameHeight} currentTime={session.currentTime} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={timelineBusy||isRefreshing||isSyncing||session.isLoading} read={api.readNativeCaptionControls} edit={api.editNativeCaptionControl} seek={api.seekNativeCaptionKeyframe} onTimeChange={time=>sessionManager.setCurrentTime(time)}/>{/if}
          {#if selected && !session.nativeClipId}
            <TextAreaControls caption={selected} sequenceId={session.sequenceId} frameRate={session.frameRate} frameWidth={session.frameWidth} frameHeight={session.frameHeight} currentTime={session.currentTime} refreshRevision={areaControlRevision} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={exportBusy||agentAreaBusy||isRefreshing||isSyncing||session.isLoading} isDemo={api.isDemo} read={api.readCaptionArea} edit={api.editCaptionArea} getCurrentTime={async()=>{if(api.isDemo)return session.currentTime;const info=await api.getActiveSequenceInfo();if(!info||info.id!==session.sequenceId)throw new Error("The active sequence changed. Refresh Position & size before editing.");return info.playhead??session.currentTime;}} onSeek={async(time)=>{const result=!api.isDemo?await api.showInPremiere(time,session.sequenceId):null;if(sessionManager.current?.sequenceId!==session.sequenceId)throw new Error("The active sequence changed while seeking.");sessionManager.setCurrentTime(typeof result?.time==='number'?result.time:time);}} onSelect={selectSelectedCaption} onBusy={setAreaBusy} onChanged={areaChanged}/>
          {/if}
          {#if !session.nativeClipId}
          <AnimationPanel animation={session.animation} onUpdate={handleAnimation} />
          <details class="caption-section">
            <summary class="caption-section__heading">Initial placement</summary>
            <div class="caption-section__body">
              <div class="caption-controls">
                <label class="caption-field caption-field--wide"><span>Apply position to</span><select bind:value={locationScope}><option value="global">All captions · default</option><option value="caption" disabled={!selected}>Selected caption</option></select></label>
                <label class="caption-field"><span>X, % from left</span><input type="number" min="0" max="100" step=".5" value={Number((position.x * 100).toFixed(2))} onchange={(event) => updatePositionAxis("x", event)} /></label>
                <label class="caption-field"><span>Y, % from top</span><input type="number" min="0" max="100" step=".5" value={Number((position.y * 100).toFixed(2))} onchange={(event) => updatePositionAxis("y", event)} /></label>
                {#if locationScope === "caption" && selected?.position}<button class="caption-button caption-field--wide" onclick={() => positionCaption(null, "caption")}>Reset to default position</button>{/if}
              </div>
              <button class="caption-button" onclick={selectSelectedCaption} disabled={api.isDemo || timelineBusy || !selected?.clipNodeId}>Select in Program Monitor</button>
              <p class="caption-help">Initial placement affects new caption media. For applied clips, use Position & size or drag handles in the Program Monitor.</p>
            </div>
          </details>
          <details class="caption-section"><summary class="caption-section__heading">Timeline timing</summary><div class="caption-section__body"><button class="caption-button" onclick={() => { void syncTimeline(); }} disabled={api.isDemo || isSyncing || !session.captions.some((caption) => caption.clipNodeId)}>{isSyncing ? "Syncing…" : "Sync timing from Premiere"}</button><details class="caption-disclosure"><summary>When to sync</summary><p>After moving or trimming caption clips in Premiere, pull their timing back into this editor.</p></details>{#if timelineStatus}<p class="caption-message" role="status">{timelineStatus}</p>{/if}</div></details>
          {/if}
        </div>
      </fieldset>
    </div>
    <footer class="caption-app__output" aria-label="Program Monitor captions">
      {#if session.nativeClipId && timelineStatus}<p class="caption-message" role="status">{timelineStatus}</p>{:else if connectionStatus}<p class="caption-message" role="status">{connectionStatus}</p>{/if}
      {#if selectionHint}<p class="caption-help caption-app__selection-hint" role="status">Enable Transform below the Program Monitor to show the box handles.</p>{/if}
      {#if selected?.layoutOverflow}<p class="caption-message caption-message--error" role="alert">Text exceeds this box. Enlarge it or split the caption.</p>{/if}
      {#if liveStatus.phase === "error" && liveStatus.message}<p class="caption-message caption-message--error" role="alert">{liveStatus.message}</p>{/if}
      {#if reflowStatus.phase === "error" && reflowStatus.message}<p class="caption-message caption-message--error" role="alert">{reflowStatus.message}</p>{/if}
      {#if !session.nativeClipId && session.captions.some(caption => caption.clipNodeId)}
        <div class="caption-app__backup"><button class="caption-button" onclick={createNativeFromButton} disabled={api.isDemo || timelineBusy || isRefreshing || isSyncing || session.isLoading}>Create native effect copy</button></div>
      {/if}
      {#if !session.nativeClipId && nativeOutputKind(session) === 'new-native'}
        <p class="caption-message" role="status">{timelineBusy ? 'Creating native effect…' : 'Native effect · live captions'}</p>
      {:else if !session.nativeClipId}{#key session.sequenceId}
        <ExportButton bind:this={exportButton} captions={session.captions} style={session.style} animation={session.animation} frameWidth={session.frameWidth} frameHeight={session.frameHeight} frameRate={session.frameRate} duration={session.duration} sequenceName={session.sequenceName} sequenceId={session.sequenceId} currentTime={session.currentTime} {selectedId} tracks={sequenceInfo?.tracks ?? []} hostApi={api} onUpdated={recordApplied} onApplied={recordMonitorApplied} onBusy={setTimelineBusy} onPhase={(phase) => outputPhase = phase} liveStatus={liveStatus} disabled={areaBusy || isRefreshing || isSyncing || session.isLoading} />
      {/key}{/if}
    </footer>
  {:else}<div class="caption-app__empty"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="2"/><path d="M8 13h10M8 19h16"/></svg><h2>Start with a sequence</h2><p>Open a sequence in Premiere. Better Captions connects automatically.</p><button class="caption-button" onclick={() => { void refreshSequence(); }} disabled={isRefreshing}>{isRefreshing ? "Looking for sequence…" : "Refresh sequence"}</button></div>{/if}
</main>
<style>
  .caption-app { display: flex; flex-direction: column; block-size: 100%; overflow: hidden; container-type: inline-size; }
  .caption-app__output { flex-shrink: 0; border-block-start: 1px solid var(--color-panel-border); background: var(--color-surface); max-block-size: 40%; overflow-y: auto; }
  .caption-app__selection-hint { padding: var(--caption-space-s) var(--caption-space-l) 0; }
  .caption-app__editor { border: 0; padding: 0; margin: 0; min-inline-size: 0; }
  .caption-app__content { flex: 1; min-block-size: 0; overflow-y: auto; }
  .caption-app__error { display: flex; align-items: flex-start; gap: var(--caption-space-s); flex-shrink: 0; max-block-size: 8rem; overflow-y: auto; padding: var(--caption-space-s) var(--caption-space-l); background: #3a2927; color: var(--color-error); font-size: var(--caption-type-s); }
  .caption-app__error p { flex: 1; overflow-wrap: anywhere; }
  .caption-app__empty { margin: auto; max-inline-size: 30rem; padding: var(--caption-space-xl); text-align: center; color: var(--color-panel-secondary); }
  .caption-app__empty svg { inline-size: 2.5rem; block-size: 2.5rem; margin: 0 auto var(--caption-space-l); }
  .caption-app__empty h2 { font-size: var(--caption-type-l); color: var(--color-panel-text); font-weight: 600; }
  .caption-app__empty p { margin-block: var(--caption-space-s) var(--caption-space-l); }
  .caption-app__backup { padding: var(--caption-space-s) var(--caption-space-l); }
  .caption-app__loading { padding: var(--caption-space-l); border-block-end: 1px solid var(--color-panel-border); }
  .caption-app__loading p { margin-block-end: var(--caption-space-s); }
  .caption-app__skeleton { block-size: 2.5rem; margin-block-start: var(--caption-space-s); border-radius: var(--caption-radius); background: var(--color-surface-raised); }
</style>
