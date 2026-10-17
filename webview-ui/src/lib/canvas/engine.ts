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
function appearance(style:StyleConfig,state:'upcoming'|'active'|'spoken'):WordAppearance {
  return state==='upcoming'?{fontFamily:style.fontFamily,fontWeight:style.fontWeight,sizeScale:1,color:style.textColor,opacity:1,bubble:false,bubbleColor:'#000000',bubbleOpacity:0,padding:0,radius:0}:style[state==='active'?'activeWord':'spokenWord'];
}
export class CaptionRenderer {
  private ctx:CanvasRenderingContext2D;
  private width:number;
  private height:number;
  constructor(ctx:CanvasRenderingContext2D,width:number,height:number){this.ctx=ctx;this.width=width;this.height=height;}
  resize(width:number,height:number){this.width=width;this.height=height;}
  clear(){this.ctx.clearRect(0,0,this.width,this.height);}
  private font(style:StyleConfig,a:WordAppearance){return `${a.fontWeight} ${style.fontSize*a.sizeScale}px "${a.fontFamily||style.fontFamily}"`;}
  private roundRect(x:number,y:number,w:number,h:number,r:number){
    const c=this.ctx;r=Math.min(Math.max(0,r),w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
  }
  renderFrame(caption:CaptionItem|null,time:number,style:StyleConfig,animation:AnimationConfig){
    this.clear();if(!caption||time<caption.startTime||time>=caption.endTime||this.width<=0||this.height<=0)return;
    const c=this.ctx,all=['upcoming','active','spoken'] as const;
    const maxSize=style.fontSize*Math.max(1,style.activeWord.sizeScale,style.spokenWord.sizeScale);
    const bounceLift=animation.preset==='bounce'?style.fontSize*style.activeWord.sizeScale*.25:0;
    const effects=(style.strokeEnabled?style.strokeWidth:0)+(style.shadowEnabled?Math.max(Math.abs(style.shadowOffsetX),Math.abs(style.shadowOffsetY))+style.shadowBlur*2:0);
    let rowHeight=maxSize*style.lineHeight;
    c.save();c.textAlign='left';c.textBaseline='middle';
    const measured=caption.words.map(word=>{
      const text=transformText(word.text,style.textTransform);let width=0;
      // Reserve each word's largest possible appearance, including its bubble.
      // Changing the active word must never reflow or shift surrounding words.
      for(const state of all){
        const a=appearance(style,state),pad=(a.bubble?a.padding:0)+effects;
        c.font=this.font(style,a);const metrics=c.measureText(text);
        width=Math.max(width,metrics.width+2*pad);
        const halfHeight=Math.max(style.fontSize*a.sizeScale*.6,metrics.actualBoundingBoxAscent||0,metrics.actualBoundingBoxDescent||0);
        rowHeight=Math.max(rowHeight,2*(halfHeight+pad));
      }
      return {word,text,width};
    });
    // Reserve motion space for the entire caption, independent of which word
    // is active, so the bounce cannot move adjacent rows or clip at frame edges.
    rowHeight+=bounceLift*2;
    c.font=this.font(style,appearance(style,'upcoming'));
    const space=Math.max(c.measureText(' ').width,3),maxWidth=Math.max(1,this.width*style.maxWidth);
    const backgroundPad=style.backgroundEnabled?style.backgroundPadding:0;
    const contentWidth=Math.max(1,maxWidth-2*backgroundPad);
    const rows:typeof measured[]=[];let row:typeof measured=[],rw=0;
    for(const m of measured){if(row.length&&rw+space+m.width>contentWidth){rows.push(row);row=[];rw=0;}if(row.length)rw+=space;row.push(m);rw+=m.width;}if(row.length)rows.push(row);
    const rowWidths=rows.map(r=>r.reduce((n,w)=>n+w.width,0)+Math.max(0,r.length-1)*space);
    const widest=Math.max(1,...rowWidths),height=rows.length*rowHeight;
    const layoutWidth=widest+2*backgroundPad,layoutHeight=height+2*backgroundPad;
    const fit=Math.min(1,maxWidth/layoutWidth,this.width/layoutWidth,this.height*.9/Math.max(1,layoutHeight));
    const px=caption.position?.x??style.positionX,py=caption.position?.y??style.positionY;
    // Keep the requested anchor where possible, but keep the complete visual
    // inside the frame when moving a caption to its edge or adding large fonts.
    const halfWidth=layoutWidth*fit/2,halfHeight=layoutHeight*fit/2;
    c.translate(clamp(this.width*px,halfWidth,this.width-halfWidth),clamp(this.height*py,halfHeight,this.height-halfHeight));c.scale(fit,fit);
    let alpha=1;
    if(animation.fadeInDuration>0)alpha=Math.min(alpha,(time-caption.startTime)/animation.fadeInDuration);
    if(animation.fadeOutDuration>0)alpha=Math.min(alpha,(caption.endTime-time)/animation.fadeOutDuration);
    c.globalAlpha=clamp(alpha,0,1);
    if(style.backgroundEnabled){c.fillStyle=rgba(style.backgroundColor,style.backgroundOpacity);this.roundRect(-widest/2-style.backgroundPadding,-height/2-style.backgroundPadding,widest+style.backgroundPadding*2,height+style.backgroundPadding*2,style.backgroundRadius);c.fill();}
    rows.forEach((r,ri)=>{
      let x=style.textAlign==='left'?-widest/2:style.textAlign==='right'?widest/2-rowWidths[ri]:-rowWidths[ri]/2;
      const y=-height/2+(ri+.5)*rowHeight;
      for(const wm of r){
        const state=wordState(wm.word,time),a=appearance(style,state);c.save();c.font=this.font(style,a);
        const actualWidth=c.measureText(wm.text).width,tx=x+(wm.width-actualWidth)/2;
        c.globalAlpha=clamp(alpha,0,1)*clamp(a.opacity,0,1);
        const started=time>=wm.word.startTime;
        if((animation.preset==='typewriter'||animation.preset==='pop'||animation.preset==='bounce')&&!started){c.restore();x+=wm.width+space;continue;}
        if(state==='active'){
          // Complete entrances within short words too, before their spoken
          // appearance takes over at the exact word end.
          const duration=Math.min(animation.preset==='pop'?.12:.28,wm.word.endTime-wm.word.startTime);
          const p=clamp((time-wm.word.startTime)/duration,0,1);
          if(animation.preset==='pop'){const s=.85+.15*p;c.translate(tx+actualWidth/2,y);c.scale(s,s);c.translate(-tx-actualWidth/2,-y);}
          if(animation.preset==='bounce')c.translate(0,-bounceLift*(1-easeOutBounce(p)));
        }
        // Both text and its highlight use the same local animation transform.
        if(a.bubble){c.fillStyle=rgba(a.bubbleColor,a.bubbleOpacity);this.roundRect(tx-a.padding,y-style.fontSize*a.sizeScale*.6-a.padding,actualWidth+2*a.padding,style.fontSize*a.sizeScale*1.2+2*a.padding,a.radius);c.fill();}
        if(style.shadowEnabled){c.shadowColor=rgba(style.shadowColor,style.shadowOpacity);c.shadowBlur=style.shadowBlur;c.shadowOffsetX=style.shadowOffsetX;c.shadowOffsetY=style.shadowOffsetY;}
        if(style.strokeEnabled&&style.strokeWidth>0){c.strokeStyle=rgba(style.strokeColor,style.strokeOpacity);c.lineWidth=style.strokeWidth*2;c.lineJoin='round';c.strokeText(wm.text,tx,y);c.shadowBlur=0;}
        c.fillStyle=a.color;c.fillText(wm.text,tx,y);c.restore();x+=wm.width+space;
      }
    });c.restore();
  }
}
