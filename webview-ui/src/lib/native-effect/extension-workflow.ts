import type { NativePanelBinding } from './panel.ts';
import { prepareNativeCaptionExtension } from './extend.ts';
import { encodeNativeTransportText } from './encode.ts';
import { parseTranscript } from '../transcript/parser.ts';
import type { TranscriptJSON } from '../types.ts';
import type { NativeCaptionExtensionReceipt,NativeCaptionExtensionRequest,NativeCaptionExtensionResult,NativeCaptionSnapshot } from '../../cep-api.ts';
interface ExtensionAPI {
  readNativeCaptionExtension:(snapshot:NativeCaptionSnapshot,id:string)=>Promise<NativeCaptionExtensionReceipt>;
  transcribeSequenceRange:(begin:number,end:number,id:string)=>Promise<string>;
  extendNativeCaptionDocument:(snapshot:NativeCaptionSnapshot,request:NativeCaptionExtensionRequest,id:string)=>Promise<NativeCaptionExtensionResult>;
}
function sameLocator(left:NativePanelBinding['snapshot']['locator']|undefined,right:NativePanelBinding['snapshot']['locator']) {
  return !!left && (['projectPath','sequenceId','clipNodeId','trackIndex','clipIndex','componentIndex','documentParamIndex'] as const).every(key=>left[key]===right[key]);
}
function unconfirmed(cause?:unknown) {
  return Object.assign(new Error('Premiere did not confirm the extension. Reconnect the caption layer before making more changes.'),{code:'BC_OUTPUT_UNCONFIRMED',recoverable:false,outputApplied:true,...(cause!==undefined?{cause}:{})});
}
/** Existing edits must be flushed before this bounded, append-only operation. */
export async function extendNativeCaptions(binding:NativePanelBinding,api:ExtensionAPI,sequenceId:string,stillCurrent:()=>boolean){
  const context=await api.readNativeCaptionExtension(binding.snapshot,sequenceId);
  if(!stillCurrent())throw new Error('The active caption layer changed. Nothing was extended.');
  if(context?.ok!==true||typeof context.canExtend!=='boolean'||typeof context.revision!=='string'||!context.revision)throw new Error('Premiere did not confirm the footage available for extension.');
  if(!context.canExtend)return {changed:false as const,appendedWords:0};
  if(context.connection.revision!==binding.snapshot.revision||context.connection.documentText!==binding.clip.documentText||!sameLocator(context.connection.locator,binding.snapshot.locator)||context.connection.projectItemId!==binding.clip.projectItemId||context.connection.clipNodeId!==binding.clip.clipNodeId||(['startTicks','endTicks','inTicks','outTicks'] as const).some(key=>context.connection[key]!==binding.clip[key]))throw new Error('The caption layer changed. Reconnect it before extending.');
  const placement={sequenceId:binding.document.sequenceId,...context.connection,ticksPerFrame:context.ticksPerFrame};
  const empty=prepareNativeCaptionExtension(binding.document,placement,context.targetEndTicks,[]);
  const expectedOut=BigInt(context.connection.outTicks)+BigInt(context.targetEndTicks)-BigInt(context.connection.endTicks);
  if(String(expectedOut)!==context.targetOutTicks)throw new Error('Premiere returned inconsistent caption extension timing.');
  const target=Number(BigInt(context.targetEndTicks))/254016000000;
  let words:ReturnType<typeof parseTranscript>[number]['words']=[];
  if(empty.appendFromSeconds<target){
    const raw=await api.transcribeSequenceRange(empty.appendFromSeconds,target,sequenceId);
    if(!stillCurrent())throw new Error('The active caption layer changed during transcription. Nothing was extended.');
    const transcript=JSON.parse(raw) as TranscriptJSON;
    if(!transcript||!Array.isArray(transcript.segments))throw new Error('Premiere did not return a timed transcript for the added footage.');
    words=parseTranscript(transcript).flatMap(caption=>caption.words);
  }
  const plan=prepareNativeCaptionExtension(binding.document,placement,context.targetEndTicks,words.map(word=>({text:word.text,start:word.startTime,end:word.endTime,endOfSentence:!!word.endOfSentence})));
  if(!plan.changed)return {changed:false as const,appendedWords:0};
  if(!stillCurrent())throw new Error('The active caption layer changed. Nothing was extended.');
  const documentText=encodeNativeTransportText(plan.document);
  // Exactly one mutation attempt; the host rechecks the captured timeline graph.
  let result:NativeCaptionExtensionResult;
  try {
    result=await api.extendNativeCaptionDocument(binding.snapshot,{revision:context.revision,documentText,endTicks:plan.endTicks,outTicks:plan.outTicks},sequenceId);
  } catch(problem) {
    // A rejected transport promise cannot prove the host did not apply it.
    throw unconfirmed(problem);
  }
  const connection=result?.connection;
  if(!result?.ok||!result.readbackVerified||result.retry!=='never'||!connection||connection.documentText!==documentText||connection.clipNodeId!==binding.clip.clipNodeId||connection.projectItemId!==binding.clip.projectItemId||!sameLocator(connection.locator,binding.snapshot.locator)||connection.startTicks!==context.connection.startTicks||connection.inTicks!==context.connection.inTicks||connection.endTicks!==plan.endTicks||connection.outTicks!==plan.outTicks||typeof connection.revision!=='string'||!connection.revision||!stillCurrent())throw unconfirmed();
  return {changed:true as const,appendedWords:plan.appendedWords,connection:result.connection};
}
