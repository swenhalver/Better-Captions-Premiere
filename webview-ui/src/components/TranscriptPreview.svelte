<script lang="ts">
  import WordTimeline from "./WordTimeline.svelte";
  import type { CaptionItem, CaptionSegment, CaptionWord } from "../lib/types";
  import { captionSentenceCount, formatTime, regroupCaptions, validateCharacterLimit } from "../lib/transcript/parser";
  import { MAX_CAPTION_CHARS } from '../lib/types';
  import { replaceText, retime, split, validateCaptions } from "../lib/transcript/edit";
  import { captionSegmentRange, replaceCaptionSegment } from "../lib/transcript/segments";
  interface SentenceRow { key: string; caption: CaptionItem; segment?: CaptionSegment; }
  interface Props {
    frameRate: number; selectedWord?: number; onSelectWord?: (index:number)=>void;
    sequenceId: string; captions: CaptionItem[]; currentTime: number; maxChars: number; selectedId?: string | null;
    onSeek: (time: number) => void; onSelect: (id: string) => void;
    onMaxCharsChange: (maxChars: number) => void; onUpdate: (captions: CaptionItem[]) => void;
    onShowInPremiere?: (time: number) => void; isDemo?: boolean; disabled?: boolean;
  }
  let { frameRate, selectedWord = 0, onSelectWord = () => {}, sequenceId, captions, currentTime, maxChars, selectedId = null, onSeek, onSelect, onMaxCharsChange, onUpdate, onShowInPremiere, isDemo = false, disabled = false }: Props = $props();
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
  let draftStart = $state(0);
  let draftEnd = $state(0);
  let draftWords = $state<CaptionWord[]>([]);
  let splitIndex = $state(1);
  let error = $state("");
  let notice = $state("");
  let previous = $state<CaptionItem[] | null>(null);
  let hasLinked = $derived(captions.some((caption) => caption.clipNodeId));
  let sentenceCount = $derived(captionSentenceCount(captions));
  let canUndo = $derived(!!previous && captions.every((caption) => !caption.clipNodeId || previous!.some((old) => old.id === caption.id && (!caption.captionBundle || old.captionBundle))));
  let nextIsLinked = $derived(!!captions[captions.findIndex((caption) => caption.id === selected?.id) + 1]?.clipNodeId);
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => { sequenceId; query = ""; previous = null; selectedRowKey = null; error = ""; notice = ""; });
  $effect(() => {
    if (!selected) return;
    draftText = selected.text;
    draftStart = Number(selected.startTime.toFixed(4));
    draftEnd = Number(selected.endTime.toFixed(4));
    draftWords = selected.words.map((word) => ({ ...word, startTime: Number(word.startTime.toFixed(4)), endTime: Number(word.endTime.toFixed(4)) }));
    splitIndex = 1;
  });
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
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function updateCaption(updated: CaptionItem, message: string) {
    try {
      const next = selectedContainer && selectedSegment ? replaceCaptionSegment(selectedContainer, selectedSegment, updated) : updated;
      commit(captions.map((caption) => caption.id === updated.id ? next : caption), message);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function saveText() {
    if (!selected) return;
    try {
      const updated = replaceText(selected, draftText);
      updateCaption(updated, updated.timingEstimated ? "Text saved. Word count changed; review the estimated word timings below." : "Text saved with existing word timings.");
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function saveTiming() {
    if (!selected) return;
    try { updateCaption(retime(selected, Number(draftStart), Number(draftEnd)), "Caption timing saved. Word times moved proportionally."); }
    catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function saveWords() {
    if (!selected) return;
    updateCaption({ ...selected, words: draftWords.map((word) => ({ ...word, text: word.text.trim(), startTime: Number(word.startTime), endTime: Number(word.endTime) })), text: draftWords.map((word) => word.text.trim()).join(" "), timingEstimated: false }, "Word text and timing saved.");
  }
  function splitCaption() {
    if (!selectedContainer) return;
    if (selectedContainer.clipNodeId) { error = "Use Premiere’s Razor tool to split an applied caption clip. Its native keyframes stay with the source."; return; }
    try {
      const parts = split(selectedContainer, selectedWordOffset + Number(splitIndex));
      commit(captions.flatMap((caption) => caption.id === selectedContainer.id ? parts : [caption]), "Caption clip split at the selected word.");
      selectedRowKey = null;
      onSelect(parts[0].id);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function mergeNext() {
    if (!selectedContainer) return;
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
      const next = regroupCaptions(captions, maxChars);
      commit(next, hasLinked ? `${captionSentenceCount(next)} sentences grouped. Update Program Monitor to show them; timeline clips and keyframes stay in place.` : "Character limit applied. Short captions join where timing, sentences and placement allow.");
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
    <details class="transcript-editor__grouping">
      <summary>Sentence grouping <span>{maxChars} characters · {sentenceCount} sentences</span></summary>
      <div class="transcript-editor__grouping-body">
        <div class="transcript-editor__grouping-controls"><label class="caption-field"><span>Characters per caption</span><input type="number" min="1" max={MAX_CAPTION_CHARS} step="1" value={maxChars} onchange={changeCharacterLimit} disabled={disabled} /></label><button class="caption-button" onclick={regroup} disabled={disabled} title="Apply the character limit to the edited transcript">Regroup</button></div>
        <p class="caption-help">Includes spaces and punctuation. A word longer than the limit stays whole.</p>
        <p class="caption-help">{hasLinked ? `${sentenceCount} sentences across ${captions.length} timeline clips. Keyframes stay with their clips.` : "Regroup splits or joins captions, respecting sentences, pauses and placement."}</p>
      </div>
    </details>
    <div class="transcript-editor__workspace">
      <div class="transcript-editor__browse">

        <div class="transcript-editor__list" bind:this={listEl} aria-label="Caption list">
          {#each sentenceRows.filter((row) => (row.segment?.text ?? row.caption.renderSegments?.map(group => group.text).join(' ') ?? row.caption.text).toLowerCase().includes(query.toLowerCase())) as row (row.key)}
            <button class="transcript-editor__cue" class:transcript-editor__cue--selected={selectedRow?.key === row.key} class:transcript-editor__cue--playing={row.segment ? currentTime >= row.segment.startTime && currentTime < row.segment.endTime : activeId === row.caption.id} data-caption-id={row.caption.id} data-row-key={row.key} onclick={() => choose(row)} aria-pressed={selectedRow?.key === row.key}>
              <span class="transcript-editor__cue-number">{String(sentenceRows.indexOf(row) + 1).padStart(2,"0")}</span><span class="transcript-editor__cue-body"><span class="transcript-editor__cue-time">{formatTime(row.segment?.startTime ?? row.caption.startTime)} — {formatTime(row.segment?.endTime ?? row.caption.endTime)}</span><span class="transcript-editor__cue-text">{#if row.segment}{row.segment.text}{:else if row.caption.renderSegments}{#each row.caption.renderSegments as group (group.id)}<span class="transcript-editor__cue-phrase">{group.text}</span>{/each}{:else}{row.caption.text}{/if}</span></span>
            </button>
          {:else}<p class="transcript-editor__empty">No captions match “{query}”. Clear the search to see all captions.</p>{/each}
        </div>
      </div>
      {#if selected}
        <div class="transcript-editor__edit">
          <div class="transcript-editor__edit-heading"><h3>{selectedSegment ? 'Sentence' : selected.renderSegments ? 'Timeline clip' : 'Caption'} {selectedRow ? sentenceRows.indexOf(selectedRow) + 1 : captions.findIndex((caption) => caption.id === selected.id) + 1}</h3><button class="caption-button" disabled={isDemo} onclick={() => onShowInPremiere?.(selected.startTime)} title={isDemo ? "Available in the installed Premiere panel" : "Select caption in Premiere"}>Show in Premiere</button></div>
          <WordTimeline caption={selected} fps={frameRate} {currentTime} selectedWord={Math.max(0, selectedWord-selectedWordOffset)} onSelectWord={(index) => onSelectWord(index+selectedWordOffset)} onSeek={onSeek} onChange={(caption) => updateCaption(caption,"Word timing saved. Connected edges stay together.")} />
          <details class="transcript-editor__detail"><summary>Edit sentence text</summary>
          <label class="caption-field"><span>Transcription</span><textarea rows="3" bind:value={draftText} spellcheck="true" onkeydown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); saveText(); } }}></textarea></label>
          <div class="transcript-editor__save"><span class="caption-help">{draftText !== selected.text ? "Unsaved text" : "Text is up to date"}</span><button class="caption-button" onclick={saveText} disabled={draftText === selected.text}>Save text</button></div>
          </details>
          {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
          {#if notice}<p class="caption-message" role="status">{notice}</p>{/if}
          {#if selected.timingEstimated}<p class="transcript-editor__estimated">Word timings are estimated. Review and save them below.</p>{/if}
          <details class="transcript-editor__detail">
            <summary>Caption timing <span>{formatTime(selected.startTime)} — {formatTime(selected.endTime)}</span></summary>
            <div class="transcript-editor__detail-body"><div class="caption-controls"><label class="caption-field"><span>Caption start, seconds</span><input type="number" min="0" step=".001" bind:value={draftStart} /></label><label class="caption-field"><span>Caption end, seconds</span><input type="number" min="0" step=".001" bind:value={draftEnd} /></label></div><button class="caption-button" onclick={saveTiming}>Save caption timing</button></div>
          </details>
          <details class="transcript-editor__detail">
            <summary>Split & merge</summary>
            <div class="transcript-editor__detail-body">
              {#if selected.words.length > 1}<div class="transcript-editor__split"><label class="caption-field"><span>Split clip before word</span><select bind:value={splitIndex} disabled={!!selectedContainer?.clipNodeId}>{#each selected.words.slice(1) as word, index}<option value={index + 1}>{index + 2}. {word.text}</option>{/each}</select></label><button class="caption-button" onclick={splitCaption} disabled={!!selectedContainer?.clipNodeId} title={selectedContainer?.clipNodeId ? 'Use Premiere’s Razor tool to split the applied clip' : 'Create a separate caption clip'}>Split clip</button></div>{/if}
              <button class="caption-button" onclick={mergeNext} disabled={captions[captions.length - 1].id === selected.id || nextIsLinked} title={nextIsLinked ? "The next caption is already linked to Premiere" : "Merge with the next unlinked caption"}>Merge with next caption</button>
            </div>
          </details>
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
  .transcript-editor__grouping-body { padding: 0 var(--caption-space-l) var(--caption-space-m); }
  .transcript-editor__grouping-controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--caption-space-s); align-items: end; margin-block-end: var(--caption-space-s); }
  .transcript-editor__search { display: flex; align-items: center; gap: var(--caption-space-s); flex: 1; min-inline-size: 0; margin: 0; padding-inline: .5rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); }
  .transcript-editor__search svg { inline-size: 1.1rem; block-size: 1.1rem; color: var(--color-panel-secondary); flex-shrink: 0; }
  .transcript-editor__search input { min-inline-size: 0; inline-size: 100%; padding: .45rem 0; background: transparent; color: var(--color-panel-text); border: 0; font-size: var(--caption-type-s); }
  .transcript-editor__list { min-block-size: 0; max-block-size: clamp(7rem, 16vh, 12rem); overflow-y: auto; }
  .transcript-editor__cue { display: flex; align-items: flex-start; inline-size: 100%; gap: var(--caption-space-m); text-align: start; background: transparent; color: var(--color-panel-text); padding: var(--caption-space-m) var(--caption-space-l); border: 0; border-block-end: 1px solid var(--color-panel-border); cursor: pointer; }
  .transcript-editor__cue:hover { background: var(--color-surface-raised); }
  .transcript-editor__cue:focus-visible { outline-offset: -2px; }
  .transcript-editor__cue--selected { background: var(--color-selection); }
  .transcript-editor__cue--playing .transcript-editor__cue-time { color: var(--color-accent); }
  .transcript-editor__cue-number { color: var(--color-panel-secondary); font-variant-numeric: tabular-nums; font-size: var(--caption-type-xs); padding-block-start: .1rem; }
  .transcript-editor__cue-body { flex: 1; min-inline-size: 0; }
  .transcript-editor__cue-time { display: block; font-variant-numeric: tabular-nums; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); margin-block-end: .3rem; }
  .transcript-editor__cue-text { display: block; font-size: var(--caption-type-m); line-height: 1.5; overflow-wrap: anywhere; }
  .transcript-editor__cue-phrase { display: block; & + & { margin-block-start: var(--caption-space-xs); } }
  .transcript-editor__edit { padding: var(--caption-space-l); display: flex; flex-direction: column; gap: var(--caption-space-m); border-block-start: 1px solid var(--color-panel-border); }
  .transcript-editor__edit-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-s); }
  .transcript-editor__edit-heading h3 { font-size: var(--caption-type-m); font-weight: 600; }
  .transcript-editor__edit-heading button { font-size: var(--caption-type-xs); }
  .transcript-editor__save { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-s); }
  .transcript-editor__estimated { font-size: var(--caption-type-xs); color: var(--color-warning); }
  .transcript-editor__detail { border-block-start: 1px solid var(--color-panel-border); }
  .transcript-editor__detail summary { font-size: var(--caption-type-s); cursor: pointer; font-weight: 600; padding-block: var(--caption-space-m); }
  .transcript-editor__detail summary span { display: block; margin-block-start: .2rem; padding-inline-start: 1rem; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); font-weight: 400; font-variant-numeric: tabular-nums; }
  .transcript-editor__detail-body { display: flex; flex-direction: column; gap: var(--caption-space-s); padding-block-end: var(--caption-space-m); }
  .transcript-editor__split { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--caption-space-s); }
  .transcript-editor__empty { padding: var(--caption-space-l); color: var(--color-panel-secondary); font-size: var(--caption-type-s); }
  .transcript-editor__empty h3 { color: var(--color-panel-text); font-weight: 600; margin-block-end: var(--caption-space-s); }
  .transcript-editor__edit .caption-message { padding: 0; }
  @container (min-width: 48rem) {
    .transcript-editor__workspace { display: grid; grid-template-columns: minmax(18rem, .8fr) minmax(22rem, 1fr); }
    .transcript-editor__list { max-block-size: 60vh; }
    .transcript-editor__edit { border-block-start: 0; border-inline-start: 1px solid var(--color-panel-border); }
  }
</style>
