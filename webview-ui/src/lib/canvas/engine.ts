import type {
  CaptionItem,
  CaptionWord,
  StyleConfig,
  AnimationConfig,
  AnimationPreset,
} from "../types";

function applyTextTransform(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  return text;
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${opacity})`;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface WordMetrics {
  word: CaptionWord;
  text: string;
  x: number;
  width: number;
}

export class CaptionRenderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  renderFrame(
    caption: CaptionItem | null,
    currentTime: number,
    style: StyleConfig,
    animation: AnimationConfig,
  ) {
    this.clear();
    if (!caption) return;

    const progress = this.getCaptionProgress(caption, currentTime, animation);
    if (progress.opacity <= 0) return;

    this.ctx.save();
    this.ctx.globalAlpha = progress.opacity;

    const font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
    this.ctx.font = font;
    this.ctx.textBaseline = "middle";

    const fullText = applyTextTransform(caption.text, style.textTransform);
    const maxWidthPx = this.width * style.maxWidth;
    const centerX = this.width * style.positionX;
    const centerY = this.height * style.positionY;

    const wordMetrics = this.measureWords(caption.words, style, maxWidthPx, centerX);

    this.drawBackground(wordMetrics, style, centerY, progress);
    this.drawWords(wordMetrics, caption, currentTime, style, animation, centerY, progress);

    this.ctx.restore();
  }

  private measureWords(
    words: CaptionWord[],
    style: StyleConfig,
    maxWidthPx: number,
    centerX: number,
  ): WordMetrics[] {
    const metrics: WordMetrics[] = [];
    const spaceWidth = this.ctx.measureText(" ").width;

    let totalWidth = 0;
    const wordWidths: number[] = [];

    for (const word of words) {
      const text = applyTextTransform(word.text, style.textTransform);
      const w = this.ctx.measureText(text).width;
      wordWidths.push(w);
      totalWidth += w;
    }
    totalWidth += spaceWidth * Math.max(0, words.length - 1);

    let startX: number;
    if (style.textAlign === "center") {
      startX = centerX - totalWidth / 2;
    } else if (style.textAlign === "right") {
      startX = centerX + maxWidthPx / 2 - totalWidth;
    } else {
      startX = centerX - maxWidthPx / 2;
    }

    let x = startX;
    for (let i = 0; i < words.length; i++) {
      const text = applyTextTransform(words[i].text, style.textTransform);
      metrics.push({ word: words[i], text, x, width: wordWidths[i] });
      x += wordWidths[i] + spaceWidth;
    }

    return metrics;
  }

  private drawBackground(
    wordMetrics: WordMetrics[],
    style: StyleConfig,
    centerY: number,
    progress: AnimationProgress,
  ) {
    if (!style.backgroundEnabled) return;
    if (!style.backgroundColor || style.backgroundColor === "transparent") return;
    if (wordMetrics.length === 0) return;

    const first = wordMetrics[0];
    const last = wordMetrics[wordMetrics.length - 1];
    const totalWidth = last.x + last.width - first.x;
    const pad = style.backgroundPadding;
    const h = style.fontSize * style.lineHeight;

    const bgX = first.x - pad;
    const bgY = centerY - h / 2 - pad;
    const bgW = totalWidth + pad * 2;
    const bgH = h + pad * 2;

    this.ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity ?? 0.6);

    if (style.backgroundRadius > 0) {
      this.roundRect(bgX, bgY, bgW, bgH, style.backgroundRadius);
      this.ctx.fill();
    } else {
      this.ctx.fillRect(bgX, bgY, bgW, bgH);
    }
  }

  private drawWords(
    wordMetrics: WordMetrics[],
    caption: CaptionItem,
    currentTime: number,
    style: StyleConfig,
    animation: AnimationConfig,
    centerY: number,
    progress: AnimationProgress,
  ) {
    for (let i = 0; i < wordMetrics.length; i++) {
      const wm = wordMetrics[i];
      const word = wm.word;
      const isWordActive = currentTime >= word.startTime;
      const wordProgress = clamp(
        (currentTime - word.startTime) / Math.max(word.endTime - word.startTime, 0.01),
        0,
        1,
      );

      this.ctx.save();

      let drawX = wm.x;
      let drawY = centerY;
      let wordAlpha = 1;
      let scale = 1;

      switch (animation.preset) {
        case "fade":
          break;

        case "pop":
          if (!isWordActive) {
            wordAlpha = 0;
          } else {
            const t = clamp(wordProgress / 0.3, 0, 1);
            scale = easeOutBack(t);
            wordAlpha = Math.min(1, t * 3);
          }
          break;

        case "typewriter":
          if (!isWordActive) {
            wordAlpha = 0;
          } else {
            const t = clamp(wordProgress / 0.15, 0, 1);
            wordAlpha = t;
          }
          break;

        case "karaoke":
          if (isWordActive) {
            this.ctx.fillStyle = animation.highlightColor;
          }
          break;

        case "bounce":
          if (!isWordActive) {
            wordAlpha = 0;
          } else {
            const t = clamp(wordProgress / 0.2, 0, 1);
            const bounceT = easeOutBack(t);
            drawY = centerY + (1 - bounceT) * -15;
            wordAlpha = Math.min(1, t * 3);
          }
          break;
      }

      this.ctx.globalAlpha = progress.opacity * wordAlpha;

      if (scale !== 1) {
        this.ctx.translate(drawX + wm.width / 2, drawY);
        this.ctx.scale(scale, scale);
        this.ctx.translate(-(drawX + wm.width / 2), -drawY);
      }

      if ((style.shadowEnabled ?? true) && style.shadowBlur > 0) {
        this.ctx.shadowColor = hexToRgba(style.shadowColor, style.shadowOpacity ?? 0.5);
        this.ctx.shadowBlur = style.shadowBlur;
        this.ctx.shadowOffsetX = style.shadowOffsetX;
        this.ctx.shadowOffsetY = style.shadowOffsetY;
      }

      if (style.strokeEnabled && style.strokeWidth > 0) {
        this.ctx.strokeStyle = hexToRgba(style.strokeColor, style.strokeOpacity ?? 1);
        this.ctx.lineWidth = style.strokeWidth * 2;
        this.ctx.lineJoin = "round";
        this.ctx.strokeText(wm.text, drawX, drawY);
        this.ctx.shadowBlur = 0;
      }

      if (animation.preset !== "karaoke" || !isWordActive) {
        this.ctx.fillStyle = style.textColor;
      }
      this.ctx.fillText(wm.text, drawX, drawY);

      this.ctx.restore();
    }
  }

  private getCaptionProgress(
    caption: CaptionItem,
    currentTime: number,
    animation: AnimationConfig,
  ): AnimationProgress {
    const fadeIn = animation.fadeInDuration;
    const fadeOut = animation.fadeOutDuration;
    const captionDuration = caption.endTime - caption.startTime;

    let opacity = 1;
    const elapsed = currentTime - caption.startTime;
    const remaining = caption.endTime - currentTime;

    if (elapsed < fadeIn) {
      opacity = easeOutCubic(elapsed / fadeIn);
    } else if (remaining < fadeOut) {
      opacity = easeOutCubic(remaining / fadeOut);
    }

    return { opacity: clamp(opacity, 0, 1), scale: 1 };
  }

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }
}

interface AnimationProgress {
  opacity: number;
  scale: number;
}
