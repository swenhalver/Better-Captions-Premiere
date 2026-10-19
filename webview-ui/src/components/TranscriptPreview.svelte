<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import WordTimeline from "./WordTimeline.svelte";
  import type { CaptionItem, CaptionSegment } from "../lib/types";
  import { captionSentenceCount, formatTime, regroupCaptions, validateCharacterLimit } from "../lib/transcript/parser";
  import { MAX_CAPTION_CHARS } from '../lib/types';
  import { replaceText, retime, split, validateCaptions } from "../lib/transcript/edit";
  import { captionSegmentRange, replaceCaptionSegment } from "../lib/transcript/segments";
  import type { WordEdge } from '../lib/transcript/timing';
  interface SentenceRow { key: string; caption: CaptionItem; segment?: CaptionSegment; }
  interface Props {
    frameRate: number; selectedWord?: number; onSelectWord?: (index:number)=>void;
    sequenceId: string; captions: CaptionItem[]; currentTime: number; maxChars: number; selectedId?: string | null;
    onSeek: (time: number) => void; onSelect: (id: string) => void;
    onMaxCharsChange: (maxChars: number) => void; onUpdate: (captions: CaptionItem[]) => void;
    onEditingChange?: (active:boolean)=>void;
    onShowInPremiere?: (time: number) => void; isDemo?: boolean; disabled?: boolean; groupingDisabled?: boolean; onRegroup?: () => void; smartCharacterCapacity?:number|null; smartLineFit?:boolean; onSmartLineFitChange?:(enabled:boolean)=>void;
  }
  let { frameRate, selectedWord = 0, onSelectWord = () => {}, sequenceId, captions, currentTime, maxChars, selectedId = null, onSeek, onSelect, onMaxCharsChange, onUpdate, disabled = false, groupingDisabled = false, onRegroup, onEditingChange=()=>{}, smartCharacterCapacity=null, smartLineFit=false, onSmartLineFitChange }: Props = $props();
  let activeId = $derived(captions.find((caption) => currentTime >= caption.startTime && currentTime < caption.endTime)?.id ?? null);
  let selectedContainer = $derived(captions.find((caption) => caption.id === selectedId) ?? captions[0]);
  let selectedRowKey = $state<string | null>(null);
  let sentenceRows = $derived.by((): SentenceRow[] => captions.flatMap(caption => {
    // A sentence crossing a legacy native cut is shown within that clip's
    // original editor. A new whole-transcript bundle has one row per sentence.
    const groups = caption.renderSegments;
    if (groups?.length && groups.every(group => captionSegmentRange(caption, group))) return groups.map(segment => ({ key: caption.id + ':' + segment.id, caption, segment }));
    return [{ key: caption.id, caption }];
  }));
  let selectedRow = $derived(sentenceRows.find(row => row.key === selectedRowKey && row.caption.id === selectedContainer?.id) ?? sentenceRows.find(row => row.caption.id === selectedContainer?.id));
  let selectedSegment = $derived(selectedRow?.segment);
  let selected = $derived(selectedContainer && selectedSegment ? { ...selectedContainer, ...selectedSegment, id: selectedContainer.id,
    startTime: Math.max(selectedContainer.startTime, selectedSegment.startTime), endTime: Math.min(selectedContainer.endTime, selectedSegment.endTime) } : selectedContainer);
  let selectedWordOffset = $derived(selectedContainer && selectedSegment ? captionSegmentRange(selectedContainer, selectedSegment)?.start ?? 0 : 0);
  let query = $state("");
  let draftText = $state("");
  let editingRowKey = $state<string | null>(null);
  let editingSource = $state("");
  let editingError = $state("");
  let editingCaret = $state(0);
  let draftStart = $state(0);
  let draftEnd = $state(0);
  let timingRowKey = $state<string | null>(null);
  let timingSource = $state('');
  $effect(()=>onEditingChange(editingRowKey!==null||timingRowKey!==null));
  onDestroy(()=>onEditingChange(false));
  let timingError = $state('');
  let timingFocus = $state<WordEdge>('startTime');
  let timingChanged = $state({ startTime: false, endTime: false });
  let timingInvalid = $state({ startTime: false, endTime: false });
  let error = $state("");
  let notice = $state("");
  let previous = $state<CaptionItem[] | null>(null);
  let hasLinked = $derived(captions.some((caption) => caption.clipNodeId));
  let sentenceCount = $derived(captionSentenceCount(captions));
  let canUndo = $derived(!!previous && captions.every((caption) => !caption.clipNodeId || previous!.some((old) => old.id === caption.id && (!caption.captionBundle || old.captionBundle))));
  let nextIsLinked = $derived(!!captions[captions.findIndex((caption) => caption.id === selected?.id) + 1]?.clipNodeId);
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => { sequenceId; query = ""; previous = null; selectedRowKey = null; editingRowKey = null; editingSource = ""; editingError = ""; timingRowKey = null; timingSource = ''; timingError = ''; error = ""; notice = ""; });
  $effect(() => {
    const visibleId = selectedId ?? activeId;
    if (!visibleId || !listEl) return;
    const el = [...listEl.querySelectorAll<HTMLElement>("[data-caption-id]")].find((node) => node.dataset.rowKey === selectedRow?.key) ?? [...listEl.querySelectorAll<HTMLElement>("[data-caption-id]")].find((node) => node.dataset.captionId === visibleId);
    el?.scrollIntoView({ block: "nearest" });
  });
  function commit(next: CaptionItem[], message: string) {
    error = "";
    try {
      if (next.length) validateCaptions(next);
      if (captions.some((caption) => caption.clipNodeId && !next.some((item) => item.id === caption.id))) throw new Error("A linked Premiere caption cannot be removed by this edit.");
      previous = JSON.parse(JSON.stringify(captions));
      onUpdate(next);
      notice = message;
      return true;
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); return false; }
  }
  function updateCaption(updated: CaptionItem, message: string) {
    try {
      const next = selectedContainer && selectedSegment ? replaceCaptionSegment(selectedContainer, selectedSegment, updated) : updated;
      commit(captions.map((caption) => caption.id === updated.id ? next : caption), message);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function rowCaption(row: SentenceRow): CaptionItem {
    return row.segment ? { ...row.caption, ...row.segment, id: row.caption.id,
      startTime: Math.max(row.caption.startTime, row.segment.startTime), endTime: Math.min(row.caption.endTime, row.segment.endTime) } : row.caption;
  }
  function textSource(row: SentenceRow) {
    const current = rowCaption(row);
    return JSON.stringify([sequenceId, current.id, row.segment?.id, current.startTime, current.endTime, current.text,
      current.words.map(word => [word.text, word.startTime, word.endTime])]);
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
  }
  function saveInlineText(row: SentenceRow) {
    if (editingRowKey !== row.key) return true;
    try {
      const current = sentenceRows.find(item => item.key === row.key);
      if (!current || textSource(current) !== editingSource) throw new Error('This sentence changed while you were editing. Cancel and select it again.');
      const source = rowCaption(current), updated = replaceText(source, draftText);
      if (updated.text !== source.text) {
        const next = current.segment ? replaceCaptionSegment(current.caption, current.segment, updated) : updated;
        if (!commit(captions.map(caption => caption.id === next.id ? next : caption), updated.timingEstimated ? 'Text saved. Review the estimated word timings.' : 'Text saved with existing word timings.')) { editingError = error; return false; }
      }
      editingRowKey = null;
      editingSource = '';
      editingError = '';
      return true;
    } catch (problem) { editingError = problem instanceof Error ? problem.message : String(problem); return false; }
  }
  function cancelTextEdit() { editingRowKey = null; editingSource = ''; editingError = ''; }
  function resizeTextEditor(node: HTMLTextAreaElement) { node.style.blockSize = 'auto'; node.style.blockSize = `${node.scrollHeight}px`; }
  function focusTextEditor(node: HTMLTextAreaElement) {
    resizeTextEditor(node);
    node.focus({ preventScroll: true });
    const caret = Math.min(editingCaret, node.value.length);
    node.setSelectionRange(caret, caret);
  }
  function textKeydown(event: KeyboardEvent, row: SentenceRow) {
    if (event.isComposing) return;
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
    const position = captions.findIndex(caption => caption.id === row.caption.id);
    const lower = row.segment ? row.caption.startTime : captions[position - 1]?.endTime ?? 0;
    const upper = row.segment ? row.caption.endTime : captions[position + 1]?.startTime;
    const time = edge === 'startTime' ? draftStart : draftEnd, frame = Math.round(time * frameRate), value = secondsValue(time);
    const minimum = edge === 'startTime' ? lower : draftStart + 1 / frameRate;
    const maximum = edge === 'startTime' ? draftEnd - 1 / frameRate : upper;
    return { min: value + (Math.ceil(minimum * frameRate - 1e-7) - frame) / frameRate,
      max: maximum === undefined ? undefined : value + (Math.floor(maximum * frameRate + 1e-7) - frame) / frameRate };
  }
  function inputCaptionTime(edge: WordEdge, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    timingInvalid[edge] = !Number.isFinite(input.valueAsNumber);
    if (timingInvalid[edge]) return;
    const time = Math.round(input.valueAsNumber * frameRate) / frameRate;
    if (edge === 'startTime') draftStart = time; else draftEnd = time;
    timingChanged[edge] = true;
    timingError = '';
    input.value = String(secondsValue(time));
  }
  function saveInlineTiming(row: SentenceRow) {
    if (timingRowKey !== row.key) return true;
    try {
      const current = sentenceRows.find(item => item.key === row.key);
      if (!current || textSource(current) !== timingSource) throw new Error('This sentence changed while you were editing. Cancel and select its timing again.');
      if (timingInvalid.startTime || timingInvalid.endTime) throw new Error('Enter a valid start and end time.');
      if (timingChanged.startTime || timingChanged.endTime) {
        const source = rowCaption(current);
        const start = timingChanged.startTime ? Math.round(draftStart * frameRate) / frameRate : source.startTime;
        const end = timingChanged.endTime ? Math.round(draftEnd * frameRate) / frameRate : source.endTime;
        if ((end - start) * frameRate < 1 - 1e-7) throw new Error('Keep at least one frame between caption start and end.');
        const updated = retime(source, start, end);
        const next = current.segment ? replaceCaptionSegment(current.caption, current.segment, updated) : updated;
        if (!commit(captions.map(caption => caption.id === next.id ? next : caption), 'Caption timing saved.')) { timingError = error; return false; }
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
  function splitCaption(wordIndex: number) {
    if (disabled || !selectedContainer) return;
    if (selectedContainer.clipNodeId) { error = "Use Premiere’s Razor tool to split an applied caption clip. Its native keyframes stay with the source."; return; }
    try {
      const parts = split(selectedContainer, wordIndex);
      if (!commit(captions.flatMap((caption) => caption.id === selectedContainer.id ? parts : [caption]), "Caption clip split at the selected word.")) return;
      selectedRowKey = null;
      onSelect(parts[1].id);
      onSelectWord(0);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function mergeNext() {
    if (disabled || !selectedContainer) return;
    const index = captions.findIndex((caption) => caption.id === selectedContainer.id);
    const next = captions[index + 1];
    if (!next) return;
    if (next.clipNodeId) { error = "Merge captions before applying them to Premiere. This next caption is already linked to a timeline clip."; return; }
    const words = [...selectedContainer.words, ...next.words];
    const merged = { ...selectedContainer, words, text: words.map((word) => word.text).join(" "), endTime: next.endTime, timingEstimated: selectedContainer.timingEstimated || next.timingEstimated };
    commit(captions.flatMap((caption, i) => i === index ? [merged] : i === index + 1 ? [] : [caption]), "Captions merged. Apply captions to update Premiere.");
  }
  function regroup() {
    if (disabled) return;
    try {
      if (onRegroup) { onRegroup(); selectedRowKey = null; return; }
      const next = regroupCaptions(captions, maxChars);
      commit(next, `${captionSentenceCount(next)} caption groups updated.`);
      selectedRowKey = null;
      if (next[0]) onSelect(next[0].id);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function changeCharacterLimit(event: Event) {
    const input = event.target as HTMLInputElement;
    try { onMaxCharsChange(validateCharacterLimit(input.valueAsNumber)); error = ''; }
    catch (problem) { input.value = String(maxChars); error = problem instanceof Error ? problem.message : String(problem); }
  }
  function choose(row: SentenceRow) { selectedRowKey = row.key; onSelect(row.caption.id); onSelectWord(row.segment ? captionSegmentRange(row.caption, row.segment)?.start ?? 0 : 0); onSeek(row.segment?.startTime ?? row.caption.startTime); error = ""; notice = ""; }
  function undo() {
    if (!previous || !canUndo) return;
    const restore = previous.map((caption) => { const current = captions.find((item) => item.id === caption.id); return current?.clipNodeId ? { ...caption, clipNodeId: current.clipNodeId, projectItemId: current.projectItemId, mediaPath: current.mediaPath } : caption; });
    previous = JSON.parse(JSON.stringify(captions));
    onUpdate(restore);
    if (restore[0]) onSelect(restore.some((caption) => caption.id === selectedId) ? selectedId! : restore[0].id);
    notice = "Previous edit restored.";
    error = "";
  }
</script>

<section class="transcript-editor" aria-label="Transcript editor">
  <div class="transcript-editor__heading"><label class="transcript-editor__search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg><input type="search" aria-label="Search captions" placeholder="Search captions" bind:value={query} /></label><button class="caption-button" onclick={undo} disabled={!canUndo} title="Restore the previous transcript edit">Undo edit</button></div>
  {#if captions.length}
    {#if !groupingDisabled}
    <details class="transcript-editor__grouping">
      <summary>Caption grouping <span>{smartLineFit ? smartCharacterCapacity===null?"Smart line fit":`Smart · ≈${smartCharacterCapacity} chars` : `${maxChars} characters`} · {sentenceCount} groups</span></summary>
      <div class="transcript-editor__grouping-body">
        {#if onSmartLineFitChange}<label class="caption-check transcript-editor__smart-fit" title="Measure the text to fit one line, with a 5% safety margin for letter widths and highlighting"><input type="checkbox" checked={smartLineFit} disabled={disabled} onchange={event=>onSmartLineFitChange?.(event.currentTarget.checked)}/><span>Smart line fit</span></label>{/if}
        <div class="transcript-editor__grouping-controls"><label class="caption-field"><span>{smartLineFit?"Characters per line (estimated)":"Characters per caption"}</span><input type="number" min="1" max={MAX_CAPTION_CHARS} step="1" value={smartLineFit ? smartCharacterCapacity ?? "" : maxChars} placeholder={smartLineFit?"—":undefined} readonly={smartLineFit} title={smartLineFit?"Estimated capacity for this width and font. Actual phrases use measured whole words.":undefined} onchange={changeCharacterLimit} disabled={disabled} /></label><button class="caption-button" onclick={regroup} disabled={disabled||smartLineFit} title="Apply the character limit to the edited transcript">Regroup</button></div>
        <p class="caption-help">{smartLineFit ? "Fits the selected width using font measurements and a 5% safety margin. Updates as width or styling changes." : "Includes spaces and punctuation. A word longer than the limit stays whole."}</p>
        <p class="caption-help">{hasLinked ? `${sentenceCount} caption groups across ${captions.length} timeline ${captions.length === 1 ? 'clip' : 'clips'}. Keyframes stay with their clips.` : "Regroup splits or joins captions, respecting sentences, pauses and placement."}</p>
      </div>
    </details>
    {/if}
    <div class="transcript-editor__workspace">
      <div class="transcript-editor__browse">

        <div class="transcript-editor__list" bind:this={listEl} aria-label="Caption list">
          {#each sentenceRows.filter((row) => (row.segment?.text ?? row.caption.renderSegments?.map(group => group.text).join(' ') ?? row.caption.text).toLowerCase().includes(query.toLowerCase())) as row (row.key)}
            <div class="transcript-editor__cue" class:transcript-editor__cue--selected={selectedRow?.key === row.key} class:transcript-editor__cue--playing={row.segment ? currentTime >= row.segment.startTime && currentTime < row.segment.endTime : activeId === row.caption.id} data-caption-id={row.caption.id} data-row-key={row.key}>
              <button class="transcript-editor__cue-select" aria-label="Select caption {sentenceRows.indexOf(row) + 1}" aria-pressed={selectedRow?.key === row.key} onclick={() => choose(row)}><span class="transcript-editor__cue-number">{String(sentenceRows.indexOf(row) + 1).padStart(2,"0")}</span></button>
              <div class="transcript-editor__cue-body">
                {#if timingRowKey === row.key}
                  <div class="transcript-editor__timing-inputs">
                    {#each ['startTime','endTime'] as raw}{@const edge = raw as WordEdge}{@const range = timingRange(row,edge)}
                      <input type="number" aria-label="Caption {sentenceRows.indexOf(row) + 1} {edge === 'startTime' ? 'start' : 'end'} in seconds" aria-invalid={!!timingError} aria-describedby={timingError ? 'caption-timing-error' : undefined} min={range.min} max={range.max} step={1/frameRate} value={secondsValue(edge === 'startTime' ? draftStart : draftEnd)} use:focusTimingEditor={edge} oninput={(event) => inputCaptionTime(edge,event)} onkeydown={(event) => timingKeydown(event,row)} onblur={(event) => timingBlur(event,row)} />
                    {/each}
                  </div>
                  {#if timingError}<p class="transcript-editor__text-error" id="caption-timing-error" role="alert">{timingError}</p>{/if}
                {:else}
                  <div class="transcript-editor__cue-time"><button class="transcript-editor__timestamp" aria-label="Edit caption {sentenceRows.indexOf(row) + 1} start time" onclick={() => beginTimingEdit(row,'startTime')} disabled={disabled}>{formatTime(row.segment?.startTime ?? row.caption.startTime)}</button><span aria-hidden="true">—</span><button class="transcript-editor__timestamp" aria-label="Edit caption {sentenceRows.indexOf(row) + 1} end time" onclick={() => beginTimingEdit(row,'endTime')} disabled={disabled}>{formatTime(row.segment?.endTime ?? row.caption.endTime)}</button></div>
                {/if}
                {#if editingRowKey === row.key}
                  <textarea class="transcript-editor__cue-input" aria-label="Edit caption {sentenceRows.indexOf(row) + 1} text" aria-invalid={!!editingError} aria-describedby={editingError ? 'caption-inline-error' : undefined} rows="1" bind:value={draftText} spellcheck="true" use:focusTextEditor oninput={(event) => { editingError = ''; resizeTextEditor(event.currentTarget); }} onkeydown={(event) => textKeydown(event,row)} onblur={() => saveInlineText(row)}></textarea>
                  {#if editingError}<p class="transcript-editor__text-error" id="caption-inline-error" role="alert">{editingError}</p>{:else if draftText !== rowCaption(row).text}<span class="transcript-editor__text-pending" role="status">Unsaved</span>{/if}
                {:else}
                  <button class="transcript-editor__cue-text" aria-label="Edit caption {sentenceRows.indexOf(row) + 1} text" onclick={(event) => beginTextEdit(row,event)} disabled={disabled}>{#if row.segment}{row.segment.text}{:else if row.caption.renderSegments}{#each row.caption.renderSegments as group (group.id)}<span class="transcript-editor__cue-phrase">{group.text}</span>{/each}{:else}{row.caption.text}{/if}</button>
                {/if}
              </div>
            </div>
          {:else}<p class="transcript-editor__empty">No captions match “{query}”. Clear the search to see all captions.</p>{/each}
        </div>
      </div>
      {#if selected}
        <div class="transcript-editor__edit">
          <WordTimeline caption={selected} fps={frameRate} {currentTime} selectedWord={Math.max(0, selectedWord-selectedWordOffset)} onSelectWord={(index) => onSelectWord(index+selectedWordOffset)} onSeek={onSeek} onChange={(caption) => updateCaption(caption,"Word timing saved.")}
            wordOffset={selectedWordOffset} onSplitBefore={splitCaption} splitDisabled={disabled || !!selectedContainer?.clipNodeId} splitTitle={selectedContainer?.clipNodeId ? 'Use Premiere’s Razor tool to split the applied clip; its keyframes stay with the source' : undefined}
            onMergeNext={mergeNext} mergeDisabled={disabled || captions[captions.length - 1].id === selected.id || nextIsLinked} mergeTitle={nextIsLinked ? 'The next caption is already linked to Premiere' : 'Merge with the next unlinked caption'} />
          {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
          {#if notice}<p class="caption-message" role="status">{notice}</p>{/if}
          {#if selected.timingEstimated}<p class="transcript-editor__estimated">Word timings are estimated. Review them in the word lane.</p>{/if}
        </div>
      {/if}
    </div>
  {:else}<div class="transcript-editor__empty"><h3>Ready for your first words</h3><p>Use Transcribe in Premiere to load timed speech. Then select a caption to edit its text and timing.</p></div>{/if}
</section>
<style>
  .transcript-editor { container-type: inline-size; }
  .transcript-editor__heading { display: flex; justify-content: space-between; align-items: center; gap: var(--caption-space-s); padding: var(--caption-space-m) var(--caption-space-l); }


  .transcript-editor__heading button { background: transparent; }
  .transcript-editor__grouping { border-block: 1px solid var(--color-panel-border); font-size: var(--caption-type-s); }
  .transcript-editor__grouping > summary { cursor: pointer; padding: var(--caption-space-m) var(--caption-space-l); }
  .transcript-editor__grouping summary span { float: right; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); }
  .transcript-editor__grouping-body { clear: both; padding: 0 var(--caption-space-l) var(--caption-space-m); }
  .transcript-editor__smart-fit { margin-block:var(--caption-space-s);font-size:var(--caption-type-s); }
  .transcript-editor__grouping-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--caption-space-s); align-items: end; margin-block-end: var(--caption-space-s); }
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
  .transcript-editor__cue-body { flex: 1; min-inline-size: 0; }
  .transcript-editor__cue-time { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; font-variant-numeric: tabular-nums; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin-block-end: .3rem; }
  .transcript-editor__timestamp { color: inherit; font: inherit; font-variant-numeric: inherit; background: transparent; border: 0; padding: 0; cursor: text; }
  .transcript-editor__timing-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--caption-space-s); min-inline-size: 0; margin-block-end: .3rem; input { inline-size: 100%; min-inline-size: 0; padding: .3rem; border: 1px solid var(--color-accent); border-radius: var(--caption-radius); background: var(--color-input); color: var(--color-panel-text); font-size: var(--caption-type-xs); font-variant-numeric: tabular-nums; &[aria-invalid=true] { border-color: var(--color-error); } } }
  .transcript-editor__cue-text { display: block; inline-size: 100%; background: transparent; color: inherit; border: 0; padding: 0; text-align: start; font-size: var(--caption-type-m); line-height: 1.5; overflow-wrap: anywhere; cursor: text; }
  .transcript-editor__cue-input { display: block; inline-size: 100%; min-inline-size: 0; min-block-size: 1.5em; margin: 0; padding: 0; resize: none; overflow: hidden; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: var(--caption-type-m); line-height: 1.5; &:focus-visible { outline: none; } }
  .transcript-editor__text-pending, .transcript-editor__text-error { display: block; margin-block-start: .25rem; font-size: var(--caption-type-xs); color: var(--color-panel-secondary); overflow-wrap: anywhere; }
  .transcript-editor__text-error { color: var(--color-error); }
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
