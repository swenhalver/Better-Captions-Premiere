<script lang="ts">
  import type { CaptionItem, CaptionWord } from "../lib/types";
  import { formatTime, groupCaptionWords } from "../lib/transcript/parser";
  import { replaceText, retime, split, validateCaptions } from "../lib/transcript/edit";
  interface Props {
    sequenceId: string; captions: CaptionItem[]; currentTime: number; maxWords: number; selectedId?: string | null;
    onSeek: (time: number) => void; onSelect: (id: string) => void;
    onMaxWordsChange: (maxWords: number) => void; onUpdate: (captions: CaptionItem[]) => void;
    onShowInPremiere?: (time: number) => void; isDemo?: boolean;
  }
  let { sequenceId, captions, currentTime, maxWords, selectedId = null, onSeek, onSelect, onMaxWordsChange, onUpdate, onShowInPremiere, isDemo = false }: Props = $props();
  let activeId = $derived(captions.find((caption) => currentTime >= caption.startTime && currentTime < caption.endTime)?.id ?? null);
  let selected = $derived(captions.find((caption) => caption.id === selectedId) ?? captions[0]);
  let draftText = $state("");
  let draftStart = $state(0);
  let draftEnd = $state(0);
  let draftWords = $state<CaptionWord[]>([]);
  let splitIndex = $state(1);
  let error = $state("");
  let notice = $state("");
  let previous = $state<CaptionItem[] | null>(null);
  let hasLinked = $derived(captions.some((caption) => caption.clipNodeId));
  let canUndo = $derived(!!previous && captions.every((caption) => !caption.clipNodeId || previous!.some((old) => old.id === caption.id)));
  let nextIsLinked = $derived(!!captions[captions.findIndex((caption) => caption.id === selected?.id) + 1]?.clipNodeId);
  let listEl: HTMLDivElement | undefined = $state();
  $effect(() => { sequenceId; previous = null; error = ""; notice = ""; });
  $effect(() => {
    if (!selected) return;
    draftText = selected.text;
    draftStart = Number(selected.startTime.toFixed(4));
    draftEnd = Number(selected.endTime.toFixed(4));
    draftWords = selected.words.map((word) => ({ ...word, startTime: Number(word.startTime.toFixed(4)), endTime: Number(word.endTime.toFixed(4)) }));
    splitIndex = 1;
  });
  $effect(() => {
    if (!activeId || !listEl) return;
    const el = [...listEl.querySelectorAll<HTMLElement>("[data-caption-id]")].find((node) => node.dataset.captionId === activeId);
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
    commit(captions.map((caption) => caption.id === updated.id ? updated : caption), message);
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
    updateCaption(retime(selected, Number(draftStart), Number(draftEnd)), "Caption timing saved. Word times moved proportionally.");
  }
  function saveWords() {
    if (!selected) return;
    updateCaption({ ...selected, words: draftWords.map((word) => ({ ...word, text: word.text.trim(), startTime: Number(word.startTime), endTime: Number(word.endTime) })), text: draftWords.map((word) => word.text.trim()).join(" "), timingEstimated: false }, "Word text and timing saved.");
  }
  function splitCaption() {
    if (!selected) return;
    try {
      const parts = split(selected, Number(splitIndex));
      parts[0] = { ...parts[0], clipNodeId: selected.clipNodeId, projectItemId: selected.projectItemId, mediaPath: selected.mediaPath };
      commit(captions.flatMap((caption) => caption.id === selected.id ? parts : [caption]), "Caption split at the selected word.");
      onSelect(parts[0].id);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function mergeNext() {
    if (!selected) return;
    const index = captions.findIndex((caption) => caption.id === selected.id);
    const next = captions[index + 1];
    if (!next) return;
    if (next.clipNodeId) { error = "Merge captions before applying them to Premiere. This next caption is already linked to a timeline clip."; return; }
    const words = [...selected.words, ...next.words];
    const merged = { ...selected, words, text: words.map((word) => word.text).join(" "), endTime: next.endTime, timingEstimated: selected.timingEstimated || next.timingEstimated };
    commit(captions.flatMap((caption, i) => i === index ? [merged] : i === index + 1 ? [] : [caption]), "Captions merged. Apply captions to update Premiere.");
  }
  function regroup() {
    if (hasLinked) { error = "Regroup captions before their first apply to Premiere. Linked caption boundaries are preserved."; return; }
    try {
      const next = captions.flatMap((caption) => groupCaptionWords(caption.words, maxWords).map((group, index) => ({ ...group, endTime: Math.min(group.endTime, caption.endTime), id: index === 0 ? caption.id : `${caption.id}-part-${index}-${Date.now().toString(36)}`, ...(index === 0 ? { clipNodeId: caption.clipNodeId, projectItemId: caption.projectItemId, mediaPath: caption.mediaPath } : {}), position: caption.position, timingEstimated: caption.timingEstimated, speaker: caption.speaker })));
      commit(next, "Grouping applied to the edited words. Existing caption boundaries remain split points.");
      if (next[0]) onSelect(next[0].id);
    } catch (problem) { error = problem instanceof Error ? problem.message : String(problem); }
  }
  function choose(caption: CaptionItem) { onSelect(caption.id); onSeek(caption.startTime); error = ""; notice = ""; }
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
  <div class="transcript-editor__heading"><h2>Transcript <span>{captions.length} captions</span></h2><button class="caption-button" onclick={undo} disabled={!canUndo} title={previous && !canUndo ? "The previous edit would remove a linked Premiere caption" : "Restore the previous transcript edit"}>Undo edit</button></div>
  {#if captions.length}
    <div class="transcript-editor__grouping">
      <label class="caption-field"><span>Words per caption</span><input type="number" min="1" max="20" step="1" value={maxWords} onchange={(event) => onMaxWordsChange(Math.max(1, Math.min(20, Number((event.target as HTMLInputElement).value))))} /></label>
      <button class="caption-button" onclick={regroup} disabled={hasLinked} title={hasLinked ? "Regroup before the first apply to Premiere" : "Apply the word limit to the edited transcript"}>Regroup edited words</button>
    </div>
    <p class="caption-help transcript-editor__note">{hasLinked ? "Caption boundaries are linked to Premiere clips. Edit timing and words below, or split an individual caption." : "Grouping uses punctuation, pauses and line length. Apply the word limit explicitly; editing it alone preserves your captions."}</p>
    <div class="transcript-editor__list" bind:this={listEl} aria-label="Caption list">
      {#each captions as caption, index (caption.id)}
        <button class="transcript-editor__cue" class:transcript-editor__cue--selected={selected?.id === caption.id} class:transcript-editor__cue--playing={activeId === caption.id} data-caption-id={caption.id} onclick={() => choose(caption)} aria-pressed={selected?.id === caption.id}>
          <span class="transcript-editor__cue-time">{index + 1} · {formatTime(caption.startTime)}</span><span class="transcript-editor__cue-text">{caption.text}</span>
        </button>
      {/each}
    </div>
    {#if selected}
      <div class="transcript-editor__edit">
        <div class="transcript-editor__edit-heading"><h3>Caption {captions.findIndex((caption) => caption.id === selected.id) + 1}</h3><button class="caption-button" disabled={isDemo} onclick={() => onShowInPremiere?.(selected.startTime)}>Show in Premiere</button></div>
        <label class="caption-field"><span>Transcription</span><textarea rows="2" bind:value={draftText} spellcheck="true"></textarea></label>
        <button class="caption-button" onclick={saveText}>Save text</button>
        {#if selected.timingEstimated}<p class="transcript-editor__estimated">Word timing is estimated after a text edit. Adjust and save word timings to confirm it.</p>{/if}
        <div class="caption-controls">
          <label class="caption-field"><span>Caption start, seconds</span><input type="number" min="0" step=".001" bind:value={draftStart} /></label>
          <label class="caption-field"><span>Caption end, seconds</span><input type="number" min="0" step=".001" bind:value={draftEnd} /></label>
        </div>
        <button class="caption-button" onclick={saveTiming}>Save caption timing</button>
        <details class="transcript-editor__words" open>
          <summary>Individual word text & timing</summary>
          <div class="transcript-editor__word-labels" aria-hidden="true"><span>Word</span><span>Start, s</span><span>End, s</span></div>
          {#each draftWords as word, index}
            <div class="transcript-editor__word">
              <input aria-label="Word {index + 1} text" type="text" bind:value={word.text} />
              <input aria-label="Word {index + 1} start in seconds" type="number" min="0" step=".001" bind:value={word.startTime} />
              <input aria-label="Word {index + 1} end in seconds" type="number" min="0" step=".001" bind:value={word.endTime} />
            </div>
          {/each}
          <button class="caption-button" onclick={saveWords}>Save word timings</button>
        </details>
        {#if selected.words.length > 1}
          <div class="transcript-editor__split">
            <label class="caption-field"><span>Split before word</span><select bind:value={splitIndex}>{#each selected.words.slice(1) as word, index}<option value={index + 1}>{index + 2}. {word.text}</option>{/each}</select></label>
            <button class="caption-button" onclick={splitCaption}>Split caption</button>
          </div>
        {/if}
        <button class="caption-button" onclick={mergeNext} disabled={captions[captions.length - 1].id === selected.id || nextIsLinked} title={nextIsLinked ? "The next caption is already linked to Premiere" : "Merge with the next unlinked caption"}>Merge with next caption</button>
      </div>
    {/if}
  {:else}<p class="transcript-editor__empty">Use Premiere’s native transcription to create timed captions. You can then edit every word, time and frame position here.</p>{/if}
  {#if error}<p class="caption-message caption-message--error" role="alert">{error}</p>{/if}
  {#if notice}<p class="caption-message" role="status">{notice}</p>{/if}
</section>

<style>
  .transcript-editor { border-block-end: 1px solid var(--color-panel-border); }
  .transcript-editor__heading { display: flex; justify-content: space-between; align-items: center; gap: var(--caption-space-s); padding: var(--caption-space-m); background: var(--color-surface); & h2 { font-size: .9rem; font-weight: 600; } & h2 span { font-weight: 400; color: var(--color-panel-secondary); font-size: .8rem; } }
  .transcript-editor__grouping { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--caption-space-s); align-items: end; padding: var(--caption-space-s) var(--caption-space-m) 0; }
  .transcript-editor__note { padding: var(--caption-space-s) var(--caption-space-m); }
  .transcript-editor__list { max-block-size: 12rem; overflow-y: auto; border-block: 1px solid var(--color-panel-border); }
  .transcript-editor__cue { display: grid; inline-size: 100%; grid-template-columns: 6.2rem minmax(0, 1fr); gap: var(--caption-space-s); text-align: start; background: transparent; color: var(--color-panel-text); padding: var(--caption-space-s) var(--caption-space-m); border: 0; border-inline-start: 2px solid transparent; cursor: pointer; &:hover { background: var(--color-surface-raised); } &:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; } }
  .transcript-editor__cue--selected { background: color-mix(in oklch, var(--color-accent) 12%, var(--color-panel-bg)); border-inline-start-color: var(--color-accent); }
  .transcript-editor__cue--playing .transcript-editor__cue-time { color: var(--color-accent); }
  .transcript-editor__cue-time { font-family: ui-monospace, monospace; color: var(--color-panel-secondary); font-size: .78rem; padding-block-start: .1rem; }
  .transcript-editor__cue-text { font-size: .9rem; line-height: 1.4; }
  .transcript-editor__edit { padding: var(--caption-space-m); display: flex; flex-direction: column; gap: var(--caption-space-m); }
  .transcript-editor__edit-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--caption-space-s); & h3 { font-size: .9rem; font-weight: 600; } }
  .transcript-editor__estimated { font-size: .8rem; color: var(--color-warning); }
  .transcript-editor__words { border-block-start: 1px solid var(--color-panel-border); padding-block-start: var(--caption-space-m); & summary { font-size: .85rem; cursor: pointer; font-weight: 600; margin-block-end: var(--caption-space-s); } & > button { inline-size: 100%; margin-block-start: var(--caption-space-s); } }
  .transcript-editor__word-labels, .transcript-editor__word { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr); gap: var(--caption-space-s); }
  .transcript-editor__word-labels { font-size: .75rem; color: var(--color-panel-secondary); margin-block-end: var(--caption-space-xs); }
  .transcript-editor__word { margin-block-end: var(--caption-space-xs); & input { inline-size: 100%; min-inline-size: 0; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); color: var(--color-panel-text); background: var(--color-surface-raised); font-size: .85rem; padding: .4rem; &:focus-visible { outline: 1px solid var(--color-accent); } } }
  .transcript-editor__split { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--caption-space-s); }
  .transcript-editor__empty { padding: var(--caption-space-l); color: var(--color-panel-secondary); font-size: .9rem; }
</style>
