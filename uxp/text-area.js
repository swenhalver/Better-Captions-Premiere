'use strict';
// Native Motion is authoritative. UXP owns structural actions; existing-key
// values use the CEP in-place setter so native easing is never reconstructed.
const histories = new Map();
const HISTORY_STEPS = 32, HISTORY_CLIPS = 32, HISTORY_BYTES = 4 * 1024 * 1024;
const fields = ['position', 'width', 'height'];
const motionFields = [...fields,'uniform','rotation','anchor'];
const unwrap = value => { for (let depth=0;depth<3 && value && typeof value==='object' && 'value' in value;depth++) { const next=value.value;if(next===value)break;value=next; } return value; };
const number = (value, min, max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid text-area value.'); return value; };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = (ppro, ticks) => ppro.TickTime.createWithTicks(typeof ticks === 'string' && /^\d+$/.test(ticks) ? ticks : String(Math.round(Number(ticks))));
const clone = value => JSON.parse(JSON.stringify(value));
const validTicks = value => typeof value==='string' && /^(0|[1-9]\d{0,23})$/.test(value);
function compareTicks(a,b) { return a.length===b.length ? (a===b?0:a<b?-1:1) : a.length<b.length?-1:1; }
const orderKeys = (a,b) => validTicks(a.ticks)&&validTicks(b.ticks)?compareTicks(a.ticks,b.ticks):Number(a.ticks)-Number(b.ticks);
function addTicks(a,b) { let result='',carry=0;for(let i=a.length-1,j=b.length-1;i>=0||j>=0||carry;i--,j--){const n=Number(a[i]||0)+Number(b[j]||0)+carry;result=String(n%10)+result;carry=Math.floor(n/10);}return result.replace(/^0+(?=\d)/,''); }
function subtractTicks(a,b) { if(compareTicks(a,b)<0)throw new Error('Invalid caption source timing.');let result='',borrow=0;for(let i=a.length-1,j=b.length-1;i>=0;i--,j--){let n=Number(a[i])-Number(b[j]||0)-borrow;borrow=n<0?1:0;if(borrow)n+=10;result=String(n)+result;}return result.replace(/^0+(?=\d)/,''); }
function verifiedFragments(d) {
  if (d.bundleSourceContiguous === undefined && d.bundleFragments === undefined) return false;
  const parts=d.bundleFragments, invalid=()=>{throw new Error('The native caption split receipt changed or is incomplete. Refresh Position & size.');};
  if (d.bundleSourceContiguous!==true || !Array.isArray(parts) || parts.length<2 || parts.length>64) invalid();
  const nodes=new Set(); let selected=0;
  for (let i=0;i<parts.length;i++) {
    const p=parts[i];
    if (!p || typeof p.clipNodeId!=='string' || !p.clipNodeId || p.clipNodeId.length>256 || nodes.has(p.clipNodeId) || p.track!==d.track || !Number.isInteger(p.track) || p.track<0 || ![p.startTicks,p.endTicks,p.inTicks,p.outTicks].every(validTicks)) invalid();
    nodes.add(p.clipNodeId);
    if (compareTicks(p.endTicks,p.startTicks)<=0 || compareTicks(p.outTicks,p.inTicks)<=0 || subtractTicks(p.endTicks,p.startTicks)!==subtractTicks(p.outTicks,p.inTicks)
      || i===0 && p.inTicks!=='0' || i>0 && (p.startTicks!==parts[i-1].endTicks || p.inTicks!==parts[i-1].outTicks)) invalid();
    if (p.clipNodeId===d.clipNodeId) {
      if (!['startTicks','endTicks','inTicks','outTicks'].every(key=>p[key]===d[key])) invalid();
      selected++;
    }
  }
  if (selected!==1) invalid();
  return true;
}
function frameTicks(d,frame) { let result='',carry=0;const digits=String(d.ticksPerFrame);for(let i=digits.length-1;i>=0||carry;i--){const n=Number(digits[i]||0)*frame+carry;result=String(n%10)+result;carry=Math.floor(n/10);}return addTicks(d.inTicks,result||'0'); }
function visibleKey(d,ticks) { const end=validTicks(d.outTicks)?d.outTicks:addTicks(d.inTicks,subtractTicks(d.endTicks,d.startTicks));return compareTicks(ticks,d.inTicks)>=0 && compareTicks(ticks,end)<0; }
function point(value) { const v = unwrap(value); if (Array.isArray(v) && v.length === 2) return v.map(x => number(x, -100, 100)); if (v && typeof v.x === 'number' && typeof v.y === 'number') return [v.x,v.y]; throw new Error('Premiere returned an invalid Position.'); }
function modeName(ppro, value) { const m = ppro.Constants.InterpolationMode; return value === m.LINEAR ? 'linear' : value === m.HOLD ? 'hold' : value === m.BEZIER ? 'bezier' : 'native'; }
function motionField(name) {
  if (typeof name !== 'string' || name.length > 512) return null;
  const normalized = name.normalize('NFKC').toLowerCase().replace(/[\s()_-]/g,'');
  const aliases = {position:'position',scale:'height',scaleheight:'height',scalewidth:'width',uniformscale:'uniform',rotation:'rotation',anchorpoint:'anchor'};
  return Object.prototype.hasOwnProperty.call(aliases,normalized) ? aliases[normalized] : null;
}
function parameterDiagnostic(names) {
  return names.map((name,index)=>index+': '+(typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,64) : '<'+typeof name+'>')).join(', ').slice(0,1200);
}
function validMotionBinding(binding) {
  return binding && binding.version===1 && ['AE.ADBE Motion','ADBE Motion'].includes(binding.componentMatchName)
    && Number.isInteger(binding.parameterCount) && binding.parameterCount>0 && binding.parameterCount<=64
    && ['widthIndex','uniformIndex','rotationIndex'].every(name=>Number.isInteger(binding[name]) && binding[name]>=0 && binding[name]<binding.parameterCount)
    && new Set([binding.widthIndex,binding.uniformIndex,binding.rotationIndex]).size===3
    && binding.uniform && binding.uniform.animated===false && typeof binding.uniform.value==='boolean';
}
function bindingIdentity(binding) { return binding ? [binding.version,binding.componentMatchName,binding.parameterCount,binding.widthIndex,binding.uniformIndex,binding.rotationIndex] : null; }
async function unnamedUniform(entries, indices, descriptor, matchName) {
  const binding=descriptor.motionBinding;
  if (!validMotionBinding(binding) || binding.componentMatchName!==matchName) return {reason:'A fresh exact-clip CEP Uniform Scale proof is unavailable.'};
  if (binding.uniformIndex!==binding.widthIndex+1 || binding.rotationIndex!==binding.uniformIndex+1) return {reason:'CEP did not identify Uniform Scale between Scale Width and Rotation.'};
  const entry=entries[indices.width+1];
  if (!entry || indices.rotation!==entry.index+1 || typeof entry.name!=='string' || entry.name.trim()!=='') return {reason:'The unnamed UXP control is not uniquely between Scale Width and Rotation.'};
  if (binding.parameterCount!==entries.length || binding.widthIndex!==indices.width || binding.uniformIndex!==entry.index || binding.rotationIndex!==indices.rotation) return {reason:'CEP and UXP exposed different Motion parameter counts or control ordinals.'};
  const animated=entry.param.isTimeVarying(), value=unwrap((await entry.param.getStartValue()).value), supported=await entry.param.areKeyframesSupported();
  const checkbox=typeof value==='boolean' || typeof value==='number' && (value===0 || value===1) && supported===false;
  if (animated!==false || !checkbox || !!value!==binding.uniform.value) return {reason:'Unnamed Motion control failed checkbox verification (type='+typeof value+', animated='+String(animated)+', keyframes='+String(supported)+').'};
  return {param:entry.param};
}

