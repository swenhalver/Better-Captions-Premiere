<script lang="ts">
  import { tick, onDestroy, untrack, type Snippet } from 'svelte';
  import { numericInput, numericInputValue } from '../lib/numeric-input';
  import ScrubbableNumber from "./ScrubbableNumber.svelte";
  import WordTimeline from "./WordTimeline.svelte";
  import type { CaptionItem, LineWrap } from "../lib/types";
  import { formatTime, validateCharacterLimit } from "../lib/transcript/parser";
  import { replaceText, retime, validateCaptions } from "../lib/transcript/edit";
  import { captionWordOffset, changeTranscriptLineBreak, deleteTranscriptLine, insertTranscriptLine, isBlankLine, lineSegment, newLineRoom, replaceTranscriptLine, replaceTranscriptWords, transcriptLineCaption, transcriptLineLane, transcriptLines, transcriptWords, withTranscriptLines, type NewLineBorrow, type NewLineSide, type TranscriptLine } from "../lib/transcript/lines";
  import type { WordEdge } from '../lib/transcript/timing';
  import { applyTypingText, typingAnchor, typingRange, typingText, type TypingAnchor } from '../lib/transcript/typing';
  import { derivePauseLines, pauseCadence, removePauseLine, type PauseLine, type PauseLineSettings } from '../lib/native-effect/pause-lines';
  type SentenceRow = TranscriptLine;
  // At touching lines, Add line takes time from one neighbouring word (see insertTranscriptLine).
  const newLineBorrow: NewLineBorrow = 'neighbour';
  type TranscriptRow = { kind: 'text'; key: string; line: SentenceRow } | { kind: 'pause'; key: string; pause: PauseLine };
  /** Line editor typing on a native layer: Premiere history steps while it is open (main-webview). */
  export interface TranscriptTyping {
    open(anchor: TypingAnchor, captions: CaptionItem[], text: string, caret: number, show: (draft: string, caret: number) => void): void;
    input(draft: string, caret: number): void;
    /** Cmd/Ctrl went down: commit pending typing now, before a Premiere shortcut such as Undo. */
    flush(): void;
    /** Cmd/Ctrl came up: Premiere may just have run Undo or Redo. */
    hint(): void;
    end(mode: 'commit' | 'cancel' | 'abandon', reason?: string): Promise<void>;
    /** Writes pending line edits now. True once Premiere confirmed them as their own history step. */
    settle(): Promise<boolean>;
  }
  interface Props {
    frameRate: number; selectedWord?: number; onSelectWord?: (index:number)=>void;
    sequenceId: string; captions: CaptionItem[]; currentTime: number; maxChars: number; selectedId?: string | null;
    onSeek: (time: number) => void; onSelect: (id: string) => void;
    onMaxCharsChange: (maxChars: number) => void; onUpdate: (captions: CaptionItem[], historyLabel?: string) => void;
    /** The native layer's line wrap; null hides the control (legacy captions group without it). */
    lineWrap?: LineWrap | null; onLineWrapChange?: (lineWrap: LineWrap) => void;
    onEditingChange?: (active:boolean)=>void;
    onShowInPremiere?: (time: number) => void; isDemo?: boolean; disabled?: boolean; groupingDisabled?: boolean; lineFitCapacity?:number|null; onSmartLineFit?:()=>void;
    /** A Characters per line drag or typing session started (true) or ended (false). */
    onCharacterLimitGesture?:(active:boolean)=>void;
    typing?: TranscriptTyping | null;
    nativeGrouping?: Snippet;
    pauseSettings?: PauseLineSettings | null;
    /** The connected native layer (project, sequence, clip), without its revision; null when none is connected. */
    nativeLayerKey?: string | null;
  }
  let { frameRate, selectedWord = 0, onSelectWord = () => {}, sequenceId, captions, currentTime, maxChars, selectedId = null, onSeek, onSelect, onMaxCharsChange, onUpdate, lineWrap = null, onLineWrapChange, disabled = false, groupingDisabled = false, onEditingChange=()=>{}, lineFitCapacity=null, onSmartLineFit, onCharacterLimitGesture, typing = null, nativeGrouping, pauseSettings = null, nativeLayerKey = null }: Props = $props();
  let activeId = $derived(captions.find((caption) => currentTime >= caption.startTime && currentTime < caption.endTime)?.id ?? null);
  let selectedContainer = $derived(captions.find((caption) => caption.id === selectedId) ?? captions[0]);
  let selectedRowKey = $state<string | null>(null);
  let selectedPauseKey = $state<string | null>(null);
  // The words an open typing editor replaces. Typing steps regroup the phrases
  // around it, so its row is pinned to exactly these words while it is open.
  let typingAt = $state<TypingAnchor | null>(null);
  // Blur runs before a pause button's click. Retain its history merge so that
  // a subsequent deletion waits even after the editor has already closed.
  let typingFinished: Promise<void> | null = null;
  // Premiere confirming the last Add line or Delete line as its own Undo step
  // (true) or not (false). Until then an open editor keeps what is typed
  // without typing steps, and saving its text or another structural edit
  // (Add, Delete, Split, Merge, a pause) waits here.
  let lineAdded: Promise<boolean> | null = null, afterLineAddedRunning = false, addingLine = false, deletingLine = $state(false), destroyed = false;
  function awaitLineAdded(pending: Promise<boolean>) {
    lineAdded = pending;
    void pending.then(() => { if (lineAdded === pending) lineAdded = null; });
  }
  // Runs after the pending Add line settles; false (run it now) when none is pending.
  function afterLineAdded(run: (confirmed: boolean) => void) {
    const pending = lineAdded;
    if (!pending || afterLineAddedRunning) return false;
    awaitLineAdded(pending.then(confirmed => {
      if (destroyed) return confirmed;
      afterLineAddedRunning = true;
      try { run(confirmed); }
      catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
      finally { afterLineAddedRunning = false; }
      return confirmed;
    }));
    return true;
  }
  let sentenceRows = $derived.by((): SentenceRow[] => {
    const rows = transcriptLines(captions);
    return typingAt && editingRowKey ? pinTypingRow(rows, editingRowKey, typingAt) : rows;
  });
  // Premiere's pause controls are read again after every confirmed write, and
  // are unknown (null) until that read returns. The pause rows keep the last
  // known settings of the same connected layer meanwhile: dropping them shrinks
  // the list for a moment, and the browser then clamps its scroll position far
  // above the line being typed. Another sequence or layer, or no layer at all,
  // never shows them; fresh settings always replace them.
  let pauseLayer = $derived(nativeLayerKey ? JSON.stringify([sequenceId, nativeLayerKey]) : null);
  let knownPauseSettings: { layer: string; settings: PauseLineSettings } | null = null;
  let pauseLineSettings = $derived.by(() => {
    const layer = pauseLayer;
    if (knownPauseSettings?.layer !== layer) knownPauseSettings = null;
    if (pauseSettings && layer) knownPauseSettings = { layer, settings: pauseSettings };
    return pauseSettings ?? knownPauseSettings?.settings ?? null;
  });
  let pauseRows = $derived(pauseLineSettings ? derivePauseLines(captions, pauseLineSettings) : []);
  // The pause slot an open editor types into; its empty row takes that slot's place.
  let editingPauseSlot = $state(0);
  let transcriptRows = $derived.by((): TranscriptRow[] => sentenceRows.flatMap((line, index) => {
    if (line.start === line.end) return [];
    const rows: TranscriptRow[] = pauseRows.filter(pause => pause.nextWordIndex === line.start).map(pause => ({ kind: 'pause' as const, key: pause.key, pause }));
    const typed = sentenceRows[index - 1];
    if (typed && typed.start === typed.end) { const at = Math.min(editingPauseSlot, rows.length); rows.splice(at, at < rows.length ? 1 : 0, { kind: 'text', key: typed.key, line: typed }); }
    return [...rows, { kind: 'text' as const, key: line.key, line }];
  }));
  let selectedPause = $derived(pauseRows.find(pause => pause.key === selectedPauseKey));
  let filteredRows = $derived(transcriptRows.filter((row, index) => {
    // The open editor stays visible, such as a just-added blank line during a search.
    if (row.key === editingRowKey) return true;
    const text = row.kind === 'pause' ? `Pause ${formatTime(row.pause.startTime)} ${formatTime(row.pause.endTime)}` : rowCaption(row.line).text;
    return `${index + 1} ${text}`.toLowerCase().includes(query.toLowerCase());
  }));
  function pinTypingRow(rows: SentenceRow[], key: string, anchor: TypingAnchor): SentenceRow[] {
    const range = typingRange(captions, anchor);
    if (!range) return rows;
    const start = range.transcriptStart, end = start + range.words.length, result: SentenceRow[] = [];
    if (start === end) {
      // Typing into a pause row: an empty row before the next line, until text arrives.
      const at = rows.findIndex(row => row.start >= start), typed = { key, caption: range.owner, start, end, window: anchor.window };
      return at < 0 ? [...rows, typed] : [...rows.slice(0, at), typed, ...rows.slice(at)];
    }
    let pinned = false;
    for (const row of rows) {
      if (row.end <= start || row.start >= end) { result.push(row); continue; }
      if (row.start < start) result.push({ ...row, key: row.key + ':before', end: start, segment: lineSegment(transcriptWords(captions).slice(row.start, start), row.key + ':before') });
      if (!pinned) { result.push({ key, caption: range.owner, start, end, segment: lineSegment(range.words, key + ':typing') }); pinned = true; }
      if (row.end > end) result.push({ ...row, key: row.key + ':after', start: end, segment: lineSegment(transcriptWords(captions).slice(end, row.end), row.key + ':after') });
    }
    return pinned ? result : rows;
  }
  let selectedGlobalWord = $derived(selectedContainer ? captionWordOffset(captions, selectedContainer.id) + selectedWord : 0);
  let selectedRow = $derived(sentenceRows.find(row => row.key === selectedRowKey && (row.caption.id === selectedContainer?.id || row.start <= selectedGlobalWord && row.end > selectedGlobalWord)) ?? sentenceRows.find(row => row.start <= selectedGlobalWord && row.end > selectedGlobalWord) ?? sentenceRows.find(row => row.caption.id === selectedContainer?.id));
  // One neighbour on either side, including across a storage boundary.
  let selectedLane = $derived(!selectedPause && selectedRow && selectedRow.end > selectedRow.start ? transcriptLineLane(captions, selectedRow) : null);
  let selected = $derived(selectedLane?.caption);
  let selectedWordOffset = $derived(selectedLane && selectedRow ? selectedLane.start - captionWordOffset(captions, selectedContainer!.id) : 0);
  let query = $state("");
  let draftText = $state("");
  let editingRowKey = $state<string | null>(null);
  let editingSource = $state("");
  let editingError = $state("");
  let editingCaret = $state(0);
  let textEditorFocused = $state(false);
  let textEditor = $state<HTMLTextAreaElement | undefined>();
  let caretSplitIndex = $derived.by(() => {
    const row = sentenceRows.find(row => row.key === editingRowKey);
    if (!row || !textEditorFocused) return null;
    const index = wordBoundaryAtCaret(draftText, editingCaret);
    const count = draftText.match(/\S+/g)?.length ?? 0;
    if (index <= 0 || index >= count) return 0;
    return index + row.start - captionWordOffset(captions, selectedContainer!.id);
  });
  function wordBoundaryAtCaret(text: string, caret: number): number {
    const words = [...text.matchAll(/\S+/g)];
    for (let i = 0; i < words.length; i++) {
      const start = words[i].index!, end = start + words[i][0].length;
      if (caret <= start) return i;
      if (caret < end) return caret - start < end - caret ? i : i + 1;
    }
    return words.length;
  }
  function trackTextCaret(event: Event) {
    textEditorFocused = true;
    editingCaret = (event.currentTarget as HTMLTextAreaElement).selectionStart ?? 0;
  }
  let draftStart = $state(0);
  let draftEnd = $state(0);
  let timingRowKey = $state<string | null>(null);
  let timingSource = $state('');
  $effect(()=>onEditingChange(editingRowKey!==null||timingRowKey!==null));
  onDestroy(()=>{ destroyed = true; if (typingAt) { typingAt = null; void typing?.end('abandon', 'editor closed'); } onEditingChange(false); });
  // Something other than typing (an Undo past it, another tool) changed the
  // words around the open editor: close it without merging its steps.
  $effect(() => { if (typingAt && editingRowKey && !typingRange(captions, typingAt)) { closeTextEdit(); void typing?.end('abandon', 'words around the line changed'); } });
  let timingError = $state('');
  let timingFocus = $state<WordEdge>('startTime');
  let timingChanged = $state({ startTime: false, endTime: false });
  let timingInvalid = $state({ startTime: false, endTime: false });
  let error = $state("");
  let notice = $state("");
  let sentenceCount = $derived(transcriptRows.length);
  // A new line is one pause row long, the same as typing into a pause.
  let newLineOptions = $derived({ frameRate, cadence: captions.length ? pauseCadence(captions, pauseLineSettings?.blankLineSeconds ?? 0) : 0, borrow: newLineBorrow });
  let newLineProblems = $derived.by(() => {
    if (!selectedRow || selectedPause || selectedRow.end <= selectedRow.start) return null;
    const problem = (at: number, side: NewLineSide) => { const room = newLineRoom(captions, at, { ...newLineOptions, side }); return 'problem' in room ? room.problem : ''; };
    return { before: problem(selectedRow.start, 'before'), after: problem(selectedRow.end, 'after') };
  });
  let hasNextLine = $derived(!!selectedRow && sentenceRows.indexOf(selectedRow) < sentenceRows.length - 1);
  let listEl: HTMLDivElement | undefined = $state();
  // Reset only when the sequence really changes: the parent's session object is
  // replaced on every Premiere Undo/Redo restore, which re-runs this effect.
  let shownSequence: string | null = null;
  $effect(() => {
    if (sequenceId === shownSequence) return;
    shownSequence = sequenceId;
    query = ""; selectedRowKey = null; selectedPauseKey = null; editingRowKey = null; editingSource = ""; editingError = ""; timingRowKey = null; timingSource = ''; timingError = ''; error = ""; notice = "";
    if (untrack(() => typingAt)) { typingAt = null; void untrack(() => typing)?.end('abandon', 'sequence changed'); }
  });
  // Where the selection sits in time. Typing, saving, Premiere confirming an
  // edit or a refresh rebuild the rows (keys count words, so they shift) but
  // leave this alone; only choosing another line, pause or caption moves it.
  let revealTarget = $derived(selectedPause ? `pause:${selectedPause.startTime}` : selectedRow ? `line:${selectedRow.segment?.startTime ?? selectedRow.window?.startTime ?? selectedRow.caption.startTime}` : activeId ? `caption:${activeId}` : '');
  let revealed = '', revealedIn: HTMLDivElement | undefined;
  $effect(revealSelection);
  // Forget the kept pause settings as soon as the layer disconnects or changes,
  // even while the rows are not drawn, so a reconnect never brings them back.
  $effect(() => { if (knownPauseSettings && knownPauseSettings.layer !== pauseLayer) knownPauseSettings = null; });
  // Scrolls the list to a newly selected line, never the panel around it, and
  // leaves the list where the user put it while the same line stays selected.
  function revealSelection() {
    const target = revealTarget, list = listEl;
    if (!target || !list || (target === revealed && list === revealedIn)) return;
    revealed = target; revealedIn = list;
    void tick().then(() => {
      const key = selectedPause?.key ?? selectedRow?.key;
      const el = [...list.querySelectorAll<HTMLElement>("[data-row-key]")].find(node => node.dataset.rowKey === key) ?? [...list.querySelectorAll<HTMLElement>("[data-caption-id]")].find(node => node.dataset.captionId === (selectedId ?? activeId));
      if (!el) return;
      const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop + list.scrollTop, bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(top, bottom - list.clientHeight);
    });
  }
  function commit(next: CaptionItem[], message: string, historyLabel?: string) {
    error = "";
    try {
      if (next.length) validateCaptions(next);
      onUpdate(next, historyLabel);
      notice = message;
      return true;
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); return false; }
  }
  function updateCaption(updated: CaptionItem, message: string) {
    try {
      if (!selectedLane) return;
      const rows = transcriptLines(captions);
      const next = replaceTranscriptWords(captions, selectedLane.start, selectedLane.end, updated.words, updated.timingEstimated);
      commit(withTranscriptLines(next, rows.map(row => ({ start: row.start, end: row.end, key: row.segment?.id ?? row.key }))), message);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function rowCaption(row: SentenceRow): CaptionItem {
    return transcriptLineCaption(captions, row);
  }
  function textSource(row: SentenceRow) {
    const current = rowCaption(row);
    return JSON.stringify([sequenceId, current.id, row.segment?.id, current.startTime, current.endTime, current.text,
      current.words.map(word => [word.text, word.startTime, word.endTime, word.lineBreakBefore, word.pauseLinesRemoved])]);
  }
  function textCaretOffset(event?: MouseEvent): number | null {
    if (!event || !event.detail) return null;
    const element = event.currentTarget as HTMLElement;
    const document = element.ownerDocument as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
    try {
      const position = document.caretPositionFromPoint?.(event.clientX, event.clientY);
      const fallback = position ? null : document.caretRangeFromPoint?.(event.clientX, event.clientY);
      const node = position?.offsetNode ?? fallback?.startContainer, offset = position?.offset ?? fallback?.startOffset;
      if (!node || offset === undefined || !element.contains(node)) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(node, offset);
      return range.toString().length;
    } catch { return null; }
  }
  function beginTextEdit(row: SentenceRow, event?: MouseEvent) {
    if (disabled) return;
    if (timingRowKey) {
      const timingRow = sentenceRows.find(item => item.key === timingRowKey);
      if (timingRow && !saveInlineTiming(timingRow)) return;
    }
    if (editingRowKey && editingRowKey !== row.key) {
      const previousRow = sentenceRows.find(item => item.key === editingRowKey);
      if (previousRow && !saveInlineText(previousRow)) return;
    }
    const current = sentenceRows.find(item => item.key === row.key);
    if (!current) return;
    choose(current);
    draftText = rowCaption(current).text;
    editingCaret = textCaretOffset(event) ?? draftText.length;
    editingSource = textSource(current);
    editingError = '';
    editingRowKey = row.key;
    if (!afterLineAdded(confirmed => { if (confirmed) openTyping(row.key); })) openTyping(row.key);
  }
  // Hands the open editor to Premiere history steps. Text typed while an Add
  // line was being confirmed becomes the first typing step.
  function openTyping(key: string) {
    const current = sentenceRows.find(item => item.key === key);
    if (!typing || typingAt || editingRowKey !== key || !current || textSource(current) !== editingSource) return;
    const text = rowCaption(current).text, caret = textEditor?.selectionStart ?? editingCaret;
    typingAt = typingAnchor(captions, current.caption.id, current.start, current.end, true);
    typing.open(typingAt, captions, text, Math.min(caret, text.length), showTypingDraft);
    if (draftText !== text) typing.input(draftText, caret);
  }
  // Premiere Undo/Redo of a typing step, while the editor stays open.
  function showTypingDraft(draft: string, caret: number) {
    draftText = draft; editingCaret = caret; editingError = '';
    void tick().then(() => {
      if (!textEditor) return;
      if (textEditor.value !== draft) textEditor.value = draft;
      textEditor.setSelectionRange(caret, caret);
      resizeTextEditor(textEditor);
    });
  }
  // Checks the draft as saving would, without changing anything.
  function typingProblem(): string {
    try {
      const range = typingAt && typingRange(captions, typingAt);
      if (!typingAt || !range) throw new Error('This line changed while you were editing. Cancel and select it again.');
      if (typingText(draftText) !== range.text) applyTypingText(captions, typingAt, draftText);
      return '';
    } catch (problem) { return problem instanceof Error ? problem.message : String(problem); }
  }
  function closeTextEdit() { textEditorFocused = false; editingRowKey = null; editingSource = ''; editingError = ''; typingAt = null; }
  function saveInlineText(row: SentenceRow) {
    if (editingRowKey !== row.key) return true;
    if (typing && typingAt) {
      // Typing steps already hold the text; closing merges them into one step.
      const problem = typingProblem();
      if (problem) { editingError = problem; return false; }
      closeTextEdit();
      typingFinished = typing.end('commit');
      return true;
    }
    // Text saved before Premiere confirmed its Add line is saved right after,
    // as an Undo step of its own.
    const draft = draftText, source = editingSource;
    if (afterLineAdded(() => { try { saveText(row.key, draft, source); } catch (problem) { throw new Error(`${problem instanceof Error ? problem.message : String(problem)} Your text was: ${draft}`); } })) {
      closeTextEdit();
      return true;
    }
    try {
      saveText(row.key, draft, source);
      closeTextEdit();
      return true;
    } catch (problem) { editingError = problem instanceof Error ? problem.message : String(problem); return false; }
  }
  function saveText(key: string, draft: string, source: string) {
    const current = sentenceRows.find(item => item.key === key);
    if (!current || textSource(current) !== source) throw new Error('This line changed while you were editing. Cancel and select it again.');
    const before = rowCaption(current), updated = replaceText(before, draft);
    if (updated.words.length === before.words.length && updated.text === before.text) return;
    const next = replaceTranscriptLine(captions, current, updated);
    const message = !updated.text ? 'Line text deleted. The blank line keeps its time.' : updated.timingEstimated ? 'Text saved. Review the estimated word timings.' : 'Text saved with existing word timings.';
    if (!commit(next, message, 'Edit transcript')) throw new Error(error);
  }
  function cancelTextEdit() {
    const typed = !!typingAt;
    closeTextEdit();
    // Escape takes back every typing step of this editor.
    if (typed) void typing?.end('cancel');
  }
  function resizeTextEditor(node: HTMLTextAreaElement) { node.style.blockSize = 'auto'; node.style.blockSize = `${node.scrollHeight}px`; }
  function focusTextEditor(node: HTMLTextAreaElement) {
    resizeTextEditor(node);
    node.focus({ preventScroll: true });
    textEditorFocused = true;
    const caret = Math.min(editingCaret, node.value.length);
    node.setSelectionRange(caret, caret);
  }
  function textKeydown(event: KeyboardEvent, row: SentenceRow) {
    // Premiere handles Cmd+Z itself; only the bare Cmd key reaches the panel.
    if (event.key === 'Meta' || event.key === 'Control') { typing?.flush(); return; }
    if (event.isComposing) return;
    // Enter breaks the line at the text cursor, as in a text editor: at the end
    // it adds a line below, at the start a line above, between words it splits.
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (event.repeat) return;
      const index = wordBoundaryAtCaret(draftText, (event.currentTarget as HTMLTextAreaElement).selectionStart ?? draftText.length);
      const count = draftText.match(/\S+/g)?.length ?? 0;
      if (count && index <= 0) void addLine('before');
      else if (index >= count) void addLine('after');
      else splitCaption(index + row.start - captionWordOffset(captions, selectedContainer!.id));
      return;
    }
    if (event.key !== 'Escape' && !((event.ctrlKey || event.metaKey) && event.key === 'Enter')) return;
    event.preventDefault();
    if (event.key === 'Escape') cancelTextEdit();
    else if (!saveInlineText(row)) return;
    void tick().then(() => [...(listEl?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])].find(node => node.dataset.rowKey === row.key)?.querySelector<HTMLButtonElement>('.transcript-editor__cue-text')?.focus({ preventScroll: true }));
  }
  function secondsValue(seconds: number) {
    return Number(seconds.toFixed(Math.min(6, Math.max(3, Math.ceil(Math.log10(frameRate)) + 1))));
  }
  function beginTimingEdit(row: SentenceRow, edge: WordEdge) {
    if (disabled) return;
    if (editingRowKey) {
      const textRow = sentenceRows.find(item => item.key === editingRowKey);
      if (textRow && !saveInlineText(textRow)) return;
    }
    if (timingRowKey && timingRowKey !== row.key) {
      const previousRow = sentenceRows.find(item => item.key === timingRowKey);
      if (previousRow && !saveInlineTiming(previousRow)) return;
    }
    const current = sentenceRows.find(item => item.key === row.key);
    if (!current) return;
    choose(current);
    const source = rowCaption(current);
    draftStart = source.startTime;
    draftEnd = source.endTime;
    timingSource = textSource(current);
    timingChanged = { startTime: false, endTime: false };
    timingInvalid = { startTime: false, endTime: false };
    timingFocus = edge;
    timingError = '';
    timingRowKey = current.key;
  }
  function timingRange(row: SentenceRow, edge: WordEdge) {
    const position = sentenceRows.findIndex(line => line.key === row.key);
    const lower = position > 0 ? rowCaption(sentenceRows[position - 1]).endTime : 0;
    const upper = position + 1 < sentenceRows.length ? rowCaption(sentenceRows[position + 1]).startTime : undefined;
    const time = edge === 'startTime' ? draftStart : draftEnd, frame = Math.round(time * frameRate), value = secondsValue(time);
    const minimum = edge === 'startTime' ? lower : draftStart + 1 / frameRate;
    const maximum = edge === 'startTime' ? draftEnd - 1 / frameRate : upper;
    return { min: value + (Math.ceil(minimum * frameRate - 1e-7) - frame) / frameRate,
      max: maximum === undefined ? undefined : value + (Math.floor(maximum * frameRate + 1e-7) - frame) / frameRate };
  }
  function inputCaptionTime(edge: WordEdge, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    timingInvalid[edge] = !Number.isFinite(numericInputValue(input));
    if (timingInvalid[edge]) return;
    const time = Math.round(numericInputValue(input) * frameRate) / frameRate;
    if (edge === 'startTime') draftStart = time; else draftEnd = time;
    timingChanged[edge] = true;
    timingError = '';
    input.value = String(secondsValue(time));
  }
  function saveInlineTiming(row: SentenceRow) {
    if (timingRowKey !== row.key) return true;
    try {
      const current = sentenceRows.find(item => item.key === row.key);
      if (!current || textSource(current) !== timingSource) throw new Error('This line changed while you were editing. Cancel and select its timing again.');
      if (timingInvalid.startTime || timingInvalid.endTime) throw new Error('Enter a valid start and end time.');
      if (timingChanged.startTime || timingChanged.endTime) {
        const source = rowCaption(current);
        const start = timingChanged.startTime ? Math.round(draftStart * frameRate) / frameRate : source.startTime;
        const end = timingChanged.endTime ? Math.round(draftEnd * frameRate) / frameRate : source.endTime;
        if ((end - start) * frameRate < 1 - 1e-7) throw new Error('Keep at least one frame between line start and end.');
        const updated = retime(source, start, end);
        const next = replaceTranscriptLine(captions, current, updated);
        if (!commit(next, 'Line timing saved.')) { timingError = error; return false; }
      }
      cancelTimingEdit();
      return true;
    } catch (problem) { timingError = problem instanceof Error ? problem.message : String(problem); return false; }
  }
  function cancelTimingEdit() { timingRowKey = null; timingSource = ''; timingError = ''; }
  function focusTimingEditor(node: HTMLInputElement, edge: WordEdge) { if (edge === timingFocus) node.focus({ preventScroll: true }); }
  function timingBlur(event: FocusEvent, row: SentenceRow) {
    if (event.relatedTarget && (event.currentTarget as HTMLElement).parentElement?.contains(event.relatedTarget as Node)) return;
    saveInlineTiming(row);
  }
  function timingKeydown(event: KeyboardEvent, row: SentenceRow) {
    if (event.key !== 'Escape' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.key === 'Escape') cancelTimingEdit();
    else if (!saveInlineTiming(row)) return;
    void tick().then(() => [...(listEl?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])].find(node => node.dataset.rowKey === row.key)?.querySelector<HTMLButtonElement>('.transcript-editor__timestamp')?.focus({ preventScroll: true }));
  }
  function splitCaption(wordIndex: number, typed = false) {
    if (disabled || !selectedRow) return;
    // After a pending Add line, so the text typed meanwhile is split too.
    if (!typed && afterLineAdded(() => splitCaption(wordIndex))) return;
    const row = selectedRow, splitAt = wordIndex + captionWordOffset(captions, selectedContainer!.id);
    if (!typed && typing && typingAt && editingRowKey) {
      const problem = typingProblem();
      if (problem) { error = problem; return; }
      void typing.end('commit').then(() => splitCaption(wordIndex, true)).catch(problem => { error = problem instanceof Error ? problem.message : String(problem); });
      return;
    }
    try {
      let source = captions;
      const editing = typed ? undefined : sentenceRows.find(row => row.key === editingRowKey);
      if (editing) {
        if (textSource(editing) !== editingSource) throw new Error('This line changed while you were editing. Cancel and select it again.');
        source = replaceTranscriptLine(captions, editing, replaceText(rowCaption(editing), draftText));
      }
      const current = typed ? row : transcriptLines(source).find(item => item.start === row.start);
      if (!current) throw new Error('Select the line again.');
      const next = changeTranscriptLineBreak(source, current, splitAt);
      if (!commit(next, editing ? 'Line split at the text cursor.' : 'Line split before the selected word.')) return;
      cancelTextEdit();
      const right = transcriptLines(next).find(item => item.start === splitAt)!;
      selectedRowKey = right.key;
      onSelect(right.caption.id);
      onSelectWord(splitAt - captionWordOffset(next, right.caption.id));
      void tick().then(() => listEl?.querySelector<HTMLButtonElement>('.transcript-editor__cue--selected .transcript-editor__cue-text')?.focus({ preventScroll: true }));
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function mergeNext(typed = false) {
    if (disabled || !selectedRow || !hasNextLine) return;
    if (!typed && afterLineAdded(() => mergeNext())) return;
    if (!typed && typing && typingAt && editingRowKey) {
      const problem = typingProblem();
      if (problem) { error = problem; return; }
      void typing.end('commit').then(() => mergeNext(true)).catch(problem => { error = problem instanceof Error ? problem.message : String(problem); });
      return;
    }
    try {
      let source = captions;
      const row = selectedRow, editing = typed ? undefined : sentenceRows.find(row => row.key === editingRowKey);
      if (editing) {
        if (textSource(editing) !== editingSource) throw new Error('This line changed while you were editing. Cancel and select it again.');
        source = replaceTranscriptLine(source, editing, replaceText(rowCaption(editing), draftText));
      }
      const current = typed ? row : transcriptLines(source).find(item => item.start === row.start);
      if (!current) throw new Error('Select the line again.');
      const next = changeTranscriptLineBreak(source, current);
      if (!commit(next, 'Lines merged.')) return;
      cancelTextEdit();
      selectedRowKey = transcriptLines(next).find(item => item.start === current.start)!.key;
      void tick().then(() => listEl?.querySelector<HTMLButtonElement>('.transcript-editor__cue--selected .transcript-editor__cue-text')?.focus({ preventScroll: true }));
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  // One "Add line" step adds a blank line beside the selected one, then opens
  // it for typing. Open editors are saved first, as when choosing a pause.
  async function addLine(side: NewLineSide) {
    if (disabled || !selectedRow || selectedPause || addingLine) return;
    const start = selectedRow.start;
    addingLine = true;
    try {
      if (!await finishPauseEditing()) return;
      // Edits still waiting to be written, such as the previous new line's
      // text, become Undo steps of their own first.
      if (typing) await typing.settle();
      if (disabled) return;
      const current = sentenceRows.find(row => row.start === start && row.end > row.start);
      if (!current) throw new Error('Select the line again.');
      const at = side === 'before' ? current.start : current.end;
      const added = insertTranscriptLine(captions, at, { ...newLineOptions, side });
      if (!commit(added.captions, '', 'Add line')) return;
      await tick();
      const line = sentenceRows.find(row => row.start === at);
      if (!line) throw new Error('The line was added. Select it to type.');
      // The editor opens at once and keeps what is typed; its typing steps
      // start once Premiere confirms Add line as one Undo step.
      if (typing) awaitLineAdded(typing.settle());
      beginTextEdit(line);
      const borrowed = added.borrowed;
      notice = !borrowed ? 'Line added.' : `Line added. It took ${borrowed.frames} ${borrowed.frames === 1 ? 'frame' : 'frames'} from the ${borrowed.edge === 'endTime' ? 'end' : 'start'} of ${borrowed.text ? `“${borrowed.text}”` : 'a blank line'}.`;
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
    finally { addingLine = false; }
  }
  // One "Delete line" step removes the selected line and its words; clearing
  // its text instead leaves a timed blank line. Open editors are saved and
  // pending edits written as their own Undo steps first; if Premiere does not
  // confirm them, nothing is deleted. The line is found again by its time after
  // saving (its text may have just changed) and by its exact words after
  // writing, so a regroup or Undo meanwhile deletes nothing else. Like Add
  // line, typing in another line starts only once Delete line is confirmed.
  // A row's own trash button passes that row; another selected line or pause
  // then stays selected.
  async function deleteLine(target?: SentenceRow) {
    const row = target ?? (selectedPause ? undefined : selectedRow);
    if (disabled || !row || deletingLine || row.end <= row.start) return;
    const elsewhere = !!target && (!!selectedPause || selectedRow?.key !== target.key);
    const sequence = sequenceId, layer = nativeLayerKey, span = rowCaption(row);
    const identity = (row: SentenceRow) => JSON.stringify(transcriptWords(captions).slice(row.start, row.end).map(word => [word.text, word.startTime, word.endTime]));
    deletingLine = true;
    try {
      if (!await finishPauseEditing()) return;
      const saved = sentenceRows.find(row => row.end > row.start && rowCaption(row).startTime >= span.startTime && rowCaption(row).startTime < span.endTime);
      if (!saved) throw new Error('This line changed. Select it again.');
      const words = identity(saved);
      if (typing && !await typing.settle()) throw new Error('Premiere has not confirmed your last edit yet, so nothing was deleted. Try Delete line again.');
      if (disabled) return;
      const current = sentenceRows.find(row => row.end > row.start && identity(row) === words);
      if (!current || sequenceId !== sequence || nativeLayerKey !== layer) throw new Error('This line changed. Select it again.');
      const kept = elsewhere && !selectedPause && selectedRow && selectedRow.end > selectedRow.start ? identity(selectedRow) : null;
      // A selected pause's key holds its next word's index, which the delete
      // can shift; it is found again by that word's time and its slot.
      const keptPause = elsewhere && selectedPause ? { time: transcriptWords(captions)[selectedPause.nextWordIndex]?.startTime, slot: selectedPause.index } : null;
      const next = deleteTranscriptLine(captions, current, pauseLineSettings ? source => derivePauseLines(source, pauseLineSettings!) : undefined);
      if (!commit(next, 'Line deleted.', 'Delete line')) return;
      if (typing) awaitLineAdded(typing.settle());
      await tick();
      if (elsewhere) {
        if (keptPause) {
          const nextWordIndex = transcriptWords(captions).findIndex(word => word.startTime === keptPause.time);
          selectedPauseKey = pauseRows.find(row => row.nextWordIndex === nextWordIndex && row.index === keptPause.slot)?.key ?? null;
          return;
        }
        const still = kept ? sentenceRows.find(row => row.end > row.start && identity(row) === kept) : undefined;
        if (!still) return;
        selectedRowKey = still.key;
        onSelect(still.caption.id);
        onSelectWord(still.start - captionWordOffset(captions, still.caption.id));
        return;
      }
      // The next line takes its place, or else the line before it.
      const neighbour = sentenceRows.find(row => row.end > row.start && row.start >= current.start) ?? sentenceRows.filter(row => row.end > row.start).at(-1);
      selectedPauseKey = null;
      selectedRowKey = neighbour?.key ?? null;
      if (!neighbour) return;
      onSelect(neighbour.caption.id);
      onSelectWord(neighbour.start - captionWordOffset(captions, neighbour.caption.id));
      void tick().then(() => listEl?.querySelector<HTMLButtonElement>('.transcript-editor__cue--selected .transcript-editor__cue-text')?.focus({ preventScroll: true }));
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
    finally { deletingLine = false; }
  }
  const lineWraps: { value: LineWrap; label: string; title: string }[] = [
    { value: 'fill', label: 'Fill', title: 'Fill: as many words on each line as fit' },
    { value: 'balance', label: 'Balance', title: 'Balance: the same number of lines as Fill, with lengths as even as possible' },
    { value: 'pretty', label: 'Pretty', title: 'Pretty: like Fill, but a short or one-word last line shares the last two lines evenly' },
  ];
  function changeCharacterLimit(value: number) {
    if (disabled || value === maxChars) return;
    try { onMaxCharsChange(validateCharacterLimit(value)); error = ''; }
    catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function choose(row: SentenceRow) { selectedPauseKey = null; selectedRowKey = row.key; onSelect(row.caption.id); onSelectWord(Math.min(row.start - captionWordOffset(captions, row.caption.id), row.caption.words.length - 1)); onSeek(row.segment?.startTime ?? row.window?.startTime ?? row.caption.startTime); error = ""; notice = ""; }
  async function finishPauseEditing(): Promise<boolean> {
    const timingRow = sentenceRows.find(row => row.key === timingRowKey);
    if (timingRow && !saveInlineTiming(timingRow)) return false;
    if (typing && typingAt) {
      const problem = typingProblem();
      if (problem) { editingError = problem; return false; }
      closeTextEdit();
      typingFinished = typing.end('commit');
    } else {
      const textRow = sentenceRows.find(row => row.key === editingRowKey);
      if (textRow && !saveInlineText(textRow)) return false;
    }
    await typingFinished;
    // A pause editor or another new line never opens before Premiere confirms an Add line.
    await lineAdded;
    return true;
  }
  async function choosePause(pause: PauseLine) {
    const nextWordTime = transcriptWords(captions)[pause.nextWordIndex]?.startTime;
    try {
      if (!await finishPauseEditing()) return;
      const nextWordIndex = transcriptWords(captions).findIndex(word => word.startTime === nextWordTime);
      const current = pauseRows.find(row => row.nextWordIndex === nextWordIndex && row.index === pause.index);
      if (!current) throw new Error('This pause changed. Select it again.');
      selectedPauseKey = current.key;
      onSeek(current.startTime);
      error = ''; notice = '';
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  // Typing into a pause row adds a line of text in that slot's time; the
  // other pause rows stay around it.
  async function beginPauseEdit(pause: PauseLine) {
    if (disabled) return;
    const nextWordTime = transcriptWords(captions)[pause.nextWordIndex]?.startTime;
    try {
      if (!await finishPauseEditing()) return;
      const nextWordIndex = transcriptWords(captions).findIndex(word => word.startTime === nextWordTime);
      const current = pauseRows.find(row => row.nextWordIndex === nextWordIndex && row.index === pause.index);
      const next = sentenceRows.find(row => row.start === nextWordIndex);
      if (!current || !next) throw new Error('This pause changed. Select it again.');
      const window = { startTime: current.startTime, endTime: current.endTime };
      const row: SentenceRow = { key: `typing-pause:${nextWordIndex}:${current.index}`, caption: next.caption, start: nextWordIndex, end: nextWordIndex, window };
      editingPauseSlot = current.index;
      choose(row);
      typingAt = typingAnchor(captions, next.caption.id, nextWordIndex, nextWordIndex, true, window);
      draftText = ''; editingCaret = 0; editingError = '';
      editingSource = textSource(row);
      editingRowKey = row.key;
      typing?.open(typingAt, captions, '', 0, showTypingDraft);
    } catch (problem) { typingAt = null; error = problem instanceof Error ? problem.message : String(problem); }
  }
  async function deletePause(pause: PauseLine) {
    if (disabled) return;
    const nextWordTime = transcriptWords(captions)[pause.nextWordIndex]?.startTime;
    try {
      if (!await finishPauseEditing()) return;
      const nextWordIndex = transcriptWords(captions).findIndex(word => word.startTime === nextWordTime);
      const current = pauseRows.find(row => row.nextWordIndex === nextWordIndex && row.index === pause.index);
      if (!current) throw new Error('This pause changed. Select it again.');
      selectedPauseKey = current.key;
      commit(removePauseLine(captions, nextWordIndex), 'Pause line deleted.', 'Delete pause line');
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
</script>

<section class="transcript-editor" aria-label="Transcript editor">
  <div class="transcript-editor__heading"><label class="transcript-editor__search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg><input type="search" aria-label="Search lines" placeholder="Search lines" bind:value={query} /></label></div>
  {#if captions.length}
    {#if !groupingDisabled}
    <section class="transcript-editor__grouping" aria-label="Caption grouping">
      <div class="transcript-editor__grouping-heading"><h3>Caption grouping</h3><span>{maxChars} characters · {sentenceCount} {sentenceCount === 1 ? 'line' : 'lines'}</span></div>
      <div class="transcript-editor__grouping-body">
        <div class="transcript-editor__grouping-controls"><div class="caption-field"><span>Characters per line</span><ScrubbableNumber label="Characters per line" min={15} max={150} step={1} decimals={0} value={maxChars} defaultValue={56} inputRealtime disabled={disabled} onChange={changeCharacterLimit} onDragState={onCharacterLimitGesture} onEditState={onCharacterLimitGesture}/></div><button type="button" class="caption-button transcript-editor__smart-fit" title="Measure the text to fit one line, with a 5% safety margin for letter widths and highlighting" disabled={disabled} onclick={() => onSmartLineFit?.()}>Smart line fit</button>{#if lineWrap}<div class="caption-field transcript-editor__wrap-field"><span id="transcript-line-wrap">Line wrap</span><div class="transcript-editor__wrap" role="group" aria-labelledby="transcript-line-wrap">{#each lineWraps as option (option.value)}<button type="button" class="transcript-editor__wrap-option" title={option.title} aria-pressed={lineWrap === option.value} {disabled} onclick={() => { if (lineWrap !== option.value) onLineWrapChange?.(option.value); }}>{option.label}</button>{/each}</div></div>{/if}</div>
        {@render nativeGrouping?.()}
      </div>
    </section>
    {/if}
    <div class="transcript-editor__workspace">
      <div class="transcript-editor__browse">

        <div class="transcript-editor__list" bind:this={listEl} aria-label="Line list">
          {#each filteredRows as entry (entry.key)}
            {@const number = transcriptRows.findIndex(row => row.key === entry.key) + 1}
            {#if entry.kind === 'pause'}
              {@const pause = entry.pause}
              <div class="transcript-editor__cue transcript-editor__cue--pause" class:transcript-editor__cue--selected={selectedPause?.key === pause.key} class:transcript-editor__cue--playing={currentTime >= pause.startTime && currentTime < pause.endTime} data-row-key={pause.key}>
                <button class="transcript-editor__cue-select" aria-label="Select pause line {number}" aria-pressed={selectedPause?.key === pause.key} onclick={() => choosePause(pause)}><span class="transcript-editor__cue-number">{String(number).padStart(2,"0")}</span></button>
                <div class="transcript-editor__cue-body">
                  <button class="transcript-editor__pause-select" aria-label="Seek to pause line {number}" onclick={() => choosePause(pause)}><span class="transcript-editor__cue-time">{formatTime(pause.startTime)}<span aria-hidden="true">—</span>{formatTime(pause.endTime)}</span></button>
                  <button class="transcript-editor__cue-text" aria-label="Add text to pause line {number}" title="Type text into this pause" disabled={disabled} onclick={() => beginPauseEdit(pause)}>Pause</button>
                </div>
                <button type="button" class="transcript-editor__cue-delete" aria-label="Delete pause line {number}" title="Delete pause line (Undo brings it back)" onpointerdown={(event) => event.preventDefault()} disabled={disabled} onclick={() => deletePause(pause)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
              </div>
            {:else}
            {@const row = entry.line}
            {@const blank = isBlankLine(rowCaption(row).words)}
            <div class="transcript-editor__cue" class:transcript-editor__cue--selected={!selectedPause && selectedRow?.key === row.key} class:transcript-editor__cue--playing={row.segment ? currentTime >= row.segment.startTime && currentTime < row.segment.endTime : activeId === row.caption.id} data-caption-id={row.caption.id} data-row-key={row.key}>
              <button class="transcript-editor__cue-select" aria-label="Select line {number}" aria-pressed={!selectedPause && selectedRow?.key === row.key} onclick={() => choose(row)}><span class="transcript-editor__cue-number">{String(number).padStart(2,"0")}</span></button>
              <div class="transcript-editor__cue-body">
                {#if timingRowKey === row.key}
                  <div class="transcript-editor__timing-inputs">
                    {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}{@const range = timingRange(row,edge)}
                      <input type="text" inputmode="decimal" use:numericInput={{ managedKeys: true }} role="spinbutton" aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={secondsValue(edge === 'startTime' ? draftStart : draftEnd)} aria-label="Line {number} {edge === 'startTime' ? 'start' : 'end'} in seconds" aria-invalid={!!timingError} aria-describedby={timingError ? 'caption-timing-error' : undefined} min={range.min} max={range.max} step={1/frameRate} value={secondsValue(edge === 'startTime' ? draftStart : draftEnd)} use:focusTimingEditor={edge} oninput={(event) => inputCaptionTime(edge,event)} onkeydown={(event) => timingKeydown(event,row)} onblur={(event) => timingBlur(event,row)} />
                    {/each}
                  </div>
                  {#if timingError}<p class="transcript-editor__text-error" id="caption-timing-error" role="alert">{timingError}</p>{/if}
                {:else}
                  <div class="transcript-editor__cue-time"><button class="transcript-editor__timestamp" aria-label="Edit line {number} start time" onclick={() => beginTimingEdit(row,'startTime')} disabled={disabled}>{formatTime(row.segment?.startTime ?? row.caption.startTime)}</button><span aria-hidden="true">—</span><button class="transcript-editor__timestamp" aria-label="Edit line {number} end time" onclick={() => beginTimingEdit(row,'endTime')} disabled={disabled}>{formatTime(row.segment?.endTime ?? row.caption.endTime)}</button>{#if editingRowKey === row.key}<span class="transcript-editor__text-pending" role="status">{!editingError && draftText !== rowCaption(row).text ? 'Unsaved' : ''}</span>{/if}</div>
                {/if}
                {#if editingRowKey === row.key}
                  <textarea class="transcript-editor__cue-input" aria-label="Edit line {number} text" aria-invalid={!!editingError} aria-describedby={editingError ? 'caption-inline-error' : undefined} rows="1" bind:value={draftText} bind:this={textEditor} spellcheck="true" use:focusTextEditor onselect={trackTextCaret} onclick={trackTextCaret} onkeyup={(event) => { if (event.key === 'Meta' || event.key === 'Control') typing?.hint(); trackTextCaret(event); }} oninput={(event) => { editingError = ''; trackTextCaret(event); resizeTextEditor(event.currentTarget); if (typingAt) typing?.input(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }} onkeydown={(event) => textKeydown(event,row)} onfocus={() => textEditorFocused = true} onblur={() => { textEditorFocused = false; saveInlineText(row); }}></textarea>
                  {#if editingError}<p class="transcript-editor__text-error" id="caption-inline-error" role="alert">{editingError}</p>{/if}
                {:else}
                  <button class="transcript-editor__cue-text" aria-label="Edit line {number} text" onclick={(event) => beginTextEdit(row,event)} disabled={disabled}>{#if blank}<span aria-hidden="true">&nbsp;</span>{:else if row.segment}{row.segment.text}{:else if row.caption.renderSegments}{#each row.caption.renderSegments as group (group.id)}<span class="transcript-editor__cue-phrase">{group.text}</span>{/each}{:else}{row.caption.text}{/if}</button>
                {/if}
              </div>
              <button type="button" class="transcript-editor__cue-delete" aria-label="Delete line {number}" title="Delete line (Undo brings it back)" onpointerdown={(event) => event.preventDefault()} disabled={disabled || deletingLine || row.end <= row.start} onclick={() => deleteLine(row)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
            </div>
            {/if}
          {:else}<p class="transcript-editor__empty">No lines match “{query}”. Clear the search to see all lines.</p>{/each}
        </div>
      </div>
      {#if selectedPause}
        <div class="transcript-editor__edit"><p class="transcript-editor__pause-description">Pause · {formatTime(selectedPause.startTime)} — {formatTime(selectedPause.endTime)}</p>{#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}{#if notice}<p class="caption-message" role="status">{notice}</p>{/if}</div>
      {:else if selected}
        <div class="transcript-editor__edit">
          <WordTimeline caption={selected} fps={frameRate} {currentTime} selectedWord={Math.max(0, selectedWord-selectedWordOffset)} onSelectWord={(index) => onSelectWord(index+selectedWordOffset)} onSeek={onSeek} onChange={(caption) => updateCaption(caption,"Word timing saved.")}
            wordOffset={selectedWordOffset} focusStart={selectedLane?.focusStart} focusEnd={selectedLane?.focusEnd} onSplitBefore={splitCaption} {caretSplitIndex} splitDisabled={disabled}
            onMergeNext={mergeNext} mergeDisabled={disabled || !hasNextLine} mergeTitle="Merge with the next line"
            onAddLine={addLine} addLineDisabled={disabled} addLineProblems={newLineProblems} />
          {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
          {#if notice}<p class="caption-message" role="status">{notice}</p>{/if}
          {#if selected.timingEstimated}<p class="transcript-editor__estimated">Word timings are estimated. Review them in the word lane.</p>{/if}
        </div>
      {/if}
    </div>
  {:else if nativeLayerKey}<div class="transcript-editor__empty"><h3>No lines left</h3><p>Every line of this caption layer was deleted. Undo in Premiere brings them back.</p></div>
  {:else}<div class="transcript-editor__empty"><h3>Ready for your first words</h3><p>Use Transcribe in Premiere to load timed speech. Then select a line to edit its text and timing.</p></div>{/if}
</section>
<style>
  .transcript-editor { container-type: inline-size; }
  .transcript-editor__heading { display: flex; justify-content: space-between; align-items: center; gap: var(--caption-space-s); padding: var(--caption-space-m) var(--caption-space-l); }


  .transcript-editor__grouping { border-block: 1px solid var(--color-panel-border); font-size: var(--caption-type-s); }
  .transcript-editor__grouping-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--caption-space-xs) var(--caption-space-s); padding: var(--caption-space-m) var(--caption-space-l); & h3 { margin: 0; font: inherit; } & span { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); } }
  .transcript-editor__grouping-body { padding: 0 var(--caption-space-l) var(--caption-space-m); }
  .transcript-editor__smart-fit { font-size:var(--caption-type-s);font-variant-numeric:tabular-nums; }
  .transcript-editor__grouping-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--caption-space-s); align-items: end; margin-block-end: var(--caption-space-s); @container (min-width: 36rem) { grid-template-columns: minmax(0, 1fr) auto auto; } }
  .transcript-editor__wrap-field { grid-column: 1 / -1; @container (min-width: 36rem) { grid-column: auto; } }
  .transcript-editor__wrap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .transcript-editor__wrap-option { min-block-size: 2.25rem; padding: .4rem .6rem; border: 1px solid var(--color-panel-border); background: var(--color-input); color: var(--color-panel-secondary); font: inherit; font-size: var(--caption-type-s); cursor: pointer;
    &:first-child { border-start-start-radius: var(--caption-radius); border-end-start-radius: var(--caption-radius); }
    &:last-child { border-start-end-radius: var(--caption-radius); border-end-end-radius: var(--caption-radius); }
    & + & { border-inline-start: 0; }
    &[aria-pressed="true"] { background: var(--color-selection); color: var(--color-accent); }
    &:hover:enabled { color: var(--color-panel-text); }
    &:focus-visible { outline: 1px solid var(--color-accent); outline-offset: -2px; }
    &:disabled { opacity: .5; cursor: default; } }
  .transcript-editor__search { display: flex; align-items: center; gap: var(--caption-space-s); flex: 1; min-inline-size: 0; margin: 0; padding-inline: .5rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); }
  .transcript-editor__search svg { inline-size: 1.1rem; block-size: 1.1rem; color: var(--color-panel-secondary); flex-shrink: 0; }
  .transcript-editor__search input { min-inline-size: 0; inline-size: 100%; padding: .45rem 0; background: transparent; color: var(--color-panel-text); border: 0; font-size: var(--caption-type-s); }
  .transcript-editor__list { min-block-size: 0; max-block-size: clamp(7rem, 16vh, 12rem); overflow-y: auto; }
  .transcript-editor__cue { display: flex; align-items: flex-start; inline-size: 100%; gap: var(--caption-space-m); text-align: start; background: transparent; color: var(--color-panel-text); padding: var(--caption-space-m) var(--caption-space-l); border: 0; border-block-end: 1px solid var(--color-panel-border); }
  .transcript-editor__cue:hover { background: var(--color-surface-raised); }
  .transcript-editor__cue:focus-visible { outline-offset: -2px; }
  .transcript-editor__cue--selected { background: var(--color-selection); }
  .transcript-editor__cue--playing .transcript-editor__cue-time { color: var(--color-accent); }
  .transcript-editor__cue-number { color: var(--color-panel-secondary); font-variant-numeric: tabular-nums; font-size: var(--caption-type-xs); padding-block-start: .1rem; }
  .transcript-editor__cue-select { flex-shrink: 0; background: transparent; border: 0; padding: 0; min-inline-size: 1.5rem; min-block-size: 2rem; text-align: start; cursor: pointer; }
  .transcript-editor__cue--pause { color: var(--color-panel-secondary); }
  .transcript-editor__pause-select { background: transparent; border: 0; padding: 0; color: inherit; text-align: start; cursor: pointer; }
  .transcript-editor__cue-delete { flex-shrink: 0; align-self: center; display: grid; place-items: center; inline-size: 2rem; block-size: 2rem; padding: .25rem; background: transparent; color: var(--color-panel-secondary); border: 1px solid transparent; border-radius: var(--caption-radius); cursor: pointer; & svg { inline-size: 1.15rem; block-size: 1.15rem; } &:hover:enabled { color: var(--color-panel-text); border-color: var(--color-panel-border); background: var(--color-surface-raised); } &:disabled { opacity: .45; cursor: default; } }
  .transcript-editor__pause-description { margin: 0; font-size: var(--caption-type-s); color: var(--color-panel-secondary); }
  .transcript-editor__cue-body { flex: 1; min-inline-size: 0; }
  .transcript-editor__cue-time { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; font-variant-numeric: tabular-nums; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin-block-end: .3rem; }
  .transcript-editor__timestamp { color: inherit; font: inherit; font-variant-numeric: inherit; background: transparent; border: 0; padding: 0; cursor: text; }
  .transcript-editor__timing-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--caption-space-s); min-inline-size: 0; margin-block-end: .3rem; input { inline-size: 100%; min-inline-size: 0; padding: .3rem; border: 1px solid var(--color-accent); border-radius: var(--caption-radius); background: var(--color-input); color: var(--color-panel-text); font-size: var(--caption-type-xs); font-variant-numeric: tabular-nums; &[aria-invalid=true] { border-color: var(--color-error); } } }
  .transcript-editor__cue-text { display: block; inline-size: 100%; background: transparent; color: inherit; border: 0; padding: 0; text-align: start; font-size: var(--caption-type-m); line-height: 1.5; overflow-wrap: anywhere; cursor: text; }
  .transcript-editor__cue-input { display: block; inline-size: 100%; min-inline-size: 0; min-block-size: 1.5em; margin: 0; padding: 0; resize: none; overflow: hidden; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: var(--caption-type-m); line-height: 1.5; overflow-wrap: anywhere; &:focus-visible { outline: none; } }
  /* Unsaved sits on the timestamp line, so it appearing or going away never
     changes the row's height and the list cannot shift at its bottom. */
  .transcript-editor__text-pending { margin-inline-start: auto; color: var(--color-panel-secondary); white-space: nowrap; }
  .transcript-editor__text-error { display: block; margin-block-start: .25rem; font-size: var(--caption-type-xs); color: var(--color-error); overflow-wrap: anywhere; }
  .transcript-editor__cue-phrase { display: block; & + & { margin-block-start: var(--caption-space-xs); } }
  .transcript-editor__edit { padding: var(--caption-space-l); display: flex; flex-direction: column; gap: var(--caption-space-m); border-block-start: 1px solid var(--color-panel-border); }
  .transcript-editor__estimated { font-size: var(--caption-type-xs); color: var(--color-warning); }
  .transcript-editor__empty { padding: var(--caption-space-l); color: var(--color-panel-secondary); font-size: var(--caption-type-s); }
  .transcript-editor__empty h3 { color: var(--color-panel-text); font-weight: 600; margin-block-end: var(--caption-space-s); }
  .transcript-editor__edit .caption-message { padding: 0; }
  @container (min-width: 48rem) {
    .transcript-editor__workspace { display: grid; grid-template-columns: minmax(18rem, .8fr) minmax(22rem, 1fr); }
    .transcript-editor__list { max-block-size: 60vh; }
    .transcript-editor__edit { border-block-start: 0; border-inline-start: 1px solid var(--color-panel-border); }
  }
</style>
