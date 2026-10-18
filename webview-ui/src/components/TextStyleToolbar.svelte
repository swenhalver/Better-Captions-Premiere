<script module lang="ts">
  import type { StyleConfig, WordAppearance } from "../lib/types";
  import { resolveAppearance, type WordStateKey, type ResolvedAppearance } from "../lib/appearance";

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
      fontWeight: style.fontWeight, color: style.textColor, textTransform: style.textTransform,
      strokeEnabled: style.strokeEnabled, strokeColor: style.strokeColor, strokeWidth: style.strokeWidth, strokeOpacity: style.strokeOpacity,
      shadowEnabled: style.shadowEnabled, shadowColor: style.shadowColor, shadowOpacity: style.shadowOpacity,
      shadowBlur: style.shadowBlur, shadowOffsetX: style.shadowOffsetX, shadowOffsetY: style.shadowOffsetY };
    for (const key of Object.keys(appearance) as (keyof ResolvedAppearance)[]) {
      if (key !== "fontSize" && key !== "sizeScale" && key !== "fontWeight" && states.every(state => state[key] === states[0][key])) {
        (appearance as Record<string, unknown>)[key] = states[0][key];
      }
    }
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
    return style.fontWeight >= 1000 && textStyleBoldState(style, scope) === false;
  }

  /** B is one relative weight step; it never changes the All words baseline. */
  export function textStyleBoldPatch(style: StyleConfig, scope: TextStyleScope): Partial<StyleConfig> {
    const offset = style.fontWeight >= 1000 || textStyleBoldState(style, scope) === true ? 0 : 100;
    const keys = scope === "all" ? stateKeys : [scopeKeys[scope]];
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = { ...style[key], fontWeightOffset: offset };
    return result as Partial<StyleConfig>;
  }
</script>

