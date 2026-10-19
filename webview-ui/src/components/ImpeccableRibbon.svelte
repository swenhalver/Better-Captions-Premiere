<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { bubblePreviewJoins } from '../lib/bubble-preview-joins';
  import FontPicker from './FontPicker.svelte';
  import HslaColorPicker from './HslaColorPicker.svelte';
  import LucideIcon from './LucideIcon.svelte';
  import WordBackgroundPreview from './WordBackgroundPreview.svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';
  type Scope = 'All words' | 'Past' | 'Current' | 'Next';
  type Appearance = { font:string; size:number; weight:number; bold:boolean; italic:boolean; underline:boolean; color:string; casing:string; opacity:number; outline:number; outlineEnabled:boolean; outlineColor:string; outlineOpacity:number; spacing:number; leading:number; bubble:boolean; backgroundColor:string; backgroundOpacity:number; colorSpaces:boolean; padding:number; bubblePaddingInline?:number; bubblePaddingBlock?:number; radius:number };
  const base = ():Appearance => ({font:'Helvetica Neue',size:60,weight:400,bold:false,italic:false,underline:false,color:'#ffffff',casing:'none',opacity:100,outline:2,outlineEnabled:false,outlineColor:'#111111',outlineOpacity:100,spacing:0,leading:1.2,bubble:false,backgroundColor:'#993fa0',backgroundOpacity:100,colorSpaces:false,padding:6,radius:5});
  let scope = $state<Scope>('All words');
  let styles = $state<Record<Scope, Appearance>>({'All words':base(),Past:{...base(),color:'#b3b3b3'},Current:{...base(),color:'#181818',bubble:true,bold:true},Next:base()});
  let active = $derived(styles[scope]);
  const outlinePreviewEnabled = $derived(active.outlineEnabled && active.outline > 0 && active.outlineOpacity > 0 && !!active.outlineColor);
  let alignment = $state<'left'|'center'|'right'>('center');
  let tab = $state('Spacing');
  let width = $state(674), height = $state(160), x = $state(360), y = $state(640);
  const tabs = ['Spacing','Outline','Layout'];
  const fonts = ['Arial','Avenir Next','Georgia','Helvetica Neue','Menlo','Times New Roman','Verdana'];
  const id = $props.id();
  let textPopover: HTMLDetailsElement | undefined;
  let backgroundPopover: HTMLDetailsElement | undefined;
  let outlinePopover: HTMLDetailsElement | undefined;
  function closePopovers(except?: HTMLDetailsElement) {
    for (const dialog of [textPopover, backgroundPopover, outlinePopover]) if (dialog && dialog !== except) dialog.open = false;
  }
  function outsidePopovers(event: PointerEvent) {
    const target = event.target as Node;
    if (![textPopover, backgroundPopover, outlinePopover].some(dialog => dialog?.contains(target))) closePopovers();
  }
  function update<K extends keyof Appearance>(key:K,value:Appearance[K]) { styles[scope][key] = value; }
  function appearance(index:number):Appearance {return {...styles['All words'], ...styles[index<2?'Past':index===2?'Current':'Next']};}
  function caseText(text:string,casing:string) { return casing==='upper'?text.toUpperCase():casing==='lower'?text.toLowerCase():casing==='title'?text.replace(/\b\w/g,c=>c.toUpperCase()):text; }
  let wordSpecimen: HTMLDivElement | undefined;
  let joinedBefore = $state<boolean[]>([]), joinedAfter = $state<boolean[]>([]);
  function measureJoins() {
    const nodes = [...wordSpecimen?.querySelectorAll<HTMLElement>('.impeccable-ribbon__word') ?? []];
    const { before, after } = bubblePreviewJoins(nodes.map((node, index) => {
      const state = scope === 'All words' ? styles['All words'] : appearance(index);
      const rect = node.getBoundingClientRect();
      const marker = node.querySelector<HTMLElement>('.impeccable-ribbon__baseline');
      return { left: rect.left, baseline: marker?.getBoundingClientRect().top ?? NaN, bubble: state.bubble, fillSpaces: state.colorSpaces };
    }));
    joinedBefore = before;
    joinedAfter = after;
  }
  let joinsQueued = false;
  let disposed = false;
  function queueJoins() {
    if (disposed || joinsQueued) return;
    joinsQueued = true;
    // Hidden browser panels suspend animation frames. Svelte's DOM-flush
    // promise still runs, so editing must not wait for a visible paint frame.
    void tick().then(() => {
      joinsQueued = false;
      if (!disposed) measureJoins();
    });
  }
  onMount(() => {
    const observer = new ResizeObserver(queueJoins);
    if (wordSpecimen) {
      observer.observe(wordSpecimen);
      // The outer specimen can keep its height while its inner text rewraps.
      // Watch the actual line-layout container and glyph boxes as well.
      for (const node of wordSpecimen.querySelectorAll('.impeccable-ribbon__text, .impeccable-ribbon__word')) observer.observe(node);
    }
    void document.fonts.ready.then(queueJoins);
    document.fonts.addEventListener('loadingdone', queueJoins);
    document.fonts.addEventListener('loadingerror', queueJoins);
    window.addEventListener('resize', queueJoins);
    queueJoins();
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', queueJoins);
      document.fonts.removeEventListener('loadingerror', queueJoins);
      window.removeEventListener('resize', queueJoins);
    };
  });
  onDestroy(() => { disposed = true; });
  $effect(() => { JSON.stringify(styles); void scope; void width; void alignment; queueJoins(); });
  function changeTab(event:KeyboardEvent,index:number) { if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:tabs.length-1))%tabs.length; tab=tabs[next]; document.getElementById(`${id}-tab-${next}`)?.focus(); }