async function resolve(ppro, sequence, descriptor) {
  if (!descriptor || !Number.isInteger(descriptor.track) || descriptor.track < 0 || !Number.isSafeInteger(descriptor.ticksPerFrame) || descriptor.ticksPerFrame <= 0 || ![descriptor.frameWidth,descriptor.frameHeight,descriptor.bounds?.width,descriptor.bounds?.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0) || ![descriptor.startTicks,descriptor.endTicks,descriptor.inTicks].every(validTicks) || compareTicks(descriptor.endTicks,descriptor.startTicks)<=0) throw new Error('Premiere returned invalid text-area geometry.');
  const split=verifiedFragments(descriptor);
  const track = await sequence.getVideoTrack(descriptor.track);
  const candidates = [];
  for (const item of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)) {
    const start = await item.getStartTime(), end = await item.getEndTime(), source = await item.getInPoint();
    if (String(start.ticks) !== descriptor.startTicks || String(end.ticks) !== descriptor.endTicks || String(source.ticks) !== descriptor.inTicks) continue;
    if (split && String((await item.getOutPoint()).ticks)!==descriptor.outTicks) continue;
    const projectItem = ppro.ClipProjectItem.cast(await item.getProjectItem());
    if (await projectItem.getMediaFilePath() === descriptor.path) candidates.push(item);
  }
  if (candidates.length !== 1) throw new Error('The caption clip changed. Refresh Position & size.');
  const clip = candidates[0], chain = await clip.getComponentChain();
  let motion, motionMatchName;
  const componentCount = await chain.getComponentCount();
  if (!Number.isInteger(componentCount) || componentCount < 0 || componentCount > 256) throw new Error('Premiere returned an invalid caption component count.');
  for (let i = 0; i < componentCount; i++) { const c = await chain.getComponentAtIndex(i), matchName=await c.getMatchName(); if (['AE.ADBE Motion','ADBE Motion'].includes(matchName)) { motion = c; motionMatchName=matchName; break; } }
  if (!motion) throw new Error('Premiere did not expose caption Motion.');
  const params = {}, names = [], duplicates = [], entries = [], indices = {};
  // Await accepts the documented synchronous SDK as well as promise-backed
  // host wrappers. Resolve by label, never by a guessed parameter index.
  const paramCount = await motion.getParamCount();
  if (!Number.isInteger(paramCount) || paramCount < 0 || paramCount > 64) throw new Error('Premiere returned an invalid Motion parameter count.');
  for (let i = 0; i < paramCount; i++) {
    const p = await motion.getParam(i), name = p ? await p.displayName : undefined;
    names.push(name);
    entries.push({param:p,name,index:i});
    const field = motionField(name);
    if (field && params[field]) duplicates.push(field);
    else if (field) {params[field] = p;indices[field]=i;}
  }
  let uniformReason='';
  if (!params.uniform && !duplicates.length) {
    const recovered=await unnamedUniform(entries,indices,descriptor,motionMatchName);
    if(recovered.param)params.uniform=recovered.param;else uniformReason=recovered.reason+' ';
  }
  const missing = motionFields.filter(name => !params[name]);
  if (missing.length || duplicates.length) throw new Error('Premiere did not expose independent Motion dimensions. '+(missing.length ? 'Missing: '+missing.join(', ')+'. ' : '')+(duplicates.length ? 'Ambiguous: '+duplicates.join(', ')+'. ' : '')+uniformReason+'Motion parameters ('+paramCount+'): '+parameterDiagnostic(names)+'.');
  if (params.uniform.isTimeVarying()) throw new Error('Turn off animated Uniform Scale in Effect Controls before using independent dimensions.');
  return params;
}

