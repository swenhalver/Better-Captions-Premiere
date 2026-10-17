/** A stable phrase rectangle measured in the original sequence's pixel coordinates. */
export interface RenderBounds { x: number; y: number; width: number; height: number; frameWidth: number; frameHeight: number; }

/** Keep a paragraph box stable across text/style changes and native keyframes. */
export function textAreaBounds(frameWidth:number,frameHeight:number,maxWidth:number,x:number,y:number,measuredHeight:number,previous?:RenderBounds):RenderBounds {
  const width=Math.min(frameWidth,Math.max(1,Math.round(frameWidth*maxWidth)));
  const oldHeight=previous&&previous.frameHeight>0?previous.height*frameHeight/previous.frameHeight:0;
  const height=Math.min(frameHeight,Math.max(1,Math.ceil(oldHeight||Math.max(measuredHeight+4,frameHeight*.4))));
  return {x:Math.round(frameWidth*x-width/2),y:Math.round(frameHeight*y-height/2),width,height,frameWidth,frameHeight};
}
