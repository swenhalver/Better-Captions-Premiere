import { buildNativeGraphicsPlan, type NativeGraphicsPlanInput } from './plan.ts';
import { buildNativeGraphicsXml } from './xml.ts';

export interface NativeGraphicsSource extends Omit<NativeGraphicsPlanInput, 'sequence'> {
  sequenceId: string;
  projectPath?: string;
}
export interface NativeGraphicsGenerationOptions { mode: 'save-only' | 'import-new-sequence'; }
export interface NativeGraphicsArtifacts { directory: string; xml: string; manifest: string; srt: string; }
export interface NativeGraphicsGenerationResult {
  ok: true;
  version: 1;
  generationId: string;
  source: { projectPath: string; sequenceId: string };
  status: 'saved' | 'imported' | 'import-unconfirmed';
  importAttempted: boolean;
  automaticRetryAllowed: false;
  artifacts: NativeGraphicsArtifacts;
  nativeSequence?: { id: string; name: string };
  verification: 'artifacts-only' | 'new-sequence-identity-and-settings';
  warnings: string[];
}
interface SourceContext { id: string; name: string; projectPath: string; width: number; height: number; fps: number; }

function sameId(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const normalize = (value: string) => {
    const plain = value.startsWith('{') && value.endsWith('}') ? value.slice(1, -1) : value;
    return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(plain) ? plain.toLowerCase() : value;
  };
  return normalize(a) === normalize(b);
}

/** Source settings come only from the captured, revalidated host context. */
export function prepareNativeGraphicsGeneration(source: NativeGraphicsSource, options: NativeGraphicsGenerationOptions, context: SourceContext, generationId: string) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length !== 1 || !['save-only', 'import-new-sequence'].includes(options.mode)) throw new Error('Choose save-only or import-new-sequence explicitly for native graphics.');
  if (!source || typeof source !== 'object' || Array.isArray(source) || !sameId(source.sequenceId, context.id) || source.projectPath !== undefined && source.projectPath !== context.projectPath) throw new Error('The native graphics source belongs to another project or sequence. Refresh Better Captions.');
  if (Object.keys(source).some(key => !['sequenceId', 'projectPath', 'captions', 'style', 'animation', 'transcriptJson'].includes(key))) throw new Error('Native graphics accepts authoring data only; paths, XML and sequence settings are supplied by the host.');
  const input: NativeGraphicsPlanInput = {
    captions: source.captions, style: source.style,
    ...(source.animation !== undefined ? { animation: source.animation } : {}),
    ...(source.transcriptJson !== undefined ? { transcriptJson: source.transcriptJson } : {}),
    sequence: { id: context.id, name: context.name, frameRate: context.fps, frameWidth: context.width, frameHeight: context.height },
  };
  const plan = buildNativeGraphicsPlan(input), output = buildNativeGraphicsXml(input, { generationId });
  return { ...output, srt: plan.srt };
}
