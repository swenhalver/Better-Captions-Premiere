import type {SessionState,StyleConfig,CaptionItem,AnimationConfig} from './types';
import {validateCaptions} from './transcript/edit.ts';
import {refreshCaptionGroups,validateCharacterLimit} from './transcript/parser.ts';
import {validateLineWrap} from './native-effect/line-wrap.ts';
import type {TextAreaEdit} from './text-area';

export interface AgentHandler {
  getState:()=>SessionState|null;
  patchStyle:(patch:Partial<StyleConfig>)=>unknown|Promise<unknown>;
  setCaptions:(captions:CaptionItem[])=>unknown|Promise<unknown>;
  refresh:()=>unknown|Promise<unknown>;
  apply:()=>unknown|Promise<unknown>;
  patchAnimation?:(patch:Partial<AnimationConfig>)=>unknown|Promise<unknown>;
  readArea?:(payload:unknown)=>unknown|Promise<unknown>;
  editArea?:(payload:unknown)=>unknown|Promise<unknown>;
  /** Test hooks only (scripts/agent.cjs test_typing / test_history). */
  testTyping?:(payload:unknown)=>unknown|Promise<unknown>;
  testHistory?:(payload:unknown)=>unknown|Promise<unknown>;
}
const styleNumbers:Record<string,[number,number]>={fontSize:[8,400],fontWeight:[1,1000],strokeOpacity:[0,1],strokeWidth:[0,30],shadowOpacity:[0,1],shadowBlur:[0,100],shadowOffsetX:[-100,100],shadowOffsetY:[-100,100],backgroundOpacity:[0,1],backgroundPadding:[0,100],backgroundRadius:[0,200],positionX:[0,1],positionY:[0,1],maxWidth:[.1,1],lineHeight:[.6,3],wordSpacing:[0,300]};
const stateNumbers:Record<string,[number,number]>={fontSize:[8,1200],letterSpacing:[-10,40],strokeWidth:[0,30],strokeOpacity:[0,1],shadowOpacity:[0,1],shadowBlur:[0,100],shadowOffsetX:[-100,100],shadowOffsetY:[-100,100],fontWeight:[1,1000],sizeScale:[.4,3],opacity:[0,1],bubbleOpacity:[0,1],padding:[0,100],paddingTop:[0,100],paddingRight:[0,100],paddingBottom:[0,100],paddingLeft:[0,100],radiusTL:[0,200],radiusTR:[0,200],radiusBR:[0,200],radiusBL:[0,200],marginTop:[-100,100],marginRight:[-100,100],marginBottom:[-100,100],marginLeft:[-100,100],bubblePaddingInline:[0,100],bubblePaddingBlock:[0,100],radius:[0,200]};
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a JSON object.');for(const key of Object.keys(value))if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid property name.');}
function number(value:unknown,min:number,max:number){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`Expected a finite number between ${min} and ${max}.`);}
function font(value:unknown){if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f]/.test(value))throw new Error('Invalid font family.');}
function color(value:unknown){if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Colors must be six-digit hex values.');}
function bool(value:unknown){if(typeof value!=='boolean')throw new Error('Expected true or false.');}
function allowedProperties(value:Record<string,unknown>,names:string[]){for(const key of Object.keys(value))if(!names.includes(key))throw new Error('Unknown caption area option: '+key);}
function areaCaption(value:unknown,current:CaptionItem[]):string {
  if(typeof value!=='string'||!/^[\w-]{1,160}$/.test(value)||!current.some(caption=>caption.id===value&&caption.clipNodeId&&caption.projectItemId&&caption.mediaPath))throw new Error('Choose an existing applied caption identity.');
  return value;
}
function areaFrame(value:unknown){number(value,0,1000000);if(!Number.isInteger(value))throw new Error('Caption area frames must be integers.');}
export function validateAreaRead(value:unknown,current:CaptionItem[]):{captionId:string;frame?:number}{
  object(value);allowedProperties(value,['captionId','frame']);const captionId=areaCaption(value.captionId,current);
  if(value.frame!==undefined)areaFrame(value.frame);
  return {captionId,...(value.frame!==undefined?{frame:value.frame as number}:{})};
}
export function validateAreaEdit(value:unknown,current:CaptionItem[]):{captionId:string;edit:TextAreaEdit}{
  object(value);allowedProperties(value,['captionId','edit']);const captionId=areaCaption(value.captionId,current),edit=value.edit;object(edit);
  allowedProperties(edit,['signature','frame','track','operation','value','interpolation','keyTicks','targetFrame']);
  const operations=['set','set-key','toggle','key','interpolation','move-key','remove-key','undo','redo'];
  if(typeof edit.operation!=='string'||!operations.includes(edit.operation))throw new Error('Unknown caption area operation.');
  if(typeof edit.signature!=='string'||!edit.signature||edit.signature.length>300000)throw new Error('Read the caption area signature before editing.');
  areaFrame(edit.frame);
  if(!['undo','redo'].includes(edit.operation)&&!['position','width','height'].includes(String(edit.track)))throw new Error('Choose Position, Width or Height.');
  if(edit.track!==undefined&&!['position','width','height'].includes(String(edit.track)))throw new Error('Unknown caption area track.');
  if(edit.keyTicks!==undefined&&(typeof edit.keyTicks!=='string'||!/^\d{1,21}$/.test(edit.keyTicks)))throw new Error('Invalid caption keyframe source ticks.');
  if(['set-key','move-key','remove-key'].includes(edit.operation)&&edit.keyTicks===undefined)throw new Error('Choose an exact caption keyframe.');
  if(edit.operation==='move-key'||edit.targetFrame!==undefined)areaFrame(edit.targetFrame);
  if(edit.value!==undefined){if(!Array.isArray(edit.value)||edit.value.length!==(edit.track==='position'?2:1))throw new Error('Invalid caption area dimensions.');for(const item of edit.value)number(item,-10000000,10000000);}
  if(['set','set-key'].includes(edit.operation)&&edit.value===undefined)throw new Error('Supply the caption area value.');
  if(edit.interpolation!==undefined&&!['linear','hold','bezier'].includes(String(edit.interpolation)))throw new Error('Unknown caption interpolation preset.');
  if(edit.operation==='interpolation'&&edit.interpolation===undefined)throw new Error('Choose an interpolation preset.');
  return {captionId,edit:JSON.parse(JSON.stringify(edit)) as TextAreaEdit};
}
export function validateStylePatch(value:unknown):Partial<StyleConfig>{
  object(value);
  for(const [key,v] of Object.entries(value)){
    if(key==='activeWord'||key==='spokenWord'||key==='upcomingWord'){
      object(v);for(const [k,n] of Object.entries(v)){if(k==='fontWeightOffset'){if(n!==null&&n!==0&&n!==100)throw new Error('Word weight offset must be null, 0 or 100.');}else if(k in stateNumbers)number(n,...stateNumbers[k]);else if(k==='fontFamily')font(n);else if(['color','bubbleColor','strokeColor','shadowColor'].includes(k))color(n);else if(['bubble','bubbleFillSpaces','underline','italic','strokeEnabled','shadowEnabled'].includes(k))bool(n);else if(k==='textTransform'){if(!['none','uppercase','lowercase','titlecase'].includes(String(n)))throw new Error('Invalid word text transform.');}else throw new Error('Unknown word style: '+k);}
    }else if(key==='maxChars')validateCharacterLimit(v);
    else if(key==='lineWrap')validateLineWrap(v);
    else if(key in styleNumbers)number(v,...styleNumbers[key]);
    else if(key==='fontFamily')font(v);
    else if(['textColor','strokeColor','shadowColor','backgroundColor'].includes(key))color(v);
    else if(['strokeEnabled','shadowEnabled','backgroundEnabled'].includes(key))bool(v);
    else if(key==='textAlign'){if(!['left','center','right'].includes(String(v)))throw new Error('Invalid text alignment.');}
    else if(key==='textTransform'){if(!['none','uppercase','lowercase','titlecase'].includes(String(v)))throw new Error('Invalid text transform.');}
    else throw new Error('Unknown caption style: '+key);
  }
  return value as Partial<StyleConfig>;
}
export function validateCaptionPatch(value:unknown,current:CaptionItem[]):CaptionItem[]{
  if(!Array.isArray(value)||value.length>10000)throw new Error('Expected at most 10000 captions.');
  const existing=new Map(current.map(c=>[c.id,c]));
  let totalWords=0;
  const result=value.map(item=>{
    object(item);if(typeof item.id!=='string'||!/^[\w-]{1,160}$/.test(item.id))throw new Error('Invalid caption identity.');
    if(typeof item.text!=='string'||item.text.length>250000)throw new Error('Invalid caption text.');
    if(!Array.isArray(item.words)||(totalWords+=item.words.length)>50000)throw new Error('Expected at most 50000 words across the caption transcript.');
    const original=existing.get(item.id),next={...original,id:item.id,text:item.text,startTime:item.startTime,endTime:item.endTime,words:item.words.map((w,index)=>{
      object(w);if(typeof w.text!=='string'||w.text.length>500)throw new Error('Invalid word text.');
      const previous=original?.words[index];
      const matched=previous?.text===w.text?previous:undefined;
      const endOfSentence=w.endOfSentence===undefined?matched?.endOfSentence:w.endOfSentence;
      const pauseLinesRemoved=w.pauseLinesRemoved===undefined?matched?.pauseLinesRemoved:w.pauseLinesRemoved;
      if(pauseLinesRemoved!==undefined&&(!Number.isInteger(pauseLinesRemoved)||Number(pauseLinesRemoved)<0||Number(pauseLinesRemoved)>8))throw new Error('Invalid removed pause-line count.');
      const lineBreakBefore=w.lineBreakBefore===undefined?matched?.lineBreakBefore:w.lineBreakBefore;
      if(lineBreakBefore!==undefined&&lineBreakBefore!=='break'&&lineBreakBefore!=='join'&&lineBreakBefore!=='edge')throw new Error('Invalid line boundary.');
      if(endOfSentence!==undefined)bool(endOfSentence);
      return {text:w.text,startTime:w.startTime,endTime:w.endTime,isActive:false,...(typeof endOfSentence==='boolean'?{endOfSentence}:{}),...(lineBreakBefore===undefined?{}:{lineBreakBefore:lineBreakBefore as 'break'|'join'|'edge'}),...(pauseLinesRemoved===undefined?{}:{pauseLinesRemoved:Number(pauseLinesRemoved)})};
    })} as CaptionItem;
    if(item.position!==undefined){object(item.position);number(item.position.x,0,1);number(item.position.y,0,1);next.position={x:item.position.x as number,y:item.position.y as number};}
    next.text=next.words.map(word=>word.text).join(' ');
    if(next.text.length>250000)throw new Error('Caption text exceeds 250000 characters.');
    return next;
  });
  for(const c of current)if(c.clipNodeId&&!result.some(n=>n.id===c.id))throw new Error('Removing a linked timeline caption requires a separate timeline edit.');
  validateCaptions(result);return refreshCaptionGroups(result);
}
export function startAgentBridge(handler:AgentHandler):()=>void {
  const win=window as any;if(!win.__adobe_cep__||typeof win.require!=='function')return ()=>{};
  const fs=win.require('fs'),path=win.require('path'),crypto=win.require('crypto');
  const extension=win.__adobe_cep__.getSystemPath('extension');
  const extensionRoot=extension.startsWith('file:')?win.require('node:url').fileURLToPath(extension):extension;
  const platform=win.require(path.join(extensionRoot,'platform.cjs'));
  const root=path.join(platform.dataRoot(),'agent');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const folder of [root,...['instances','requests','responses'].map(sub=>path.join(root,sub))]){
    platform.secureDirectory(folder);
    const stat=fs.lstatSync(folder);
    if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync(folder)!==folder)throw new Error('The caption agent folder must be a private local directory.');
  }
  const instanceId=crypto.randomBytes(10).toString('hex'),instance=path.join(root,'instances',instanceId+'.json');
  let busy=false,alive=true;
  const atomic=(file:string,data:unknown)=>{const temp=file+'.tmp-'+instanceId;fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temp,file);};
  function announce(){const s=handler.getState();atomic(instance,{version:1,instanceId,sequenceId:s?.sequenceId??null,sequenceName:s?.sequenceName??null,updatedAt:Date.now(),busy,capabilities:['get_state','patch_style','patch_animation','set_captions','set_position','read_area','edit_area','refresh','apply']});}
  async function poll(){
    if(!alive||busy)return;busy=true;
    try{
      for(const file of fs.readdirSync(path.join(root,'requests')).filter((x:string)=>/^[a-zA-Z0-9_-]{1,100}\.json$/.test(x))){
        const requestPath=path.join(root,'requests',file);let request:any;
        try{const stat=fs.lstatSync(requestPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5000000)continue;request=JSON.parse(fs.readFileSync(requestPath,'utf8'));}catch{continue;}
        if(request.instanceId!==instanceId)continue;
        const id=file.slice(0,-5),response=path.join(root,'responses',file);
        if(fs.existsSync(response)){fs.unlinkSync(requestPath);continue;}
        try{
          if(request.version!==1||request.id!==id||!Number.isFinite(request.createdAt)||Math.abs(Date.now()-request.createdAt)>120000)throw new Error('Invalid or expired agent request.');
          const state=handler.getState();if(!state)throw new Error('No active caption session.');if(request.sequenceId!==state.sequenceId)throw new Error('The active sequence changed. Read state again.');
          const payload=request.payload??{};let result:unknown;
          switch(request.action){
            case 'get_state':break;
            case 'patch_style':await handler.patchStyle(validateStylePatch(payload));break;
            case 'patch_animation':{
              if(!handler.patchAnimation)throw new Error('Animation editing is unavailable in this panel.');object(payload);const p=payload as Partial<AnimationConfig>;
              for(const [k,v]of Object.entries(p)){if(k==='preset'){if(!['fade','pop','typewriter','karaoke','bounce'].includes(String(v)))throw new Error('Invalid animation preset.');}else if(k==='highlightColor')color(v);else if(k==='fadeInDuration'||k==='fadeOutDuration')number(v,0,5);else throw new Error('Unknown animation option.');}
              await handler.patchAnimation(p);break;
            }
            case 'set_captions':await handler.setCaptions(validateCaptionPatch(payload.captions,state.captions));break;
            case 'set_position':{
              object(payload);number(payload.x,0,1);number(payload.y,0,1);
              if(payload.captionId){const captions=state.captions.map(c=>c.id===payload.captionId?{...c,position:{x:payload.x as number,y:payload.y as number}}:c);if(!captions.some(c=>c.id===payload.captionId))throw new Error('Caption identity not found.');await handler.setCaptions(captions);}
              else await handler.patchStyle({positionX:payload.x as number,positionY:payload.y as number});break;
            }
            case 'refresh':await handler.refresh();break;
            case 'apply':await handler.apply();break;
            case 'read_area':if(!handler.readArea)throw new Error('Caption area controls are unavailable.');result=await handler.readArea(validateAreaRead(payload,state.captions));break;
            case 'edit_area':if(!handler.editArea)throw new Error('Caption area controls are unavailable.');result=await handler.editArea(validateAreaEdit(payload,state.captions));break;
            default:throw new Error('Unsupported caption action.');
          }
          atomic(response,{version:1,id,ok:true,completedAt:Date.now(),state:handler.getState(),...(result===undefined?{}:{result})});
        }catch(e){atomic(response,{version:1,id,ok:false,completedAt:Date.now(),error:e instanceof Error?e.message:String(e)});}
        fs.unlinkSync(requestPath);
      }
    }finally{busy=false;if(alive)announce();}
  }
  announce();const timer=setInterval(()=>void poll().catch(console.error),500);
  const heartbeat=setInterval(announce,5000);
  const stop=()=>{alive=false;clearInterval(timer);clearInterval(heartbeat);try{fs.unlinkSync(instance);}catch{}};
  window.addEventListener('unload',stop,{once:true});return stop;
}