</script>

<svelte:window onpointerdown={outsidePopovers}/>

<section class="impeccable-ribbon" aria-label="Mac ribbon design, interactive synthetic sample">
  <div class="impeccable-ribbon__scope" role="group" aria-label="Words to style">
    {#each ['All words','Past','Current','Next'] as name}
      <button aria-pressed={scope===name} onclick={()=>scope=name as Scope}>{name}</button>
    {/each}
    <button class="impeccable-ribbon__reset" aria-label="Reset selected word style" title="Reset selected word style" onclick={()=>styles[scope]=base()}><LucideIcon name="reset"/></button>
  </div>

  <div class="impeccable-ribbon__bar" aria-label="Text formatting">
    <div class="impeccable-ribbon__case-wrap">
      <span class="impeccable-ribbon__case-display" aria-hidden="true">Aa<LucideIcon name="chevron-down"/></span>
      <select class="impeccable-ribbon__case" onfocus={() => closePopovers()} aria-label="Text case" title="Text case" value={active.casing} onchange={e=>update('casing',e.currentTarget.value)}><option value="none">As typed</option><option value="upper">UPPERCASE</option><option value="lower">lowercase</option><option value="title">Title Case</option></select>
    </div>
    <div class="impeccable-ribbon__segment" role="group" aria-label="Emphasis">
      <button class="impeccable-ribbon__emphasis" aria-label="One weight bolder" title="One weight bolder" aria-pressed={active.bold} onclick={()=>update('bold',!active.bold)}><LucideIcon name="bold"/></button>
      <button class="impeccable-ribbon__emphasis" aria-label="Italic" title="Italic" aria-pressed={active.italic} onclick={()=>update('italic',!active.italic)}><LucideIcon name="italic"/></button>
      <button class="impeccable-ribbon__emphasis" aria-label="Underline" title="Underline" aria-pressed={active.underline} onclick={()=>update('underline',!active.underline)}><LucideIcon name="underline"/></button>
    </div>
    <details class="impeccable-ribbon__background" bind:this={textPopover} name={`${id}-format-popovers`}>
      <summary class="impeccable-ribbon__swatch" onclick={() => closePopovers(textPopover)} aria-label="Text color and opacity" title="Text color and opacity" style:background={active.color}></summary>
      <div class="impeccable-ribbon__background-popover">
        <HslaColorPicker value={active.color} opacity={active.opacity/100} label="Text color" onChange={({color,opacity})=>{update('color',color);update('opacity',opacity*100);}}/>
      </div>
    </details>
    <details class="impeccable-ribbon__background" bind:this={backgroundPopover} name={`${id}-format-popovers`}>
      <summary class="impeccable-ribbon__background-trigger" onclick={() => closePopovers(backgroundPopover)} aria-label="Word background color" title={active.bubble?'Word background color':'No word background'}><WordBackgroundPreview enabled={active.bubble} color={active.backgroundColor} opacity={active.backgroundOpacity/100} textColor={active.color} textOpacity={active.opacity/100} outlined={active.outlineEnabled&&active.outline>0&&active.outlineOpacity>0} outlineColor={active.outlineColor} outlineOpacity={active.outlineOpacity/100}/></summary>
      <div class="impeccable-ribbon__background-popover">
        <label class="impeccable-ribbon__toggle"><input type="checkbox" checked={active.bubble} onchange={e=>update('bubble',e.currentTarget.checked)}/>Word background</label>
        <HslaColorPicker value={active.backgroundColor} opacity={active.backgroundOpacity/100} label="Word background" onChange={({color,opacity})=>{update('backgroundColor',color);update('backgroundOpacity',opacity*100);update('bubble',true);}}/>
        <div class="impeccable-ribbon__popover-grid">
          <label class="impeccable-ribbon__popover-field" title="Left and right padding"><span>Inline padding</span><ScrubbableNumber label="Bubble inline padding" value={active.bubblePaddingInline ?? active.padding} min={0} max={100} onChange={value=>update('bubblePaddingInline',value)}/></label>
          <label class="impeccable-ribbon__popover-field" title="Top and bottom padding"><span>Block padding</span><ScrubbableNumber label="Bubble block padding" value={active.bubblePaddingBlock ?? active.padding} min={0} max={100} onChange={value=>update('bubblePaddingBlock',value)}/></label>
          <label class="impeccable-ribbon__popover-field"><span>Corners, px</span><ScrubbableNumber label="Bubble corners" value={active.radius} min={0} max={30} onChange={value=>update('radius',value)}/></label>
        </div>
        <label class="impeccable-ribbon__toggle impeccable-ribbon__spaces"><input type="checkbox" checked={active.colorSpaces} onchange={e=>update('colorSpaces',e.currentTarget.checked)}/>Color spaces between words</label>
      </div>
    </details>
    <details class="impeccable-ribbon__background" bind:this={outlinePopover} name={`${id}-format-popovers`}>
      <summary class="impeccable-ribbon__outline-trigger" onclick={() => closePopovers(outlinePopover)} aria-label="Outline settings" title="Outline settings"><LucideIcon name="outline" fill={outlinePreviewEnabled?active.color:'none'} stroke={outlinePreviewEnabled?active.outlineColor:'currentColor'} fillOpacity={outlinePreviewEnabled?active.opacity/100:1} strokeOpacity={outlinePreviewEnabled?active.outlineOpacity/100:1}/></summary>
      <div class="impeccable-ribbon__background-popover">
        <label class="impeccable-ribbon__toggle"><input type="checkbox" checked={active.outlineEnabled} onchange={event=>update('outlineEnabled',event.currentTarget.checked)}/>Outline</label>
        <label class="impeccable-ribbon__popover-field"><span>Width, px</span><ScrubbableNumber label="Outline width, px" value={active.outline} min={0} max={16} step={.5} onChange={value=>{update('outline',value);update('outlineEnabled',value>0);}}/></label>
        <HslaColorPicker value={active.outlineColor} opacity={active.outlineOpacity/100} label="Outline color" onChange={({color,opacity})=>{update('outlineColor',color);update('outlineOpacity',opacity*100);}}/>
      </div>
    </details>
    <div class="impeccable-ribbon__family"><FontPicker value={active.font} {fonts} onOpen={() => closePopovers()} onSelect={font=>update('font',font)}/></div>
    <select class="impeccable-ribbon__weight" onfocus={() => closePopovers()} aria-label="Font weight" title="Font weight" value={active.weight} onchange={e=>update('weight',Number(e.currentTarget.value))}>{#each [100,200,300,400,500,600,700,800,900] as weight}<option value={weight}>{weight}</option>{/each}</select>
    <div class="impeccable-ribbon__size"><button class="impeccable-ribbon__size-step" type="button" aria-label="Decrease font size" title="Decrease font size" disabled={active.size<=8} onclick={()=>update('size',Math.max(8,active.size-1))}><LucideIcon name="a-arrow-down"/></button><ScrubbableNumber label="Font size" value={active.size} min={8} max={240} onChange={value=>update('size',value)}/><button class="impeccable-ribbon__size-step" type="button" aria-label="Increase font size" title="Increase font size" disabled={active.size>=240} onclick={()=>update('size',Math.min(240,active.size+1))}><LucideIcon name="a-arrow-up"/></button></div>

    {#if scope==='All words'}<div class="impeccable-ribbon__alignment"><AlignmentButtons value={alignment} onChange={value=>alignment=value}/></div>{/if}
    <div class="impeccable-ribbon__leading" title="Line height — applies to all words"><LucideIcon name="line-height"/><ScrubbableNumber label="Line height" value={styles['All words'].leading} min={.6} max={3} step={.05} onChange={value=>{for (const key of ['All words','Past','Current','Next'] as Scope[]) styles[key].leading=value;}}/></div>
  </div>

  <div class="impeccable-ribbon__tabs" role="tablist" aria-label="Additional text controls">
    {#each tabs as name,index}<button id={`${id}-tab-${index}`} role="tab" aria-selected={tab===name} aria-controls={`${id}-details`} tabindex={tab===name?0:-1} onclick={()=>tab=name} onkeydown={event=>changeTab(event,index)}>{name}</button>{/each}
  </div>
  <div class="impeccable-ribbon__details" id={`${id}-details`} role="tabpanel" aria-labelledby={`${id}-tab-${tabs.indexOf(tab)}`} tabindex="0">
    {#if tab==='Spacing'}
      <label class="impeccable-ribbon__field"><span>Word spacing</span><div class="impeccable-ribbon__value"><ScrubbableNumber label="Word spacing" value={active.spacing} min={0} max={60} onChange={value=>update('spacing',value)}/><small>px</small></div></label>
    {:else if tab==='Outline'}
      <label class="impeccable-ribbon__field"><span>Outline width</span><div class="impeccable-ribbon__value"><ScrubbableNumber label="Outline width" value={active.outline} min={0} max={16} onChange={value=>{update('outline',value);update('outlineEnabled',value>0);}}/><small>px</small></div></label>
    {:else}
      {#each [{label:'Position X',value:x,set:(v:number)=>x=v},{label:'Position Y',value:y,set:(v:number)=>y=v},{label:'Width',value:width,set:(v:number)=>width=v},{label:'Height',value:height,set:(v:number)=>height=v}] as field}
        <label class="impeccable-ribbon__field"><span>{field.label}</span><ScrubbableNumber label={field.label} value={field.value} min={0} max={1400} onChange={field.set}/></label>
      {/each}
    {/if}
  </div>

  <div class="impeccable-ribbon__specimen" bind:this={wordSpecimen} aria-label="Synthetic typography sample" style:text-align={alignment}>
    <div class="impeccable-ribbon__text" style:font-size={`${styles['All words'].size/2}px`} style:line-height={styles['All words'].leading} style:width={`${Math.max(15,width/7)}%`} style:min-height={`${height/5}px`} style:transform={`translate(${(x-360)/15}px,${(y-640)/15}px)`}>
      {#each ['Every','word','has','its','own','style.'] as word,index}
        {@const state=scope==='All words'?styles['All words']:appearance(index)}
        {@const shown=caseText(word,state.casing)+(state.bubble&&state.colorSpaces&&index<5?'\u00a0':'')}
        <span class="impeccable-ribbon__word" style:font-family={state.font} style:font-size={`${state.size/2}px`} style:font-weight={Math.min(900,state.weight+(state.bold?100:0))} style:font-style={state.italic?'italic':'normal'} style:color={state.color} style:line-height={state.leading} style:margin-inline-end={state.bubble&&state.colorSpaces?'0':`${state.spacing/2}px`} style:padding={state.bubble?`${(state.bubblePaddingBlock ?? state.padding)/2}px ${(state.bubblePaddingInline ?? state.padding)/2}px`:'0'} style:padding-inline-end={state.bubble&&state.colorSpaces?`${((state.bubblePaddingInline ?? state.padding)+state.spacing)/2}px`:undefined} style:border-radius={`${joinedBefore[index]?0:state.radius/2}px ${joinedAfter[index]?0:state.radius/2}px ${joinedAfter[index]?0:state.radius/2}px ${joinedBefore[index]?0:state.radius/2}px`}>
          {#if state.bubble}<span class="impeccable-ribbon__word-background" aria-hidden="true" style:background={state.backgroundColor} style:opacity={state.backgroundOpacity/100}></span>{/if}
          <span class="impeccable-ribbon__outline" aria-hidden="true" style:opacity={state.opacity*state.outlineOpacity/10000} style:-webkit-text-stroke={`${state.outlineEnabled?state.outline:0}px ${state.outlineColor}`}>{shown}</span><span class="impeccable-ribbon__fill" style:opacity={state.opacity/100} style:text-decoration-line={state.underline?'underline':undefined}>{shown}<span class="impeccable-ribbon__baseline" aria-hidden="true"></span></span>
        </span>{state.bubble&&state.colorSpaces?'':' '}

      {/each}
    </div>
  </div>
</section>

<style>
  .impeccable-ribbon {--ribbon-space:.375rem;--ribbon-radius:.6rem;--ribbon-height:2.65rem;--ribbon-icon-size:1.5rem;--ribbon-neutral-l:30%;--ribbon-neutral-c:0;--ribbon-neutral-h:0;--ribbon-control:oklch(var(--ribbon-neutral-l) var(--ribbon-neutral-c) var(--ribbon-neutral-h));container:mac-ribbon / inline-size;background:var(--color-panel-bg);color:var(--color-panel-text);min-inline-size:0;}
  .impeccable-ribbon__scope {display:flex;align-items:center;gap:.125rem;padding:.6rem .75rem;border-block-end:1px solid var(--color-panel-border);& button {font:inherit;font-size:.9rem;padding:.4rem .65rem;color:var(--color-panel-secondary);background:transparent;border:0;border-radius:.35rem;cursor:pointer;&[aria-pressed="true"] {color:var(--color-panel-text);background:var(--ribbon-control);}}& .impeccable-ribbon__reset {margin-inline-start:auto;padding:.25rem;display:grid;place-items:center;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);stroke:currentColor;stroke-width:1.6;fill:none;}}}
  .impeccable-ribbon__bar {position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:var(--ribbon-space);padding:.9rem .75rem;}
  .impeccable-ribbon__case,.impeccable-ribbon__weight {border:0;background:var(--ribbon-control);color:var(--color-panel-text);border-radius:var(--ribbon-radius);font:inherit;font-size:1.15rem;block-size:var(--ribbon-height);padding-inline:.55rem;cursor:pointer;}
  .impeccable-ribbon__case-wrap {position:relative;inline-size:4.1rem;block-size:var(--ribbon-height);border-radius:var(--ribbon-radius);background:var(--ribbon-control);flex-shrink:0;&:focus-within {outline:2px solid var(--color-accent);outline-offset:2px;}}
  .impeccable-ribbon__case-display {position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding-inline:.55rem;pointer-events:none;font-size:1.15rem;& :global(svg) {inline-size:1rem;block-size:1rem;fill:none;stroke:currentColor;stroke-width:1.5;}}
  .impeccable-ribbon__case {position:absolute;inset:0;inline-size:100%;color:transparent;background:transparent;appearance:none;& option {color:var(--color-panel-text);background:var(--color-panel-bg);}&:focus-visible {outline:none;}}
  .impeccable-ribbon__weight {inline-size:5rem;}
  .impeccable-ribbon__segment {display:flex;border-radius:var(--ribbon-radius);background:var(--ribbon-control);overflow:hidden;flex-shrink:0;}
  .impeccable-ribbon__emphasis {inline-size:2.6rem;block-size:var(--ribbon-height);display:grid;place-items:center;background:transparent;color:var(--color-panel-text);border:0;cursor:pointer;font-size:1.85rem;line-height:1;&+& {border-inline-start:1px solid var(--color-panel-border);}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&[aria-pressed="true"] {background:var(--color-primary);color:white;}}
  .impeccable-ribbon__swatch {cursor:pointer;list-style:none;box-sizing:border-box;border:1px solid var(--color-panel-border);&::-webkit-details-marker {display:none;}&:focus-visible {outline:2px solid var(--color-accent);outline-offset:2px;}display:block;block-size:var(--ribbon-height);inline-size:var(--ribbon-height);border-radius:var(--ribbon-radius);overflow:hidden;flex-shrink:0;}
  .impeccable-ribbon__background {position:relative;flex-shrink:0;}
  .impeccable-ribbon__background-trigger {--word-background-base:var(--ribbon-control);display:grid;place-items:center;block-size:var(--ribbon-height);inline-size:var(--ribbon-height);border-radius:var(--ribbon-radius);border:1px solid var(--color-panel-border);background:var(--ribbon-control);cursor:pointer;list-style:none;box-sizing:border-box;&::-webkit-details-marker {display:none;}&:focus-visible {outline:2px solid var(--color-accent);outline-offset:2px;}}
  .impeccable-ribbon__outline-trigger {display:grid;place-items:center;inline-size:var(--ribbon-height);block-size:var(--ribbon-height);border:0;border-radius:var(--ribbon-radius);background:var(--ribbon-control);color:var(--color-panel-text);cursor:pointer;list-style:none;&::-webkit-details-marker {display:none;}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .impeccable-ribbon__background-popover {position:absolute;inset-block-start:calc(100% + .4rem);inset-inline-end:0;z-index:12;inline-size:min(17rem,calc(100cqi - 1.5rem));box-sizing:border-box;padding:.85rem;background:var(--color-panel-bg);border:1px solid var(--color-panel-border);border-radius:var(--ribbon-radius);}
  .impeccable-ribbon__popover-field {display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-block-start:.55rem;font-size:.9rem;& :global(.scrubbable-number) {inline-size:4.5rem;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {color:var(--color-accent);min-block-size:1.8rem;padding:.2rem .35rem;}}
  .impeccable-ribbon__popover-grid {display:grid;grid-template-columns:1fr 1fr;gap:.65rem;& label {display:grid;gap:.25rem;}& :global(.scrubbable-number) {inline-size:100%;}}
  .impeccable-ribbon__spaces {margin-block-start:.75rem;}

  .impeccable-ribbon__family {flex:1 1 10rem;min-inline-size:7rem;& :global(.font-picker) {min-block-size:var(--ribbon-height);border:0;border-radius:var(--ribbon-radius);background:var(--ribbon-control);}& :global(.font-picker__input) {min-block-size:var(--ribbon-height);font-size:1.35rem;padding-inline:.7rem;}}
  .impeccable-ribbon__size {display:flex;align-items:center;inline-size:8rem;background:var(--ribbon-control);border-radius:var(--ribbon-radius);& :global(.scrubbable-number) {flex:1;min-inline-size:0;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {font-size:1.35rem;block-size:var(--ribbon-height);border:0;background:transparent;padding-inline:.15rem;text-align:center;}}
  .impeccable-ribbon__size-step {display:grid;place-items:center;inline-size:2.25rem;block-size:var(--ribbon-height);flex-shrink:0;padding:0;border:0;background:transparent;color:var(--color-panel-text);cursor:pointer;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}&:hover:enabled {background:var(--color-surface-overlay);}&:disabled {opacity:.4;cursor:default;}}
  .impeccable-ribbon__leading {display:flex;align-items:center;inline-size:5rem;gap:.2rem;border-radius:var(--ribbon-radius);background:var(--ribbon-control);color:var(--color-panel-text);padding-inline:.25rem;& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);flex-shrink:0;color:inherit;}& :global(.scrubbable-number) {flex:1;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {block-size:var(--ribbon-height);border:0;background:transparent;padding-inline:.2rem;font-size:1rem;}}
  .impeccable-ribbon__alignment {border-radius:var(--ribbon-radius);overflow:hidden;& :global(.alignment__button) {inline-size:2.6rem;block-size:var(--ribbon-height);border:0;background:var(--ribbon-control);color:var(--color-panel-text);}& :global(.alignment__button[aria-pressed="true"]) {background:var(--color-primary);color:white;}& :global(svg) {inline-size:var(--ribbon-icon-size);block-size:var(--ribbon-icon-size);}}
  .impeccable-ribbon__tabs {display:flex;gap:1.1rem;padding-inline:.75rem;border-block-end:1px solid var(--color-panel-border);& button {padding:.3rem 0 .65rem;background:transparent;border:0;border-block-end:2px solid transparent;color:var(--color-panel-text);font:inherit;font-size:.95rem;cursor:pointer;&[aria-selected="true"] {color:var(--color-accent);border-block-end-color:var(--color-accent);}}}
  .impeccable-ribbon__details {display:grid;grid-template-columns:repeat(auto-fit,minmax(8.25rem,1fr));gap:.75rem;padding:.75rem;align-items:center;}
  .impeccable-ribbon__field {display:flex;align-items:center;justify-content:space-between;gap:.4rem;font-size:.9rem;min-inline-size:0;&>span {color:var(--color-panel-secondary);white-space:nowrap;}& :global(.scrubbable-number) {max-inline-size:5.2rem;}& :global(.scrubbable-number__value),& :global(.scrubbable-number__input) {color:var(--color-accent);background:transparent;border:0;text-align:end;padding:.25rem;font-size:1rem;min-block-size:1.8rem;}}
  .impeccable-ribbon__value {display:flex;align-items:center;min-inline-size:3rem;& small {font-size:.8rem;color:var(--color-panel-secondary);}}
  .impeccable-ribbon__toggle {display:flex;align-items:center;gap:.4rem;font-size:.9rem;}
  .impeccable-ribbon__specimen {border-block-start:1px solid var(--color-panel-border);min-block-size:8rem;padding:1.8rem 1rem;overflow:hidden;display:flex;justify-content:center;align-items:center;background:var(--color-input);}
  .impeccable-ribbon__text {max-inline-size:100%;}
  .impeccable-ribbon__word {position:relative;isolation:isolate;display:inline-grid;grid-template:1fr / 1fr;vertical-align:baseline;}
  .impeccable-ribbon__word-background {position:absolute;inset:0;border-radius:inherit;z-index:-1;pointer-events:none;}
  .impeccable-ribbon__outline,.impeccable-ribbon__fill {grid-area:1 / 1;}
  .impeccable-ribbon__outline {z-index:0;}
  .impeccable-ribbon__fill {z-index:1;}
  .impeccable-ribbon__baseline {display:inline-block;inline-size:0;block-size:0;vertical-align:baseline;margin:0;padding:0;border:0;}
  .impeccable-ribbon :global(button:focus-visible),.impeccable-ribbon :global(select:focus-visible),.impeccable-ribbon :global(input:focus-visible) {outline:2px solid var(--color-accent);outline-offset:2px;}
  .impeccable-ribbon :global(::selection) {background:var(--color-selection);color:var(--color-panel-text);}
  .impeccable-ribbon__background {@container mac-ribbon (max-width:31rem) {position:static;}}
  .impeccable-ribbon__background-popover {@container mac-ribbon (max-width:31rem) {inset-inline-end:.75rem;}}
  .impeccable-ribbon__family {@container mac-ribbon (max-width:31rem) {order:-1;flex-basis:calc(100% - 15rem);}}
  .impeccable-ribbon__weight {@container mac-ribbon (max-width:31rem) {order:-1;}}
  .impeccable-ribbon__size {@container mac-ribbon (max-width:31rem) {order:-1;}}
  .impeccable-ribbon__details {@container mac-ribbon (min-width:45rem) {grid-template-columns:repeat(4,minmax(0,1fr));}}
</style>
