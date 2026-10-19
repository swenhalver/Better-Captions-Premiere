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

  export function textStyleSizeStep(style: StyleConfig, scope: TextStyleScope, direction: -1 | 1): Partial<StyleConfig> {
    const next = clamp(textStyleAppearance(style, scope).fontSize + direction, 8, scope === 'all' ? 400 : 1200);
    return textStylePatch(style, scope, { fontSize: next });
  }

  /** A color-picker gesture changes only its edited channel, preserving mixed states. */
  export function textStyleColorPatch(appearance: ResolvedAppearance, kind: 'text' | 'bubble' | 'stroke' | 'shadow', next: { color: string; opacity: number }): Partial<WordAppearance> {
    const fields = { text: ['color', 'opacity'], bubble: ['bubbleColor', 'bubbleOpacity'], stroke: ['strokeColor', 'strokeOpacity'], shadow: ['shadowColor', 'shadowOpacity'] } as const;
    const [colorKey, opacityKey] = fields[kind];
    const patch: Partial<WordAppearance> = {};
    if (next.color.toLowerCase() !== appearance[colorKey].toLowerCase()) patch[colorKey] = next.color;
    if (Math.abs(next.opacity - appearance[opacityKey]) > 1e-9) patch[opacityKey] = next.opacity;
    if (kind === 'bubble' && colorKey in patch && !appearance.bubble) patch.bubble = true;
    return patch;
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
  import { tick, type Snippet } from 'svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import HslaColorPicker from './HslaColorPicker.svelte';
  import LucideIcon from './LucideIcon.svelte';
  import FontPicker from './FontPicker.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  interface Props { style: StyleConfig; fonts?: string[]; fontCatalog?: InstalledFont[]; fontsLoading?: boolean; fontsError?: string; onRefreshFonts?: () => void; scope?: TextStyleScope; onScopeChange: (scope: TextStyleScope) => void; onUpdate: (updates: Partial<StyleConfig>) => void; disabled?: boolean; nativeMode?: boolean; nativeLayout?: Snippet; nativeAlignment?: Snippet; }
  let { style, fonts = [], fontCatalog = [], fontsLoading = false, fontsError = '', onRefreshFonts, scope = "all", onScopeChange, onUpdate, disabled = false, nativeMode = false, nativeLayout, nativeAlignment }: Props = $props();
  const componentId = $props.id();
  let appearance = $derived.by(() => { void fontCatalog; return textStyleAppearance(style, scope); });
  let boldState = $derived(textStyleBoldState(style, scope));
  let weights = $derived(fontWeightOptions(appearance.fontFamily, fontCatalog));
  let boldDisabled = $derived.by(() => { void fontCatalog; return !weights.length && boldState === false || textStyleBoldDisabled(style, scope); });
  type DetailTab = "spacing" | "stroke" | "shadow" | "layout";
  let expanded = $state<DetailTab>("spacing");
  const tabs: {key:DetailTab;label:string}[]=[{key:"spacing",label:"Spacing"},{key:"stroke",label:"Outline"},{key:"shadow",label:"Shadow"},{key:"layout",label:"Layout"}];
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
  function update(patch: Partial<WordAppearance>) { if (Object.keys(patch).length) onUpdate(textStylePatch(style, scope, patch)); }
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
  type PopoverKind = 'text' | 'bubble' | 'stroke' | 'shadow';
  let popover = $state<PopoverKind | null>(null);
  const popoverLabel = $derived(popover === 'text' ? 'Text color and opacity' : popover === 'bubble' ? 'Word background and bubble settings' : popover === 'stroke' ? 'Outline color and opacity' : 'Shadow color and opacity');
  let popoverPosition = $state('');
  let popoverTrigger: HTMLButtonElement | undefined;
  let popup: HTMLDivElement | undefined;
  function placePopover() {
    if (!popover || !popoverTrigger) return;
    const rect = popoverTrigger.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const height = popover === 'bubble' ? 440 : popover === 'stroke' ? 320 : 220;
    const above = rect.top > height + 8 && window.innerHeight - rect.bottom < height + 8;
    popoverPosition = `left:${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px;width:${width}px;max-height:${Math.max(80, (above ? rect.top : window.innerHeight - rect.bottom) - 12)}px;${above ? `bottom:${window.innerHeight - rect.top + 4}px` : `top:${rect.bottom + 4}px`}`;
  }
  function portal(node: HTMLDivElement) {
    popup = node;
    document.body.appendChild(node);
    placePopover();
    return { destroy() { node.remove(); popup = undefined; } };
  }
  function openPopover(next: PopoverKind, trigger: HTMLButtonElement, keyboard = false) {
    popoverTrigger = trigger;
    popover = popover === next ? null : next;
    placePopover();
    if (popover && keyboard) void tick().then(() => popup?.querySelector<HTMLInputElement>('input')?.focus());
  }
  function closePopover() { popover = null; }
  function outsidePopover(event: PointerEvent) {
    const target = event.target as Node;
    if (popover && !popup?.contains(target) && !popoverTrigger?.contains(target)) closePopover();
  }
  function leavePopover(event: FocusEvent) {
    const target = event.target as Node;
    if (popover && !popup?.contains(target) && !popoverTrigger?.contains(target)) closePopover();
  }
  function popoverKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && popover) {
      event.preventDefault();
      closePopover();
      popoverTrigger?.focus();
    }
  }
  $effect(() => { if (disabled) closePopover(); });
  $effect(() => { void scope; closePopover(); });
  const effects = [
    { key: "stroke", label: "Outline", enabled: "strokeEnabled", fields: [
      { key: "strokeColor", label: "Color", type: "color" }, { key: "strokeWidth", label: "Width, px", min: 0, max: 30, step: .5 },
    ] },
    { key: "shadow", label: "Shadow", enabled: "shadowEnabled", fields: [
      { key: "shadowColor", label: "Color", type: "color" },
      { key: "shadowBlur", label: "Blur, px", min: 0, max: 100 }, { key: "shadowOffsetX", label: "X offset, px", min: -100, max: 100 },
      { key: "shadowOffsetY", label: "Y offset, px", min: -100, max: 100 },
    ] },
  ] as const;
