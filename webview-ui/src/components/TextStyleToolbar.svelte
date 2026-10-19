<script module lang="ts">
  import type { StyleConfig, WordAppearance } from "../lib/types";
  import { resolveAppearance, type WordStateKey, type ResolvedAppearance } from "../lib/appearance";
  import { fontWeightOptions, nextFontWeight, resolveFontWeight, type InstalledFont } from '../lib/font-catalog.ts';

  export type TextStyleScope = "all" | "spoken" | "current" | "upcoming";
  const stateKeys: WordStateKey[] = ["spokenWord", "activeWord", "upcomingWord"];
  const scopeKeys = { spoken: "spokenWord", current: "activeWord", upcoming: "upcomingWord" } as const;
  const baseFields = { fontFamily: "fontFamily", fontWeight: "fontWeight", color: "textColor", textTransform: "textTransform",
    strokeEnabled: "strokeEnabled", strokeColor: "strokeColor", strokeWidth: "strokeWidth", strokeOpacity: "strokeOpacity",
    shadowEnabled: "shadowEnabled", shadowColor: "shadowColor", shadowOpacity: "shadowOpacity", shadowBlur: "shadowBlur",
    shadowOffsetX: "shadowOffsetX", shadowOffsetY: "shadowOffsetY" } as const;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  /** Change one formatting property without flattening the other word-state styles. */
  export function textStylePatch(style: StyleConfig, scope: TextStyleScope, patch: Partial<WordAppearance>): Partial<StyleConfig> {
    if (scope !== "all") {
      const key = scopeKeys[scope];
      const next = { ...style[key], ...patch };
      if (patch.fontSize !== undefined) next.sizeScale = clamp(patch.fontSize / style.fontSize, .4, 3);
      if (patch.fontWeight !== undefined && !("fontWeightOffset" in patch)) next.fontWeightOffset = null;
      return { [key]: next };
    }
    const result: Record<string, unknown> = {};
    for (const [key, target] of Object.entries(baseFields)) {
      if (key in patch) result[target] = patch[key as keyof WordAppearance];
    }
    const { fontSize, ...wordPatch } = patch;
    if (fontSize !== undefined) result.fontSize = fontSize;
    for (const key of stateKeys) {
      const saved = style[key];
      const next: Partial<WordAppearance> = { ...saved, ...wordPatch };
      // Older presets may store absolute per-state pixels. Keep their proportions
      // when changing the common base size, just as sizeScale-only states do.
      if (fontSize !== undefined && saved?.fontSize !== undefined) next.fontSize = clamp(saved.fontSize * fontSize / style.fontSize, 8, 1200);
      if (Object.keys(wordPatch).length || next.fontSize !== saved?.fontSize) result[key] = next;
    }
    return result as Partial<StyleConfig>;
  }

  export function textStyleAppearance(style: StyleConfig, scope: TextStyleScope): ResolvedAppearance {
    if (scope !== "all") return resolveAppearance(style, scopeKeys[scope]);
    const states = stateKeys.map(state => resolveAppearance(style, state));
    const appearance = { ...states[2], fontFamily: style.fontFamily, fontSize: style.fontSize,
      fontWeight: resolveFontWeight(style.fontFamily, style.fontWeight), color: style.textColor, textTransform: style.textTransform,
      strokeEnabled: style.strokeEnabled, strokeColor: style.strokeColor, strokeWidth: style.strokeWidth, strokeOpacity: style.strokeOpacity,
      shadowEnabled: style.shadowEnabled, shadowColor: style.shadowColor, shadowOpacity: style.shadowOpacity,
      shadowBlur: style.shadowBlur, shadowOffsetX: style.shadowOffsetX, shadowOffsetY: style.shadowOffsetY };
    for (const key of Object.keys(appearance) as (keyof ResolvedAppearance)[]) {
      if (key !== "fontSize" && key !== "sizeScale" && key !== "fontWeight" && states.every(state => state[key] === states[0][key])) {
        (appearance as Record<string, unknown>)[key] = states[0][key];
      }
    }
    appearance.fontWeight = resolveFontWeight(appearance.fontFamily, style.fontWeight);
    return appearance;
  }

  export function textStyleMixed(style: StyleConfig, scope: TextStyleScope, key: keyof WordAppearance): boolean {
    if (scope !== "all") return false;
    const values = stateKeys.map(state => resolveAppearance(style, state)[key]);
    return values.some(value => value !== values[0]);
  }

  export function textStyleBoldState(style: StyleConfig, scope: TextStyleScope): boolean | "mixed" {
    const keys = scope === "all" ? stateKeys : [scopeKeys[scope]];
    const modes = keys.map(key => style[key]?.fontWeightOffset === 100);
    return modes.every(mode => mode === modes[0]) ? modes[0] : "mixed";
  }

  export function textStyleBoldDisabled(style: StyleConfig, scope: TextStyleScope): boolean {
    if (textStyleBoldState(style, scope) !== false) return false;
    const keys = scope === 'all' ? stateKeys : [scopeKeys[scope]];
    return keys.every(key => nextFontWeight(style[key]?.fontFamily || style.fontFamily, style.fontWeight) <= resolveFontWeight(style[key]?.fontFamily || style.fontFamily, style.fontWeight));
  }

  /** B uses the next installed heavier face; the shared baseline stays intact. */
  export function textStyleBoldPatch(style: StyleConfig, scope: TextStyleScope): Partial<StyleConfig> {
    const offset = style.fontWeight >= 1000 || textStyleBoldState(style, scope) === true ? 0 : 100;
    const keys = scope === "all" ? stateKeys : [scopeKeys[scope]];
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = { ...style[key], fontWeightOffset: offset };
    return result as Partial<StyleConfig>;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import FontPicker from './FontPicker.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  interface Props { style: StyleConfig; fonts?: string[]; fontCatalog?: InstalledFont[]; fontsLoading?: boolean; fontsError?: string; onRefreshFonts?: () => void; scope?: TextStyleScope; onScopeChange: (scope: TextStyleScope) => void; onUpdate: (updates: Partial<StyleConfig>) => void; disabled?: boolean; nativeMode?: boolean; nativeLayout?: Snippet; nativeAlignment?: Snippet; }
  let { style, fonts = [], fontCatalog = [], fontsLoading = false, fontsError = '', onRefreshFonts, scope = "all", onScopeChange, onUpdate, disabled = false, nativeMode = false, nativeLayout, nativeAlignment }: Props = $props();
  const componentId = $props.id();
  let appearance = $derived.by(() => { void fontCatalog; return textStyleAppearance(style, scope); });
  let boldState = $derived(textStyleBoldState(style, scope));
  let weights = $derived(fontWeightOptions(appearance.fontFamily, fontCatalog));
  let boldDisabled = $derived.by(() => { void fontCatalog; return !weights.length && boldState === false || textStyleBoldDisabled(style, scope); });
  type DetailTab = "spacing" | "stroke" | "shadow" | "bubble" | "layout";
  let expanded = $state<DetailTab>("spacing");
  const tabs: {key:DetailTab;label:string}[]=[{key:"spacing",label:"Spacing"},{key:"stroke",label:"Outline"},{key:"shadow",label:"Shadow"},{key:"bubble",label:"Bubble"},{key:"layout",label:"Layout"}];
  function tabKey(event:KeyboardEvent,index:number){
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    expanded=tabs[next].key;document.getElementById(`${componentId}-tab-${expanded}`)?.focus();
  }
  function toggleEffect(key:"stroke"|"shadow"|"bubble",enabled:boolean){
    const field=key==="stroke"?"strokeEnabled":key==="shadow"?"shadowEnabled":"bubble";
    const patch:Partial<WordAppearance>={[field]:enabled};
    if(nativeMode&&enabled&&key==="stroke"&&appearance.strokeWidth<=0)patch.strokeWidth=2;
    if(nativeMode&&enabled&&key==="shadow"){if(appearance.shadowOpacity<=0)patch.shadowOpacity=1;if(!appearance.shadowBlur&&!appearance.shadowOffsetX&&!appearance.shadowOffsetY)patch.shadowBlur=4;}
    update(patch);
  }
  let sizeMax = $derived(scope === "all" ? 400 : 1200);
  const mixed = (key: keyof WordAppearance) => textStyleMixed(style, scope, key);
  const value = (event: Event) => (event.currentTarget as HTMLInputElement).value;
  function update(patch: Partial<WordAppearance>) { onUpdate(textStylePatch(style, scope, patch)); }
  function selectFont(fontFamily: string) {
    const patch = textStylePatch(style, scope, { fontFamily });
    if (scope === 'all') {
      patch.fontWeight = resolveFontWeight(fontFamily, style.fontWeight);
      for (const key of stateKeys) Object.assign(patch, { [key]: { ...patch[key], fontWeight: resolveFontWeight(fontFamily, style[key]?.fontWeight ?? style.fontWeight) } });
    } else {
      const key = scopeKeys[scope];
      Object.assign(patch, { [key]: { ...patch[key], fontWeight: resolveFontWeight(fontFamily, style[key]?.fontWeight ?? style.fontWeight) } });
    }
    onUpdate(patch);
  }
  const effects = [
    { key: "stroke", label: "Outline", enabled: "strokeEnabled", fields: [
      { key: "strokeColor", label: "Color", type: "color" }, { key: "strokeWidth", label: "Width, px", min: 0, max: 30, step: .5 },
      { key: "strokeOpacity", label: "Opacity, %", min: 0, max: 100, factor: 100 },
    ] },
    { key: "shadow", label: "Shadow", enabled: "shadowEnabled", fields: [
      { key: "shadowColor", label: "Color", type: "color" }, { key: "shadowOpacity", label: "Opacity, %", min: 0, max: 100, factor: 100 },
      { key: "shadowBlur", label: "Blur, px", min: 0, max: 100 }, { key: "shadowOffsetX", label: "X offset, px", min: -100, max: 100 },
      { key: "shadowOffsetY", label: "Y offset, px", min: -100, max: 100 },
    ] },
    { key: "bubble", label: "Word bubble", enabled: "bubble", fields: [
      { key: "bubbleColor", label: "Color", type: "color" }, { key: "bubbleOpacity", label: "Opacity, %", min: 0, max: 100, factor: 100 },
      { key: "padding", label: "Padding, px", min: 0, max: 100 }, { key: "radius", label: "Corners, px", min: 0, max: 200 },
    ] },
  ] as const;
</script>

<fieldset class="text-style" {disabled} aria-label="Caption text styling">
  <div class="text-style__scope" role="group" aria-label="Words to style">
    {#each [{ value: "all", label: "All words" }, { value: "spoken", label: "Past" }, { value: "current", label: "Current" }, { value: "upcoming", label: "Next" }] as item}
      <button class="text-style__scope-button" aria-pressed={scope === item.value} onclick={() => onScopeChange(item.value as TextStyleScope)}>{item.label}</button>
    {/each}
  </div>

  <div class="text-style__font-row">
    <FontPicker value={mixed('fontFamily') ? '' : appearance.fontFamily} {fonts} placeholder={mixed('fontFamily') ? 'Mixed fonts' : 'Font family'} loading={fontsLoading} error={fontsError} onOpen={() => { if (!fonts.length) onRefreshFonts?.(); }} onRetry={onRefreshFonts} onSelect={selectFont} />
    <div class="text-style__number" title={scope === "all" ? "Base font size, px — keeps relative word sizes" : "Font size, px"}><ScrubbableNumber label={scope === "all" ? "Base font size, px" : "Font size, px"} min={8} max={sizeMax} step={.5} value={Number(appearance.fontSize.toFixed(2))} {disabled} onChange={fontSize => update({ fontSize })} /><span aria-hidden="true">px</span></div>
    <button class="text-style__toggle" aria-label="Bold" title={boldDisabled ? 'This font has no heavier installed weight' : boldState === true ? 'Turn off the bolder step and follow All words' : `Next supported weight above All words (${style.fontWeight})`} aria-pressed={boldState} disabled={boldDisabled} onclick={() => onUpdate(textStyleBoldPatch(style, scope))}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3.5h4a3.25 3.25 0 0 1 0 6.5H6m4 0a3.25 3.25 0 0 1 0 6.5H6v-13"/></svg></button>
    <button class="text-style__toggle" aria-label="Italic" title="Italic — uses a synthetic slant when needed" aria-pressed={mixed("italic") ? "mixed" : appearance.italic} onclick={() => update({ italic: mixed("italic") || !appearance.italic })}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3.5h8M4 16.5h8M12 3.5l-4 13"/></svg></button>
    <input class="text-style__color" type="color" value={appearance.color} aria-label="Text color" title={mixed("color") ? "Text color — mixed word colors" : "Text color"} oninput={(event) => update({ color: value(event) })} />
  </div>

  <div class="text-style__format-row">
    <select class="text-style__input" aria-label="Font weight" disabled={!weights.length} title={weights.length ? scope === "all" ? "All words font weight" : "Font weight — absolute override" : "Select an installed font to choose its supported weights"} value={appearance.fontWeight} onchange={(event) => update({ fontWeight: Number(value(event)) })}>{#if !weights.length}<option value={appearance.fontWeight}>{appearance.fontWeight}</option>{:else}{#if !weights.includes(appearance.fontWeight)}<option value={appearance.fontWeight} disabled hidden>{appearance.fontWeight}</option>{/if}{#each weights as weight}<option value={weight}>{weight}</option>{/each}{/if}</select>
    <select class="text-style__input" aria-label="Text case" title="Text case" disabled={nativeMode && scope !== "all"} value={mixed("textTransform") ? "" : appearance.textTransform} onchange={(event) => update({ textTransform: value(event) as WordAppearance["textTransform"] })}>{#if mixed("textTransform")}<option value="" disabled>Mixed case</option>{/if}<option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="titlecase">Title Case</option></select>
    <div class="text-style__number" title="Text opacity, %"><ScrubbableNumber label="Text opacity, %" min={0} max={100} value={mixed("opacity") ? null : Math.round(appearance.opacity * 100)} {disabled} onChange={opacity => update({ opacity: opacity / 100 })} /><span aria-hidden="true">%</span></div>
    {#if scope==='all'}<div class="text-style__alignment">{#if nativeMode}{@render nativeAlignment?.()}{:else}<AlignmentButtons value={style.textAlign==='left'||style.textAlign==='right'?style.textAlign:'center'} {disabled} onChange={textAlign=>onUpdate({textAlign})}/>{/if}</div>{/if}
  </div>

  <div class="text-style__tabs" role="tablist" aria-label="Text settings">
    {#each tabs as item,index}
      <button class="text-style__tab" id={`${componentId}-tab-${item.key}`} role="tab" aria-selected={expanded===item.key} tabindex={expanded===item.key?0:-1} aria-controls={`${componentId}-${item.key}`} onclick={()=>expanded=item.key} onkeydown={event=>tabKey(event,index)}>{item.label}</button>
    {/each}
  </div>

  {#if expanded === "spacing"}
    <div class="text-style__expanded" id={`${componentId}-spacing`} role="tabpanel" aria-labelledby={`${componentId}-tab-spacing`} tabindex="0">
      <div class="caption-controls">
        {#if !nativeMode}<div class="caption-field"><span>Letter spacing, px</span><ScrubbableNumber label="Letter spacing, px" min={-10} max={40} step={.5} {disabled} value={mixed("letterSpacing") ? null : appearance.letterSpacing} onChange={letterSpacing => update({ letterSpacing })} /></div>{/if}
        <div class="caption-field"><span>{nativeMode?"Word spacing, px":"Word spacing, %"}</span><ScrubbableNumber label={nativeMode?"Word spacing, px":"Word spacing, %"} min={0} max={300} {disabled} value={style.wordSpacing ?? null} placeholder="Original" onChange={wordSpacing => onUpdate({ wordSpacing })} /></div>
        <div class="caption-field"><span>Line height</span><ScrubbableNumber label="Line height" min={.6} max={3} step={.05} value={style.lineHeight} {disabled} onChange={lineHeight => onUpdate({ lineHeight })} /></div>
        {#if style.wordSpacing === undefined && !nativeMode}<button class="caption-button" onclick={() => onUpdate({ wordSpacing: 100 })}>Use normal spacing</button>{/if}
      </div>
      <p class="caption-help">Word spacing and line height apply to all words.</p>
    </div>
  {/if}

  {#each effects as effect}
    {#if expanded === effect.key}
      <div class="text-style__expanded" id={`${componentId}-${effect.key}`} role="tabpanel" aria-labelledby={`${componentId}-tab-${effect.key}`} tabindex="0">
        <div class="caption-controls">
          <label class="caption-check"><input type="checkbox" {disabled} checked={appearance[effect.enabled]} aria-checked={mixed(effect.enabled) ? "mixed" : appearance[effect.enabled]} onchange={event=>toggleEffect(effect.key,event.currentTarget.checked)} /><span>{effect.label}</span></label>
          {#each effect.fields as raw}
            {@const field = raw as { key: keyof WordAppearance; label: string; type?: string; min?: number; max?: number; step?: number; factor?: number }}
            {#if field.type === "color"}
              <label class="caption-field"><span>{field.label}</span><input type="color" disabled={disabled || !appearance[effect.enabled] && !mixed(effect.enabled)} value={appearance[field.key] as string} onchange={(event) => update({ [field.key]: value(event) })} /></label>
            {:else}
              <div class="caption-field"><span>{field.label}</span><ScrubbableNumber label={`${effect.label} ${field.label}`} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} disabled={disabled || !appearance[effect.enabled] && !mixed(effect.enabled)} value={mixed(field.key) ? null : Number(appearance[field.key]) * (field.factor ?? 1)} onChange={next => update({ [field.key]: next / (field.factor ?? 1) })} /></div>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  {/each}

  {#if expanded === "layout"}
    <div class="text-style__expanded" id={`${componentId}-layout`} role="tabpanel" aria-labelledby={`${componentId}-tab-layout`} tabindex="0">
      {#if nativeMode}{@render nativeLayout?.()}{:else}
      <div class="caption-controls">
        <div class="caption-field"><span>Line width, % of frame</span><ScrubbableNumber label="Line width, % of frame" min={10} max={100} value={Math.round(style.maxWidth * 100)} {disabled} onChange={next => onUpdate({ maxWidth: next / 100 })} /></div>
      </div>
      <label class="caption-check"><input type="checkbox" checked={style.backgroundEnabled} onchange={(event) => onUpdate({ backgroundEnabled: event.currentTarget.checked })} /><span>Whole caption background</span></label>
      {#if style.backgroundEnabled}
        <div class="caption-controls">
          <label class="caption-field"><span>Background color</span><input type="color" value={style.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: value(event) })} /></label>
          <div class="caption-field"><span>Opacity, %</span><ScrubbableNumber label="Opacity, %" min={0} max={100} value={Math.round(style.backgroundOpacity * 100)} {disabled} onChange={next => onUpdate({ backgroundOpacity: next / 100 })} /></div>
          <div class="caption-field"><span>Padding, px</span><ScrubbableNumber label="Padding, px" min={0} max={100} value={style.backgroundPadding} {disabled} onChange={next => onUpdate({ backgroundPadding: next })} /></div>
          <div class="caption-field"><span>Corners, px</span><ScrubbableNumber label="Corners, px" min={0} max={200} value={style.backgroundRadius} {disabled} onChange={next => onUpdate({ backgroundRadius: next })} /></div>
        </div>
      {/if}
      {/if}
    </div>
  {/if}
</fieldset>

<style>
  .text-style { display: flex; flex-direction: column; gap: var(--caption-space-xs); min-inline-size: 0; container-type:inline-size; margin: 0; padding: var(--caption-space-m) var(--caption-space-l); border: 0; border-block-end: 1px solid var(--color-panel-border); }
  .text-style__scope { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-block-end: var(--caption-space-xs); }
  .text-style__scope-button { min-inline-size: 0; min-block-size: 2rem; padding: var(--caption-space-xs); border: 1px solid var(--color-panel-border); background: transparent; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); cursor: pointer; & + & { border-inline-start: 0; } &[aria-pressed="true"] { background: var(--color-selection); color: var(--color-accent); } &:hover:enabled { background: var(--color-surface-overlay); } &:disabled { opacity: .5; cursor: default; } }
  .text-style__font-row { display: grid; grid-template-columns: minmax(0, 1fr) 5.5rem repeat(3, 2.25rem); gap: var(--caption-space-xs); }
  .text-style__format-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 5.25rem; gap: var(--caption-space-xs); }
  .text-style__alignment {grid-column:1/-1;justify-self:end;@container (min-width:36rem) {grid-column:auto;}}
  .text-style__format-row { @container (min-width:36rem) {grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) 5.25rem auto;} }
  .text-style__input, .text-style__number, .text-style__toggle, .text-style__color { min-inline-size: 0; min-block-size: 2.25rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); color: var(--color-panel-text); font-size: var(--caption-type-s); &:disabled { opacity: .5; cursor: default; } }
  .text-style__input { inline-size: 100%; padding: .3rem .4rem; }
  .text-style__number { display: flex; align-items: center; padding-inline-end: var(--caption-space-xs); & :global(.scrubbable-number) { flex: 1; } & :global(.scrubbable-number__value), & :global(.scrubbable-number__input) { border: 0; background: transparent; } & span { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); } }
  .text-style__toggle { display: inline-flex; align-items: center; justify-content: center; padding: .4rem; cursor: pointer; background: var(--color-surface-raised); & svg { inline-size: 1.25rem; block-size: 1.25rem; } &[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-selection); color: var(--color-accent); } &[aria-pressed="mixed"] { color: var(--color-accent); text-decoration: underline; } &:hover:enabled { background: var(--color-surface-overlay); } }
  .text-style__color { inline-size: 2.25rem; padding: var(--caption-space-xs); cursor: pointer; }
  .text-style__tabs { display:flex; border-block-end:1px solid var(--color-panel-border); }
  .text-style__tab { flex:1;min-inline-size:0;min-block-size:2rem;padding:var(--caption-space-xs);border:0;border-block-end:2px solid transparent;background:transparent;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);cursor:pointer;&[aria-selected="true"] {border-block-end-color:var(--color-accent);color:var(--color-accent);}&:hover:enabled {color:var(--color-panel-text);}&:focus-visible {outline:1px solid var(--color-accent);outline-offset:-2px;}&:disabled {opacity:.5;cursor:default;} }
  .text-style__expanded { display: flex; flex-direction: column; gap: var(--caption-space-s); padding-block: var(--caption-space-s); & .caption-controls {grid-template-columns:repeat(auto-fit,minmax(min(100%,7rem),1fr));gap:var(--caption-space-s);align-items:end;} & .caption-check {min-block-size:2.25rem;align-self:end;font-size:var(--caption-type-s);} & .caption-help {margin:0;} }
</style>
