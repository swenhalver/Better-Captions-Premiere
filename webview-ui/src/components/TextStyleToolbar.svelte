<script module lang="ts">
  import { DEFAULT_STYLE, type StyleConfig, type WordAppearance } from "../lib/types";
  import { resolveAppearance, type WordStateKey, type ResolvedAppearance } from "../lib/appearance";
  import { fontWeightOptions, nextFontWeight, resolveFontWeight, type InstalledFont } from '../lib/font-catalog.ts';
  import { LINE_POSITIONS, lineOverrideGroups, lineScope, lineScopePosition, lineSets, lineStylePatch, lineStyleReset, resolveLineAppearance, type LineScope } from '../lib/line-styles.ts';

  /** Word states, or a line position of the visible caption window (line-1 is the top line). */
  export type TextStyleScope = "all" | "spoken" | "current" | "upcoming" | LineScope;
  const stateKeys: WordStateKey[] = ["spokenWord", "activeWord", "upcomingWord"];
  const scopeKeys = { spoken: "spokenWord", current: "activeWord", upcoming: "upcomingWord" } as const;
  const baseFields = { fontFamily: "fontFamily", fontWeight: "fontWeight", color: "textColor", textTransform: "textTransform",
    strokeEnabled: "strokeEnabled", strokeColor: "strokeColor", strokeWidth: "strokeWidth", strokeOpacity: "strokeOpacity",
    shadowEnabled: "shadowEnabled", shadowColor: "shadowColor", shadowOpacity: "shadowOpacity", shadowBlur: "shadowBlur",
    shadowOffsetX: "shadowOffsetX", shadowOffsetY: "shadowOffsetY" } as const;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  /** Change one formatting property without flattening the other word-state styles. */
  export function textStylePatch(style: StyleConfig, scope: TextStyleScope, patch: Partial<WordAppearance>): Partial<StyleConfig> {
    const line = lineScopePosition(scope);
    if (line) return lineStylePatch(style, line, patch);
    if (scope !== "all") {
      const key = scopeKeys[scope as keyof typeof scopeKeys];
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
    const line = lineScopePosition(scope);
    if (line) return resolveLineAppearance(style, line, textStyleAppearance(style, 'all'));
    if (scope !== "all") return resolveAppearance(style, scopeKeys[scope as keyof typeof scopeKeys]);
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

  /** Scoped reset follows today's All words value; All words resets to factory
   * defaults; a line position goes back to inheriting the word states. */
  export function textStyleResetPatch(style: StyleConfig, scope: TextStyleScope, fields: readonly (keyof WordAppearance)[]): Partial<StyleConfig> {
    const line = lineScopePosition(scope);
    if (line) return lineStyleReset(style, line, fields);
    if (scope !== 'all') {
      const baseline = textStyleAppearance(style, 'all');
      const patch = Object.fromEntries(fields.map(field => [field, baseline[field]])) as Partial<WordAppearance>;
      return textStylePatch(style, scope, patch);
    }
    const result = fields.includes('fontSize') ? textStylePatch(style, 'all', {fontSize: DEFAULT_STYLE.fontSize}) : {};
    for (const field of fields) {
      if (field === 'fontSize') continue;
      if (field in baseFields) {
        const target = baseFields[field as keyof typeof baseFields];
        Object.assign(result, {[target]: DEFAULT_STYLE[target]});
      }
      for (const key of stateKeys) {
        Object.assign(result, {[key]: {...style[key], ...result[key], [field]: resolveAppearance(DEFAULT_STYLE, key)[field]}});
      }
    }
    return result;
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
    const line = lineScopePosition(scope);
    if (line) return !lineSets(style, line, [key]) && textStyleMixed(style, 'all', key);
    if (scope !== "all") return false;
    const values = stateKeys.map(state => resolveAppearance(style, state)[key]);
    return values.some(value => value !== values[0]);
  }

  export function textStyleBoldState(style: StyleConfig, scope: TextStyleScope): boolean | "mixed" {
    const line = lineScopePosition(scope);
    if (line) return lineSets(style, line, ['fontWeight']) ? style.lineStyles?.[line]?.fontWeightOffset === 100 : textStyleBoldState(style, 'all');
    const keys = scope === "all" ? stateKeys : [scopeKeys[scope as keyof typeof scopeKeys]];
    const modes = keys.map(key => style[key]?.fontWeightOffset === 100);
    return modes.every(mode => mode === modes[0]) ? modes[0] : "mixed";
  }

  export function textStyleBoldDisabled(style: StyleConfig, scope: TextStyleScope): boolean {
    if (textStyleBoldState(style, scope) !== false) return false;
    const line = lineScopePosition(scope);
    if (line) { const family = style.lineStyles?.[line]?.fontFamily || style.fontFamily; return nextFontWeight(family, style.fontWeight) <= resolveFontWeight(family, style.fontWeight); }
    const keys = scope === 'all' ? stateKeys : [scopeKeys[scope as keyof typeof scopeKeys]];
    return keys.every(key => nextFontWeight(style[key]?.fontFamily || style.fontFamily, style.fontWeight) <= resolveFontWeight(style[key]?.fontFamily || style.fontFamily, style.fontWeight));
  }

  /** B uses the next installed heavier face; the shared baseline stays intact. */
  export function textStyleBoldPatch(style: StyleConfig, scope: TextStyleScope): Partial<StyleConfig> {
    const offset = style.fontWeight >= 1000 || textStyleBoldState(style, scope) === true ? 0 : 100;
    const line = lineScopePosition(scope);
    if (line) return lineStylePatch(style, line, { fontWeightOffset: offset });
    const keys = scope === "all" ? stateKeys : [scopeKeys[scope as keyof typeof scopeKeys]];
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = { ...style[key], fontWeightOffset: offset };
    return result as Partial<StyleConfig>;
  }
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { trackAnchoredPopup } from '../lib/anchored-popup.ts';
  import SpacingInspector from './SpacingInspector.svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import HslaColorPicker from './HslaColorPicker.svelte';
  import LucideIcon from './LucideIcon.svelte';
  import typeShadowSvg from '../assets/type-shadow.svg?raw';
  const typeShadowIcon=typeShadowSvg.replaceAll('stroke="#000"','stroke="currentColor"').replaceAll('stroke="#808080"','stroke="#000"').replace('matrix(2,0,0,2,2,-8)','matrix(2,0,0,2,6,-4)');
  import WordBackgroundPreview from './WordBackgroundPreview.svelte';
  import FontPicker from './FontPicker.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  // lineCount: line positions offered as scopes (Visible lines, or lines per page); 0 hides them.
  interface Props { style: StyleConfig; fonts?: string[]; fontCatalog?: InstalledFont[]; fontsLoading?: boolean; fontsError?: string; onRefreshFonts?: () => void; scope?: TextStyleScope; onScopeChange: (scope: TextStyleScope) => void; onUpdate: (updates: Partial<StyleConfig>) => void; disabled?: boolean; nativeMode?: boolean; lineCount?: number; nativeLayout?: Snippet; nativeAlignment?: Snippet; }
  let { style, fonts = [], fontCatalog = [], fontsLoading = false, fontsError = '', onRefreshFonts, scope = "all", onScopeChange, onUpdate, disabled = false, nativeMode = false, lineCount = 0, nativeLayout, nativeAlignment }: Props = $props();
  const componentId = $props.id();
  const line = $derived(lineScopePosition(scope));
  const lineButtons = $derived(LINE_POSITIONS.slice(0, Math.max(0, Math.min(LINE_POSITIONS.length, Math.floor(lineCount)))));
  const lineGroups = $derived(line ? lineOverrideGroups(style, line) : []);
  /** In a line scope, a control whose fields the line does not set shows the inherited value. */
  const inherited = (...fields: string[]) => !!line && !lineSets(style, line, fields);
  let appearance = $derived.by(() => { void fontCatalog; return textStyleAppearance(style, scope); });
  const resetAppearance = $derived(textStyleAppearance(scope === 'all' ? DEFAULT_STYLE : style, 'all'));
  let boldState = $derived(textStyleBoldState(style, scope));
  let weights = $derived(fontWeightOptions(appearance.fontFamily, fontCatalog));
  let boldDisabled = $derived.by(() => { void fontCatalog; return !weights.length && boldState === false || textStyleBoldDisabled(style, scope); });
  function toggleEffect(key:"stroke"|"shadow"|"bubble",enabled:boolean){
    const field=key==="stroke"?"strokeEnabled":key==="shadow"?"shadowEnabled":"bubble";
    const patch:Partial<WordAppearance>={[field]:enabled};
    // A line stores the amount with its toggle, so it never depends on inherited width or opacity.
    if(nativeMode&&enabled&&key==="stroke"&&(appearance.strokeWidth<=0||line))patch.strokeWidth=appearance.strokeWidth>0?appearance.strokeWidth:2;
    if(nativeMode&&enabled&&key==="shadow"){if(appearance.shadowOpacity<=0||line)patch.shadowOpacity=appearance.shadowOpacity>0?appearance.shadowOpacity:1;if(!appearance.shadowBlur&&!appearance.shadowOffsetX&&!appearance.shadowOffsetY)patch.shadowBlur=4;}
    update(patch);
  }
  let sizeMax = $derived(scope === "all" ? 400 : 1200);
  const mixed = (key: keyof WordAppearance) => textStyleMixed(style, scope, key);
  const outlinePreviewEnabled = $derived(appearance.strokeEnabled && appearance.strokeWidth > 0 && appearance.strokeOpacity > 0 && !!appearance.strokeColor && !['strokeEnabled','strokeWidth','strokeOpacity','strokeColor','color','opacity'].some(key => mixed(key as keyof WordAppearance)));
  const value = (event: Event) => (event.currentTarget as HTMLInputElement).value;
  function update(patch: Partial<WordAppearance>) { if (Object.keys(patch).length) onUpdate(textStylePatch(style, scope, patch)); }
  let spacingPatch:Partial<WordAppearance>={};
  let spacingQueued=false;
  function updateSpacing(key:string,value:number){
    const field=({top:'marginTop',right:'marginRight',bottom:'marginBottom',left:'marginLeft',inline:'bubblePaddingInline',block:'bubblePaddingBlock'} as Record<string,string>)[key]??key;
    spacingPatch={...spacingPatch,[field]:value};
    if(!spacingQueued){spacingQueued=true;queueMicrotask(()=>{const patch=spacingPatch;spacingPatch={};spacingQueued=false;update(patch);});}
  }
  function resetField(field: keyof WordAppearance) { onUpdate(textStyleResetPatch(style, scope, [field])); }
  let spacingResetFields = new Set<keyof WordAppearance>();
  let spacingResetQueued = false;
  function resetSpacing(key: string) {
    const field = (({top:'marginTop',right:'marginRight',bottom:'marginBottom',left:'marginLeft',inline:'bubblePaddingInline',block:'bubblePaddingBlock'} as Record<string,string>)[key] ?? key) as keyof WordAppearance;
    spacingResetFields.add(field);
    if (!spacingResetQueued) {
      spacingResetQueued = true;
      queueMicrotask(() => { const fields = [...spacingResetFields]; spacingResetFields.clear(); spacingResetQueued = false; onUpdate(textStyleResetPatch(style, scope, fields)); });
    }
  }
  function resetWordSpacing() {
    if (scope !== 'all') return;
    if (!nativeMode) { onUpdate({wordSpacing: DEFAULT_STYLE.wordSpacing}); return; }
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure) return;
    measure.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily.replace(/["\\]/g, '')}"`;
    const width = measure.measureText(' ').width;
    if (Number.isFinite(width) && width >= 0) onUpdate({wordSpacing: width});
  }
  function selectFont(fontFamily: string) {
    // A line keeps inheriting its weight; the renderer picks the nearest face.
    if (line) { onUpdate(textStylePatch(style, scope, { fontFamily })); return; }
    const patch = textStylePatch(style, scope, { fontFamily });
    if (scope === 'all') {
      patch.fontWeight = resolveFontWeight(fontFamily, style.fontWeight);
      for (const key of stateKeys) Object.assign(patch, { [key]: { ...patch[key], fontWeight: resolveFontWeight(fontFamily, style[key]?.fontWeight ?? style.fontWeight) } });
    } else {
      const key = scopeKeys[scope as keyof typeof scopeKeys];
      Object.assign(patch, { [key]: { ...patch[key], fontWeight: resolveFontWeight(fontFamily, style[key]?.fontWeight ?? style.fontWeight) } });
    }
    onUpdate(patch);
  }
  type PopoverKind = 'text' | 'bubble' | 'stroke' | 'shadow' | 'spacing';
  let popover = $state<PopoverKind | null>(null);
  const popoverLabel = $derived(popover === 'spacing' ? 'Padding, margin and radius' : popover === 'text' ? 'Text color and opacity' : popover === 'bubble' ? 'Word background and bubble settings' : popover === 'stroke' ? 'Outline color and opacity' : 'Shadow color and opacity');
  let popoverTrigger = $state<HTMLButtonElement>();
  let popup: HTMLDivElement | undefined;
  function portal(node: HTMLDivElement, trigger: HTMLButtonElement | undefined) {
    popup = node;
    document.body.appendChild(node);
    let tracking = trigger ? trackAnchoredPopup(trigger, node, { onHidden: closePopover }) : undefined;
    return {
      update(next: HTMLButtonElement | undefined) {
        tracking?.destroy();
        tracking = next ? trackAnchoredPopup(next, node, { onHidden: closePopover }) : undefined;
      },
      destroy() { tracking?.destroy(); node.remove(); popup = undefined; },
    };
  }
  function openPopover(next: PopoverKind, trigger: HTMLButtonElement, keyboard = false) {
    popoverTrigger = trigger;
    popover = popover === next ? null : next;
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

</script>

<svelte:window onfocusin={leavePopover} onpointerdown={outsidePopover} onkeydown={popoverKey} />

<fieldset class="text-style" {disabled} aria-label="Caption text styling">
  <div class="text-style__scope" role="group" aria-label="Words to style">
    {#each [{ value: "all", label: "All words" }, { value: "spoken", label: "Past" }, { value: "current", label: "Current" }, { value: "upcoming", label: "Next" }] as item}
      <button class="text-style__scope-button" aria-pressed={scope === item.value} onclick={() => onScopeChange(item.value as TextStyleScope)}>{item.label}</button>
    {/each}
  </div>
  {#if lineButtons.length}
    <div class="text-style__lines" role="group" aria-label="Line positions">
      <span class="text-style__lines-label" title="Style one line of the visible captions. Line 1 is the top line. A line's settings win over Past, Current and Next while a line sits there.">Lines</span>
      {#each lineButtons as position}
        {@const styled = lineOverrideGroups(style, position).length > 0}
        <button class="text-style__line-button" class:text-style__line-button--styled={styled} aria-pressed={scope === lineScope(position)} aria-label={`Line ${position}${styled ? ', has its own style' : ''}`} title={`Line ${position}${position === '1' ? ' (top)' : position === lineButtons[lineButtons.length - 1] ? ' (bottom)' : ''}${styled ? ' — has its own style' : ''}`} onclick={() => onScopeChange(scope === lineScope(position) ? 'all' : lineScope(position))}>{position}</button>
      {/each}
    </div>
  {/if}
  {#if line}
    <div class="text-style__line-overrides" role="group" aria-label={`Line ${line} settings`}>
      {#if lineGroups.length}
        <span class="text-style__line-note">Line {line} sets</span>
        {#each lineGroups as group}
          <button class="text-style__override" type="button" aria-label={`Reset Line ${line} ${group.label.toLowerCase()} to inherit`} title={`Line ${line} sets its own ${group.label.toLowerCase()}. Click to inherit Past, Current and Next again.`} onclick={() => onUpdate(lineStyleReset(style, line, group.fields))}>{group.label}<LucideIcon name="reset"/></button>
        {/each}
      {:else}
        <span class="text-style__line-note">Line {line} inherits Past, Current and Next. Change a setting to set it for this line.</span>
      {/if}
    </div>
  {/if}

  <div class="text-style__ribbon" aria-label="Text formatting">
    <div class="text-style__case-wrap" title="Text case">
      <span class="text-style__case-display" aria-hidden="true">Aa<LucideIcon name="chevron-down"/></span>
      <select class="text-style__case" aria-label="Text case" disabled={nativeMode && scope !== "all"} value={mixed("textTransform") ? "" : appearance.textTransform} onfocus={closePopover} onchange={(event) => update({ textTransform: value(event) as WordAppearance["textTransform"] })}>{#if mixed("textTransform")}<option value="" disabled>Mixed case</option>{/if}<option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="titlecase">Title Case</option></select>
    </div>
    <div class="text-style__segment" role="group" aria-label="Emphasis">
      <button class="text-style__toggle" data-inherited={inherited('fontWeight') || undefined} aria-label="Bold" title={boldDisabled ? 'This font has no heavier installed weight' : boldState === true ? 'Turn off the bolder step and follow All words' : `Next supported weight above All words (${style.fontWeight})`} aria-pressed={boldState} disabled={boldDisabled} onclick={() => onUpdate(textStyleBoldPatch(style, scope))}><LucideIcon name="bold"/></button>
      <button class="text-style__toggle" data-inherited={inherited('italic') || undefined} aria-label="Italic" title="Italic — uses a synthetic slant when needed" aria-pressed={mixed("italic") ? "mixed" : appearance.italic} onclick={() => update({ italic: mixed("italic") || !appearance.italic })}><LucideIcon name="italic"/></button>
      <button class="text-style__toggle" data-inherited={inherited('underline') || undefined} aria-label="Underline" title="Underline" aria-pressed={mixed('underline') ? 'mixed' : appearance.underline} onclick={() => update({ underline: mixed('underline') || !appearance.underline })}><LucideIcon name="underline"/></button>
    </div>
    <button class="text-style__swatch" type="button" data-inherited={inherited('color', 'opacity') || undefined} aria-label="Text color and opacity" title={mixed("color") ? "Text color — mixed word colors" : "Text color and opacity"} aria-expanded={popover === 'text'} aria-controls={`${componentId}-color-popover`} onclick={event => openPopover('text', event.currentTarget, event.detail === 0)}><LucideIcon name="type-color" accentStroke={mixed("color") ? "currentColor" : appearance.color} accentOpacity={mixed("opacity") ? 1 : appearance.opacity}/></button>
    <button class="text-style__background" type="button" data-inherited={inherited('bubble', 'bubbleFillSpaces', 'bubbleColor', 'bubbleOpacity') || undefined} aria-label="Word background and bubble settings" title="Word background and bubble settings" aria-expanded={popover === 'bubble'} aria-controls={`${componentId}-color-popover`} onclick={event => openPopover('bubble', event.currentTarget, event.detail === 0)}><WordBackgroundPreview enabled={mixed('bubble')?null:appearance.bubble} color={mixed('bubbleColor')?null:appearance.bubbleColor} opacity={mixed('bubbleOpacity')?null:appearance.bubbleOpacity} textColor={mixed('color')?null:appearance.color} textOpacity={mixed('opacity')?null:appearance.opacity} outlined={mixed('strokeEnabled')||mixed('strokeWidth')||mixed('strokeOpacity')?null:appearance.strokeEnabled&&appearance.strokeWidth>0&&appearance.strokeOpacity>0} outlineColor={mixed('strokeColor')?null:appearance.strokeColor} outlineOpacity={mixed('strokeOpacity')?null:appearance.strokeOpacity}/></button>
    <button class="text-style__outline" type="button" data-inherited={inherited('strokeEnabled', 'strokeWidth', 'strokeColor', 'strokeOpacity') || undefined} aria-label="Outline settings" title="Outline settings" aria-expanded={popover === 'stroke'} aria-controls={`${componentId}-color-popover`} onclick={event => openPopover('stroke', event.currentTarget, event.detail === 0)}><LucideIcon name="outline" fill={outlinePreviewEnabled?appearance.color:'none'} stroke={outlinePreviewEnabled?appearance.strokeColor:'currentColor'} fillOpacity={outlinePreviewEnabled?appearance.opacity:1} strokeOpacity={outlinePreviewEnabled?appearance.strokeOpacity:1}/></button>
    <button class="text-style__shadow" type="button" data-inherited={inherited('shadowEnabled', 'shadowOpacity', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY') || undefined} aria-label="Shadow settings" title="Shadow settings" aria-expanded={popover==='shadow'} onclick={event=>openPopover('shadow',event.currentTarget,event.detail===0)}><span class="text-style__shadow-icon" aria-hidden="true">{@html typeShadowIcon}</span></button>
    <div class="text-style__font-group">
      <div class="text-style__family" data-inherited={inherited('fontFamily') || undefined}><FontPicker value={mixed('fontFamily') ? '' : appearance.fontFamily} {fonts} placeholder={mixed('fontFamily') ? 'Mixed fonts' : 'Font family'} loading={fontsLoading} error={fontsError} onOpen={() => { closePopover(); if (!fonts.length) onRefreshFonts?.(); }} onRetry={onRefreshFonts} onSelect={selectFont} /></div>
      <select class="text-style__weight" data-inherited={inherited('fontWeight') || undefined} onfocus={closePopover} aria-label="Font weight" disabled={!weights.length} title={weights.length ? scope === "all" ? "All words font weight" : "Font weight — absolute override" : "Select an installed font to choose its supported weights"} value={appearance.fontWeight} onchange={(event) => update({ fontWeight: Number(value(event)) })}>{#if !weights.length}<option value={appearance.fontWeight}>{appearance.fontWeight}</option>{:else}{#if !weights.includes(appearance.fontWeight)}<option value={appearance.fontWeight} disabled hidden>{appearance.fontWeight}</option>{/if}{#each weights as weight}<option value={weight}>{weight}</option>{/each}{/if}</select>
      <div class="text-style__number" data-inherited={inherited('fontSize') || undefined} title={scope === "all" ? "Base font size — keeps relative word sizes" : "Font size"}><span class="text-style__size-icon" aria-hidden="true"><LucideIcon name="a-small-large"/></span><button class="text-style__size-step" type="button" aria-label="Decrease font size" title="Decrease font size" disabled={disabled || appearance.fontSize <= 8} onclick={() => onUpdate(textStyleSizeStep(style, scope, -1))}><LucideIcon name="a-arrow-down"/></button><ScrubbableNumber defaultValue={resetAppearance.fontSize} onReset={() => resetField('fontSize')} label={scope === "all" ? "Base font size, px" : "Font size, px"} min={8} max={sizeMax} step={.5} value={Number(appearance.fontSize.toFixed(2))} {disabled} onChange={fontSize => update({ fontSize })} /><button class="text-style__size-step" type="button" aria-label="Increase font size" title="Increase font size" disabled={disabled || appearance.fontSize >= sizeMax} onclick={() => onUpdate(textStyleSizeStep(style, scope, 1))}><LucideIcon name="a-arrow-up"/></button></div>

    </div>
    <div class="text-style__leading" title="Line height — applies to all words"><LucideIcon name="line-height"/><ScrubbableNumber defaultValue={scope === 'all' ? DEFAULT_STYLE.lineHeight : style.lineHeight} label="Line height" min={.6} max={3} step={.05} value={style.lineHeight} {disabled} onChange={lineHeight => onUpdate({ lineHeight })}/></div>
    <button class="text-style__spacing" type="button" data-inherited={inherited('paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'radiusTL', 'radiusTR', 'radiusBR', 'radiusBL', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft') || undefined} aria-label="Padding and margin" title="Padding, margin and corner radius" aria-expanded={popover==='spacing'} onclick={event=>openPopover('spacing',event.currentTarget,event.detail===0)}><LucideIcon name="scan"/></button>
    {#if scope==='all'}<div class="text-style__alignment">{#if nativeMode}{@render nativeAlignment?.()}{:else}<AlignmentButtons value={style.textAlign==='left'||style.textAlign==='right'?style.textAlign:'center'} {disabled} onChange={textAlign=>onUpdate({textAlign})}/>{/if}</div>{/if}
  </div>

  {#if popover}
    <div class="text-style__popover" id={`${componentId}-color-popover`} role="dialog" aria-label={popoverLabel} use:portal={popoverTrigger}>
      {#if popover === 'spacing'}
        <SpacingInspector variant="cross" inherited={line ? key => inherited(({top:'marginTop',right:'marginRight',bottom:'marginBottom',left:'marginLeft'} as Record<string,string>)[key] ?? key) : undefined} defaults={{inline:resetAppearance.bubblePaddingInline,block:resetAppearance.bubblePaddingBlock,lineHeight:scope === 'all' ? DEFAULT_STYLE.lineHeight : style.lineHeight,top:resetAppearance.marginTop,right:resetAppearance.marginRight,bottom:resetAppearance.marginBottom,left:resetAppearance.marginLeft,paddingTop:resetAppearance.paddingTop,paddingRight:resetAppearance.paddingRight,paddingBottom:resetAppearance.paddingBottom,paddingLeft:resetAppearance.paddingLeft,radiusTL:resetAppearance.radiusTL,radiusTR:resetAppearance.radiusTR,radiusBR:resetAppearance.radiusBR,radiusBL:resetAppearance.radiusBL}} onReset={resetSpacing} value={{inline:appearance.bubblePaddingInline,block:appearance.bubblePaddingBlock,top:appearance.marginTop,right:appearance.marginRight,bottom:appearance.marginBottom,left:appearance.marginLeft,paddingTop:appearance.paddingTop,paddingRight:appearance.paddingRight,paddingBottom:appearance.paddingBottom,paddingLeft:appearance.paddingLeft,radiusTL:appearance.radiusTL,radiusTR:appearance.radiusTR,radiusBR:appearance.radiusBR,radiusBL:appearance.radiusBL}} onChange={updateSpacing}/>
      <div class="caption-controls">
        {#if !nativeMode}<div class="caption-field"><span>Letter spacing, px</span><ScrubbableNumber defaultValue={resetAppearance.letterSpacing} onReset={() => resetField('letterSpacing')} label="Letter spacing, px" min={-10} max={40} step={.5} {disabled} value={mixed("letterSpacing") ? null : appearance.letterSpacing} onChange={letterSpacing => update({ letterSpacing })} /></div>{/if}
        <div class="caption-field"><span>{nativeMode?"Word spacing, px":"Word spacing, %"}</span><ScrubbableNumber defaultValue={nativeMode ? undefined : scope === 'all' ? DEFAULT_STYLE.wordSpacing : style.wordSpacing} onReset={resetWordSpacing} label={nativeMode?"Word spacing, px":"Word spacing, %"} min={0} max={300} {disabled} value={style.wordSpacing ?? null} placeholder="Original" onChange={wordSpacing => onUpdate({ wordSpacing })} /></div>
        {#if style.wordSpacing === undefined && !nativeMode}<button class="caption-button" onclick={() => onUpdate({ wordSpacing: 100 })}>Use normal spacing</button>{/if}
      </div>
      {:else if popover === 'text'}
        <div class="text-style__popover-group" data-inherited={inherited('color', 'opacity') || undefined}><HslaColorPicker value={appearance.color} opacity={appearance.opacity} label="Text color" defaultOpacity={resetAppearance.opacity} onOpacityReset={() => resetField('opacity')} {disabled} onChange={next => update(textStyleColorPatch(appearance, 'text', next))}/></div>
      {:else if popover === 'bubble'}
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.bubble} aria-checked={mixed('bubble') ? 'mixed' : appearance.bubble} onchange={event => toggleEffect('bubble', event.currentTarget.checked)} /><span>Word background</span></label>
        <HslaColorPicker value={appearance.bubbleColor} opacity={appearance.bubbleOpacity} label="Word background" defaultOpacity={resetAppearance.bubbleOpacity} onOpacityReset={() => resetField('bubbleOpacity')} {disabled} onChange={next => update(textStyleColorPatch(appearance, 'bubble', next))}/>
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.bubbleFillSpaces ?? false} aria-checked={mixed('bubbleFillSpaces') ? 'mixed' : appearance.bubbleFillSpaces ?? false} onchange={event => update({ bubbleFillSpaces: event.currentTarget.checked })} /><span>Color spaces between words</span></label>
      {:else if popover === 'stroke'}
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.strokeEnabled} aria-checked={mixed('strokeEnabled') ? 'mixed' : appearance.strokeEnabled} onchange={event => toggleEffect('stroke', event.currentTarget.checked)}/><span>Outline</span></label>
        <div class="text-style__popover-field"><span>Width, px</span><ScrubbableNumber defaultValue={resetAppearance.strokeWidth} onReset={() => resetField('strokeWidth')} label="Outline width, px" min={0} max={30} step={.5} value={mixed('strokeWidth') ? null : appearance.strokeWidth} disabled={disabled || !appearance.strokeEnabled && !mixed('strokeEnabled')} onChange={strokeWidth => update({ strokeWidth })}/></div>
        <HslaColorPicker value={appearance.strokeColor} opacity={appearance.strokeOpacity} label="Outline color" defaultOpacity={resetAppearance.strokeOpacity} onOpacityReset={() => resetField('strokeOpacity')} {disabled} onChange={next => update(textStyleColorPatch(appearance, 'stroke', next))}/>
      {:else}
        <label class="caption-check"><input type="checkbox" {disabled} checked={appearance.shadowEnabled} aria-checked={mixed('shadowEnabled')?'mixed':appearance.shadowEnabled} onchange={event=>toggleEffect('shadow',event.currentTarget.checked)}/><span>Shadow</span></label>
        <div class="text-style__shadow-fields">
          {#each [{key:'shadowBlur' as const,label:'Blur, px',min:0},{key:'shadowOffsetX' as const,label:'X offset, px',min:-100},{key:'shadowOffsetY' as const,label:'Y offset, px',min:-100}] as field}
            <div class="caption-field"><span>{field.label}</span><ScrubbableNumber defaultValue={resetAppearance[field.key]} onReset={() => resetField(field.key)} label={`Shadow ${field.label}`} min={field.min} max={100} value={mixed(field.key)?null:appearance[field.key]} {disabled} onChange={next=>update({[field.key]:next})}/></div>
          {/each}
        </div>
        <HslaColorPicker value={appearance.shadowColor} opacity={appearance.shadowOpacity} label="Shadow color" defaultOpacity={resetAppearance.shadowOpacity} onOpacityReset={() => resetField('shadowOpacity')} {disabled} onChange={next => update(textStyleColorPatch(appearance, 'shadow', next))}/>
      {/if}
    </div>
  {/if}


  <div class="text-style__layout-controls" aria-label="Caption layout">
      {#if nativeMode}{@render nativeLayout?.()}{:else}
      <div class="caption-controls">
        <div class="caption-field"><span>Line width, % of frame</span><ScrubbableNumber defaultValue={Math.round(DEFAULT_STYLE.maxWidth * 100)} label="Line width, % of frame" min={10} max={100} value={Math.round(style.maxWidth * 100)} {disabled} onChange={next => onUpdate({ maxWidth: next / 100 })} /></div>
      </div>
      <label class="caption-check"><input type="checkbox" checked={style.backgroundEnabled} onchange={(event) => onUpdate({ backgroundEnabled: event.currentTarget.checked })} /><span>Whole caption background</span></label>
      {#if style.backgroundEnabled}
        <div class="caption-controls">
          <label class="caption-field"><span>Background color</span><input type="color" value={style.backgroundColor} oninput={(event) => onUpdate({ backgroundColor: value(event) })} /></label>
          <div class="caption-field"><span>Opacity, %</span><ScrubbableNumber defaultValue={Math.round(DEFAULT_STYLE.backgroundOpacity * 100)} label="Opacity, %" min={0} max={100} value={Math.round(style.backgroundOpacity * 100)} {disabled} onChange={next => onUpdate({ backgroundOpacity: next / 100 })} /></div>
          <div class="caption-field"><span>Padding, px</span><ScrubbableNumber defaultValue={DEFAULT_STYLE.backgroundPadding} label="Padding, px" min={0} max={100} value={style.backgroundPadding} {disabled} onChange={next => onUpdate({ backgroundPadding: next })} /></div>
          <div class="caption-field"><span>Corners, px</span><ScrubbableNumber defaultValue={DEFAULT_STYLE.backgroundRadius} label="Corners, px" min={0} max={200} value={style.backgroundRadius} {disabled} onChange={next => onUpdate({ backgroundRadius: next })} /></div>
        </div>
      {/if}
      {/if}

  </div>
</fieldset>

<style>
  .text-style__shadow-icon {display:block;inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);& :global(svg) {display:block;inline-size:100%;block-size:100%;}}
  .text-style { --ribbon-height:2.65rem;--ribbon-icon-size:1.5rem;--ribbon-gap:.3rem;--ribbon-radius:.45rem;display:flex;flex-direction:column;gap:var(--caption-space-xs);min-inline-size:0;container:text-style / inline-size;margin:0;padding:var(--caption-space-m) var(--caption-space-l);border:0;border-block-end:1px solid var(--color-panel-border); }
  .text-style__scope {display:flex;align-items:center;gap:.125rem;margin-block-end:var(--caption-space-xs);}
  .text-style__lines {display:flex;align-items:center;flex-wrap:wrap;gap:.125rem;margin-block-end:var(--caption-space-xs);}
  .text-style__lines-label {margin-inline-end:.35rem;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);cursor:help;}
  .text-style__line-button {position:relative;inline-size:1.75rem;min-block-size:1.6rem;padding:0;border:0;border-radius:.3rem;background:transparent;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);font-variant-numeric:tabular-nums;cursor:pointer;&[aria-pressed="true"] {background:var(--color-selection);color:var(--color-accent);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.5;cursor:default;}}
  /* A dot marks a line that has its own style. */
  .text-style__line-button--styled::after {content:"";position:absolute;inset-block-end:.15rem;inset-inline-start:50%;inline-size:.25rem;block-size:.25rem;margin-inline-start:-.125rem;border-radius:50%;background:var(--color-accent);}
  .text-style__line-overrides {display:flex;align-items:center;flex-wrap:wrap;gap:.25rem;margin-block-end:var(--caption-space-xs);font-size:var(--caption-type-xs);color:var(--color-panel-secondary);}
  .text-style__override {display:inline-flex;align-items:center;gap:.2rem;padding:.15rem .4rem;border:1px solid var(--color-panel-border);border-radius:999px;background:var(--color-surface-raised);color:var(--color-panel-text);font-size:var(--caption-type-xs);cursor:pointer;& :global(svg) {inline-size:.8rem;block-size:.8rem;color:var(--color-panel-secondary);}&:hover:enabled {border-color:var(--color-accent);}}
  /* Line scope: controls the line does not set show the inherited value, quieter. */
  .text-style [data-inherited],.text-style__popover [data-inherited] {opacity:.55;}
  .text-style__scope-button {flex:1;min-inline-size:0;min-block-size:2rem;padding:var(--caption-space-xs);border:0;border-radius:.3rem;background:transparent;color:var(--color-panel-secondary);font-size:var(--caption-type-xs);cursor:pointer;&[aria-pressed="true"] {background:var(--color-surface-raised);color:var(--color-panel-text);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.5;cursor:default;}}
  .text-style__ribbon {display:flex;align-items:center;flex-wrap:wrap;gap:var(--ribbon-gap);padding-block:.35rem;}
  .text-style__case-wrap {position:relative;inline-size:3.1rem;block-size:var(--ribbon-height);flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);&:focus-within {outline:2px solid var(--color-accent);outline-offset:1px;}&:has(select:disabled) {opacity:.5;}}
  .text-style__case-display {position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding-inline:.45rem;pointer-events:none;font-size:1rem;& :global(svg) {inline-size:.8rem;block-size:.8rem;fill:none;stroke:currentColor;stroke-width:1.5;}}
  .text-style__case {position:absolute;inset:0;inline-size:100%;border:0;border-radius:inherit;background:transparent;color:transparent;appearance:none;cursor:pointer;& option {background:var(--color-panel-bg);color:var(--color-panel-text);}&:focus-visible {outline:none;}}
  .text-style__segment {display:flex;flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);overflow:hidden;}
  .text-style__toggle {display:grid;place-items:center;inline-size:2.1rem;block-size:var(--ribbon-height);padding:.15rem;border:0;background:transparent;color:var(--color-panel-text);font-size:1.45rem;line-height:1;cursor:pointer;&+& {border-inline-start:1px solid var(--color-panel-border);}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&[aria-pressed="true"] {background:var(--color-selection);color:var(--color-accent);}&[aria-pressed="mixed"] {color:var(--color-accent);text-decoration:underline;}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.5;cursor:default;}}
  .text-style__swatch,.text-style__background,.text-style__outline,.text-style__spacing,.text-style__shadow {display:grid;place-items:center;inline-size:var(--ribbon-height);block-size:var(--ribbon-height);flex-shrink:0;padding:0;border:1px solid var(--color-panel-border);border-radius:var(--ribbon-radius);cursor:pointer;}
  .text-style__swatch {background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__background {background:var(--color-surface-raised);color:var(--color-panel-text);}
  .text-style__spacing,.text-style__shadow {background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg){inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__outline {background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__popover-field {display:flex;align-items:center;justify-content:space-between;gap:.5rem;& :global(.scrubbable-number) {inline-size:5rem;}}
  .text-style__font-group {display:contents;}
  .text-style__family {flex:0 1 13rem;min-inline-size:min(13rem,100%);& :global(.font-picker) {min-block-size:var(--ribbon-height);border:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);}& :global(.font-picker__input) {block-size:var(--ribbon-height);font-size:1rem;}}
  .text-style__weight {appearance:none;box-sizing:border-box;block-size:var(--ribbon-height);background-image:url('data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="%23b0b0b0" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m3 4.5 3 3 3-3"/%3E%3C/svg%3E');background-repeat:no-repeat;background-position:right .4rem center;background-size:.8rem;inline-size:4.5rem;min-inline-size:0;min-block-size:var(--ribbon-height);padding:.25rem 1.35rem .25rem .4rem;border:0;border-radius:var(--ribbon-radius);background-color:var(--color-surface-raised);color:var(--color-panel-text);font:inherit;font-size:var(--caption-type-s);cursor:pointer;&:disabled {opacity:.5;cursor:default;}}
  .text-style__number {display:flex;align-items:center;inline-size:7rem;flex-shrink:0;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);& :global(.scrubbable-number) {flex:1;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {border:0;background:transparent;font-size:1rem;padding-inline:.15rem;text-align:center;}}
  .text-style__size-step {display:grid;place-items:center;inline-size:2rem;block-size:var(--ribbon-height);flex-shrink:0;padding:0;border:0;background:transparent;color:var(--color-panel-text);cursor:pointer;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.4;cursor:default;}}
  .text-style__size-icon {display:none;inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);flex-shrink:0;color:var(--color-panel-text);& :global(svg) {display:block;inline-size:100%;block-size:100%;}}
  /* Narrow panels: one small/large A icon beside the size, like line height, instead of the A-down / A-up buttons. */
  @container text-style (max-width: 47.99rem) {
    .text-style__number {box-sizing:border-box;inline-size:5rem;gap:.1rem;padding-inline:.2rem;}
    .text-style__size-step {display:none;}
    .text-style__size-icon {display:block;}
  }
  .text-style__leading {display:flex;align-items:center;justify-content:center;box-sizing:border-box;block-size:var(--ribbon-height);inline-size:5rem;flex-shrink:0;gap:.1rem;padding-inline:.2rem;border-radius:var(--ribbon-radius);background:var(--color-surface-raised);color:var(--color-panel-text);& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);flex-shrink:0;color:inherit;}& :global(.scrubbable-number) {flex:0 0 2.2rem;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {text-align:center;border:0;background:transparent;padding-inline:.15rem;font-size:var(--caption-type-s);}}
  .text-style__alignment {flex-shrink:0;& :global(.alignment) {border-radius:var(--ribbon-radius);overflow:hidden;}& :global(.alignment__button) {inline-size:2.1rem;block-size:var(--ribbon-height);border:0;background:var(--color-surface-raised);color:var(--color-panel-text);}& :global(.alignment__button[aria-pressed="true"]) {background:var(--color-selection);color:var(--color-accent);}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .text-style__popover {position:fixed;z-index:1000;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:1rem;padding:1.2rem;border:1px solid var(--color-panel-border);border-radius:var(--caption-radius);background:var(--color-panel-bg);color:var(--color-panel-text);font-family:inherit;font-size:var(--caption-type-s);& .caption-check {margin:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {color:var(--color-accent);}}
  .text-style__layout-controls {display:flex;flex-direction:column;gap:var(--caption-space-s);padding-block-start:var(--caption-space-m);border-block-start:1px solid var(--color-panel-border);}
  .text-style__shadow-fields {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.65rem;}
  .text-style :global(button:focus-visible),.text-style :global(input:focus-visible),.text-style :global(select:focus-visible),.text-style__popover :global(input:focus-visible) {outline:2px solid var(--color-accent);outline-offset:1px;}
</style>
