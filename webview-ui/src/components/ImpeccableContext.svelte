<script lang="ts">
  import FontPicker from './FontPicker.svelte';
  import AlignmentButtons from './AlignmentButtons.svelte';
  import ScrubbableNumber from './ScrubbableNumber.svelte';

  type Scope = 'all' | 'past' | 'current' | 'next';
  type Shelf = 'spacing' | 'outline' | 'shadow' | 'bubble' | 'layout';
  type Appearance = { family: string; weight: number; size: number; bold: boolean; italic: boolean; color: string; casing: string; spacing: number; leading: number; outline: number; outlineColor: string; shadow: number; bubble: boolean; bubbleColor: string; padding: number; radius: number };
  const fresh = (): Appearance => ({ family: 'Helvetica Neue', weight: 400, size: 38, bold: false, italic: false, color: '#ffffff', casing: 'original', spacing: 0, leading: 1.3, outline: 0, outlineColor: '#111111', shadow: 0, bubble: false, bubbleColor: '#ffd654', padding: 5, radius: 5 });
  let appearances = $state<Record<Scope, Appearance>>({ all: fresh(), past: { ...fresh(), color: '#acb1b8' }, current: { ...fresh(), bold: true, color: '#171717', bubble: true }, next: fresh() });
  let scope = $state<Scope>('all');
  let shelf = $state<Shelf | null>(null);
  let align = $state<'left' | 'center' | 'right'>('center');
  let boxWidth = $state(85), boxHeight = $state(74), x = $state(50), y = $state(53);
  const current = $derived(appearances[scope]);
  const id = $props.id();
  const fonts = ['Arial', 'Georgia', 'Helvetica Neue', 'Times New Roman', 'Verdana'];
  const scopes: { key: Scope; text: string }[] = [{ key: 'all', text: 'All words' }, { key: 'past', text: 'Past' }, { key: 'current', text: 'Current' }, { key: 'next', text: 'Next' }];
  const shelves: { key: Shelf; text: string; path: string }[] = [
    { key: 'spacing', text: 'Spacing', path: 'M4 5h16M4 19h16M8 9l-3 3 3 3m8-6 3 3-3 3M5 12h14' },
    { key: 'outline', text: 'Outline', path: 'm4 20 8-16 8 16M7 14h10' },
    { key: 'shadow', text: 'Shadow', path: 'M5 4h11v13H5zM9 20h11V8' },
    { key: 'bubble', text: 'Bubble', path: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z' },
    { key: 'layout', text: 'Position & size', path: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M8 8h8v8H8z' },
  ];
  function change<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    if (scope === 'all') for (const item of Object.values(appearances)) item[key] = value;
    else appearances[scope][key] = value;
  }
  function rendered(word: string, index: number) {
    const look = appearances[index < 3 ? 'past' : index === 3 ? 'current' : 'next'];
    return look.casing === 'upper' ? word.toUpperCase() : look.casing === 'lower' ? word.toLowerCase() : look.casing === 'title' ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
  }
  function sampleStyle(index: number) {
    const look = appearances[index < 3 ? 'past' : index === 3 ? 'current' : 'next'];
    return `font-family:"${look.family}",sans-serif;font-size:${look.size}px;font-weight:${Math.min(900, look.weight + (look.bold ? 100 : 0))};font-style:${look.italic ? 'italic' : 'normal'};color:${look.color};margin-inline-end:${look.spacing}px;line-height:${look.leading};-webkit-text-stroke:${look.outline}px ${look.outlineColor};paint-order:stroke fill;text-shadow:${look.shadow ? `2px 3px ${look.shadow}px #000` : 'none'};background:${look.bubble ? look.bubbleColor : 'transparent'};padding:${look.bubble ? look.padding : 0}px;border-radius:${look.radius}px`;
  }
  function resetShelf() {
    if (shelf === 'spacing') { change('spacing', 0); change('leading', 1.3); }
    if (shelf === 'outline') change('outline', 0);
    if (shelf === 'shadow') change('shadow', 0);
    if (shelf === 'bubble') { change('bubble', false); change('padding', 5); change('radius', 5); }
    if (shelf === 'layout') { boxWidth = 85; boxHeight = 74; x = 50; y = 53; }
  }
</script>

<section class="context-inspector" aria-label="Contextual typography design">
  <div class="context-inspector__scopes" role="group" aria-label="Word appearance">
    {#each scopes as option}<button class="context-inspector__scope" aria-pressed={scope === option.key} onclick={() => scope = option.key}>{option.text}</button>{/each}
  </div>
  <div class="context-inspector__typography">
    <div class="context-inspector__family"><FontPicker value={current.family} {fonts} onSelect={(value) => change('family', value)} /></div>
    <select class="context-inspector__weight" aria-label="Font weight" value={current.weight} onchange={(event) => change('weight', Number(event.currentTarget.value))}>
      {#each current.family === 'Helvetica Neue' ? [100, 200, 300, 400, 500, 600, 700, 800, 900] : [400, 700] as weight}<option value={weight}>{weight}</option>{/each}
    </select>
    <div class="context-inspector__size"><ScrubbableNumber label="Font size" value={current.size} min={12} max={96} step={1} variant="hot" onChange={(value) => change('size', value)} /><span>px</span></div>
  </div>
  <div class="context-inspector__formatting" role="group" aria-label="Text formatting">
    <div class="context-inspector__segment">
      <button class="context-inspector__format context-inspector__format--bold" title="One step bolder" aria-label="One step bolder" aria-pressed={current.bold} onclick={() => change('bold', !current.bold)}>B</button>
      <button class="context-inspector__format context-inspector__format--italic" title="Italic" aria-label="Italic" aria-pressed={current.italic} onclick={() => change('italic', !current.italic)}>I</button>
      <label class="context-inspector__swatch" title="Text color"><input aria-label="Text color" type="color" value={current.color} oninput={(event) => change('color', event.currentTarget.value)} /></label>
    </div>
    <label class="context-inspector__highlight" title="Word background color"><span aria-hidden="true">A</span><input aria-label="Word background color" type="color" value={current.bubbleColor} oninput={(event) => { change('bubbleColor', event.currentTarget.value); change('bubble', true); }} /><i style={`background:${current.bubble ? current.bubbleColor : 'transparent'}`}></i></label>
    <select class="context-inspector__case" aria-label="Text case" value={current.casing} onchange={(event) => change('casing', event.currentTarget.value)}><option value="original">Aa</option><option value="upper">AA</option><option value="lower">aa</option><option value="title">Title</option></select>
    {#if scope === 'all'}<AlignmentButtons value={align} onChange={(value) => align = value} />{/if}
    <span class="context-inspector__spacer"></span>
    <button class="context-inspector__more" aria-label="Show effect controls" aria-expanded={shelf !== null} onclick={() => shelf = shelf ? null : 'spacing'} title="Show effect controls"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16M9 4v6m6 4v6" /></svg></button>
  </div>
  {#if shelf !== null}
    <div class="context-inspector__shelf">
      <div class="context-inspector__shelf-top">
        <div class="context-inspector__tabs" role="tablist" aria-label="Appearance details">
          {#each shelves as item}<button class="context-inspector__tab" role="tab" aria-selected={shelf === item.key} aria-controls={`${id}-effect-panel`} id={`${id}-${item.key}`} tabindex={shelf === item.key ? 0 : -1} onkeydown={(event) => { const index = shelves.findIndex(option => option.key === item.key); const next = event.key === 'Home' ? 0 : event.key === 'End' ? shelves.length - 1 : event.key === 'ArrowRight' ? (index + 1) % shelves.length : event.key === 'ArrowLeft' ? (index + shelves.length - 1) % shelves.length : -1; if (next >= 0) { event.preventDefault(); shelf = shelves[next].key; document.getElementById(`${id}-${shelf}`)?.focus(); } }} aria-label={item.text} title={item.text} onclick={() => shelf = item.key}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={item.path} /></svg><span>{item.key === 'layout' ? 'Layout' : item.text}</span></button>{/each}
        </div>
        <button class="context-inspector__reset" aria-label="Reset current effect controls" title="Reset current controls" onclick={resetShelf}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/></svg></button>
      </div>
      <div class="context-inspector__fields" id={`${id}-effect-panel`} role="tabpanel" aria-labelledby={`${id}-${shelf}`}>
        {#if shelf === 'spacing'}
          <label class="context-inspector__field"><span>Word spacing</span><div><ScrubbableNumber value={current.spacing} label="Word spacing" min={0} max={32} step={.5} variant="hot" onChange={(value) => change('spacing', value)} /><span>px</span></div></label>
          <label class="context-inspector__field"><span>Line height</span><div><ScrubbableNumber value={current.leading} label="Line height" min={.8} max={2.5} step={.05} decimals={2} variant="hot" onChange={(value) => change('leading', value)} /><span>×</span></div></label>
        {:else if shelf === 'outline'}
          <label class="context-inspector__field"><span>Outline width</span><div><ScrubbableNumber value={current.outline} label="Outline width" min={0} max={8} step={.5} variant="hot" onChange={(value) => change('outline', value)} /><span>px</span></div></label>
          <label class="context-inspector__field"><span>Outline color</span><input type="color" aria-label="Outline color" value={current.outlineColor} oninput={(event) => change('outlineColor', event.currentTarget.value)} /></label>
        {:else if shelf === 'shadow'}
          <label class="context-inspector__field"><span>Shadow softness</span><div><ScrubbableNumber value={current.shadow} label="Shadow softness" min={0} max={24} step={1} variant="hot" onChange={(value) => change('shadow', value)} /><span>px</span></div></label>
        {:else if shelf === 'bubble'}
          <label class="context-inspector__check"><input type="checkbox" checked={current.bubble} onchange={(event) => change('bubble', event.currentTarget.checked)} />Word bubble</label>
          <label class="context-inspector__field"><span>Fill</span><input type="color" aria-label="Bubble color" value={current.bubbleColor} oninput={(event) => change('bubbleColor', event.currentTarget.value)} /></label>
          <label class="context-inspector__field"><span>Padding</span><ScrubbableNumber value={current.padding} label="Bubble padding" min={0} max={20} step={1} variant="hot" onChange={(value) => change('padding', value)} /></label>
          <label class="context-inspector__field"><span>Roundness</span><ScrubbableNumber value={current.radius} label="Bubble roundness" min={0} max={30} step={1} variant="hot" onChange={(value) => change('radius', value)} /></label>
        {:else}
          <label class="context-inspector__field"><span>Position X</span><div><ScrubbableNumber value={x} label="Position X" min={0} max={100} step={1} variant="hot" onChange={(value) => x = value} /><span>%</span></div></label>
          <label class="context-inspector__field"><span>Position Y</span><div><ScrubbableNumber value={y} label="Position Y" min={0} max={100} step={1} variant="hot" onChange={(value) => y = value} /><span>%</span></div></label>
          <label class="context-inspector__field"><span>Width</span><div><ScrubbableNumber value={boxWidth} label="Text area width" min={15} max={100} step={1} variant="hot" onChange={(value) => boxWidth = value} /><span>%</span></div></label>
          <label class="context-inspector__field"><span>Height</span><div><ScrubbableNumber value={boxHeight} label="Text area height" min={15} max={100} step={1} variant="hot" onChange={(value) => boxHeight = value} /><span>%</span></div></label>
        {/if}
      </div>
    </div>
  {/if}
  <div class="context-inspector__sample" aria-label="Synthetic browser type sample">
    <span class="context-inspector__sample-label">Browser type sample · synthetic</span>
    <div class="context-inspector__text-area" class:context-inspector__text-area--bounds={shelf === 'layout'} style={`width:${boxWidth}%;height:${boxHeight}%;left:${x}%;top:${y}%;text-align:${align};line-height:${appearances.all.leading};word-spacing:${appearances.all.spacing}px;`}>
      {#each ['Make', 'every', 'word', 'feel', 'like', 'you.'] as word, index}<span class="context-inspector__word" style={sampleStyle(index)}>{rendered(word, index)}</span>{' '}{/each}
    </div>
  </div>
</section>

<style>
  .context-inspector { --context-gap: .4rem; --context-radius: .4rem; --context-neutral-l: 23%; --context-neutral-c: 0; --context-neutral-h: 260; --context-surface: oklch(var(--context-neutral-l) var(--context-neutral-c) var(--context-neutral-h)); container: contextual / inline-size; color: var(--color-panel-text); font-size: var(--caption-type-s); }
  .context-inspector__scopes { display: flex; gap: 0; padding: .6rem 0; border-block-end: 1px solid var(--color-panel-border); }
  .context-inspector__scope { flex: 1; min-block-size: 2.25rem; border: 0; background: transparent; color: var(--color-panel-secondary); font: inherit; cursor: pointer; &[aria-pressed='true'] { color: var(--color-accent); background: var(--color-selection); border-radius: var(--context-radius); } &:hover { color: var(--color-panel-text); } }
  .context-inspector__typography { display: grid; grid-template-columns: minmax(6rem, 1fr) 5rem 4.5rem; gap: var(--context-gap); padding-block: .8rem .5rem; align-items: center; }
  .context-inspector__family { min-inline-size: 0; :global(.font-picker) { border-radius: var(--context-radius); background: var(--color-surface-raised); } }
  .context-inspector__weight, .context-inspector__case { min-inline-size: 0; min-block-size: 2.25rem; padding: .25rem .4rem; color: var(--color-panel-text); background: var(--color-surface-raised); border: 0; border-radius: var(--context-radius); font: inherit; cursor: pointer; }
  .context-inspector__size { display: flex; align-items: center; padding-inline: .1rem .4rem; border-radius: var(--context-radius); background: var(--color-surface-raised); & > span { color: var(--color-panel-secondary); } }
  .context-inspector__formatting { display: flex; align-items: center; flex-wrap: wrap; gap: var(--context-gap); padding-block-end: .8rem; }
  .context-inspector__segment { display: flex; align-items: center; overflow: hidden; border-radius: var(--context-radius); background: var(--color-surface-raised); }
  .context-inspector__format { inline-size: 2.25rem; min-block-size: 2.25rem; padding: 0; border: 0; border-inline-end: 1px solid var(--color-panel-border); background: transparent; color: var(--color-panel-text); font: inherit; font-size: 1.3rem; cursor: pointer; &[aria-pressed='true'] { color: var(--color-accent); background: var(--color-selection); } &:hover { background: var(--color-surface-overlay); } }
  .context-inspector__format--bold { font-weight: 700; }
  .context-inspector__format--italic { font-family: Georgia, serif; font-style: italic; }
  .context-inspector__swatch { display: grid; place-items: center; inline-size: 2.3rem; block-size: 2.25rem; }
  .context-inspector__swatch input, .context-inspector__field input[type='color'] { inline-size: 1.7rem; block-size: 1.7rem; padding: 0; border: 0; border-radius: .25rem; background: transparent; cursor: pointer; &::-webkit-color-swatch-wrapper { padding: .1rem; } &::-webkit-color-swatch { border: 0; border-radius: .2rem; } }
  .context-inspector__highlight { position: relative; display: grid; place-items: center; inline-size: 2.25rem; block-size: 2.25rem; border-radius: var(--context-radius); background: var(--color-surface-raised); color: var(--color-panel-text); cursor: pointer; & > span { font-size: 1.25rem; line-height: 1; margin-block-end: .3rem; } & > input { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; opacity: 0; cursor: pointer; } & > i { position: absolute; inset: auto .35rem .35rem; block-size: .25rem; border-radius: .1rem; pointer-events: none; } &:focus-within { outline: 2px solid var(--color-accent); outline-offset: 1px; } }
  .context-inspector__spacer { flex: 1; }
  .context-inspector__more, .context-inspector__reset { display: grid; place-items: center; inline-size: 2.25rem; block-size: 2.25rem; padding: .4rem; border: 0; border-radius: var(--context-radius); color: var(--color-panel-text); background: transparent; cursor: pointer; & svg { inline-size: 1.3rem; block-size: 1.3rem; } &:hover, &[aria-expanded='true'] { color: var(--color-accent); background: var(--color-selection); } }
  .context-inspector__shelf { border-block: 1px solid var(--color-panel-border); margin-block-end: .8rem; }
  .context-inspector__shelf-top { display: flex; align-items: center; }
  .context-inspector__tabs { display: flex; flex: 1; min-inline-size: 0; }
  .context-inspector__tab { display: flex; align-items: center; justify-content: center; gap: .35rem; flex: 1; min-inline-size: 0; min-block-size: 2.7rem; padding: .35rem .25rem; border: 0; border-block-end: 2px solid transparent; background: transparent; color: var(--color-panel-secondary); font: inherit; cursor: pointer; & svg { inline-size: 1.2rem; block-size: 1.2rem; flex-shrink: 0; } & span { display: none; } &[aria-selected='true'] { color: var(--color-accent); border-block-end-color: var(--color-accent); } &:hover { color: var(--color-panel-text); } @container contextual (min-width: 35rem) { & span { display: inline; } } }
  .context-inspector__fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); align-items: center; gap: .45rem 1rem; padding-block: .55rem .7rem; }
  .context-inspector__field { display: flex; align-items: center; justify-content: space-between; gap: .4rem; min-block-size: 2.25rem; color: var(--color-panel-secondary); & > div { display: flex; align-items: center; color: var(--color-panel-secondary); } }
  .context-inspector__check { display: flex; align-items: center; gap: .4rem; min-block-size: 2.25rem; & input { accent-color: var(--color-accent); } }
  .context-inspector__sample { position: relative; block-size: 16rem; overflow: hidden; background: var(--context-surface); border-block-start: 1px solid var(--color-panel-border); }
  .context-inspector__sample-label { position: absolute; inset: .65rem auto auto .65rem; color: var(--color-panel-secondary); font-size: var(--caption-type-xs); }
  .context-inspector__text-area { position: absolute; box-sizing: border-box; transform: translate(-50%, -50%); overflow-wrap: anywhere; padding: .3rem; }
  .context-inspector__text-area--bounds { outline: 1px solid var(--color-accent); outline-offset: .1rem; }
  .context-inspector__word { position: relative; display: inline; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
</style>