</script>

<svelte:window onfocusin={leavePopover} onpointerdown={outsidePopover} onkeydown={popoverKey} onresize={placePopover} onscroll={placePopover} />

<fieldset class="text-style" {disabled} aria-label="Caption text styling">
  <div class="text-style__scope" role="group" aria-label="Words to style">
    {#each [{ value: "all", label: "All words" }, { value: "spoken", label: "Past" }, { value: "current", label: "Current" }, { value: "upcoming", label: "Next" }] as item}
      <button class="text-style__scope-button" aria-pressed={scope === item.value} onclick={() => onScopeChange(item.value as TextStyleScope)}>{item.label}</button>
    {/each}
  </div>

  <div class="text-style__ribbon" aria-label="Text formatting">
    <div class="text-style__case-wrap" title="Text case">
      <span class="text-style__case-display" aria-hidden="true">Aa<LucideIcon name="chevron-down"/></span>
      <select class="text-style__case" aria-label="Text case" disabled={nativeMode && scope !== "all"} value={mixed("textTransform") ? "" : appearance.textTransform} onchange={(event) => update({ textTransform: value(event) as WordAppearance["textTransform"] })}>{#if mixed("textTransform")}<option value="" disabled>Mixed case</option>{/if}<option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="titlecase">Title Case</option></select>
    </div>
    <div class="text-style__segment" role="group" aria-label="Emphasis">
      <button class="text-style__toggle" aria-label="Bold" title={boldDisabled ? 'This font has no heavier installed weight' : boldState === true ? 'Turn off the bolder step and follow All words' : `Next supported weight above All words (${style.fontWeight})`} aria-pressed={boldState} disabled={boldDisabled} onclick={() => onUpdate(textStyleBoldPatch(style, scope))}><LucideIcon name="bold"/></button>
      <button class="text-style__toggle" aria-label="Italic" title="Italic — uses a synthetic slant when needed" aria-pressed={mixed("italic") ? "mixed" : appearance.italic} onclick={() => update({ italic: mixed("italic") || !appearance.italic })}><LucideIcon name="italic"/></button>
      <button class="text-style__toggle" aria-label="Underline" title="Underline" aria-pressed={mixed('underline') ? 'mixed' : appearance.underline} onclick={() => update({ underline: mixed('underline') || !appearance.underline })}><LucideIcon name="underline"/></button>
    </div>
    <button class="text-style__swatch" type="button" aria-label="Text color and opacity" title={mixed("color") ? "Text color — mixed word colors" : "Text color and opacity"} aria-expanded={popover === 'text'} aria-controls={`${componentId}-color-popover`} style:background={appearance.color} onclick={event => openPopover('text', event.currentTarget, event.detail === 0)}></button>
    <button class="text-style__background" type="button" aria-label="Word background and bubble settings" title="Word background and bubble settings" aria-expanded={popover === 'bubble'} aria-controls={`${componentId}-color-popover`} style:background={appearance.bubble ? appearance.bubbleColor : undefined} onclick={event => openPopover('bubble', event.currentTarget, event.detail === 0)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 18 6-13 6 13M8 14h8"/>{#if !appearance.bubble}<path class="text-style__slash" d="m4 20 16-16"/>{/if}</svg></button>
    <button class="text-style__outline" type="button" aria-label="Outline settings" title="Outline settings" aria-expanded={popover === 'stroke'} aria-controls={`${componentId}-color-popover`} onclick={event => openPopover('stroke', event.currentTarget, event.detail === 0)}><LucideIcon name="outline" fill={mixed('color')?'currentColor':appearance.color} stroke={mixed('strokeColor')?'currentColor':appearance.strokeColor} fillOpacity={mixed('opacity')?1:appearance.opacity} strokeOpacity={mixed('strokeOpacity')?1:appearance.strokeOpacity}/></button>
    <div class="text-style__font-group">
      <div class="text-style__family"><FontPicker value={mixed('fontFamily') ? '' : appearance.fontFamily} {fonts} placeholder={mixed('fontFamily') ? 'Mixed fonts' : 'Font family'} loading={fontsLoading} error={fontsError} onOpen={() => { closePopover(); if (!fonts.length) onRefreshFonts?.(); }} onRetry={onRefreshFonts} onSelect={selectFont} /></div>
      <select class="text-style__weight" aria-label="Font weight" disabled={!weights.length} title={weights.length ? scope === "all" ? "All words font weight" : "Font weight — absolute override" : "Select an installed font to choose its supported weights"} value={appearance.fontWeight} onchange={(event) => update({ fontWeight: Number(value(event)) })}>{#if !weights.length}<option value={appearance.fontWeight}>{appearance.fontWeight}</option>{:else}{#if !weights.includes(appearance.fontWeight)}<option value={appearance.fontWeight} disabled hidden>{appearance.fontWeight}</option>{/if}{#each weights as weight}<option value={weight}>{weight}</option>{/each}{/if}</select>
      <div class="text-style__number" title={scope === "all" ? "Base font size — keeps relative word sizes" : "Font size"}><button class="text-style__size-step" type="button" aria-label="Decrease font size" title="Decrease font size" disabled={disabled || appearance.fontSize <= 8} onclick={() => onUpdate(textStyleSizeStep(style, scope, -1))}><LucideIcon name="a-arrow-down"/></button><ScrubbableNumber label={scope === "all" ? "Base font size, px" : "Font size, px"} min={8} max={sizeMax} step={.5} value={Number(appearance.fontSize.toFixed(2))} {disabled} onChange={fontSize => update({ fontSize })} /><button class="text-style__size-step" type="button" aria-label="Increase font size" title="Increase font size" disabled={disabled || appearance.fontSize >= sizeMax} onclick={() => onUpdate(textStyleSizeStep(style, scope, 1))}><LucideIcon name="a-arrow-up"/></button></div>

    </div>
    {#if scope==='all'}<div class="text-style__alignment">{#if nativeMode}{@render nativeAlignment?.()}{:else}<AlignmentButtons value={style.textAlign==='left'||style.textAlign==='right'?style.textAlign:'center'} {disabled} onChange={textAlign=>onUpdate({textAlign})}/>{/if}</div>{/if}
    <div class="text-style__leading" title="Line height — applies to all words"><LucideIcon name="line-height"/><ScrubbableNumber label="Line height" min={.6} max={3} step={.05} value={style.lineHeight} {disabled} onChange={lineHeight => onUpdate({ lineHeight })}/></div>
  </div>

  {#if popover}
    <div class="text-style__popover" id={`${componentId}-color-popover`} role="dialog" aria-label={popoverLabel} style={popoverPosition} use:portal>
      {#if popover === 'text'}
        <HslaColorPicker value={appearance.color} opacity={appearance.opacity} label="Text color" {disabled} onChange={next => update(textStyleColorPatch(appearance, 'text', next))}/>
      {:else if popover === 'bubble'}
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.bubble} aria-checked={mixed('bubble') ? 'mixed' : appearance.bubble} onchange={event => toggleEffect('bubble', event.currentTarget.checked)} /><span>Word background</span></label>
        <HslaColorPicker value={appearance.bubbleColor} opacity={appearance.bubbleOpacity} label="Word background" {disabled} onChange={next => update(textStyleColorPatch(appearance, 'bubble', next))}/>
        <div class="text-style__popover-grid">
          <div class="caption-field" title="Left and right padding"><span>Inline padding</span><ScrubbableNumber label="Bubble inline padding, px" min={0} max={100} value={mixed('bubblePaddingInline') ? null : appearance.bubblePaddingInline ?? appearance.padding} {disabled} onChange={bubblePaddingInline => update({ bubblePaddingInline })} /></div>
          <div class="caption-field" title="Top and bottom padding"><span>Block padding</span><ScrubbableNumber label="Bubble block padding, px" min={0} max={100} value={mixed('bubblePaddingBlock') ? null : appearance.bubblePaddingBlock ?? appearance.padding} {disabled} onChange={bubblePaddingBlock => update({ bubblePaddingBlock })} /></div>
          <div class="caption-field"><span>Corners, px</span><ScrubbableNumber label="Bubble corners, px" min={0} max={200} value={mixed('radius') ? null : appearance.radius} {disabled} onChange={radius => update({ radius })} /></div>
        </div>
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.bubbleFillSpaces ?? false} aria-checked={mixed('bubbleFillSpaces') ? 'mixed' : appearance.bubbleFillSpaces ?? false} onchange={event => update({ bubbleFillSpaces: event.currentTarget.checked })} /><span>Color spaces between words</span></label>
      {:else if popover === 'stroke'}
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.strokeEnabled} aria-checked={mixed('strokeEnabled') ? 'mixed' : appearance.strokeEnabled} onchange={event => toggleEffect('stroke', event.currentTarget.checked)}/><span>Outline</span></label>
        <div class="text-style__popover-field"><span>Width, px</span><ScrubbableNumber label="Outline width, px" min={0} max={30} step={.5} value={mixed('strokeWidth') ? null : appearance.strokeWidth} disabled={disabled || !appearance.strokeEnabled && !mixed('strokeEnabled')} onChange={strokeWidth => update({ strokeWidth })}/></div>
        <HslaColorPicker value={appearance.strokeColor} opacity={appearance.strokeOpacity} label="Outline color" {disabled} onChange={next => update(textStyleColorPatch(appearance, 'stroke', next))}/>
      {:else}
        <HslaColorPicker value={appearance.shadowColor} opacity={appearance.shadowOpacity} label="Shadow color" {disabled} onChange={next => update(textStyleColorPatch(appearance, 'shadow', next))}/>
      {/if}
    </div>
  {/if}

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
              <div class="caption-field"><span>{field.label} / opacity</span><button class="text-style__effect-color" type="button" disabled={disabled || !appearance[effect.enabled] && !mixed(effect.enabled)} aria-label={`${effect.label} color and opacity`} aria-expanded={popover === effect.key} aria-controls={`${componentId}-color-popover`} onclick={event => openPopover(effect.key, event.currentTarget, event.detail === 0)}><span style:background={appearance[field.key] as string} aria-hidden="true"></span>{Math.round((effect.key === 'stroke' ? appearance.strokeOpacity : appearance.shadowOpacity) * 100)}%</button></div>
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
  .text-style { --ribbon-height:2.25rem;--ribbon-icon-size:1.25rem;--ribbon-gap:.3rem;--ribbon-radius:.45rem;display:flex;flex-direction:column;gap:var(--caption-space-xs);min-inline-size:0;container:text-style / inline-size;margin:0;padding:var(--caption-space-m) var(--caption-space-l);border:0;border-block-end:1px solid var(--color-panel-border); }
  .text-style__scope {display:flex;align-items:center;gap:.125rem;margin-block-end:var(--caption-space-xs);}
  .text-style__scope-button {flex:1;min-inline-size:0;min-block-size:2rem;padding:var(--caption-space-xs);border:0;border-radius:.3rem;background:transparent;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);cursor:pointer;&[aria-pressed="true"] {background:var(--color-surface-raised);color:var(--color-panel-text);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.5;cursor:default;}}
  .text-style__ribbon {display:flex;align-items:center;flex-wrap:wrap;gap:var(--ribbon-gap);padding-block:.35rem;}
  .text-style__case-wrap {position:relative;inline-size:3.1rem;block-size:var(--ribbon-height);flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);&:focus-within {outline:2px solid var(--color-accent);outline-offset:1px;}&:has(select:disabled) {opacity:.5;}}
  .text-style__case-display {position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding-inline:.45rem;pointer-events:none;font-size:1rem;& :global(svg) {inline-size:.8rem;block-size:.8rem;fill:none;stroke:currentColor;stroke-width:1.5;}}
  .text-style__case {position:absolute;inset:0;inline-size:100%;border:0;border-radius:inherit;background:transparent;color:transparent;appearance:none;cursor:pointer;& option {background:var(--color-panel-bg);color:var(--color-panel-text);}&:focus-visible {outline:none;}}
  .text-style__segment {display:flex;flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);overflow:hidden;}
  .text-style__toggle {display:grid;place-items:center;inline-size:2.1rem;block-size:var(--ribbon-height);padding:.15rem;border:0;background:transparent;color:var(--color-panel-text);font-size:1.45rem;line-height:1;cursor:pointer;&+& {border-inline-start:1px solid var(--color-panel-border);}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&[aria-pressed="true"] {background:var(--color-selection);color:var(--color-accent);}&[aria-pressed="mixed"] {color:var(--color-accent);text-decoration:underline;}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.5;cursor:default;}}
  .text-style__swatch,.text-style__background,.text-style__outline {display:grid;place-items:center;inline-size:var(--ribbon-height);block-size:var(--ribbon-height);flex-shrink:0;padding:0;border:1px solid var(--color-panel-border);border-radius:var(--ribbon-radius);cursor:pointer;}
  .text-style__background {background:var(--color-surface-raised);color:white;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__outline {background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__popover-field {display:flex;align-items:center;justify-content:space-between;gap:.5rem;& :global(.scrubbable-number) {inline-size:5rem;}}
  .text-style__slash {stroke:var(--color-error,#ffb4a9);}
  .text-style__font-group {display:flex;align-items:center;gap:var(--ribbon-gap);flex:1 1 19rem;min-inline-size:19rem;@container text-style (max-width:36rem) {order:2;flex-basis:100%;min-inline-size:0;}}
  .text-style__family {flex:1;min-inline-size:0;& :global(.font-picker) {border:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);}& :global(.font-picker__input) {font-size:1rem;}}
  .text-style__weight {inline-size:4.5rem;min-inline-size:0;min-block-size:var(--ribbon-height);padding:.25rem .4rem;border:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);color:var(--color-panel-text);font:inherit;font-size:var(--caption-type-s);cursor:pointer;&:disabled {opacity:.5;cursor:default;}}
  .text-style__number {display:flex;align-items:center;inline-size:7rem;flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);& :global(.scrubbable-number) {flex:1;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {border:0;background:transparent;font-size:1rem;padding-inline:.15rem;text-align:center;}}
  .text-style__size-step {display:grid;place-items:center;inline-size:2rem;block-size:var(--ribbon-height);flex-shrink:0;padding:0;border:0;background:transparent;color:var(--color-panel-text);cursor:pointer;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.4;cursor:default;}}
  .text-style__leading {display:flex;align-items:center;inline-size:4.7rem;flex-shrink:0;gap:.1rem;padding-inline:.2rem;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);flex-shrink:0;color:inherit;}& :global(.scrubbable-number) {flex:1;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {border:0;background:transparent;padding-inline:.15rem;font-size:var(--caption-type-s);}}
  .text-style__effect-color {display:flex;align-items:center;gap:.5rem;min-block-size:2.25rem;padding:.25rem .4rem;border:1px solid var(--color-panel-border);border-radius:var(--caption-radius);background:var(--color-input);color:var(--color-panel-text);font:inherit;font-size:var(--caption-type-s);cursor:pointer;& span {inline-size:1.5rem;block-size:1.25rem;border:1px solid var(--color-panel-border);border-radius:.15rem;}&:disabled {opacity:.5;cursor:default;}}
  .text-style__alignment {flex-shrink:0;margin-inline-start:auto;& :global(.alignment__button) {inline-size:2.1rem;block-size:var(--ribbon-height);border:0;background:var(--color-surface-raised);color:var(--color-panel-text);}& :global(.alignment__button[aria-pressed="true"]) {background:var(--color-selection);color:var(--color-accent);}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__popover {position:fixed;z-index:1000;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:.65rem;padding:.8rem;border:1px solid var(--color-panel-border);border-radius:var(--caption-radius);background:var(--color-panel-bg);color:var(--color-panel-text);font-family:inherit;font-size:var(--caption-type-s);& .caption-check {margin:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {color:var(--color-accent);}}
  .text-style__popover-grid {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;}
  .text-style__tabs {display:flex;gap:1rem;border-block-end:1px solid var(--color-panel-border);}
  .text-style__tab {min-inline-size:0;min-block-size:2rem;padding:var(--caption-space-xs) 0;border:0;border-block-end:2px solid transparent;background:transparent;color:var(--color-panel-text);font-size:var(--caption-type-xs);cursor:pointer;&[aria-selected="true"] {border-block-end-color:var(--color-accent);color:var(--color-accent);}&:hover:enabled {color:var(--color-accent);}&:focus-visible {outline:1px solid var(--color-accent);outline-offset:-2px;}&:disabled {opacity:.5;cursor:default;}}
  .text-style__expanded {display:flex;flex-direction:column;gap:var(--caption-space-s);padding-block:var(--caption-space-s);& .caption-controls {grid-template-columns:repeat(auto-fit,minmax(min(100%,7rem),1fr));gap:var(--caption-space-s);align-items:end;}& .caption-check {min-block-size:2.25rem;align-self:end;font-size:var(--caption-type-s);}& .caption-help {margin:0;}}
  .text-style :global(button:focus-visible),.text-style :global(input:focus-visible),.text-style :global(select:focus-visible),.text-style__popover :global(input:focus-visible) {outline:2px solid var(--color-accent);outline-offset:1px;}
</style>
