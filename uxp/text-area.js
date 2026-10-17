'use strict';
// Native UXP actions give every panel edit one Premiere Undo transaction.
const undo = new Map();
const fields = ['position', 'width', 'height'];
const unwrap = value => { for (let depth=0;depth<3 && value && typeof value==='object' && 'value' in value;depth++) { const next=value.value;if(next===value)break;value=next; } return value; };
const number = (value, min, max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid text-area value.'); return value; };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tick = (ppro, ticks) => ppro.TickTime.createWithTicks(String(Math.round(Number(ticks))));
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
  if (!descriptor || !Number.isInteger(descriptor.track) || descriptor.track < 0 || !Number.isFinite(descriptor.ticksPerFrame) || descriptor.ticksPerFrame <= 0 || ![descriptor.frameWidth,descriptor.frameHeight,descriptor.bounds?.width,descriptor.bounds?.height].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0) || ![descriptor.startTicks,descriptor.endTicks,descriptor.inTicks].every(n=>typeof n==='string'&&/^\d+$/.test(n)) || Number(descriptor.endTicks)<=Number(descriptor.startTicks)) throw new Error('Premiere returned invalid text-area geometry.');
  const track = await sequence.getVideoTrack(descriptor.track);
  const candidates = [];
  for (const item of await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)) {
    const start = await item.getStartTime(), end = await item.getEndTime(), source = await item.getInPoint();
    if (String(start.ticks) !== descriptor.startTicks || String(end.ticks) !== descriptor.endTicks || String(source.ticks) !== descriptor.inTicks) continue;
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
  const missing = [...fields,'uniform'].filter(name => !params[name]);
  if (missing.length || duplicates.length) throw new Error('Premiere did not expose independent Motion dimensions. '+(missing.length ? 'Missing: '+missing.join(', ')+'. ' : '')+(duplicates.length ? 'Ambiguous: '+duplicates.join(', ')+'. ' : '')+uniformReason+'Motion parameters ('+paramCount+'): '+parameterDiagnostic(names)+'.');
  if (params.uniform.isTimeVarying()) throw new Error('Turn off animated Uniform Scale in Effect Controls before using independent dimensions.');
  return params;
}

