import type { CaptionItem, StyleConfig, AnimationConfig } from "../types";
import { CaptionRenderer } from "../canvas/engine";
import { getCaptionAtTime } from "../transcript/parser";

export interface ExportProgress {
  current: number;
  total: number;
  percent: number;
}

export interface ExportDimensions {
  width: number;
  height: number;
}

export function calculateExportDimensions(
  style: StyleConfig,
  sequenceWidth: number,
): ExportDimensions {
  const textHeight = style.fontSize * style.lineHeight;
  const bgPadding = style.backgroundPadding * 2;
  const strokeBleed = style.strokeWidth * 2;
  const shadowBleed = style.shadowBlur + Math.abs(style.shadowOffsetY);
  const animationMargin = 20;
  const safetyMargin = 10;

  const height = Math.ceil(
    textHeight + bgPadding + strokeBleed + shadowBleed * 2 + animationMargin + safetyMargin,
  );

  return { width: sequenceWidth, height };
}

export async function exportFrames(
  captions: CaptionItem[],
  style: StyleConfig,
  animation: AnimationConfig,
  sequenceWidth: number,
  _sequenceHeight: number,
  frameRate: number,
  duration: number,
  onProgress?: (progress: ExportProgress) => void,
): Promise<{ frames: string[]; exportWidth: number; exportHeight: number }> {
  const { width, height } = calculateExportDimensions(style, sequenceWidth);

  console.log("[exporter] Starting export", {
    sequenceWidth,
    exportWidth: width,
    exportHeight: height,
    frameRate,
    duration,
    captionCount: captions.length,
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true });

  if (!ctx) {
    console.error("[exporter] Failed to get canvas 2d context");
    throw new Error("Failed to create canvas context");
  }

  const exportStyle: StyleConfig = { ...style, positionX: 0.5, positionY: 0.5 };
  const renderer = new CaptionRenderer(ctx, width, height);
  const totalFrames = Math.ceil(duration * frameRate);
  const frames: string[] = [];

  console.log("[exporter] Export canvas:", width, "x", height, "| Total frames:", totalFrames);

  for (let frame = 0; frame < totalFrames; frame++) {
    const currentTime = frame / frameRate;
    const caption = getCaptionAtTime(captions, currentTime);

    ctx.clearRect(0, 0, width, height);
    renderer.renderFrame(caption, currentTime, exportStyle, animation);

    const dataUrl = canvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    frames.push(base64);

    if (frame === 0) {
      console.log("[exporter] First frame rendered, base64 length:", base64.length);
    }

    if (onProgress) {
      onProgress({
        current: frame + 1,
        total: totalFrames,
        percent: Math.round(((frame + 1) / totalFrames) * 100),
      });
    }

    if (frame % 10 === 0) {
      if (frame % 100 === 0) {
        console.log(`[exporter] Progress: ${frame}/${totalFrames} frames`);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  console.log("[exporter] All frames rendered. Total:", frames.length);
  return { frames, exportWidth: width, exportHeight: height };
}