<script lang="ts">
  interface Props { style: StyleConfig; fonts?: string[]; scope?: TextStyleScope; onScopeChange: (scope: TextStyleScope) => void; onUpdate: (updates: Partial<StyleConfig>) => void; disabled?: boolean; nativeMode?: boolean; }
  let { style, fonts = [], scope = "all", onScopeChange, onUpdate, disabled = false, nativeMode = false }: Props = $props();
  const componentId = $props.id();
  let appearance = $derived(textStyleAppearance(style, scope));
  let boldState = $derived(textStyleBoldState(style, scope));
  let expanded = $state<"spacing" | "stroke" | "shadow" | "bubble" | "layout" | null>(null);
  let sizeMax = $derived(scope === "all" ? 400 : 1200);
  const mixed = (key: keyof WordAppearance) => textStyleMixed(style, scope, key);
  const value = (event: Event) => (event.currentTarget as HTMLInputElement).value;
  function update(patch: Partial<WordAppearance>) { onUpdate(textStylePatch(style, scope, patch)); }
  function numeric(event: Event, min: number, max: number, apply: (value: number) => void, factor = 1) {
    const number = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(number)) apply(clamp(number, min, max) / factor);
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
    <input class="text-style__input" list={`${componentId}-fonts`} aria-label="Font family" title="Font family" maxlength="160" value={mixed("fontFamily") ? "" : appearance.fontFamily} placeholder={mixed("fontFamily") ? "Mixed fonts" : "Font family"} onchange={(event) => { const font = value(event).trim(); if (font) update({ fontFamily: font }); }} />
    <datalist id={`${componentId}-fonts`}>{#each fonts as font}<option value={font}></option>{/each}</datalist>
    <label class="text-style__number" title={scope === "all" ? "Base font size, px — keeps relative word sizes" : "Font size, px"}><input type="number" aria-label={scope === "all" ? "Base font size, px" : "Font size, px"} min="8" max={sizeMax} step=".5" value={Number(appearance.fontSize.toFixed(2))} onchange={(event) => numeric(event, 8, sizeMax, fontSize => update({ fontSize }))} /><span aria-hidden="true">px</span></label>
    <button class="text-style__toggle" aria-label="Bold" title={style.fontWeight >= 1000 ? boldState === false ? "All words is already at weight 1000; no heavier step is available" : "Turn off the +100 weight step and follow All words" : `One step bolder (+100) than All words (${style.fontWeight})`} aria-pressed={boldState} disabled={nativeMode || textStyleBoldDisabled(style, scope)} onclick={() => onUpdate(textStyleBoldPatch(style, scope))}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3.5h4a3.25 3.25 0 0 1 0 6.5H6m4 0a3.25 3.25 0 0 1 0 6.5H6v-13"/></svg></button>
    <button class="text-style__toggle" aria-label="Italic" title={nativeMode ? "Italic is unavailable in the experimental native renderer" : "Italic"} disabled={nativeMode} aria-pressed={mixed("italic") ? "mixed" : appearance.italic} onclick={() => update({ italic: mixed("italic") || !appearance.italic })}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3.5h8M4 16.5h8M12 3.5l-4 13"/></svg></button>
    <input class="text-style__color" type="color" value={appearance.color} aria-label="Text color" title={mixed("color") ? "Text color — mixed word colors" : "Text color"} oninput={(event) => update({ color: value(event) })} />
  </div>

  <div class="text-style__format-row">
    <select class="text-style__input" aria-label="Font weight" disabled={nativeMode} title={scope === "all" ? "All words font weight" : "Font weight — absolute override"} value={scope === "all" ? style.fontWeight : appearance.fontWeight} onchange={(event) => update({ fontWeight: Number(value(event)) })}>{#each [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as weight}<option value={weight}>{weight}</option>{/each}</select>
    <select class="text-style__input" aria-label="Text case" title="Text case" disabled={nativeMode && scope !== "all"} value={mixed("textTransform") ? "" : appearance.textTransform} onchange={(event) => update({ textTransform: value(event) as WordAppearance["textTransform"] })}>{#if mixed("textTransform")}<option value="" disabled>Mixed case</option>{/if}<option value="none">As typed</option><option value="uppercase" disabled={nativeMode}>UPPERCASE</option><option value="lowercase" disabled={nativeMode}>lowercase</option><option value="titlecase">Title Case</option></select>
    <label class="text-style__number" title="Text opacity, %"><input type="number" aria-label="Text opacity, %" min="0" max="100" value={mixed("opacity") ? "" : Math.round(appearance.opacity * 100)} placeholder="Mixed" onchange={(event) => numeric(event, 0, 100, opacity => update({ opacity }), 100)} /><span aria-hidden="true">%</span></label>
  </div>

  <div class="text-style__more" role="group" aria-label="More text settings">
    {#each [{ key: "spacing", label: "Spacing" }, { key: "stroke", label: "Outline" }, { key: "shadow", label: "Shadow" }, { key: "bubble", label: "Bubble" }, { key: "layout", label: "Layout" }] as item}
      <button class="text-style__more-button" disabled={nativeMode && item.key === "layout"} aria-expanded={expanded === item.key} aria-controls={`${componentId}-${item.key}`} onclick={() => expanded = expanded === item.key ? null : item.key as typeof expanded}>{item.label}</button>
    {/each}
  </div>

  {#if expanded === "spacing"}
    <div class="text-style__expanded" id={`${componentId}-spacing`} role="group" aria-label="Text spacing">
      <div class="caption-controls">
        <label class="caption-field"><span>Letter spacing, px</span><input type="number" min="-10" max="40" step=".5" disabled={nativeMode} value={mixed("letterSpacing") ? "" : appearance.letterSpacing} placeholder="Mixed" onchange={(event) => numeric(event, -10, 40, letterSpacing => update({ letterSpacing }))} /></label>
        <label class="caption-field"><span>Word spacing, %</span><input type="number" min="0" max="300" disabled={nativeMode} value={style.wordSpacing ?? ""} placeholder="Original" onchange={(event) => numeric(event, 0, 300, wordSpacing => onUpdate({ wordSpacing }))} /></label>
        <label class="caption-field"><span>Line height</span><input type="number" min=".6" max="3" step=".05" value={style.lineHeight} onchange={(event) => numeric(event, .6, 3, lineHeight => onUpdate({ lineHeight }))} /></label>
        {#if style.wordSpacing === undefined && !nativeMode}<button class="caption-button" onclick={() => onUpdate({ wordSpacing: 100 })}>Use normal spacing</button>{/if}
      </div>
      <p class="caption-help">Word spacing and line height apply to all words.</p>
    </div>
  {/if}

  {#each effects as effect}
    {#if expanded === effect.key}
      <div class="text-style__expanded" id={`${componentId}-${effect.key}`} role="group" aria-label={effect.label}>
        <label class="caption-check"><input type="checkbox" disabled={nativeMode && effect.key !== "bubble"} checked={appearance[effect.enabled]} aria-checked={mixed(effect.enabled) ? "mixed" : appearance[effect.enabled]} onchange={(event) => update({ [effect.enabled]: event.currentTarget.checked })} /><span>{effect.label}</span></label>
        <div class="caption-controls">
          {#each effect.fields as raw}
            {@const field = raw as { key: keyof WordAppearance; label: string; type?: string; min?: number; max?: number; step?: number; factor?: number }}
            <label class="caption-field"><span>{field.label}</span><input type={field.type ?? "number"} min={field.min} max={field.max} step={field.step ?? 1} disabled={!nativeMode && !appearance[effect.enabled] && !mixed(effect.enabled)} value={field.type === "color" ? appearance[field.key] as string : mixed(field.key) ? "" : Number(appearance[field.key]) * (field.factor ?? 1)} placeholder={field.type === "color" ? undefined : "Mixed"} onchange={(event) => field.type === "color" ? update({ [field.key]: value(event) }) : numeric(event, field.min ?? 0, field.max ?? 100, next => update({ [field.key]: next }), field.factor ?? 1)} /></label>
          {/each}
        </div>
      </div>
    {/if}
  {/each}

  {#if expanded === "layout"}
    <div class="text-style__expanded" id={`${componentId}-layout`} role="group" aria-label="Caption layout">
      <div class="caption-controls">
        <label class="caption-field"><span>Alignment</span><select value={style.textAlign} onchange={(event) => onUpdate({ textAlign: value(event) as CanvasTextAlign })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label class="caption-field"><span>Line width, % of frame</span><input type="number" min="10" max="100" value={Math.round(style.maxWidth * 100)} onchange={(event) => numeric(event, 10, 100, maxWidth => onUpdate({ maxWidth }), 100)} /></label>
      </div>
      <label class="caption-check"><input type="checkbox" checked={style.backgroundEnabled} onchange={(event) => onUpdate({ backgroundEnabled: event.currentTarget.checked })} /><span>Whole caption background</span></label>
      {#if style.backgroundEnabled}
        <div class="caption-controls">
          <label class="caption-field"><span>Background color</span><input type="color" value={style.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: value(event) })} /></label>
          <label class="caption-field"><span>Opacity, %</span><input type="number" min="0" max="100" value={Math.round(style.backgroundOpacity * 100)} onchange={(event) => numeric(event, 0, 100, backgroundOpacity => onUpdate({ backgroundOpacity }), 100)} /></label>
          <label class="caption-field"><span>Padding, px</span><input type="number" min="0" max="100" value={style.backgroundPadding} onchange={(event) => numeric(event, 0, 100, backgroundPadding => onUpdate({ backgroundPadding }))} /></label>
          <label class="caption-field"><span>Corners, px</span><input type="number" min="0" max="200" value={style.backgroundRadius} onchange={(event) => numeric(event, 0, 200, backgroundRadius => onUpdate({ backgroundRadius }))} /></label>
        </div>
      {/if}
    </div>
  {/if}
</fieldset>

<style>
  .text-style { display: flex; flex-direction: column; gap: var(--caption-space-xs); min-inline-size: 0; margin: 0; padding: var(--caption-space-m) var(--caption-space-l); border: 0; border-block-end: 1px solid var(--color-panel-border); }
  .text-style__scope { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-block-end: var(--caption-space-xs); }
  .text-style__scope-button { min-inline-size: 0; min-block-size: 2rem; padding: var(--caption-space-xs); border: 1px solid var(--color-panel-border); background: transparent; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); cursor: pointer; & + & { border-inline-start: 0; } &[aria-pressed="true"] { background: var(--color-selection); color: var(--color-accent); } &:hover:enabled { background: var(--color-surface-overlay); } &:disabled { opacity: .5; cursor: default; } }
  .text-style__font-row { display: grid; grid-template-columns: minmax(0, 1fr) 5.5rem repeat(3, 2.25rem); gap: var(--caption-space-xs); }
  .text-style__format-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) 5.25rem; gap: var(--caption-space-xs); }
  .text-style__input, .text-style__number, .text-style__toggle, .text-style__color { min-inline-size: 0; min-block-size: 2.25rem; border: 1px solid var(--color-panel-border); border-radius: var(--caption-radius); background: var(--color-input); color: var(--color-panel-text); font-size: var(--caption-type-s); &:disabled { opacity: .5; cursor: default; } }
  .text-style__input { inline-size: 100%; padding: .3rem .4rem; }
  .text-style__number { display: flex; align-items: center; padding-inline-end: var(--caption-space-xs); & input { inline-size: 100%; min-inline-size: 0; border: 0; background: transparent; color: inherit; padding: .3rem .2rem .3rem .4rem; font-variant-numeric: tabular-nums; } & span { color: var(--color-panel-secondary); font-size: var(--caption-type-xs); } }
  .text-style__toggle { display: inline-flex; align-items: center; justify-content: center; padding: .4rem; cursor: pointer; background: var(--color-surface-raised); & svg { inline-size: 1.25rem; block-size: 1.25rem; } &[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-selection); color: var(--color-accent); } &[aria-pressed="mixed"] { color: var(--color-accent); text-decoration: underline; } &:hover:enabled { background: var(--color-surface-overlay); } }
  .text-style__color { inline-size: 2.25rem; padding: var(--caption-space-xs); cursor: pointer; }
  .text-style__more { display: flex; flex-wrap: wrap; gap: var(--caption-space-xs); }
  .text-style__more-button { flex: 1; min-block-size: 2rem; padding: var(--caption-space-xs); border: 1px solid transparent; border-radius: var(--caption-radius); background: transparent; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); cursor: pointer; &[aria-expanded="true"] { border-color: var(--color-panel-border); color: var(--color-panel-text); background: var(--color-surface-raised); } &:hover:enabled { background: var(--color-surface-overlay); color: var(--color-panel-text); } &:disabled { opacity: .5; cursor: default; } }
  .text-style__expanded { display: flex; flex-direction: column; gap: var(--caption-space-s); padding-block: var(--caption-space-s); border-block-start: 1px solid var(--color-panel-border); & .caption-controls { gap: var(--caption-space-s); } & .caption-check { font-size: var(--caption-type-s); } }
</style>