async function curve(param, name) {
  const animated = param.isTimeVarying(), times = animated ? param.getKeyframeListAsTickTimes() : [];
  if (times.length > 256) throw new Error('Use Effect Controls for tracks with more than 256 keyframes.');
  const convert = value => name === 'position' ? point(value) : name === 'uniform' ? !!unwrap(value) : unwrap(value);
  const keys = [];
  for (const time of times) { const key = param.getKeyframePtr(time); keys.push({ ticks: String(time.ticks), value: convert(key.value), mode: typeof key.getTemporalInterpolationMode === 'function' ? await key.getTemporalInterpolationMode() : null }); }
  keys.sort((a,b) => Number(a.ticks)-Number(b.ticks));
  return { animated, value: animated ? null : convert((await param.getStartValue()).value), keys };
}
async function rawState(params) { const state = {}; for (const name of [...fields,'uniform']) state[name] = await curve(params[name],name); return state; }
function identity(d) { return JSON.stringify([d.sequenceId,d.projectPath,d.clipNodeId,d.projectItemId,d.path,d.track,d.startTicks,d.endTicks,d.inTicks,d.ticksPerFrame,d.frameWidth,d.frameHeight,d.bounds,bindingIdentity(d.motionBinding)]); }
function signature(d, raw) { return JSON.stringify([identity(d),raw]); }
async function verifyDescriptor(descriptor, revalidate, uniform) {
  if (typeof revalidate !== 'function') throw new Error('Native text-area edits require a fresh Premiere timeline identity check.');
  const fresh = await revalidate();
  if (!fresh || fresh.ok !== true || identity(fresh) !== identity(descriptor)) throw new Error('The caption timeline link changed. Refresh Position & size before continuing.');
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
  if (Number(descriptor.inTicks) > 2 && (fields.some(name=>target[name].animated) || otherAnimation) && !recovery) throw new Error('Caption box reflow cannot preserve animated Motion on a trimmed source. Restore the caption source in point to zero, or remove its existing animation before adding or changing keyframes.');
}
function confirmed(actual, expected) {
  const sameValue=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((v,i)=>sameValue(v,b[i])):typeof a==='number'&&typeof b==='number'?Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-8):a===b;
  return [...fields,'uniform'].every(name=>{const a=actual[name],b=expected[name];return a.animated===b.animated&&(b.animated?a.keys.length===b.keys.length&&b.keys.every((key,i)=>Math.abs(Number(a.keys[i].ticks)-Number(key.ticks))<=2&&(key.mode===null || a.keys[i].mode===key.mode)&&sameValue(a.keys[i].value,key.value)):sameValue(a.value,b.value));});
}
function nativeValue(ppro, name, value) { return name === 'position' ? new ppro.PointF(value[0],value[1]) : value; }
async function keyframe(ppro, param, name, value, ticks, mode) {
  const key = param.createKeyframe(nativeValue(ppro,name,value)); key.position = tick(ppro,ticks);
  if (mode !== undefined) {
    if (typeof key.setTemporalInterpolationMode === 'function') { if (await key.setTemporalInterpolationMode(mode) === false) throw new Error('Premiere refused the keyframe interpolation.'); }
    else throw new Error('Premiere did not expose this scalar keyframe interpolation. Use Effect Controls.');
  }
  return {key,readableMode:typeof key.getTemporalInterpolationMode==='function'};
}
async function replaceActions(ppro, param, name, target, current, restoring = false) {
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
      const exactMode = key.mode === ppro.Constants.InterpolationMode.LINEAR || key.mode === ppro.Constants.InterpolationMode.HOLD;
      // Native easing handles are not exposed by this API. Keep existing
      // complex keys intact; a mode enum alone cannot recreate their curve.
      if ((!old || !equal(old.value,key.value) || restoring && old.mode !== key.mode) && !exactMode) throw new Error('Use Premiere Undo or Effect Controls to preserve this keyframe\'s custom interpolation.');
      if (!old || !equal(old.value,key.value)) {
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
  const at = tick(ppro,Number(d.inTicks)+frame*d.ticksPerFrame), tracks = {};
  for (const name of fields) {
    const source = name === 'width' && raw.uniform.value ? 'height' : name, c = raw[source];
    const scale = name === 'position' ? [d.frameWidth,d.frameHeight] : [d.bounds[name]/100];
    const convert = value => (name === 'position' ? point(value) : [number(unwrap(value),1,10000)]).map((n,i)=>n*scale[i]);
    tracks[name] = { animated:c.animated, value:convert(await params[source].getValueAtTime(at)), keys:c.keys.map(k=>({frame:(Number(k.ticks)-Number(d.inTicks))/d.ticksPerFrame,value:convert(k.value),interpolation:modeName(ppro,k.mode)})) };
  }
  const sig = signature(d,raw), saved = undo.get(identity(d));
  return { signature:sig, frame, count, startTime:Number(d.startTicks)/254016000000, frameRate:254016000000/d.ticksPerFrame, frameWidth:d.frameWidth,frameHeight:d.frameHeight,tracks,canUndo:!!saved && saved.after === sig };
}
async function readArea(ppro, sequence, descriptor, frame, revalidate) {
  const params = await resolve(ppro,sequence,descriptor), raw = await rawState(params);
  await verifyDescriptor(descriptor,revalidate,raw.uniform);
  return snapshot(ppro,descriptor,params,raw,frame);
}
async function editArea(ppro, project, sequence, descriptor, request, revalidate) {
  if (!request || !['set','toggle','key','interpolation','undo'].includes(request.operation) || typeof request.signature !== 'string' || request.signature.length > 300000) throw new Error('Invalid text-area operation.');
  const params = await resolve(ppro,sequence,descriptor), before = await rawState(params), id = identity(descriptor);
  if (request.signature !== signature(descriptor,before)) throw new Error('Motion changed in Premiere. Refresh Position & size before editing again.');
  const view = await snapshot(ppro,descriptor,params,before,request.frame), name = request.track;
  let target = JSON.parse(JSON.stringify(before));
  const actions = [];
  if (request.operation === 'undo') {
    const saved = undo.get(id); if (!saved || saved.after !== request.signature) throw new Error('Use Premiere Undo for earlier or external edits.');
    target = saved.before;
  } else {
    if (!fields.includes(name)) throw new Error('Invalid text-area track.');
    if (!await params[name].areKeyframesSupported()) throw new Error('This Motion property does not support keyframes.');
    const time = String(Math.round(Number(descriptor.inTicks)+view.frame*descriptor.ticksPerFrame));
    const recoveryRequested = request.operation === 'toggle' && before[name].animated || request.operation === 'key' && before[name].animated && before[name].keys.some(key=>Math.abs(Number(key.ticks)-Number(time))<=2);
    let keepUniformForRecovery = false;
    if (name !== 'position' && before.uniform.value) {
      // Only static scales can be copied exactly. Mode enums do not contain
      // native Bezier handles, so recreating an animated Width curve loses it.
      if (before.height.animated || before.width.animated) {
        if (!recoveryRequested) throw new Error('Turn off Uniform Scale in Effect Controls before editing animated width or height. Custom native interpolation cannot be copied safely. Existing animation can still be removed.');
        keepUniformForRecovery = true;
      } else { target.width = JSON.parse(JSON.stringify(before.height)); target.uniform = {animated:false,value:false,keys:[]}; }
    }
    const track = target[name];
    const existing = track.keys.find(k=>Math.abs(Number(k.ticks)-Number(time))<=2);
    let value = unwrap(await params[name === 'width' && before.uniform.value && !keepUniformForRecovery ? 'height' : name].getValueAtTime(tick(ppro,time)));
    if (name === 'position') value = point(value);
    if (request.operation === 'set') {
      if (!Array.isArray(request.value) || request.value.length !== (name === 'position' ? 2 : 1)) throw new Error('Invalid text-area dimensions.');
      value = name === 'position' ? [number(request.value[0],-descriptor.frameWidth*2,descriptor.frameWidth*3)/descriptor.frameWidth,number(request.value[1],-descriptor.frameHeight*2,descriptor.frameHeight*3)/descriptor.frameHeight] : number(request.value[0],descriptor.bounds[name]*.01,descriptor.bounds[name]*100)/descriptor.bounds[name]*100;
    }
    if (request.operation === 'toggle' && track.animated || request.operation === 'key' && existing && track.keys.length === 1) { track.animated=false;track.value=value;track.keys=[]; }
    else if (request.operation === 'key' && existing) track.keys=track.keys.filter(k=>k!==existing);
    else if (request.operation === 'interpolation') {
      const m = ppro.Constants.InterpolationMode, modes = {linear:m.LINEAR,hold:m.HOLD,bezier:m.BEZIER};
      if (!existing || !Object.prototype.hasOwnProperty.call(modes,request.interpolation)) throw new Error('Select a keyframe to change its interpolation.');
      if (existing.mode === null) throw new Error('Premiere does not expose this keyframe\'s interpolation for readback. Use Effect Controls to change it.');
      existing.mode=modes[request.interpolation];
    } else if (track.animated || request.operation === 'toggle' || request.operation === 'key') {
      if (!existing && track.keys.length >= 256) throw new Error('This property already has 256 keyframes.');
      track.animated=true;track.value=null;
      if (existing) existing.value=value; else track.keys.push({ticks:time,value,mode:ppro.Constants.InterpolationMode.LINEAR});
      track.keys.sort((a,b)=>Number(a.ticks)-Number(b.ticks));
    } else track.value=value;
  }
  guardRenderSupport(descriptor,before,target,params);
  for (const n of [...fields,'uniform']) if (!equal(before[n],target[n])) actions.push(...await replaceActions(ppro,params[n],n,target[n],before[n],request.operation === 'undo'));
  // UXP exposes a project-item ID, but no documented mapping to CEP track-item
  // node IDs. Revalidate the exact private CEP descriptor after preparation;
  // no further asynchronous native work is started before the transaction.
  const currentParams = await resolve(ppro,sequence,descriptor);
  if (!equal(before,await rawState(currentParams))) throw new Error('Motion changed while the edit was prepared. Refresh and try again.');
  await verifyDescriptor(descriptor,revalidate,before.uniform);
  if (actions.length) {
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
    undo.delete(id);
    throw new Error('The native edit could not be verified after its transaction. Use Premiere Undo, then refresh Position & size. ' + String(error.message || error));
  }
  if (!confirmed(after,target)) { undo.delete(id); throw new Error('Premiere did not confirm every Motion change. Use Premiere Undo, then refresh Position & size.'); }
  if (request.operation === 'undo') undo.delete(id);
  else { undo.set(id,{before,after:signature(descriptor,after)});if(undo.size>32)undo.delete(undo.keys().next().value); }
  return snapshot(ppro,descriptor,afterParams,after,view.frame);
}
module.exports = { readArea, editArea };