async function curve(param, name) {
  const animated = param.isTimeVarying(), times = animated ? param.getKeyframeListAsTickTimes() : [];
  if (times.length > 256) throw new Error('Use Effect Controls for tracks with more than 256 keyframes.');
  const convert = value => name === 'position' || name === 'anchor' ? point(value) : name === 'uniform' ? !!unwrap(value) : number(unwrap(value),-1000000,1000000);
  const keys = [];
  for (const time of times) { const key = param.getKeyframePtr(time); keys.push({ ticks: String(time.ticks), value: convert(key.value), mode: typeof key.getTemporalInterpolationMode === 'function' ? await key.getTemporalInterpolationMode() : null }); }
  keys.sort(orderKeys);
  return { animated, value: animated ? null : convert((await param.getStartValue()).value), keys };
}
async function rawState(params) { const state = {}; for (const name of motionFields) state[name] = await curve(params[name],name); return state; }
function identity(d, includePath=true) { return JSON.stringify([d.sequenceId,d.projectPath,d.clipNodeId,d.projectItemId,includePath?d.path:null,d.track,d.startTicks,d.endTicks,d.inTicks,d.outTicks,d.ticksPerFrame,d.frameWidth,d.frameHeight,d.bounds,bindingIdentity(d.motionBinding),d.bundleSourceContiguous,d.bundleFragments]); }
function signature(d, raw) { return JSON.stringify([identity(d),raw]); }
async function verifyDescriptor(descriptor, revalidate, uniform) {
  if (typeof revalidate !== 'function') throw new Error('Native text-area edits require a fresh Premiere timeline identity check.');
  const fresh = await revalidate();
  if (!fresh || fresh.ok !== true || identity(fresh) !== identity(descriptor)) throw new Error('The caption timeline link changed. Refresh Position & size before continuing.');
  verifiedFragments(fresh);
  if (descriptor.motionBinding && (!validMotionBinding(fresh.motionBinding) || fresh.motionBinding.componentMatchName!==descriptor.motionBinding.componentMatchName || uniform && (uniform.animated || fresh.motionBinding.uniform.value!==uniform.value))) throw new Error('Uniform Scale changed or its exact CEP Motion binding could not be confirmed. Refresh Position & size.');
  return fresh;
}
function isAnimationRecovery(before, target) {
  let removed = false;
  if (!equal(before.uniform,target.uniform)) return false;
  for (const name of fields) {
    const old = before[name], next = target[name];
    if (equal(old,next)) continue;
    if (!old.animated || next.animated && (next.keys.length >= old.keys.length || !next.keys.every(key=>old.keys.some(previous=>equal(previous,key))))) return false;
    removed = true;
  }
  return removed;
}
function guardRenderSupport(descriptor, before, target, params) {
  const recovery = isAnimationRecovery(before,target);
  if (target.uniform.value && (target.height.animated || target.width.animated) && !recovery) throw new Error('Turn off Uniform Scale in Effect Controls before editing animated width or height. Existing unsupported animation can still be removed.');
  const otherAnimation = ['rotation','anchor'].some(name=>params[name]?.isTimeVarying());
  if (Number(descriptor.inTicks) > 2 && !verifiedFragments(descriptor) && (fields.some(name=>target[name].animated) || otherAnimation) && !recovery) throw new Error('Caption box reflow cannot preserve animated Motion on a trimmed source. Restore the caption source in point to zero, or remove its existing animation before adding or changing keyframes.');
}
function sameNativeNumber(actual,expected) {
  // Premiere stores Motion values as Float32. A round-to-nearest conversion
  // can differ by up to 2^-24 relatively; keep the existing near-zero floor.
  return Number.isFinite(actual)&&Number.isFinite(expected)
    && Math.abs(actual-expected)<=Math.max(1e-6,Math.abs(expected)*Math.pow(2,-24));
}
function confirmed(actual, expected) {
  const sameValue=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((v,i)=>sameValue(v,b[i])):typeof a==='boolean'&&(b===0||b===1)?Number(a)===b:typeof b==='boolean'&&(a===0||a===1)?a===Number(b):typeof a==='number'&&typeof b==='number'?sameNativeNumber(a,b):a===b;
  return motionFields.every(name=>{const a=actual?.[name],b=expected?.[name];return a&&b&&a.animated===b.animated&&(b.animated?a.keys.length===b.keys.length&&b.keys.every((key,i)=>a.keys[i].ticks===key.ticks&&(key.mode===null || key.mode===undefined || a.keys[i].mode===key.mode)&&sameValue(a.keys[i].value,key.value)):sameValue(a.value,b.value));});
}
function sameRaw(actual,expected) { return confirmed(actual,expected)&&confirmed(expected,actual); }
function descriptorMotionMatches(d,raw) { return !!d.nativeMotion && confirmed(raw,d.nativeMotion); }
function nativeValue(ppro, name, value) { return name === 'position' ? new ppro.PointF(value[0],value[1]) : value; }
async function keyframe(ppro, param, name, value, ticks, mode) {
  const key = param.createKeyframe(nativeValue(ppro,name,value)); key.position = tick(ppro,ticks);
  if (mode !== undefined) {
    if (typeof key.setTemporalInterpolationMode === 'function') { if (await key.setTemporalInterpolationMode(mode) === false) throw new Error('Premiere refused the keyframe interpolation.'); }
    else throw new Error('Premiere did not expose this scalar keyframe interpolation. Use Effect Controls.');
  }
  return {key,readableMode:typeof key.getTemporalInterpolationMode==='function'};
}
function simpleMode(ppro,mode) { return mode===ppro.Constants.InterpolationMode.LINEAR || mode===ppro.Constants.InterpolationMode.HOLD; }
function guardStructuralChanges(ppro,before,target,allowRecovery=false) {
  for(const name of fields) {
    const old=before[name],next=target[name];
    for(const key of old.keys) {
      const kept=next.animated && next.keys.find(item=>item.ticks===key.ticks);
      if(!kept && !simpleMode(ppro,key.mode) && !allowRecovery) throw new Error('Use Effect Controls to move or remove this keyframe. Premiere does not expose its custom interpolation for exact Undo and Redo.');
      if(kept && kept.mode!==key.mode && (!simpleMode(ppro,key.mode)||!simpleMode(ppro,kept.mode))) throw new Error('Use Effect Controls to change this keyframe\'s custom interpolation. Its native easing cannot be restored exactly by the plugin.');
    }
    for(const key of next.keys) if(!old.keys.some(item=>item.ticks===key.ticks) && !simpleMode(ppro,key.mode)) throw new Error('Use Premiere Undo or Effect Controls to preserve this keyframe\'s custom interpolation.');
  }
}
function reversible(ppro,before,after) { try { guardStructuralChanges(ppro,before,after);guardStructuralChanges(ppro,after,before);return true; } catch { return false; } }
function historyFor(d,raw) {
  const id=identity(d,false),saved=histories.get(id);
  if(saved&&!sameRaw(raw,saved.current)){histories.delete(id);return null;}
  return saved||null;
}
function boundHistory() {
  while(histories.size>HISTORY_CLIPS)histories.delete(histories.keys().next().value);
  while([...histories.values()].reduce((bytes,item)=>bytes+JSON.stringify(item).length,0)>HISTORY_BYTES){
    let trimmed=false;
    for(const [id,item] of histories){
      if(item.past.length>1){item.past.shift();trimmed=true;break;}
      if(item.future.length>1){item.future.shift();trimmed=true;break;}
      if(histories.size>1){histories.delete(id);trimmed=true;break;}
    }
    if(!trimmed){histories.clear();break;}
  }
}
async function replaceActions(ppro, param, name, target, current, patches, restoring = false) {
  const actions = [];
  if (!target.animated) {
    if (current.animated) actions.push(()=>param.createSetTimeVaryingAction(false));
    if (current.animated || !equal(current.value,target.value)) {
      if(name==='position'){const value=target.value.slice();actions.push(()=>param.createSetValueAction(param.createKeyframe(nativeValue(ppro,name,value)),true));}
      else {const prepared = await keyframe(ppro,param,name,target.value,0);actions.push(()=>param.createSetValueAction(prepared.key,true));}
    }
  } else {
    if (!current.animated) actions.push(()=>param.createSetTimeVaryingAction(true));
    for (const old of current.keys) if (!target.keys.some(k=>k.ticks===old.ticks)) { const at = tick(ppro,old.ticks); actions.push(()=>param.createRemoveKeyframeAction(at,true)); }
    for (const key of target.keys) {
      const old = current.keys.find(k=>k.ticks===key.ticks);
      const exactMode = simpleMode(ppro,key.mode);
      // Native easing handles are not exposed by this API. Keep existing
      // complex keys intact; a mode enum alone cannot recreate their curve.
      if (!old && !exactMode) throw new Error('Use Premiere Undo or Effect Controls to preserve this keyframe\'s custom interpolation.');
      if(old&&!equal(old.value,key.value)) patches.push({property:name,ticks:key.ticks,expectedValue:clone(old.value),value:clone(key.value)});
      if (!old) {
        if(name==='position'){
          // Adobe's PointKeyframe path constructs the PointF/key in the lock
          // and adds that key directly. Do not apply a scalar interpolation
          // Action to it or claim an undocumented default mode is Linear.
          const value=key.value.slice(), ticks=key.ticks;
          actions.push(()=>{const pointKey=param.createKeyframe(nativeValue(ppro,name,value));pointKey.position=tick(ppro,ticks);return param.createAddKeyframeAction(pointKey);});
          if(!old&&!restoring)key.mode=null;
          continue;
        }
        const requestedMode=key.mode, prepared = await keyframe(ppro,param,name,key.value,key.ticks,requestedMode);
        actions.push(()=>param.createAddKeyframeAction(prepared.key));
        // PointKeyframe does not expose a temporal-mode getter. Read back its
        // position/value, while leaving the UI mode explicitly "native".
        if(!prepared.readableMode)key.mode=null;
      }
      else if (old.mode !== key.mode) { const at = tick(ppro,key.ticks); actions.push(()=>param.createSetInterpolationAtKeyframeAction(at,key.mode,true)); }
    }
  }
  return actions;
}
async function snapshot(ppro, descriptor, params, raw, frame) {
  const d = descriptor, count = Math.round((Number(d.endTicks)-Number(d.startTicks))/d.ticksPerFrame);
  frame = Math.max(0,Math.min(count-1,Math.round(number(frame,0,1000000))));
  const at = tick(ppro,frameTicks(d,frame)), tracks = {};
  for (const name of fields) {
    const source = name === 'width' && raw.uniform.value ? 'height' : name, c = raw[source];
    const scale = name === 'position' ? [d.frameWidth,d.frameHeight] : [d.bounds[name]/100];
    const convert = value => (name === 'position' ? point(value) : [number(unwrap(value),1,10000)]).map((n,i)=>n*scale[i]);
    tracks[name] = { animated:c.animated, value:convert(await params[source].getValueAtTime(at)), keys:c.keys.map(k=>({ticks:k.ticks,frame:(Number(k.ticks)-Number(d.inTicks))/d.ticksPerFrame,value:convert(k.value),interpolation:modeName(ppro,k.mode)})) };
  }
  const sig = signature(d,raw), saved = historyFor(d,raw);
  return { signature:sig, frame, count, startTime:Number(d.startTicks)/254016000000, frameRate:254016000000/d.ticksPerFrame, frameWidth:d.frameWidth,frameHeight:d.frameHeight,tracks,canUndo:!!saved?.past.length,canRedo:!!saved?.future.length };
}
async function readArea(ppro, sequence, descriptor, frame, revalidate) {
  const params = await resolve(ppro,sequence,descriptor), raw = await rawState(params);
  await verifyDescriptor(descriptor,revalidate,raw.uniform);
  return snapshot(ppro,descriptor,params,raw,frame);
}
async function editArea(ppro, project, sequence, descriptor, request, revalidate, options={}) {
  if (!request || !['set','set-key','move-key','remove-key','toggle','key','interpolation','undo','redo'].includes(request.operation) || typeof request.signature !== 'string' || request.signature.length > 300000) throw new Error('Invalid text-area operation.');
  const params = await resolve(ppro,sequence,descriptor), before = await rawState(params), id = identity(descriptor,false);
  if (request.signature !== signature(descriptor,before)) throw new Error('Motion changed in Premiere. Refresh Position & size before editing again.');
  const view = await snapshot(ppro,descriptor,params,before,request.frame), name = request.track;
  const saved=historyFor(descriptor,before), isUndo=request.operation==='undo', isRedo=request.operation==='redo';
  let target = clone(before), entry;
  const actions = [],patches=[];
  if (isUndo || isRedo) {
    const stack=isUndo?saved?.past:saved?.future;
    entry=stack?.[stack.length-1];
    if (!entry || !sameRaw(before,isUndo?entry.after:entry.before)) throw new Error('Use Premiere Undo for earlier or external edits. No matching plugin '+(isUndo?'Undo':'Redo')+' is available.');
    target = clone(isUndo?entry.before:entry.after);
  } else {
    if (!fields.includes(name)) throw new Error('Invalid text-area track.');
    if (!await params[name].areKeyframesSupported()) throw new Error('This Motion property does not support keyframes.');
    const exact=['set-key','move-key','remove-key'].includes(request.operation) || request.operation==='interpolation' && request.keyTicks!==undefined;
    if(exact && (!validTicks(request.keyTicks)||!visibleKey(descriptor,request.keyTicks))) throw new Error('Select an existing keyframe within this caption clip.');
    const time = exact ? request.keyTicks : frameTicks(descriptor,view.frame);
    const selected=before[name].keys.find(key=>key.ticks===time);
    if(exact && (!before[name].animated || !selected)) throw new Error('The selected native keyframe no longer exists. Refresh Position & size.');
    const recoveryRequested = request.operation === 'toggle' && before[name].animated || ['key','remove-key'].includes(request.operation) && !!selected;
    let keepUniformForRecovery = false;
    if (name !== 'position' && before.uniform.value) {
      // Only static scales can be copied exactly. Mode enums do not contain
      // native Bezier handles, so recreating an animated Width curve loses it.
      if (before.height.animated || before.width.animated) {
        if (!recoveryRequested) throw new Error('Turn off Uniform Scale in Effect Controls before editing animated width or height. Custom native interpolation cannot be copied safely. Existing animation can still be removed.');
        keepUniformForRecovery = true;
      } else { target.width = clone(before.height); target.uniform = {animated:false,value:false,keys:[]}; }
    }
    const track = target[name];
    const existing = track.keys.find(k=>k.ticks===time);
    let value = unwrap(await params[name === 'width' && before.uniform.value && !keepUniformForRecovery ? 'height' : name].getValueAtTime(tick(ppro,time)));
    if (name === 'position') value = point(value);
    if (request.operation === 'set' || request.operation === 'set-key') {
      if (!Array.isArray(request.value) || request.value.length !== (name === 'position' ? 2 : 1)) throw new Error('Invalid text-area dimensions.');
      value = name === 'position' ? [number(request.value[0],-descriptor.frameWidth*2,descriptor.frameWidth*3)/descriptor.frameWidth,number(request.value[1],-descriptor.frameHeight*2,descriptor.frameHeight*3)/descriptor.frameHeight] : number(request.value[0],descriptor.bounds[name]*.01,descriptor.bounds[name]*100)/descriptor.bounds[name]*100;
    }
    if (request.operation === 'move-key') {
      const frame=number(request.targetFrame,0,Math.min(view.count-1,1000000));
      if(!Number.isInteger(frame))throw new Error('Choose a whole frame within this caption clip.');
      const destination=frameTicks(descriptor,frame);
      if(!visibleKey(descriptor,destination))throw new Error('The destination is outside this caption clip.');
      if(track.keys.some(key=>key!==existing && key.ticks===destination))throw new Error('A native keyframe already occupies the destination frame.');
      existing.ticks=destination;
      track.keys.sort(orderKeys);
    }
    else if (request.operation === 'toggle' && track.animated || ['key','remove-key'].includes(request.operation) && existing && track.keys.length === 1) { track.animated=false;track.value=existing&&request.operation==='remove-key'?clone(existing.value):value;track.keys=[]; }
    else if (['key','remove-key'].includes(request.operation) && existing) track.keys=track.keys.filter(k=>k!==existing);
    else if (request.operation === 'interpolation') {
      const m = ppro.Constants.InterpolationMode, modes = {linear:m.LINEAR,hold:m.HOLD,bezier:m.BEZIER};
      if (!existing || !Object.prototype.hasOwnProperty.call(modes,request.interpolation)) throw new Error('Select a keyframe to change its interpolation.');
      if (existing.mode === null) throw new Error('Premiere does not expose this keyframe\'s interpolation for readback. Use Effect Controls to change it.');
      existing.mode=modes[request.interpolation];
    } else if (track.animated || request.operation === 'toggle' || request.operation === 'key') {
      if (!existing && track.keys.length >= 256) throw new Error('This property already has 256 keyframes.');
      track.animated=true;track.value=null;
      if (existing) existing.value=value; else track.keys.push({ticks:time,value,mode:ppro.Constants.InterpolationMode.LINEAR});
      track.keys.sort(orderKeys);
    } else track.value=value;
  }
  guardRenderSupport(descriptor,before,target,params);
  const recovery=isAnimationRecovery(before,target) && (Number(descriptor.inTicks)>2 && !verifiedFragments(descriptor) || before.uniform.value && (before.height.animated||before.width.animated));
  guardStructuralChanges(ppro,before,target,recovery);
  for (const n of [...fields,'uniform']) if (!equal(before[n],target[n])) actions.push(...await replaceActions(ppro,params[n],n,target[n],before[n],patches,isUndo||isRedo));
  if(patches.length && (typeof options.patchKeyValues!=='function' || actions.length || patches.length>32)) throw new Error('This existing-key edit requires the compatible in-place Premiere keyframe service. No native changes were made.');
  // UXP exposes a project-item ID, but no documented mapping to CEP track-item
  // node IDs. Revalidate the exact private CEP descriptor after preparation;
  // no further asynchronous native work is started before the transaction.
  const currentParams = await resolve(ppro,sequence,descriptor);
  if (!sameRaw(before,await rawState(currentParams))) throw new Error('Motion changed while the edit was prepared. Refresh and try again.');
  const commitDescriptor=await verifyDescriptor(descriptor,revalidate,before.uniform);
  if(patches.length && !descriptorMotionMatches(commitDescriptor,before)) throw new Error('The exact native Motion state could not be confirmed for an in-place keyframe edit. No native changes were made.');
  if (patches.length) {
    let receipt;
    try { receipt=await options.patchKeyValues({version:1,descriptor:commitDescriptor,updates:patches}); }
    catch(error){histories.delete(id);throw error;}
    if(!receipt || receipt.ok!==true || !receipt.descriptor || identity(receipt.descriptor)!==identity(descriptor) || !descriptorMotionMatches(receipt.descriptor,target)) { histories.delete(id);throw new Error('Premiere did not confirm the in-place keyframe edit. Refresh Position & size before continuing.'); }
  } else if (actions.length) {
    let committed=false;
    project.lockedAccess(()=>{ committed=project.executeTransaction(compound=>{for(const createAction of actions) if(compound.addAction(createAction())===false)throw new Error('Premiere refused a Motion action.');},'Better Captions: Position & size'); });
    if (!committed) throw new Error('Premiere did not commit the text-area edit.');
  }
  let afterParams, after;
  try {
    // Unlocking Uniform Scale changes the binding proof's Boolean state.
    // Refresh that proof before resolving an unnamed control after the edit.
    const afterDescriptor = await verifyDescriptor(descriptor,revalidate);
    afterParams = await resolve(ppro,sequence,afterDescriptor);
    after = await rawState(afterParams);
    await verifyDescriptor(descriptor,revalidate,after.uniform);
  } catch (error) {
    histories.delete(id);
    throw new Error('The native edit could not be verified after its transaction. Use Premiere Undo, then refresh Position & size. ' + String(error.message || error));
  }
  if (!confirmed(after,target)) { histories.delete(id); throw new Error('Premiere did not confirm every Motion change. Use Premiere Undo, then refresh Position & size.'); }
  if(!sameRaw(before,after)){
    const next=saved||{past:[],future:[],current:before};
    if(isUndo){next.past.pop();next.future.push(entry);}
    else if(isRedo){next.future.pop();next.past.push(entry);}
    else if(reversible(ppro,before,after)){next.past.push({before:clone(before),after:clone(after)});if(next.past.length>HISTORY_STEPS)next.past.shift();next.future=[];}
    else {histories.delete(id);return snapshot(ppro,descriptor,afterParams,after,view.frame);}
    next.current=clone(after);histories.delete(id);histories.set(id,next);boundHistory();
  }
  return snapshot(ppro,descriptor,afterParams,after,view.frame);
}
module.exports = { readArea, editArea };
