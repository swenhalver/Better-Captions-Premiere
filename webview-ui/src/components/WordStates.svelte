<script lang="ts">
  import type { StyleConfig, WordAppearance } from "../lib/types";
  import { resolveAppearance, type WordStateKey } from "../lib/appearance";
  interface Props { style: StyleConfig; fonts?: string[]; stateKey?: WordStateKey; onUpdate: (updates: Partial<StyleConfig>) => void; }
  let { style, fonts = [], onUpdate, stateKey = "activeWord" }: Props = $props();
  let appearance = $derived(resolveAppearance(style,stateKey));
  function update(patch: Partial<WordAppearance>) { onUpdate({ [stateKey]: { ...style[stateKey], ...patch } }); }
  const value = (event: Event) => (event.target as HTMLInputElement).value;
  const numeric = (event: Event) => (event.target as HTMLInputElement).valueAsNumber;
  const fields = {
    stroke: [{key:'strokeColor',label:'Stroke color',type:'color'},{key:'strokeWidth',label:'Stroke width, px',min:0,max:30,step:.5},{key:'strokeOpacity',label:'Stroke opacity',min:0,max:1,step:.05}],
    shadow: [{key:'shadowColor',label:'Shadow color',type:'color'},{key:'shadowOpacity',label:'Shadow opacity',min:0,max:1,step:.05},{key:'shadowBlur',label:'Shadow blur, px',min:0,max:100},{key:'shadowOffsetX',label:'Shadow X, px',min:-100,max:100},{key:'shadowOffsetY',label:'Shadow Y, px',min:-100,max:100}],
    bubble: [{key:'bubbleColor',label:'Bubble color',type:'color'},{key:'bubbleOpacity',label:'Bubble opacity',min:0,max:1,step:.05},{key:'padding',label:'Bubble padding, px',min:0,max:100},{key:'radius',label:'Bubble corners, px',min:0,max:200}],
  } satisfies Record<string, {key:keyof WordAppearance;label:string;type?:string;min?:number;max?:number;step?:number}[]>;
  const groups = [{key:'strokeEnabled',label:'Stroke',fields:fields.stroke},{key:'shadowEnabled',label:'Shadow',fields:fields.shadow},{key:'bubble',label:'Word bubble',fields:fields.bubble}] as const;
</script>

<details class="caption-section" open>
  <summary class="caption-section__heading">Typography</summary>
  <div class="caption-section__body caption-controls">
    <label class="caption-field caption-field--wide"><span>Font family</span><input list="{stateKey}-fonts" value={appearance.fontFamily} onchange={(event) => update({fontFamily:value(event)})} /><datalist id="{stateKey}-fonts">{#each fonts as font}<option value={font}></option>{/each}</datalist></label>
    <label class="caption-field"><span>Font size, px</span><input type="number" min="8" max="1200" value={appearance.fontSize} onchange={(event) => update({fontSize:numeric(event)})} /></label>
    <label class="caption-field"><span>Weight</span><select value={appearance.fontWeight} onchange={(event) => update({fontWeight:Number(value(event))})}>{#each [100,200,300,400,500,600,700,800,900] as weight}<option value={weight}>{weight}</option>{/each}</select></label>
    <label class="caption-field"><span>Text color</span><input type="color" value={appearance.color} onchange={(event) => update({color:value(event)})} /></label>
    <label class="caption-field"><span>Opacity, %</span><input type="number" min="0" max="100" value={Math.round(appearance.opacity*100)} onchange={(event) => update({opacity:numeric(event)/100})} /></label>
    <label class="caption-field"><span>Letter spacing, px</span><input type="number" min="-10" max="40" step=".5" value={appearance.letterSpacing} onchange={(event) => update({letterSpacing:numeric(event)})} /></label>
    <label class="caption-field"><span>Case</span><select value={appearance.textTransform} onchange={(event) => update({textTransform:value(event) as WordAppearance['textTransform']})}><option value="none">As typed</option><option value="uppercase">UPPERCASE</option><option value="lowercase">lowercase</option><option value="titlecase">Title Case</option></select></label>
    <label class="caption-check"><input type="checkbox" checked={appearance.italic} onchange={(event) => update({italic:event.currentTarget.checked})} /><span>Italic</span></label>
  </div>
</details>
{#each groups as group}
  <details class="caption-section">
    <summary class="caption-section__heading">{group.label} · {appearance[group.key] ? 'On' : 'Off'}</summary>
    <div class="caption-section__body">
      <label class="caption-check"><input type="checkbox" checked={appearance[group.key]} onchange={(event) => update({[group.key]:event.currentTarget.checked})} /><span>Enable {group.label.toLowerCase()}</span></label>
      <div class="caption-controls">
        {#each group.fields as raw}
          {@const field = raw as {key:keyof WordAppearance;label:string;type?:string;min?:number;max?:number;step?:number}}
          <label class="caption-field"><span>{field.label}</span><input type={field.type ?? 'number'} min={field.min} max={field.max} step={field.step ?? 1} disabled={!appearance[group.key]} value={appearance[field.key] as string | number} onchange={(event) => update({[field.key]:field.type === 'color' ? value(event) : numeric(event)})} /></label>
        {/each}
      </div>
    </div>
  </details>
{/each}
