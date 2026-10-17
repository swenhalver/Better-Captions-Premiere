import {resolveAppearance,effectPadding,type ResolvedAppearance} from '../appearance.ts';
import type {CaptionItem,CaptionWord,StyleConfig,AnimationConfig,WordAppearance} from '../types';

export function wordState(word:CaptionWord,time:number):'upcoming'|'active'|'spoken' {
  return time>=word.endTime?'spoken':time>=word.startTime?'active':'upcoming';
}
const transformText=(text:string,transform:string)=>transform==='uppercase'?text.toUpperCase():transform==='lowercase'?text.toLowerCase():text;
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function easeOutBounce(t:number){
  const n=7.5625,d=2.75;
  if(t<1/d)return n*t*t;
  if(t<2/d){t-=1.5/d;return n*t*t+.75;}
  if(t<2.5/d){t-=2.25/d;return n*t*t+.9375;}
  t-=2.625/d;return n*t*t+.984375;
}
function rgba(hex:string,opacity:number){const n=parseInt(hex.replace('#',''),16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${clamp(opacity,0,1)})`;}
function appearance(style:StyleConfig,state:'upcoming'|'active'|'spoken'):ResolvedAppearance { return resolveAppearance(style,state==='upcoming'?'upcomingWord':state==='active'?'activeWord':'spokenWord'); }
export interface RenderArea { width:number; height:number; measureOnly?:boolean; }
export interface RenderLayout { width:number; height:number; rowHeight:number; rows:CaptionWord[][]; }
interface MeasuredWord { word:CaptionWord; text:string; width:number; continuation:boolean; gapBefore:number; }
export class CaptionRenderer {
  private ctx:CanvasRenderingContext2D;
  private width:number;
  private height:number;
  constructor(ctx:CanvasRenderingContext2D,width:number,height:number){this.ctx=ctx;this.width=width;this.height=height;}
  resize(width:number,height:number){this.width=width;this.height=height;}
  clear(){this.ctx.clearRect(0,0,this.width,this.height);}
  private font(style:StyleConfig,a:ResolvedAppearance){return `${a.italic?'italic ':''}${a.fontWeight} ${a.fontSize}px "${a.fontFamily||style.fontFamily}"`;}
  private measureText(text:string,a:ResolvedAppearance){return this.ctx.measureText(text).width+Math.max(0,Array.from(text).length-1)*a.letterSpacing;}
  private paintText(text:string,x:number,y:number,a:ResolvedAppearance,stroke=false){
    const c=this.ctx; if(!a.letterSpacing){if(stroke)c.strokeText(text,x,y);else c.fillText(text,x,y);return;}
    for(const glyph of Array.from(text)){if(stroke)c.strokeText(glyph,x,y);else c.fillText(glyph,x,y);x+=c.measureText(glyph).width+a.letterSpacing;}
  }
  private roundRect(x:number,y:number,w:number,h:number,r:number){
    const c=this.ctx;r=Math.min(Math.max(0,r),w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
  }
  renderFrame(caption:CaptionItem|null,time:number,style:StyleConfig,animation:AnimationConfig,area?:RenderArea):RenderLayout|undefined{
    this.clear();if(!caption||time<caption.startTime||time>=caption.endTime||this.width<=0||this.height<=0)return;
    const c=this.ctx,all=['upcoming','active','spoken'] as const;
    const maxSize=Math.max(...all.map(state=>appearance(style,state).fontSize));
    const bounceLift=animation.preset==='bounce'?appearance(style,'active').fontSize*.25:0;
    let rowHeight=maxSize*style.lineHeight;
    c.save();c.textAlign='left';c.textBaseline='middle';
    const maxWidth=Math.max(1,area?.width??this.width*style.maxWidth);
    const backgroundPad=style.backgroundEnabled?style.backgroundPadding:0;
    const contentWidth=Math.max(1,maxWidth-2*backgroundPad);
    const measure=(word:CaptionWord,text:string,continuation=false):MeasuredWord=>{
      let width=0;
      // Reserve each word's largest possible appearance, including its bubble.
      // Changing the active word must never reflow or shift surrounding words.
      for(const state of all){
        const a=appearance(style,state),pad=(a.bubble?a.padding:0)+effectPadding(a);
        c.font=this.font(style,a);const transformed=transformText(text,a.textTransform),metrics=c.measureText(transformed);
        width=Math.max(width,this.measureText(transformed,a)+2*pad);
        const halfHeight=Math.max(a.fontSize*.6,metrics.actualBoundingBoxAscent||0,metrics.actualBoundingBoxDescent||0);
        rowHeight=Math.max(rowHeight,2*(halfHeight+pad));
      }
      return {word,text,width,continuation,gapBefore:0};
    };
    const measured:MeasuredWord[]=[];
    for(const word of caption.words){
      const text=word.text,whole=measure(word,text);
      if(!area||whole.width<=contentWidth){measured.push(whole);continue;}
      // Break long words at grapheme boundaries, keeping one spoken-word state
      // across the pieces. A narrow text area must never reduce the font size.
      const graphemes=typeof Intl.Segmenter==='function'?Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):Array.from(text);
      let chunk='',continuation=false;
      for(const grapheme of graphemes){
        if(chunk&&measure(word,chunk+grapheme).width>contentWidth){measured.push(measure(word,chunk,continuation));chunk='';continuation=true;}
        chunk+=grapheme;
      }
      if(chunk)measured.push(measure(word,chunk,continuation));
    }
    // Reserve motion space for the entire caption, independent of which word
    // is active, so the bounce cannot move adjacent rows or clip at frame edges.
    rowHeight+=bounceLift*2;
    c.font=this.font(style,appearance(style,'upcoming'));
    const space=Math.max(c.measureText(' ').width,3);
    const rows:typeof measured[]=[];let row:typeof measured=[],rw=0;
    for(const m of measured){const gap=m.continuation?0:space;if(row.length&&rw+gap+m.width>contentWidth){rows.push(row);row=[];rw=0;}m.gapBefore=row.length?gap:0;rw+=m.gapBefore;row.push(m);rw+=m.width;}if(row.length)rows.push(row);
    const rowWidths=rows.map(r=>r.reduce((n,w)=>n+w.width+w.gapBefore,0));
    const widest=Math.max(1,...rowWidths),height=rows.length*rowHeight;
    const layoutWidth=widest+2*backgroundPad,layoutHeight=height+2*backgroundPad;
    const layout:RenderLayout={width:layoutWidth,height:layoutHeight,rowHeight,rows:rows.map(row=>row.map(part=>({...part.word,text:part.text})))};
    if(area?.measureOnly){c.restore();return layout;}
    const fit=area?1:Math.min(1,maxWidth/layoutWidth,this.width/layoutWidth,this.height*.9/Math.max(1,layoutHeight));
    const px=caption.position?.x??style.positionX,py=caption.position?.y??style.positionY;
    // Keep the requested anchor where possible, but keep the complete visual
    // inside the frame when moving a caption to its edge or adding large fonts.
    const halfWidth=layoutWidth*fit/2,halfHeight=layoutHeight*fit/2;
    c.translate(area?area.width/2:clamp(this.width*px,halfWidth,this.width-halfWidth),area?area.height/2:clamp(this.height*py,halfHeight,this.height-halfHeight));c.scale(fit,fit);
    let alpha=1;
    if(animation.fadeInDuration>0)alpha=Math.min(alpha,(time-caption.startTime)/animation.fadeInDuration);
    if(animation.fadeOutDuration>0)alpha=Math.min(alpha,(caption.endTime-time)/animation.fadeOutDuration);
    c.globalAlpha=clamp(alpha,0,1);
    if(style.backgroundEnabled){
      const backgroundX=area&&style.textAlign==='left'?-contentWidth/2:area&&style.textAlign==='right'?contentWidth/2-widest:-widest/2;
      c.fillStyle=rgba(style.backgroundColor,style.backgroundOpacity);this.roundRect(backgroundX-style.backgroundPadding,-height/2-style.backgroundPadding,widest+style.backgroundPadding*2,height+style.backgroundPadding*2,style.backgroundRadius);c.fill();
    }
    rows.forEach((r,ri)=>{
      const alignmentWidth=area?contentWidth:widest;
      let x=style.textAlign==='left'?-alignmentWidth/2:style.textAlign==='right'?alignmentWidth/2-rowWidths[ri]:-rowWidths[ri]/2;
      const y=-height/2+(ri+.5)*rowHeight;
      for(const wm of r){
        x+=wm.gapBefore;
        const state=wordState(wm.word,time),a=appearance(style,state);c.save();c.font=this.font(style,a);
        const visibleText=transformText(wm.text,a.textTransform),actualWidth=this.measureText(visibleText,a),tx=x+(wm.width-actualWidth)/2;
        c.globalAlpha=clamp(alpha,0,1)*clamp(a.opacity,0,1);
        const started=time>=wm.word.startTime;
        if((animation.preset==='typewriter'||animation.preset==='pop'||animation.preset==='bounce')&&!started){c.restore();x+=wm.width;continue;}
        if(state==='active'){
          // Complete entrances within short words too, before their spoken
          // appearance takes over at the exact word end.
          const duration=Math.min(animation.preset==='pop'?.12:.28,wm.word.endTime-wm.word.startTime);
          const p=clamp((time-wm.word.startTime)/duration,0,1);
          if(animation.preset==='pop'){const s=.85+.15*p;c.translate(tx+actualWidth/2,y);c.scale(s,s);c.translate(-tx-actualWidth/2,-y);}
          if(animation.preset==='bounce')c.translate(0,-bounceLift*(1-easeOutBounce(p)));
        }
        // Both text and its highlight use the same local animation transform.
        if(a.bubble){c.fillStyle=rgba(a.bubbleColor,a.bubbleOpacity);this.roundRect(tx-a.padding,y-a.fontSize*.6-a.padding,actualWidth+2*a.padding,a.fontSize*1.2+2*a.padding,a.radius);c.fill();}
        if(a.shadowEnabled){c.shadowColor=rgba(a.shadowColor,a.shadowOpacity);c.shadowBlur=a.shadowBlur;c.shadowOffsetX=a.shadowOffsetX;c.shadowOffsetY=a.shadowOffsetY;}
        if(a.strokeEnabled&&a.strokeWidth>0){c.strokeStyle=rgba(a.strokeColor,a.strokeOpacity);c.lineWidth=a.strokeWidth*2;c.lineJoin='round';this.paintText(visibleText,tx,y,a,true);c.shadowBlur=0;}
        c.fillStyle=a.color;this.paintText(visibleText,tx,y,a);c.restore();x+=wm.width;
      }
    });c.restore();return layout;
  }
}
