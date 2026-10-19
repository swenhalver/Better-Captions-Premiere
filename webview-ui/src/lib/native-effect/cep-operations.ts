import { NATIVE_EFFECT_MATCH_NAME, normalizeNativeMatchName, validateNativeDocument } from './contract.ts';
import { encodeNativeTransportText, decodeNativeTransportTimeOrigin, MAX_NATIVE_CARRIER_BYTES } from './encode.ts';
export interface CepNativeLocator {
  projectPath: string; sequenceId: string; clipNodeId: string;
  trackIndex: number; clipIndex: number; componentIndex: number; documentParamIndex: number;
}
export interface CepNativeSnapshot {
  locator: CepNativeLocator;
  /** Exact opaque revision returned by the read script; includes document carrier,
   * clip timing and component ordering. Never derive this from an earlier project. */
  revision: string;
}
function locator(input: CepNativeLocator): CepNativeLocator {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('Expected a native CEP locator.');
  const names = ['projectPath', 'sequenceId', 'clipNodeId', 'trackIndex', 'clipIndex', 'componentIndex', 'documentParamIndex'];
  if (Object.keys(input).some(key => !names.includes(key))) throw new Error('Unknown CEP locator field.');
  for (const key of ['projectPath', 'sequenceId', 'clipNodeId'] as const) {
    if (typeof input[key] !== 'string' || !input[key] || input[key].length > (key === 'projectPath' ? 4096 : 256) || /[\u0000-\u001f]/.test(input[key])) throw new Error('Invalid CEP identity.');
  }
  for (const key of ['trackIndex', 'clipIndex', 'componentIndex', 'documentParamIndex'] as const) {
    if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > (key === 'clipIndex' ? 100000 : 128)) throw new Error('Invalid bounded CEP index.');
  }
  return { projectPath: input.projectPath, sequenceId: input.sequenceId, clipNodeId: input.clipNodeId, trackIndex: input.trackIndex, clipIndex: input.clipIndex, componentIndex: input.componentIndex, documentParamIndex: input.documentParamIndex };
}
function literal(value: unknown): string { return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
/** Real ExtendScript API calls, returned as source for an explicitly chosen CEP bridge.
 * Building a script never executes it. No QE, file IO, effect insertion or retries. */
function script(request: { locator: CepNativeLocator; expectedRevision?: string; documentText?: string }): string {
  return `(function(){
var r=${literal(request)};
function fail(message){throw new Error(message);}
function canonical(name){return name===${literal(NATIVE_EFFECT_MATCH_NAME)}||name===${literal('AE.' + NATIVE_EFFECT_MATCH_NAME)};}
function read(){
 var p=app.project,projectPath=p?String(p.path):'';
 // Match the host bridge's local-drive prefix normalization without changing locator identity.
 if(projectPath.slice(0,4)===${literal('\\\\?\\')}&&/^[a-z]:$/i.test(projectPath.slice(4,6))&&projectPath.charCodeAt(6)===92)projectPath=projectPath.slice(4);
 if(!p||projectPath!==r.locator.projectPath)fail('Native project changed.');
 var s=p.activeSequence;if(!s||String(s.sequenceID)!==r.locator.sequenceId)fail('Native sequence changed.');
 var tracks=s.videoTracks;if(r.locator.trackIndex>=tracks.numTracks)fail('Native track changed.');
 var clips=tracks[r.locator.trackIndex].clips;if(r.locator.clipIndex>=clips.numItems)fail('Native clip changed.');
 var c=clips[r.locator.clipIndex];if(String(c.nodeId)!==r.locator.clipNodeId)fail('Native clip identity changed.');
 if(typeof c.isAdjustmentLayer!=='function'||c.isAdjustmentLayer()!==true)fail('Native captions require an adjustment layer.');
 var components=c.components;if(components.numItems>128||r.locator.componentIndex>=components.numItems)fail('Native component changed.');
 var fx=components[r.locator.componentIndex];if(!canonical(String(fx.matchName)))fail('Native effect changed.');
 var props=fx.properties;if(props.numItems>128||r.locator.documentParamIndex>=props.numItems)fail('Native parameter changed.');
 var param=props[r.locator.documentParamIndex];if(String(param.displayName)!=='Caption document (experimental)')fail('Native document parameter changed.');
 if(param.isTimeVarying())fail('Native document unexpectedly animated.');
 var text=param.getValue();if(typeof text!=='string'||!/^BCDOC1:[0-9a-f]+$/.test(text)||text.length%2!==1||(text.length+1)*2>${MAX_NATIVE_CARRIER_BYTES})fail('Native document is not a bounded text carrier.');
 var names=[],nativeCount=0;for(var i=0;i<components.numItems;i++){var name=String(components[i].matchName);names.push(name);if(canonical(name))nativeCount++;}
 if(nativeCount!==1)fail('Ambiguous native component instances.');
 var revision=JSON.stringify({projectPath:projectPath,sequenceId:String(s.sequenceID),clipNodeId:String(c.nodeId),adjustmentLayer:true,start:String(c.start.ticks),end:String(c.end.ticks),inPoint:String(c.inPoint.ticks),outPoint:String(c.outPoint.ticks),components:names,documentIndex:r.locator.documentParamIndex,documentText:text});
 return {param:param,text:text,revision:revision};
}
var attempted=false;
try{
 var before=read();
 if(r.documentText===undefined)return JSON.stringify({ok:true,revision:before.revision,documentText:before.text,readOnly:true});
 if(before.revision!==r.expectedRevision)fail('Native revision changed. Read again; no write performed.');
 // Exactly one setter. Its boolean/integer acknowledgement is not render proof.
 attempted=true;
 var acknowledgement=before.param.setValue(r.documentText,1);
 var after=read();
 if(after.text!==r.documentText)return JSON.stringify({ok:false,uncertain:true,retry:'never',error:'Native write readback differs; inspect before another action.'});
 return JSON.stringify({ok:true,revision:after.revision,documentText:after.text,acknowledgement:acknowledgement,readbackVerified:true,renderVerified:false,retry:'never'});
}catch(e){return JSON.stringify({ok:false,uncertain:attempted,retry:'never',error:'Native host operation failed. Inspect the current target before another action.'});}
})()`;
}
export function buildCepNativeReadScript(input: CepNativeLocator): string { return script({ locator: locator(input) }); }
/** Requires explicit existing-container selection. Migration/addition is a separate action.
 * The caller must preserve a reversible snapshot before executing this script. */
export function buildCepNativeDocumentApplyScript(snapshot: CepNativeSnapshot, document: unknown, explicitConsent: boolean, mode: 'initial-attachment' | 'edit-existing'): string {
  if (explicitConsent !== true) throw new Error('Explicit native document apply consent is required.');
  if (mode !== 'initial-attachment' && mode !== 'edit-existing') throw new Error('Choose explicit initial attachment or existing-document editing.');
  const selected = locator(snapshot.locator);
  if (typeof snapshot.revision !== 'string' || !snapshot.revision || snapshot.revision.length > MAX_NATIVE_CARRIER_BYTES) throw new Error('Read the exact native revision before apply.');
  // Parse revision only as JSON data; bind it to the selected project/sequence/clip.
  let baseline: Record<string, unknown>;
  try { baseline = JSON.parse(snapshot.revision); } catch { throw new Error('Invalid native revision.'); }
  if (!baseline || baseline.projectPath !== selected.projectPath || baseline.sequenceId !== selected.sequenceId || baseline.clipNodeId !== selected.clipNodeId || baseline.adjustmentLayer !== true || baseline.documentIndex !== selected.documentParamIndex || !Array.isArray(baseline.components) || !normalizeNativeMatchName(baseline.components[selected.componentIndex])) throw new Error('Native snapshot identity differs.');
  const normalized = validateNativeDocument(document);
  if (normalized.sequenceId !== selected.sequenceId) throw new Error('Native document sequence differs.');
  const seconds = mode === 'initial-attachment'
    ? adjustmentLayerTimeOrigin(baseline.start, baseline.inPoint)
    : decodeNativeTransportTimeOrigin(baseline.documentText);
  return script({ locator: selected, expectedRevision: snapshot.revision, documentText: encodeNativeTransportText({ ...normalized, timeOriginSeconds: seconds }) });
}

/** Word times remain sequence-relative. Snapshot start/inPoint are exact Premiere
 * decimal tick strings; only the explicit apply derives this persistent origin. */
export function adjustmentLayerTimeOrigin(startTicks: unknown, inPointTicks: unknown): number {
  const ticksPerSecond = 254016000000n, bound = 864000n * ticksPerSecond;
  function ticks(value: unknown): bigint {
    if (typeof value !== 'string' || !/^-?\d{1,21}$/.test(value)) throw new Error('Invalid adjustment-layer snapshot ticks.');
    const result = BigInt(value);
    if (result < -bound || result > bound) throw new Error('Adjustment-layer snapshot ticks exceed bounds.');
    return result;
  }
  const difference = ticks(inPointTicks) - ticks(startTicks);
  if (difference < -bound || difference > bound) throw new Error('Adjustment-layer time origin exceeds bounds.');
  return Number(difference) / Number(ticksPerSecond);
}
