<script lang="ts">
  import { onMount, tick } from "svelte";
  import * as webviewAPI from "./webview-api";
  import { setSequenceCallbacks, setTimelinePlayheadCallback } from "./webview-api";
  import { initWebview } from "./webview-setup";
  import type { NativeTransportAvailability } from "./webview-setup";
  import { createLiveOutput, retryableNativeRead, staleNativeRead, type LiveOutputStatus } from "./lib/live-output";
  import { startCaptionReconnect } from "./lib/reconnect";
  import { connectionKey, reconnectLegacyCaptions, chooseNativeCaptionConnection, sameSequenceId, type CaptionConnections } from "./lib/clip-connections";
  import { rehydrateNativePanel, prepareNativePanelUpdate, confirmNativePanelUpdate, deriveNativePanelPhrases, nativeLineFitCharacterCapacity, nativeDocumentWriteSnapshot } from "./lib/native-effect/panel";
  import { extendNativeCaptions } from "./lib/native-effect/extension-workflow";
  import { confirmLineControls, confirmedLineScope, type ConfirmedLineControls } from './lib/native-effect/line-controls';
  import NativeEffectControls from './components/NativeEffectControls.svelte';
  import NativePauseLineControl from './components/NativePauseLineControl.svelte';
  import NativeRollUpControls from './components/NativeRollUpControls.svelte';
  import NativeAlignmentControls from './components/NativeAlignmentControls.svelte';
  import { prepareNativeCreation, nativeOutputKind } from "./lib/native-effect/create";
  import { encodeNativeTransportText } from "./lib/native-effect/encode";
  import { sessionManager } from "./lib/session/manager.svelte";
  import { validateStylePatch, validateCaptionPatch, validateAreaRead, validateAreaEdit, type AgentHandler } from "./lib/agent-bridge";
  import { retime, validateCaptions } from "./lib/transcript/edit";
  import { applyTypingText, createTypingController, typingRange, type TypingAnchor } from "./lib/transcript/typing";
  import { clearLineMerges, transcriptLines } from './lib/transcript/lines';
  import type { TranscriptTyping } from "./components/TranscriptPreview.svelte";
  import type { NativePanelBinding } from "./lib/native-effect/panel";
  import { refreshCaptionGroups, regroupCaptions } from "./lib/transcript/parser";
  import { captionLinks, confirmCaptionGeometry, createCaptionSelectionSync, legacyMotionBaseline, legacyMotionIdentity, panelVisibilityMessage, startProgramMonitorWatcher, type CaptionGeometryCue, type CaptionLink, type MotionWatchContext, type ReflowStatus } from "./lib/program-monitor";
  import type { TranscriptJSON, SequenceInfo, SessionState, StyleConfig, CaptionItem, AnimationConfig, MotionProfile, LineWrap } from "./lib/types";
  import TextAreaControls from "./components/TextAreaControls.svelte";
  import PanelTabs from "./components/PanelTabs.svelte";
  import SequenceStatus from "./components/SequenceStatus.svelte";
  import TranscriptPreview from "./components/TranscriptPreview.svelte";
  import TextStyleToolbar, { type TextStyleScope } from "./components/TextStyleToolbar.svelte";
  import { registerFontCatalog, type InstalledFont } from './lib/font-catalog.ts';
  import AnimationPanel from "./components/AnimationPanel.svelte";
  import StylePresets from "./components/StylePresets.svelte";
  import { applyPresetLook, type PresetLook } from "./lib/style-presets";
  import ExportButton from "./components/ExportButton.svelte";

  const { api } = initWebview(webviewAPI);
  let activeTab = $state("transcript");
  let wordState = $state<TextStyleScope>("all");
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
  let transcriptDraftActive = $state(false);
  let nativeGeometryInteracting = $state(false);
  let pauseControls = $state.raw<{blankLineSeconds:number;visibleLines:number}|null>(null);
  // Line positions offered as style scopes: Visible lines while scrolling, lines per page otherwise.
  let lineControls = $state.raw<ConfirmedLineControls>({clipKey:null,count:null});
  function noteLineControls(controls:{rollUp?:{value:unknown};rollUpLines?:{value:unknown};groups?:{value:unknown}}|null){
    const next=confirmLineControls(lineControls,lineClipKey,controls);
    wordState=confirmedLineScope(wordState,lineControls,next);
    lineControls=next;
  }
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
  let pauseSettings = $derived(nativeBinding ? pauseControls : null);
  const lineClipKey = $derived(nativeBinding ? JSON.stringify([nativeBinding.snapshot.locator.projectPath,nativeBinding.snapshot.locator.sequenceId,nativeBinding.snapshot.locator.clipNodeId]) : null);
  const lineCount = $derived(lineControls.clipKey===lineClipKey ? lineControls.count??0 : 0);
  $effect(() => { noteLineControls(null); });
  const lineFitCapacity=$derived.by(()=>{const session=sessionManager.current;return nativeBinding&&session?nativeLineFitCharacterCapacity(nativeBinding,session,undefined,lineCount):null;});
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
  // A sequence whose refresh has not confirmed its caption layers yet, e.g. its
  // read raced a playhead move (scrubbing). The reconnect poll repeats the
  // refresh quietly and nothing writes until it completes. A saved session it
  // already restored is kept, so edits made meanwhile are not reloaded over.
  let discoveryPending = '';
  const restoredStored = new Map<string, unknown>();
  let statusSequenceId: string | null = null;
  const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const message = (problem: unknown) => problem instanceof Error ? problem.message : String(problem);
  // Each native write becomes one named step in Premiere's Undo history. Edits
  // coalesced into one write share the label "Edit captions".
  let undoLabel = '';
  function labelEdit(label: string) { undoLabel = !undoLabel || undoLabel === label ? label : 'Edit lines'; }
  function captionEditLabel(before: CaptionItem[], after: CaptionItem[]) {
    const beforeLines=transcriptLines(before).length,afterLines=transcriptLines(after).length;
    if (afterLines > beforeLines) return 'Split line';
    if (afterLines < beforeLines) return 'Merge lines';
    return before.some((caption, index) => caption.text !== after[index]?.text) ? 'Edit transcript' : 'Line timing';
  }
  // Line editor typing on a native layer. Each pause (or Cmd going down) commits
  // the draft as one "Typing" step in Premiere's history, so Premiere Undo/Redo
  // works keystroke burst by burst while the editor stays open. Closing the
  // editor undoes those steps and commits the text once as "Edit text"; Escape
  // only undoes them. See lib/transcript/typing.ts and uxp/native-params.js.
  interface TypingSession {
    id: string; anchor: TypingAnchor; open: CaptionItem[];
    /** Binding and applied signature before the first confirmed typing step: what a merge returns to. */
    base: NativePanelBinding | null; baseSignature: string; steps: number; mergeable: boolean;
  }
  let typingSession: TypingSession | null = null;
  // Merges run one at a time; while one runs, no write, read or typing step starts.
  let typingMerging = 0, typingMerged: Promise<void> = Promise.resolve();
  let typingShow: ((draft: string, caret: number) => void) | null = null;
  // Recent typing events for getState diagnostics: when Cmd flushed, when each
  // step was written and confirmed, and when Premiere Undo/Redo was followed.
  const typingEvents: { at: number; event: string; text?: string; undoIndex?: number | null; detail?: string; stepAt?: number }[] = [];
  function typingEvent(event: string, detail: { text?: string; undoIndex?: number | null; detail?: string; stepAt?: number } = {}) {
    typingEvents.push({ at: Date.now(), event, ...detail });
    if (typingEvents.length > 40) typingEvents.shift();
  }
  const typingController = createTypingController({
    setTimer: (run, ms) => setTimeout(run, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    push: pushTyping, show: (draft, caret) => typingShow?.(draft, caret),
  });
  function pushTyping(draft: string): boolean {
    const typing = typingSession, session = sessionManager.current;
    if (!typing || !session?.nativeClipId || !nativeBinding || typingMerging) return false;
    try {
      // Every step is the open text replaced by the draft, so word timing comes
      // out as if the text were saved once, whatever the order of steps.
      const next = applyTypingText(typing.open, typing.anchor, draft);
      if (!typing.base && appliedSignatures[outputKey(session)] !== outputSignature(session)) typing.mergeable = false;
      updateCaptions(next);
      undoLabel = 'Typing';
      typingEvent('push', { text: typingRange(next, typing.anchor)?.text });
      return true;
    } catch (problem) { error = message(problem); return false; }
  }
  const transcriptTyping: TranscriptTyping = {
    open(anchor, captions, text, caret, show) {
      typingSession = { id: 'typing-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10), anchor, open: plain(captions), base: null, baseSignature: '', steps: 0, mergeable: true };
      typingShow = show;
      typingController.open(text, caret);
      // Gets the layer ready for fast typing steps (see uxp/native-params.js).
      const binding = nativeBinding, session = sessionManager.current;
      if (binding && session?.nativeClipId && typeof api.primeNativeTyping === 'function') void api.primeNativeTyping(plain(binding.snapshot), session.sequenceId)
        .then(result => typingEvent('primed', { undoIndex: result.undoIndex ?? null, detail: result.primed ? (result.seeded ? 'seeded' : 'ready') : result.reason }))
        .catch(problem => typingEvent('primed', { detail: message(problem) }));
      reconnect?.notify();
    },
    input: (draft, caret) => typingController.input(draft, caret),
    flush: () => { typingEvent(typingController.flush() ? 'cmd-flush' : 'cmd'); },
    hint() { typingEvent('cmd-up'); for (const delay of [120, 400]) setTimeout(() => reconnect?.notify(), delay); },
    end: (mode, reason) => finishTyping(mode, reason),
    // Writes pending line edits now, through the serialized live output, so a
    // structural edit is confirmed as its own history step before typing starts.
    // True only if the same sequence and layer are still current, with no typing
    // merge running and every edit written.
    async settle() {
      const session = sessionManager.current, key = session && outputKey(session), clip = session?.nativeClipId;
      if (!session || !key || !liveOutput || !await liveOutput.settle()) return false;
      return sessionManager.current === session && outputKey(session) === key && session.nativeClipId === clip && !typingMerging &&
        (!clip || nativeBinding?.snapshot.locator.clipNodeId === clip) && appliedSignatures[key] === outputSignature(session);
    },
  };
  async function finishTyping(mode: 'commit' | 'cancel' | 'abandon', reason?: string) {
    const typing = typingSession;
    if (!typing) return;
    typingEvent(mode, reason ? { detail: reason } : {});
    // Commit pending typing into the session first, so nothing typed is lost.
    if (mode === 'commit') typingController.flush();
    const draft = typingController.close();
    typingSession = null; typingShow = null;
    if (mode === 'abandon') return;
    let release = () => {};
    const previous = typingMerged;
    typingMerged = new Promise(resolve => { release = resolve; });
    typingMerging++;
    const current = sessionManager.current;
    if (mode === 'cancel' && current && typingRange(current.captions, typing.anchor)?.text !== typingRange(typing.open, typing.anchor)?.text) {
      try { updateCaptions(plain(typing.open)); undoLabel = 'Edit text'; } catch (problem) { error = message(problem); }
    }
    try {
      await previous;
      await liveOutput?.idle();
      const session = sessionManager.current, binding = nativeBinding, base = typing.base;
      if (!session?.nativeClipId || !binding || !typing.steps) return;
      if (!typing.mergeable || !base || base.snapshot.locator.clipNodeId !== binding.snapshot.locator.clipNodeId) { typingDiagnostics = { collapsed: false, reason: 'unmergeable', steps: typing.steps, at: Date.now() }; return; }
      const key = outputKey(session);
      const result = await api.collapseNativeTyping(plain(base.snapshot.locator), typing.id, session.sequenceId);
      typingDiagnostics = { ...result, steps: typing.steps, at: Date.now() };
      typingEvent(result.collapsed ? 'merged' : 'not-merged', { undoIndex: null, detail: result.collapsed ? 'undid ' + result.undone : result.reason });
      if (!result.collapsed || sessionManager.current !== session) return;
      if (result.revision !== base.snapshot.revision) { await followLayer(); return; }
      // Premiere is back before the first typing step; commit the text once.
      nativeBinding = base; appliedSignatures[key] = typing.baseSignature; liveOutput?.forget();
      if (outputSignature(session) === typing.baseSignature) { undoLabel = ''; return; }
      undoLabel = 'Edit text';
      // As live output, so a sentence editor opened meanwhile stays enabled.
      automaticOutput = true;
      try { await applyNativeOutput(); }
      catch (problem) {
        error = message(problem);
        const failure = problem as { code?: string; cause?: unknown };
        typingDiagnostics = { ...typingDiagnostics, finalError: message(failure.cause ?? problem) };
        if (failure.code === 'BC_OUTPUT_UNCONFIRMED' || failure.code === 'BC_NATIVE_PENDING') liveOutput?.block(key, error);
      } finally { automaticOutput = false; }
    } catch (problem) {
      // The merge stopped part way. Follow the layer, then put the typed text back.
      error = message(problem);
      typingDiagnostics = { ...typingDiagnostics, mergeError: error };
      try {
        await followLayer();
        const session = sessionManager.current;
        if (mode === 'commit' && draft && session && typingRange(session.captions, typing.anchor)) updateCaptions(applyTypingText(session.captions, typing.anchor, draft.draft));
      } catch (again) { error = message(again) + ' Your text was: ' + (draft?.draft ?? ''); }
    } finally {
      typingMerging--; release();
      liveOutput?.notify(); reconnect?.notify(); typingController.retry();
    }
  }
  let typingDiagnostics: Record<string, unknown> | null = null;
  // Reads the layer, putting back any document Premiere Undo/Redo selected, and
  // shows it even over pending panel edits: Premiere's history wins.
  async function followLayer() {
    const info = sequenceInfo;
    if (!info) return;
    const snapshot = await readConnections(info, true);
    if (snapshot) { acceptConnections(snapshot, info, true); lastDocumentRead = Date.now(); }
  }
  function sameNativeFit(a:{lineFitWidth?:number;lineFitFontScale?:number;lineFitStates?:unknown},b:typeof a){return a.lineFitWidth===b.lineFitWidth&&a.lineFitFontScale===b.lineFitFontScale&&JSON.stringify(a.lineFitStates)===JSON.stringify(b.lineFitStates);}
  $effect(() => {
    // Read the render inputs, readiness and visibility reactively. Playback and
    // selection alone never change outputSignature or schedule a new render.
    const session = sessionManager.current;
    if (session) { outputSignature(session); appliedSignatures[outputKey(session)]; }
    void nativeGeometryInteracting; void timelineBusy; void isRefreshing; void isSyncing; void hostPanelVisible; void documentVisible; void nativeAvailable; void exportButton;
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
    const label = undoLabel || 'Edit lines';
    undoLabel = '';
    // Steps of an open typing editor are recorded for merging when it closes.
    const typing = typingSession && !typingMerging ? typingSession : null, before = appliedSignatures[outputKey(session)];
    let submitted = false;
    timelineBusy = true;
    if (typing) typingEvent('write', { text: typingRange(edited.captions, typing.anchor)?.text });
    try {
      submitted = true;
      const result = await api.writeNativeCaptionDocument(plain(nativeDocumentWriteSnapshot(binding, edited)), documentText, session.sequenceId, label, ...(typing ? [typing.id] : []));
      if (!result?.ok || !result.readbackVerified) throw new Error('Premiere did not confirm the caption document.');
      const confirmed = confirmNativePanelUpdate(binding, prepared, edited, result);
      // Keep newer edits in the editor, while their next write uses the freshly
      // confirmed revision instead of replaying an obsolete setter.
      if (nativeBinding === binding) nativeBinding = confirmed;
      if (sessionManager.current === session) appliedSignatures[outputKey(session)] = outputSignature(edited);
      if (typing) {
        if (!typing.base) { typing.base = binding; typing.baseSignature = before; }
        typing.steps++;
        const range = typingRange(edited.captions, typing.anchor);
        const stepAt = (result as { fastStep?: { at?: number } }).fastStep?.at;
        typingEvent('confirmed', { text: range?.text, undoIndex: (result as { undoIndex?: number }).undoIndex ?? null, ...(typeof stepAt === 'number' ? { stepAt } : {}) });
        if (range && typingSession === typing) typingController.confirmed(range.text);
      }
    } catch (problem) {
      // Premiere Undo/Redo got there first and nothing was committed: follow it.
      if ((problem as { code?: string }).code === 'BC_NATIVE_STALE') { if (typing) typingEvent('stale', { detail: message(problem) }); await followLayer(); return; }
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
    return !api.isDemo && nativeAvailable && hostPanelVisible && !document.hidden && !timelineBusy && !nativeGeometryInteracting && !isRefreshing && !isSyncing && !session?.isLoading && !typingMerging && !isEditingTranscript()
      && (allowPendingEdits || !session?.captions.length || appliedSignatures[outputKey(session)] === outputSignature(session));
  }
  async function readConnections(info: SequenceInfo, includeDocuments = true): Promise<CaptionConnections | null> {
    if (api.isDemo || typeof api.readCaptionConnections !== 'function') return null;
    const session = legacySessions.get(connectionKey(info)) ?? sessionManager.current;
    const links = session?.nativeClipId ? [] : captionLinks(session?.captions ?? []);
    return await api.readCaptionConnections(info.id, plain(links), { includeDocuments }) as CaptionConnections;
  }
  // The host reports a revision per native layer (document fingerprint, edit
  // token, timing, line fit), not one for the whole read.
  function connectionsRevision(snapshot: CaptionConnections) {
    return snapshot.connectionRevision ?? JSON.stringify(snapshot.native.map(item => item.connectionRevision ?? ''));
  }
  function acceptConnections(snapshot: CaptionConnections, info: SequenceInfo, force = false): boolean {
    // Validation includes the project and sequence even for an empty saved session.
    const key = connectionKey(info);
    const current = sessionManager.current;
    const legacy = current?.nativeClipId ? legacySessions.get(key) : current;
    const plan = reconnectLegacyCaptions(legacy?.captions ?? [], snapshot, info);
    const retainedNative = snapshot.native.find(item => item.clipNodeId === (nativeBinding?.snapshot.locator.clipNodeId ?? current?.nativeClipId));
    const native = chooseNativeCaptionConnection(snapshot, plan.selectedId, nativeBinding?.snapshot.locator.clipNodeId ?? current?.nativeClipId);
    // Discovery may run while an old movie session has pending edits. Keep
    // those saved edits as its sidecar and bind the confirmed native document.
    // Never replace pending edits already belonging to a native layer.
    if (!force && current?.nativeClipId && appliedSignatures[key] !== outputSignature(current)) return false;
    let externalChange = false;
    if (native) {
      if (!native.documentText || !native.revision) {
        const bound = nativeBinding?.clip;
        if (!bound || native.maxChars !== bound.maxChars || !sameNativeFit(native,bound) || ['clipNodeId', 'startTicks', 'endTicks', 'inTicks', 'outTicks'].some(key => native[key as keyof typeof native] !== bound[key as keyof typeof bound])) return true;
      } else if (!nativeBinding || nativeBinding.snapshot.revision !== native.revision || nativeBinding.clip.maxChars !== native.maxChars || !sameNativeFit(native,nativeBinding.clip)) {
        externalChange = nativeBinding?.snapshot.locator.clipNodeId === native.clipNodeId;
        const typed = typingSession && current ? typingRange(current.captions, typingSession.anchor)?.text : undefined;
        const recovered = rehydrateNativePanel({ ...native, documentText: native.documentText, revision: native.revision }, info);
        if (current && !current.nativeClipId) legacySessions.set(key, plain(current));
        const session = { ...recovered.session, projectPath: info.projectPath, nativeClipId: native.clipNodeId };
        nativeBinding = recovered.binding;
        sessionManager.restore(session);
        const restored = sessionManager.current!;
        appliedSignatures[outputKey(restored)] = outputSignature(restored);
        liveOutput?.forget();
        selectFirst();
        nativeSelection = null;
        watchRevisionChanged();
        // Premiere Undo/Redo of a typing step: the open editor follows it.
        const range = typingSession && typed !== undefined ? typingRange(restored.captions, typingSession.anchor) : null;
        if (range && range.text !== typed) { typingEvent('restored', { text: range.text, detail: 'was ' + typed }); typingController.restored(range.text); }
      }
      sessionManager.setCurrentTime(snapshot.playhead);
      connectionStatus = externalChange ? 'Updated from Premiere' : 'Connected to native caption layer';
      if (native.documentText && native.revision && nativeBinding?.snapshot.revision === native.revision) {
        const restored = sessionManager.current!;
        liveOutput?.confirmReadback(key, outputSignature(restored));
      }
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
        : snapshot.native.length && !legacy?.captions.length ? 'Select a S-Captions layer to edit it.'
        : snapshot.legacy.length && !legacy?.captions.length ? 'The caption edit file is missing. Existing video captions are preserved.' : '';
    }
    connectionRevision = connectionsRevision(snapshot);
    return false;
  }
  async function inspectConnections() {
    const generation = reconnectGeneration;
    const info = await api.getActiveSequenceInfo();
    if (generation !== reconnectGeneration) return;
    if (!info || !sequenceInfo || connectionKey(info) !== connectionKey(sequenceInfo) || discoveryPending === connectionKey(info)) { await refreshSequence(info); return; }
    const current = sessionManager.current;
    const before = current ? outputSignature(current) : '';
    let snapshot = await readConnections(info, false);
    if (generation !== reconnectGeneration || !connectionReady(true) || (current && outputSignature(current) !== before)) return;
    if (!snapshot) return;
    const previousRevision = connectionRevision;
    const needsDocument = acceptConnections(snapshot, info);
    if (needsDocument || nativeBinding && (connectionsRevision(snapshot) !== previousRevision || Date.now() - lastDocumentRead >= 30000)) {
      // An abandoned or failed document read must not consume the revision change,
      // or the panel would miss a Premiere Undo/Redo until its periodic full read.
      try { snapshot = await readConnections(info, true); }
      catch (problem) { connectionRevision = previousRevision; throw problem; }
      if (generation !== reconnectGeneration || !connectionReady(true) || (current && sessionManager.current === current && outputSignature(current) !== before)) { connectionRevision = previousRevision; return; }
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
      if (sequenceInfo && info && sequenceInfo.projectPath !== info.projectPath) { loaded.clear(); restoredStored.clear(); legacySessions.clear(); legacyBaselines.clear(); transcriptionBackup = null; }
      sequenceInfo = info;
      if (contextChanged) {
        nativeBinding = null; connectionRevision = ''; connectionStatus = '';
        nativeSelection = null; areaControlRevision = ''; selectionHint = null; selectedId = null;
        ++selectionRevision; motionWatcher?.reset();
      }
      if (!info) { discoveryPending = ''; sessionManager.deactivateSequence(); selectedId = null; return; }
      sessionManager.activateSequence(info);
      const key = connectionKey(info);
      discoveryPending = key;
      if (!loaded.has(key)) {
        let stored = restoredStored.get(key) as Awaited<ReturnType<typeof api.loadSession>> | undefined;
        if (stored === undefined) {
          stored = await api.loadSession(info.id);
          if (generation !== reconnectGeneration) return;
          if (stored && sameSequenceId(stored.sequenceId, info.id)) {
            if (stored.captions?.length) validateCaptions(stored.captions);
            sessionManager.restore({ ...stored, sequenceId: info.id, projectPath: info.projectPath } as SessionState);
            sessionManager.activateSequence(info);
            saveStatus = "Saved caption session loaded";
          }
          restoredStored.set(key, stored ?? null);
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
        loaded.add(key); restoredStored.delete(key);
      } else {
        const connections = await readConnections(info);
        if (generation !== reconnectGeneration) return;
        if (connections) { acceptConnections(connections, info); lastDocumentRead = Date.now(); }
      }
      selectFirst();
      discoveryPending = '';
    } catch (problem) {
      // A read that raced a playhead move leaves discovery pending for the poll.
      if (!staleNativeRead(problem)) { discoveryPending = ''; error = message(problem); }
    }
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
    if(transcriptDraftActive){error='Finish or cancel the sentence edit before extending captions.';return;}
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
  function fitCharacterLimit() {
    if(transcriptDraftActive){error='Finish or cancel the sentence edit before changing grouping.';return;}
    const session=sessionManager.current,binding=nativeBinding;
    if(!session)return;
    if(editsLocked||isSyncing||isRefreshing||session.isLoading){error='Wait for the current caption operation to finish.';return;}
    if(!session.nativeClipId||!binding){error='Smart line fit measures the native caption layer. Connect or create one first.';return;}
    if(binding.clip.maxChars===undefined){error='The character limit is animated in Effect Controls. Remove its keyframes to use Smart line fit.';return;}
    const capacity=nativeLineFitCharacterCapacity(binding,session,undefined,lineCount);
    if(capacity===null){error='Smart line fit measurement is unavailable in this editor.';return;}
    error='';
    changeCharacterLimit(capacity, 'Smart line fit');
    if(!error)timelineStatus=`Characters per line set to ${capacity}.`;
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
      captions: session.captions.map((caption) => ({ id: caption.id, text: caption.text, startTime: caption.startTime, endTime: caption.endTime, position: caption.position, words: caption.words.map((word) => ({ text: word.text, startTime: word.startTime, endTime: word.endTime, lineBreakBefore: word.lineBreakBefore, pauseLinesRemoved: word.pauseLinesRemoved })), renderSegments: caption.renderSegments })),
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
    if(transcriptDraftActive)throw new Error("Finish or cancel the sentence edit before changing its style.");
    if (editsLocked || isSyncing || isRefreshing) throw new Error("Wait for the current caption operation to finish.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    const updates = validateStylePatch(patch);
    const next = { ...updates, ...(updates.activeWord ? { activeWord: { ...session.style.activeWord, ...updates.activeWord } } : {}), ...(updates.spokenWord ? { spokenWord: { ...session.style.spokenWord, ...updates.spokenWord } } : {}), ...(updates.upcomingWord ? { upcomingWord: { ...session.style.upcomingWord, ...updates.upcomingWord } } : {}) };
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), style: { ...plain(session.style), ...next } });
    sessionManager.updateStyle(next);
    if (nativeBinding) sessionManager.updateCaptions(deriveNativePanelPhrases(nativeBinding,plain(session)));
    if (before !== outputSignature(session)) { labelEdit('Style'); markOutputEdited(session.sequenceId); }
  }
  function handleStyle(patch: Partial<StyleConfig>) { try { updateStyle(patch); } catch (problem) { error = message(problem); } }
  // One Characters per line drag or typing session is one Premiere edit. The
  // panel previews every value; the layer is written once the gesture ends, so
  // that single write still holds the original merges and limit for one Undo.
  let characterLimitGesture = $state(false);
  function setCharacterLimitGesture(active: boolean) {
    if (characterLimitGesture === active) return;
    characterLimitGesture = active;
    if (!active) liveOutput?.notify();
  }
  function changeCharacterLimit(maxChars: number, label = 'Characters per line') {
    try { reflowCharacterLimit(maxChars, label); } catch (problem) { error = message(problem); }
  }
  function reflowCharacterLimit(maxChars: number, label = 'Characters per line') {
    const session = sessionManager.current;
    if (!session) return;
    // Grouping is one edit: limit and derived phrases change together. A
    // reflow also forgets every merge ('join' and 'edge'), so the new limit
    // regroups them; manual split breaks stay. One document write carries both,
    // so one Premiere Undo puts back the old limit and the merged lines together.
    updateStyle({ maxChars });
    const reflowed = clearLineMerges(plain(session.captions));
    updateCaptions(nativeBinding ? reflowed : regroupCaptions(reflowed, maxChars));
    undoLabel = label;
  }
  // A line wrap change is a reflow too: merges clear, manual breaks stay, and
  // the mode rides in the same document write, so one Undo restores both.
  function changeLineWrap(lineWrap: LineWrap) {
    try { reflowLineWrap(lineWrap); } catch (problem) { error = message(problem); }
  }
  function reflowLineWrap(lineWrap: LineWrap) {
    const session = sessionManager.current;
    if (!session || (session.style.lineWrap ?? 'fill') === lineWrap) return;
    updateStyle({ lineWrap });
    const reflowed = clearLineMerges(plain(session.captions));
    updateCaptions(nativeBinding ? reflowed : regroupCaptions(reflowed, session.style.maxChars));
    undoLabel = 'Line wrap';
  }
  async function applyStylePreset(look: PresetLook) {
    if(transcriptDraftActive)throw new Error("Finish or cancel the sentence edit before applying a preset.");
    if (editsLocked || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    const next = applyPresetLook(session.style, look);
    if(nativeBinding)next.style.wordSpacing=session.style.wordSpacing;
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), style: next.style, animation: next.animation });
    session.style = next.style;
    session.animation = next.animation;
    if (nativeBinding) sessionManager.updateCaptions(deriveNativePanelPhrases(nativeBinding,plain(session)));
    sessionManager.persist();
    if (before !== outputSignature(session)) { labelEdit('Apply preset'); markOutputEdited(session.sequenceId); }
    await flushSave();
    if (sessionManager.current?.sequenceId !== session.sequenceId) throw new Error("The preset was applied to the previous sequence. Return to that sequence to review it.");
  }
  function updateCaptions(captions: CaptionItem[], markEdited = true, historyLabel?:string) {
    if (markEdited && editsLocked) throw new Error("Wait for Premiere to finish placing the captions.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const previous = session.captions;
    if (captions.length) validateCaptions(captions);
    captions = nativeBinding ? deriveNativePanelPhrases(nativeBinding,{...plain(sessionManager.current!),captions}) : refreshCaptionGroups(captions);
    if (nativeBinding && markEdited) prepareNativePanelUpdate(nativeBinding, { ...plain(sessionManager.current!), captions });
    if (markEdited) labelEdit(historyLabel ?? captionEditLabel(previous, captions));
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
      if (!selection.selectCaptionClip) throw new Error("Update S-Captions to select the caption in the Program Monitor.");
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
    // An open typing editor keeps reading the layer, to follow Premiere Undo/Redo.
    if (typingSession) return false;
    const active = document.activeElement;
    // The caption search box edits nothing, so Premiere Undo/Redo is still followed.
    return transcriptDraftActive || document.hasFocus() && active instanceof HTMLElement && !!active.closest(".transcript-editor") && !active.closest(".transcript-editor__search") && (["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) || active.isContentEditable);
  }
  function selectionPauseReason(): string | null {
    const session = sessionManager.current;
    if (api.isDemo) return "demo";
    if (session && discoveryPending === outputKey(session)) return "discovering";
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
    if (!geometryAPI.readCaptionGeometry) throw new Error("Update S-Captions to enable Program Monitor text-box reflow.");
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
  // One bounded, read-only sample for the existing agent get_state transport.
  // No observers, retained DOM nodes, focus/selection changes or scroll writes.
  function uiViewportSnapshot() {
    const list = document.querySelector<HTMLElement>('.transcript-editor__list');
    const outer = document.querySelector<HTMLElement>('.caption-app__content');
    const editor = list?.querySelector<HTMLTextAreaElement>('.transcript-editor__cue-input') ?? null;
    const editedRow = editor?.closest<HTMLElement>('[data-row-key]') ?? null;
    const selectedRow = list?.querySelector<HTMLElement>('.transcript-editor__cue--selected') ?? null;
    const active = document.activeElement;
    const listRect = list?.getBoundingClientRect();
    const bounded = (value: string | null | undefined) => value == null ? null : value.slice(0, 160);
    function scrollBox(node: HTMLElement | null) {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
        maxScrollTop: Math.max(0, node.scrollHeight - node.clientHeight),
        top: rect.top, height: rect.height, width: rect.width,
        overflowAnchor: getComputedStyle(node).getPropertyValue('overflow-anchor'),
      };
    }
    function rowBox(node: Element | null) {
      if (!node || !list || !listRect) return null;
      const rect = node.getBoundingClientRect();
      const topInListViewport = rect.top - listRect.top - list.clientTop;
      return {
        key: bounded(node.getAttribute('data-row-key')), captionId: bounded(node.getAttribute('data-caption-id')),
        top: rect.top, topInListViewport, topInListContent: topInListViewport + list.scrollTop, height: rect.height,
      };
    }
    function inputState(node: Element | null) {
      if (!node) return null;
      const input = node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node : null;
      return {
        tag: node.tagName, type: input?.type ?? null, ariaLabel: bounded(node.getAttribute('aria-label')),
        rowKey: bounded(node.closest('[data-row-key]')?.getAttribute('data-row-key')),
        selectionStart: input?.selectionStart ?? null, selectionEnd: input?.selectionEnd ?? null,
        selectionDirection: input?.selectionDirection ?? null, valueLength: input?.value.length ?? null,
      };
    }
    const pending = editedRow?.querySelector<HTMLElement>('.transcript-editor__text-pending') ?? null;
    return {
      sampledAt: Date.now(), activeTab, documentHasFocus: document.hasFocus(),
      userAgent: bounded(navigator.userAgent), overflowAnchorSupported: typeof CSS !== 'undefined' && CSS.supports('overflow-anchor', 'none'),
      list: scrollBox(list), outer: scrollBox(outer),
      selectedRow: rowBox(selectedRow), editedRow: rowBox(editedRow),
      previousEditedRow: rowBox(editedRow?.previousElementSibling ?? null),
      activeElement: inputState(active), editor: editor ? { ...inputState(editor), focused: active === editor, height: editor.getBoundingClientRect().height } : null,
      pending: pending ? { text: bounded(pending.textContent), height: pending.getBoundingClientRect().height, visibility: getComputedStyle(pending).visibility } : null,
    };
  }
  function runtimeState() {
    const session = sessionManager.current, caption = session?.captions.find(item => item.id === selectedId);
    return {
      reflow: { phase: reflowStatus.phase, message: reflowStatus.message.slice(0, 1000), pauseReason: motionPauseReason(), watcher: motionWatcher?.diagnostics() ?? null },
      visibility: { hostPanelVisible, documentHidden: document.hidden, documentVisibilityState: document.visibilityState },
      uiViewport: uiViewportSnapshot(),
      fonts: { count: fonts.length, loading: fontsLoading, error: fontsError },
      selectedId, nativeSelection: nativeSelection ? { ...nativeSelection } : null,
      liveOutput: { ...liveStatus, ...liveOutput?.diagnostics(), nativeAvailable },
      connection: { status: connectionStatus, kind: session?.nativeClipId ? 'native-effect' : 'generated-movie', clipNodeId: session?.nativeClipId, reconnect: reconnect?.diagnostics() ?? null },
      busy: { timeline: timelineBusy, export: exportBusy, area: areaBusy, refreshing: isRefreshing, syncing: isSyncing, loading: !!session?.isLoading },
      hasSavedWatchSignature: !!caption?.motionProfile?.watchSignature,
      typing: { open: !!typingSession, steps: typingSession?.steps ?? 0, mergeable: typingSession?.mergeable ?? null, merging: typingMerging, editor: typingController.state ? { ...typingController.state } : null, lastMerge: typingDiagnostics, events: typingEvents.slice(-20) },
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
    if (editsLocked || isSyncing || isRefreshing) throw new Error("Wait for the current caption operation to finish.");
    const session = sessionManager.current;
    if (!session) throw new Error("No active caption session.");
    const before = outputSignature(session);
    if (nativeBinding) prepareNativePanelUpdate(nativeBinding, { ...plain(session), animation: { ...plain(session.animation), ...validateAnimation(patch) } });
    sessionManager.updateAnimation(validateAnimation(patch));
    if (before !== outputSignature(session)) { labelEdit('Animation'); markOutputEdited(session.sequenceId); }
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
    async patchStyle(patch) {
      // A limit change reflows exactly like the panel control: merges clear.
      const { maxChars, lineWrap, ...rest } = validateStylePatch(patch);
      if (Object.keys(rest).length) updateStyle(rest);
      if (maxChars !== undefined && maxChars !== sessionManager.current?.style.maxChars) reflowCharacterLimit(maxChars);
      if (lineWrap !== undefined) reflowLineWrap(lineWrap);
      await flushSave(); return getState();
    },
    async patchAnimation(patch: Partial<AnimationConfig>) { updateAnimation(patch); await flushSave(); return getState(); },
    readArea: payload => runAgentArea(payload, false),
    editArea: payload => runAgentArea(payload, true),
    async setCaptions(captions) {
      if(transcriptDraftActive)throw new Error("Finish or cancel the sentence edit before replacing captions.");
      if (editsLocked || isSyncing || isRefreshing) throw new Error("Wait for the current caption operation to finish.");
      const current = sessionManager.current;
      if (!current) throw new Error("No active caption session.");
      updateCaptions(validateCaptionPatch(captions, current.captions));
      await flushSave(); return getState();
    },
    async refresh() { if (timelineBusy) throw new Error("Wait for the caption render and timeline update to finish."); return refreshSequence(); },
    testTyping: testTyping,
    async testHistory(payload) {
      const direction = (payload as { direction?: unknown })?.direction;
      if (direction !== 'undo' && direction !== 'redo') throw new Error('Use direction undo or redo.');
      const before = await undoState(), step = await api.testNativeHistoryStep(direction, sessionManager.current?.sequenceId);
      await sleep(Number((payload as { settle?: unknown }).settle ?? 1500));
      return { before, step, after: await undoState(), editor: typingController.state ? { ...typingController.state } : null, typing: !!typingSession };
    },
    async apply() {
      if (timelineBusy || isRefreshing || isSyncing || sessionManager.current?.isLoading) throw new Error("Wait for the current caption operation to finish.");
      if (api.isDemo) throw new Error("Apply captions from the installed Premiere panel.");
      if (nativeBinding) { await applyNativeOutput(); return getState(); }
      if (sessionManager.current && nativeOutputKind(sessionManager.current) === "new-native") { await createNativeOutput(); return getState(); }
      if (!exportButton) throw new Error("Caption controls are not ready.");
      await flushSave(); await exportButton.apply(); await flushSave(); return getState();
    },
  };
  // Test hooks only (scripts/agent.cjs test_typing / test_history). They drive the
  // real line editor through DOM events, since a tester cannot always focus it.
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function undoState() {
    const locator = nativeBinding?.snapshot.locator;
    return locator ? await api.readNativeUndoState(plain(locator), sessionManager.current?.sequenceId) : null;
  }
  async function testTyping(payload: unknown) {
    const p = (payload ?? {}) as { row?: number; texts?: string[]; gap?: number; flush?: boolean; end?: 'commit' | 'cancel' | 'none'; settle?: number };
    if (!Array.isArray(p.texts) || p.texts.some(text => typing(text))) throw new Error('Pass texts: an array of drafts.');
    function typing(text: unknown) { return typeof text !== 'string' || text.length > 2000; }
    activeTab = 'transcript'; await tick();
    const before = await undoState();
    // An open editor is continued; otherwise the given row's text is clicked to open it.
    if (!document.querySelector('.transcript-editor__cue-input')) {
      if (!p.row) throw new Error('No sentence editor is open. Pass row to open one.');
      const button = document.querySelectorAll<HTMLElement>('.transcript-editor__cue')[p.row - 1]?.querySelector<HTMLButtonElement>('.transcript-editor__cue-text');
      if (!button) throw new Error('No such sentence row.');
      button.click(); await tick();
    }
    const area = document.querySelector<HTMLTextAreaElement>('.transcript-editor__cue-input');
    if (!area || !typingSession) throw new Error('The line editor did not open in typing mode.');
    const opened = area.value, during: unknown[] = [];
    for (const text of p.texts) {
      area.value = text; area.setSelectionRange(text.length, text.length);
      area.dispatchEvent(new Event('input', { bubbles: true }));
      if (p.flush) area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', bubbles: true }));
      await sleep(p.gap ?? 1100); await liveOutput?.idle();
      during.push({ text, undo: await undoState() });
    }
    if (p.end === 'commit') area.dispatchEvent(new FocusEvent('blur'));
    else if (p.end === 'cancel') area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (p.end === 'commit' || p.end === 'cancel') { await sleep(50); await typingMerged; await liveOutput?.idle(); await sleep(p.settle ?? 300); }
    const range = typingSession ? typingRange(sessionManager.current?.captions ?? [], typingSession.anchor) : null;
    return { opened, before, during, after: await undoState(), merge: typingDiagnostics, open: !!typingSession, text: range?.text ?? null, error, live: { ...liveStatus } };
  }
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
        // A connected native layer stays writable with no lines left (Delete line on the last one).
        if (api.isDemo || !session || !sessionLoaded(session) || !(session.nativeClipId && nativeBinding) && (!session.hasTranscript || !session.captions.length)) return null;
        const signature = outputSignature(session);
        return { sequenceId: outputKey(session), signature,
          needed: appliedSignatures[outputKey(session)] !== signature,
          ready: discoveryPending !== outputKey(session) && nativeAvailable && hostPanelVisible && documentVisible && !timelineBusy && !nativeGeometryInteracting && !characterLimitGesture && !isRefreshing && !isSyncing && !session.isLoading && !typingMerging && !!(nativeBinding || nativeOutputKind(session) === "new-native" || exportButton) };
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
      // A typing step was already debounced by the line editor.
      debounce: () => typingSession ? 0 : 400,
      onStatus(status) { if (liveStatus.phase !== status.phase || liveStatus.message !== status.message) liveStatus = status; },
    });
    let wasWaiting = false;
    reconnect = startCaptionReconnect({
      // Premiere Undo/Redo of a panel edit is picked up by this poll.
      interval: 1500,
      fast: () => typingSession ? 400 : null,
      ready: () => connectionReady(true),
      inspect: inspectConnections,
      onError(problem) { connectionStatus = retryableNativeRead(problem) ? 'Waiting for Premiere. Reconnection will resume automatically.' : message(problem); },
      transient: staleNativeRead,
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
        if (!selectionAPI.readCaptionSelection) throw new Error("Update S-Captions to follow Program Monitor caption selection.");
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
  <SequenceStatus {pauseSettings} session={sessionManager.current} onRefresh={() => { void refreshSequence(); }} onTranscribe={() => { void transcribe(); }} onExtend={sessionManager.current?.nativeClipId ? () => { void extendCaptions(); } : undefined} isDemo={api.isDemo} isBusy={isRefreshing || isSyncing || timelineBusy || !!sessionManager.current?.isLoading} {saveStatus} />
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
          {#snippet nativeGrouping()}{#if session.nativeClipId && nativeBinding}<NativePauseLineControl onControlsChange={controls=>{const seconds=controls?.rollUpBlankLineSeconds?.value,lines=controls?.rollUpLines?.value;pauseControls=typeof seconds==='number'&&typeof lines==='number'?{blankLineSeconds:seconds,visibleLines:lines}:null;noteLineControls(controls);}} onInteracting={active=>{nativeGeometryInteracting=active;if(!active){reconnect?.notify();liveOutput?.notify();}}} snapshot={nativeBinding.snapshot} sequenceId={session.sequenceId} currentTime={session.currentTime} visible={activeTab==='transcript'&&hostPanelVisible&&documentVisible} disabled={timelineBusy||isRefreshing||isSyncing||session.isLoading} read={api.readNativeCaptionControls} edit={api.editNativeCaptionControl} seek={api.seekNativeCaptionKeyframe} onTimeChange={time=>sessionManager.setCurrentTime(time)}/>{/if}{/snippet}
          <TranscriptPreview {pauseSettings} {nativeGrouping} nativeLayerKey={lineClipKey} {lineFitCapacity} typing={session.nativeClipId && nativeBinding && !api.isDemo ? transcriptTyping : null} onEditingChange={(active)=>transcriptDraftActive=active} onSmartLineFit={fitCharacterLimit} onCharacterLimitGesture={setCharacterLimitGesture} frameRate={session.frameRate} {selectedWord} onSelectWord={(index) => selectedWord = index} sequenceId={session.sequenceId} captions={session.captions} currentTime={session.currentTime} maxChars={session.style.maxChars} lineWrap={session.nativeClipId && nativeBinding ? session.style.lineWrap ?? 'fill' : null} onLineWrapChange={changeLineWrap} groupingDisabled={!!session.nativeClipId && nativeBinding?.clip.maxChars === undefined} {selectedId} onSelect={(id) => { selectedId = id; selectedWord = 0; }} onSeek={seekCaption} onMaxCharsChange={changeCharacterLimit} onUpdate={(captions,label)=>updateCaptions(captions,true,label)} onShowInPremiere={seekCaption} isDemo={api.isDemo} disabled={editsLocked || isRefreshing || isSyncing || session.isLoading} />
        </div>
        <div id="workspace-panel-style" role="tabpanel" aria-labelledby="workspace-tab-style" tabindex="0" hidden={activeTab !== "style"}>
          {#key session.sequenceId}
            <StylePresets nativeMode={!!session.nativeClipId} style={session.style} animation={session.animation} load={api.loadStylePresets} save={api.saveStylePresets} onApply={applyStylePreset} isDemo={api.isDemo} disabled={editsLocked || isRefreshing || isSyncing || session.isLoading} />
          {/key}
          {#snippet nativeAlignment()}{#if session.nativeClipId && nativeBinding}<NativeAlignmentControls snapshot={nativeBinding.snapshot} sequenceId={session.sequenceId} currentTime={session.currentTime} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={timelineBusy||isRefreshing||isSyncing||session.isLoading} read={api.readNativeCaptionControls} edit={api.editNativeCaptionControl} seek={api.seekNativeCaptionKeyframe} onTimeChange={time=>sessionManager.setCurrentTime(time)}/>{/if}{/snippet}
          {#snippet nativeLayout()}{#if session.nativeClipId && nativeBinding}<NativeEffectControls onControlsChange={noteLineControls} onInteracting={active=>{nativeGeometryInteracting=active;if(!active){reconnect?.notify();liveOutput?.notify();}}} snapshot={nativeBinding.snapshot} sequenceId={session.sequenceId} frameWidth={session.frameWidth} frameHeight={session.frameHeight} currentTime={session.currentTime} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={timelineBusy||isRefreshing||isSyncing||session.isLoading} read={api.readNativeCaptionControls} edit={api.editNativeCaptionControl} seek={api.seekNativeCaptionKeyframe} onTimeChange={time=>sessionManager.setCurrentTime(time)}/>{/if}{/snippet}
          <TextStyleToolbar style={session.style} {fonts} {fontCatalog} {fontsLoading} {fontsError} onRefreshFonts={() => { void refreshFonts(); }} scope={wordState} nativeMode={!!session.nativeClipId} {lineCount} {nativeLayout} {nativeAlignment} onScopeChange={changeWordState} onUpdate={handleStyle} />
          {#if session.nativeClipId && nativeBinding}<NativeRollUpControls snapshot={nativeBinding.snapshot} sequenceId={session.sequenceId} frameWidth={session.frameWidth} frameHeight={session.frameHeight} currentTime={session.currentTime} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={timelineBusy||isRefreshing||isSyncing||session.isLoading} read={api.readNativeCaptionControls} edit={api.editNativeCaptionControl} seek={api.seekNativeCaptionKeyframe} onTimeChange={time=>sessionManager.setCurrentTime(time)}/>{/if}
          {#if selected && !session.nativeClipId}
            <TextAreaControls caption={selected} sequenceId={session.sequenceId} frameRate={session.frameRate} frameWidth={session.frameWidth} frameHeight={session.frameHeight} currentTime={session.currentTime} refreshRevision={areaControlRevision} visible={activeTab==='style'&&hostPanelVisible&&documentVisible} disabled={exportBusy||agentAreaBusy||isRefreshing||isSyncing||session.isLoading} isDemo={api.isDemo} read={api.readCaptionArea} edit={api.editCaptionArea} getCurrentTime={async()=>{if(api.isDemo)return session.currentTime;const info=await api.getActiveSequenceInfo();if(!info||info.id!==session.sequenceId)throw new Error("The active sequence changed. Refresh Position & size before editing.");return info.playhead??session.currentTime;}} onSeek={async(time)=>{const result=!api.isDemo?await api.showInPremiere(time,session.sequenceId):null;if(sessionManager.current?.sequenceId!==session.sequenceId)throw new Error("The active sequence changed while seeking.");sessionManager.setCurrentTime(typeof result?.time==='number'?result.time:time);}} onSelect={selectSelectedCaption} onBusy={setAreaBusy} onChanged={areaChanged}/>
          {/if}
          {#if !session.nativeClipId}
          <AnimationPanel animation={session.animation} onUpdate={handleAnimation} />
          <details class="caption-section">
            <summary class="caption-section__heading">Initial placement</summary>
            <div class="caption-section__body">
              <div class="caption-controls">
                <label class="caption-field caption-field--wide"><span>Apply position to</span><select bind:value={locationScope}><option value="global">All lines · default</option><option value="caption" disabled={!selected}>Selected line</option></select></label>
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
      {#if selectionHint}<p class="caption-help caption-app__selection-hint" role="status">Enable Transform below the Program Monitor to show the layout handles.</p>{/if}
      {#if selected?.layoutOverflow}<p class="caption-message caption-message--error" role="alert">Text exceeds the line width. Increase the width or split the line.</p>{/if}
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
  {:else}<div class="caption-app__empty"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3" y="6" width="26" height="20" rx="2"/><path d="M8 13h10M8 19h16"/></svg><h2>Start with a sequence</h2><p>Open a sequence in Premiere. S-Captions connects automatically.</p><button class="caption-button" onclick={() => { void refreshSequence(); }} disabled={isRefreshing}>{isRefreshing ? "Looking for sequence…" : "Refresh sequence"}</button></div>{/if}
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
