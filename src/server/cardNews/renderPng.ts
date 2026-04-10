import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { getCardNewsTemplate, type CardNewsTemplateKey } from "@/server/cardNews/templates";
import type { CardNewsRenderInput, CardNewsSlideInput } from "@/server/cardNews/renderHtml";

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

const OVERLAY_STOPS: Record<CardNewsTemplateKey, Array<{ offset: number; color: string }>> = {
  "editorial-story": [
    { offset: 0, color: "rgba(7,10,16,0.18)" },
    { offset: 0.38, color: "rgba(7,10,16,0.52)" },
    { offset: 0.72, color: "rgba(7,10,16,0.84)" },
    { offset: 1, color: "rgba(7,10,16,0.96)" },
  ],
  "fortune-cover": [
    { offset: 0, color: "rgba(7,10,16,0.34)" },
    { offset: 0.58, color: "rgba(7,10,16,0.68)" },
    { offset: 1, color: "rgba(7,10,16,0.92)" },
  ],
  "question-contrast": [
    { offset: 0, color: "rgba(10,14,24,0.36)" },
    { offset: 0.55, color: "rgba(10,14,24,0.64)" },
    { offset: 1, color: "rgba(10,14,24,0.90)" },
  ],
  "analysis-panel": [
    { offset: 0, color: "rgba(9,10,15,0.48)" },
    { offset: 0.56, color: "rgba(9,10,15,0.72)" },
    { offset: 1, color: "rgba(9,10,15,0.94)" },
  ],
  "stat-bars": [
    { offset: 0, color: "rgba(9,11,18,0.48)" },
    { offset: 0.58, color: "rgba(9,11,18,0.72)" },
    { offset: 1, color: "rgba(9,11,18,0.95)" },
  ],
  "closing-cta": [
    { offset: 0, color: "rgba(8,10,15,0.40)" },
    { offset: 0.52, color: "rgba(8,10,15,0.64)" },
    { offset: 1, color: "rgba(8,10,15,0.94)" },
  ],
};

function setFont(ctx: SKRSContext2D, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px "Arial", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
}

function drawRoundedRect(ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function fitCover(image: LoadedImage, targetWidth: number, targetHeight: number) {
  const srcWidth = Math.max(1, Math.round(image.width));
  const srcHeight = Math.max(1, Math.round(image.height));
  const srcRatio = srcWidth / srcHeight;
  const targetRatio = targetWidth / targetHeight;

  if (srcRatio > targetRatio) {
    const drawHeight = targetHeight;
    const drawWidth = drawHeight * srcRatio;
    return {
      dx: (targetWidth - drawWidth) / 2,
      dy: 0,
      dw: drawWidth,
      dh: drawHeight,
    };
  }

  const drawWidth = targetWidth;
  const drawHeight = drawWidth / srcRatio;
  return {
    dx: 0,
    dy: (targetHeight - drawHeight) / 2,
    dw: drawWidth,
    dh: drawHeight,
  };
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let truncated = false;

  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) {
      lines.push("");
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      continue;
    }

    let current = "";
    for (const char of Array.from(rawLine)) {
      const next = current + char;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char.trim() ? char : "";
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
      } else {
        current = next;
      }
    }

    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    if (current) {
      lines.push(current);
    }
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (truncated && lines.length === maxLines && lines.some((line) => line.length > 0)) {
    let last = lines[maxLines - 1] ?? "";
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = `${last}…`;
  }

  return lines.slice(0, maxLines);
}

function drawLines(args: {
  ctx: SKRSContext2D;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  maxLines: number;
  lineHeight: number;
  color: string;
  fontSize: number;
  weight?: number;
}) {
  const { ctx, text, x, y, maxWidth, maxLines, lineHeight, color, fontSize, weight } = args;
  setFont(ctx, fontSize, weight ?? 400);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";

  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });

  return y + lines.length * lineHeight;
}

function splitParagraphs(value?: string) {
  return (value ?? "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePercent(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Math.max(0, Math.min(100, Number(match[1])));
}

async function loadRemoteImage(url: string) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`배경 이미지를 불러오지 못했습니다 (HTTP ${res.status})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return loadImage(bytes);
}

function drawOverlay(ctx: SKRSContext2D, width: number, height: number, templateKey: CardNewsTemplateKey) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  for (const stop of OVERLAY_STOPS[templateKey]) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawEditorialFallbackBackground(ctx: SKRSContext2D, width: number, height: number) {
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#11161d");
  base.addColorStop(1, "#080b11");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const orbA = ctx.createRadialGradient(width * 0.72, height * 0.14, 20, width * 0.72, height * 0.14, 240);
  orbA.addColorStop(0, "rgba(215,160,63,0.24)");
  orbA.addColorStop(1, "rgba(215,160,63,0)");
  ctx.fillStyle = orbA;
  ctx.fillRect(0, 0, width, height);

  const orbB = ctx.createRadialGradient(width * 0.18, height * 0.18, 10, width * 0.18, height * 0.18, 170);
  orbB.addColorStop(0, "rgba(255,255,255,0.08)");
  orbB.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = orbB;
  ctx.fillRect(0, 0, width, height);
}

function drawFooterPill(args: {
  ctx: SKRSContext2D;
  x: number;
  y: number;
  brand: string;
  accent: string;
  border: string;
  textMuted: string;
}) {
  const { ctx, x, y, brand, accent, border, textMuted } = args;
  setFont(ctx, 20, 700);
  const brandWidth = ctx.measureText(brand).width;
  setFont(ctx, 20, 400);
  const suffix = "템플릿 기반 카드뉴스 초안";
  const suffixWidth = ctx.measureText(suffix).width;
  const width = brandWidth + suffixWidth + 54;
  const height = 54;

  ctx.fillStyle = "rgba(0,0,0,0.22)";
  drawRoundedRect(ctx, x, y, width, height, 999);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 999);
  ctx.stroke();

  ctx.textBaseline = "middle";
  setFont(ctx, 20, 700);
  ctx.fillStyle = accent;
  ctx.fillText(brand, x + 20, y + height / 2);

  setFont(ctx, 20, 400);
  ctx.fillStyle = textMuted;
  ctx.fillText(suffix, x + 34 + brandWidth, y + height / 2);
  ctx.textBaseline = "top";
}

function drawCenteredLines(args: {
  ctx: SKRSContext2D;
  text: string;
  centerX: number;
  y: number;
  maxWidth: number;
  maxLines: number;
  lineHeight: number;
  color: string;
  fontSize: number;
  weight?: number;
}) {
  const { ctx, text, centerX, y, maxWidth, maxLines, lineHeight, color, fontSize, weight } = args;
  setFont(ctx, fontSize, weight ?? 400);
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => {
    const width = ctx.measureText(line).width;
    ctx.fillText(line, centerX - width / 2, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function statToneColor(accent: string, tone?: string) {
  if (tone === "info") return "#6ea8ff";
  if (tone === "danger") return "#ff5f5f";
  if (tone === "muted") return "rgba(255,255,255,0.72)";
  return accent;
}

function drawStats(args: {
  ctx: SKRSContext2D;
  slide: CardNewsSlideInput;
  accent: string;
  x: number;
  y: number;
  width: number;
}) {
  const { ctx, slide, accent, x, y, width } = args;
  const stats = slide.stats ?? [];
  if (stats.length === 0) return y;

  let currentY = y;
  for (const stat of stats.slice(0, 6)) {
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    drawRoundedRect(ctx, x, currentY, width, 66, 18);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, currentY, width, 66, 18);
    ctx.stroke();

    ctx.textBaseline = "middle";
    setFont(ctx, 26, 400);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(stat.label, x + 22, currentY + 33);

    setFont(ctx, 28, 800);
    ctx.fillStyle = statToneColor(accent, stat.tone);
    const valueWidth = ctx.measureText(stat.value).width;
    ctx.fillText(stat.value, x + width - valueWidth - 22, currentY + 33);
    ctx.textBaseline = "top";

    currentY += 78;
  }

  return currentY;
}

function drawEditorialMetricGrid(args: {
  ctx: SKRSContext2D;
  slide: CardNewsSlideInput;
  x: number;
  y: number;
  width: number;
}) {
  const { ctx, slide, x, y, width } = args;
  const stats = slide.stats ?? [];
  if (stats.length === 0) return y;

  const cols = Math.min(3, stats.length);
  const gap = 16;
  const cellWidth = (width - gap * (cols - 1)) / cols;
  const rows = Math.ceil(Math.min(stats.length, 6) / cols);
  const panelHeight = rows * 132 + Math.max(0, rows - 1) * gap + 56;

  ctx.fillStyle = "rgba(9,11,18,0.84)";
  drawRoundedRect(ctx, x, y, width, panelHeight, 28);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, width, panelHeight, 28);
  ctx.stroke();

  stats.slice(0, 6).forEach((stat, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const boxX = x + 28 + col * (cellWidth + gap);
    const boxY = y + 28 + row * (132 + gap);
    const innerWidth = cellWidth - 28 * 2;

    ctx.fillStyle = "rgba(255,255,255,0.04)";
    drawRoundedRect(ctx, boxX, boxY, cellWidth, 132, 22);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, cellWidth, 132, 22);
    ctx.stroke();

    drawLines({
      ctx,
      text: stat.label,
      x: boxX + 18,
      y: boxY + 18,
      maxWidth: innerWidth,
      maxLines: 2,
      lineHeight: 22,
      color: "rgba(247,242,232,0.58)",
      fontSize: 18,
      weight: 500,
    });

    drawLines({
      ctx,
      text: stat.value,
      x: boxX + 18,
      y: boxY + 70,
      maxWidth: innerWidth,
      maxLines: 2,
      lineHeight: 34,
      color: statToneColor("#d7a03f", stat.tone),
      fontSize: 34,
      weight: 800,
    });
  });

  return y + panelHeight;
}

function drawEditorialScoreBars(args: {
  ctx: SKRSContext2D;
  slide: CardNewsSlideInput;
  x: number;
  y: number;
  width: number;
}) {
  const { ctx, slide, x, y, width } = args;
  const stats = slide.stats ?? [];
  if (stats.length === 0) return y;

  let currentY = y;
  for (const stat of stats.slice(0, 5)) {
    ctx.textBaseline = "middle";
    setFont(ctx, 24, 500);
    ctx.fillStyle = "rgba(247,242,232,0.82)";
    ctx.fillText(stat.label, x, currentY + 14);
    setFont(ctx, 26, 800);
    ctx.fillStyle = statToneColor("#d7a03f", stat.tone);
    const valueWidth = ctx.measureText(stat.value).width;
    ctx.fillText(stat.value, x + width - valueWidth, currentY + 14);
    ctx.textBaseline = "top";

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    drawRoundedRect(ctx, x, currentY + 34, width, 12, 999);
    ctx.fillStyle = statToneColor("#d7a03f", stat.tone);
    drawRoundedRect(ctx, x, currentY + 34, Math.max(18, (width * parsePercent(stat.value)) / 100), 12, 999);
    currentY += 74;
  }

  return currentY;
}

async function renderEditorialStorySlidePng(args: {
  brand: string;
  backgroundImageUrl?: string | null;
  templateKey: CardNewsTemplateKey;
  slide: CardNewsSlideInput;
  slideIndex: number;
  slideCount: number;
}) {
  const template = getCardNewsTemplate(args.templateKey);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");

  if (args.backgroundImageUrl) {
    const image = await loadRemoteImage(args.backgroundImageUrl);
    const cover = fitCover(image, template.width, template.height);
    ctx.drawImage(image, cover.dx, cover.dy, cover.dw, cover.dh);
  } else {
    drawEditorialFallbackBackground(ctx, template.width, template.height);
  }
  drawOverlay(ctx, template.width, template.height, template.key);

  const pageLabel =
    args.slide.pageLabel?.trim() ||
    `${String(args.slideIndex + 1).padStart(2, "0")} / ${String(args.slideCount).padStart(2, "0")}`;

  ctx.textBaseline = "top";
  setFont(ctx, 18, 600);
  ctx.fillStyle = "rgba(247,242,232,0.58)";
  ctx.fillText(args.brand, 54, 46);
  const pageWidth = ctx.measureText(pageLabel).width;
  ctx.fillText(pageLabel, template.width - 54 - pageWidth, 46);

  const x = 72;
  const width = template.width - 144;
  const layoutIndex = Math.min(args.slideIndex, 6);

  if (layoutIndex === 0) {
    let y = 750;
    if (args.slide.eyebrow?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.eyebrow,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 30,
        color: template.accent,
        fontSize: 20,
        weight: 700,
      });
      y += 26;
    }
    y = drawLines({
      ctx,
      text: args.slide.title,
      x,
      y,
      maxWidth: width,
      maxLines: 3,
      lineHeight: 98,
      color: template.textPrimary,
      fontSize: 102,
      weight: 900,
    });
    if (args.slide.accentTitle?.trim()) {
      drawLines({
        ctx,
        text: args.slide.accentTitle,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 98,
        color: template.accent,
        fontSize: 102,
        weight: 900,
      });
    }
    if (args.slide.subtitle?.trim()) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(x, 1110);
      ctx.lineTo(template.width - x, 1110);
      ctx.stroke();
      drawLines({
        ctx,
        text: args.slide.subtitle,
        x,
        y: 1138,
        maxWidth: width,
        maxLines: 3,
        lineHeight: 44,
        color: "rgba(247,242,232,0.76)",
        fontSize: 34,
        weight: 500,
      });
    }
    if (args.slide.footer?.trim()) {
      drawLines({
        ctx,
        text: args.slide.footer,
        x,
        y: 1240,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 32,
        color: "rgba(247,242,232,0.58)",
        fontSize: 24,
        weight: 500,
      });
    }
  } else if (layoutIndex === 1) {
    let y = 118;
    if (args.slide.eyebrow?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.eyebrow,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 28,
        color: template.accent,
        fontSize: 20,
        weight: 700,
      });
      y += 18;
    }
    y = drawEditorialMetricGrid({ ctx, slide: args.slide, x, y, width });
    y += 28;
    y = drawLines({
      ctx,
      text: args.slide.title,
      x,
      y,
      maxWidth: width,
      maxLines: 3,
      lineHeight: 74,
      color: template.textPrimary,
      fontSize: 76,
      weight: 900,
    });
    if (args.slide.accentTitle?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.accentTitle,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 74,
        color: template.accent,
        fontSize: 76,
        weight: 900,
      });
    }
    if (args.slide.subtitle?.trim()) {
      y += 16;
      y = drawLines({
        ctx,
        text: args.slide.subtitle,
        x,
        y,
        maxWidth: width,
        maxLines: 3,
        lineHeight: 40,
        color: "rgba(247,242,232,0.72)",
        fontSize: 28,
        weight: 500,
      });
    }
    if (args.slide.body?.trim()) {
      y += 14;
      drawLines({
        ctx,
        text: args.slide.body,
        x,
        y,
        maxWidth: width,
        maxLines: 6,
        lineHeight: 40,
        color: "rgba(247,242,232,0.82)",
        fontSize: 30,
        weight: 500,
      });
    }
    if (args.slide.quote?.trim()) {
      ctx.fillStyle = "rgba(215,160,63,0.12)";
      drawRoundedRect(ctx, x, 1120, width, 120, 24);
      ctx.strokeStyle = "rgba(215,160,63,0.28)";
      ctx.beginPath();
      ctx.roundRect(x, 1120, width, 120, 24);
      ctx.stroke();
      drawLines({
        ctx,
        text: args.slide.quote,
        x: x + 26,
        y: 1148,
        maxWidth: width - 52,
        maxLines: 3,
        lineHeight: 32,
        color: template.textPrimary,
        fontSize: 28,
        weight: 700,
      });
    }
  } else if (layoutIndex === 2 || layoutIndex === 3 || layoutIndex === 4) {
    const accent = layoutIndex === 3 ? "#72aef7" : template.accent;
    const noteBg = layoutIndex === 3 ? "rgba(60,114,197,0.16)" : "rgba(215,160,63,0.12)";
    let y = 122;
    if (args.slide.eyebrow?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.eyebrow,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 28,
        color: accent,
        fontSize: 20,
        weight: 700,
      });
      y += 24;
    }
    ctx.fillStyle = accent;
    drawRoundedRect(ctx, x, y + 8, 6, 160, 999);
    const titleX = x + 26;
    let titleY = y;
    titleY = drawLines({
      ctx,
      text: args.slide.title,
      x: titleX,
      y: titleY,
      maxWidth: width - 26,
      maxLines: 3,
      lineHeight: 78,
      color: template.textPrimary,
      fontSize: 82,
      weight: 900,
    });
    if (args.slide.accentTitle?.trim()) {
      titleY = drawLines({
        ctx,
        text: args.slide.accentTitle,
        x: titleX,
        y: titleY,
        maxWidth: width - 26,
        maxLines: 2,
        lineHeight: 78,
        color: accent,
        fontSize: 78,
        weight: 900,
      });
    }
    y = titleY + 34;

    if (args.slide.body?.trim()) {
      const paragraphs = splitParagraphs(args.slide.body);
      for (const paragraph of paragraphs.slice(0, layoutIndex === 4 ? 3 : 4)) {
        y = drawLines({
          ctx,
          text: paragraph,
          x,
          y,
          maxWidth: width,
          maxLines: 4,
          lineHeight: 42,
          color: "rgba(247,242,232,0.84)",
          fontSize: 31,
          weight: 500,
        });
        y += 18;
      }
    }

    if (layoutIndex === 4) {
      y += 10;
      y = drawEditorialScoreBars({ ctx, slide: args.slide, x, y, width });
      if (args.slide.footer?.trim()) {
        drawLines({
          ctx,
          text: args.slide.footer,
          x,
          y: 1260,
          maxWidth: width,
          maxLines: 2,
          lineHeight: 28,
          color: "rgba(247,242,232,0.6)",
          fontSize: 20,
          weight: 600,
        });
      }
    } else if (args.slide.quote?.trim()) {
      ctx.fillStyle = noteBg;
      drawRoundedRect(ctx, x, Math.min(y + 8, 1120), width, 112, 24);
      ctx.strokeStyle = `${accent}33`;
      ctx.beginPath();
      ctx.roundRect(x, Math.min(y + 8, 1120), width, 112, 24);
      ctx.stroke();
      drawLines({
        ctx,
        text: args.slide.quote,
        x: x + 24,
        y: Math.min(y + 34, 1146),
        maxWidth: width - 48,
        maxLines: 3,
        lineHeight: 32,
        color: layoutIndex === 3 ? "#9fc5ff" : template.textPrimary,
        fontSize: 28,
        weight: 700,
      });
      if (args.slide.footer?.trim()) {
        drawLines({
          ctx,
          text: args.slide.footer,
          x,
          y: 1260,
          maxWidth: width,
          maxLines: 2,
          lineHeight: 30,
          color: "rgba(247,242,232,0.62)",
          fontSize: 24,
          weight: 500,
        });
      }
    }
  } else if (layoutIndex === 5) {
    let y = 118;
    if (args.slide.eyebrow?.trim()) {
      y = drawCenteredLines({
        ctx,
        text: args.slide.eyebrow,
        centerX: template.width / 2,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 24,
        color: "rgba(247,242,232,0.48)",
        fontSize: 18,
        weight: 700,
      });
    }
    ctx.fillStyle = template.accent;
    drawRoundedRect(ctx, template.width / 2 - 6, y + 28, 12, 12, 999);
    y += 86;
    if (args.slide.subtitle?.trim()) {
      y = drawCenteredLines({
        ctx,
        text: args.slide.subtitle,
        centerX: template.width / 2,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 34,
        color: "rgba(247,242,232,0.58)",
        fontSize: 26,
        weight: 500,
      });
      y += 18;
    }
    y = drawCenteredLines({
      ctx,
      text: args.slide.title,
      centerX: template.width / 2,
      y,
      maxWidth: width - 80,
      maxLines: 3,
      lineHeight: 80,
      color: template.textPrimary,
      fontSize: 84,
      weight: 900,
    });
    if (args.slide.accentTitle?.trim()) {
      y = drawCenteredLines({
        ctx,
        text: args.slide.accentTitle,
        centerX: template.width / 2,
        y,
        maxWidth: width - 80,
        maxLines: 2,
        lineHeight: 80,
        color: template.accent,
        fontSize: 84,
        weight: 900,
      });
    }
    if (args.slide.body?.trim()) {
      y += 20;
      y = drawCenteredLines({
        ctx,
        text: args.slide.body,
        centerX: template.width / 2,
        y,
        maxWidth: width - 80,
        maxLines: 2,
        lineHeight: 34,
        color: "rgba(247,242,232,0.42)",
        fontSize: 30,
        weight: 500,
      });
    }
    if (args.slide.quote?.trim()) {
      y += 18;
      y = drawCenteredLines({
        ctx,
        text: args.slide.quote,
        centerX: template.width / 2,
        y,
        maxWidth: width - 80,
        maxLines: 3,
        lineHeight: 80,
        color: template.textPrimary,
        fontSize: 84,
        weight: 900,
      });
    }
    if (args.slide.footer?.trim()) {
      drawCenteredLines({
        ctx,
        text: args.slide.footer,
        centerX: template.width / 2,
        y: 1130,
        maxWidth: 760,
        maxLines: 3,
        lineHeight: 34,
        color: "rgba(247,242,232,0.56)",
        fontSize: 26,
        weight: 500,
      });
    }
    drawFooterPill({
      ctx,
      x: 200,
      y: 1244,
      brand: args.brand,
      accent: template.accent,
      border: template.footerBorder,
      textMuted: template.textMuted,
    });
  } else {
    let y = 720;
    if (args.slide.eyebrow?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.eyebrow,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 28,
        color: template.accent,
        fontSize: 20,
        weight: 700,
      });
      y += 24;
    }
    y = drawLines({
      ctx,
      text: args.slide.title,
      x,
      y,
      maxWidth: width,
      maxLines: 3,
      lineHeight: 92,
      color: template.textPrimary,
      fontSize: 96,
      weight: 900,
    });
    if (args.slide.accentTitle?.trim()) {
      y = drawLines({
        ctx,
        text: args.slide.accentTitle,
        x,
        y,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 92,
        color: template.accent,
        fontSize: 96,
        weight: 900,
      });
    }
    if (args.slide.body?.trim()) {
      y += 24;
      drawLines({
        ctx,
        text: args.slide.body,
        x,
        y,
        maxWidth: width,
        maxLines: 4,
        lineHeight: 40,
        color: "rgba(247,242,232,0.82)",
        fontSize: 30,
        weight: 500,
      });
    }
    if (args.slide.quote?.trim()) {
      ctx.fillStyle = "rgba(215,160,63,0.12)";
      drawRoundedRect(ctx, x, 1100, width, 110, 24);
      ctx.strokeStyle = "rgba(215,160,63,0.28)";
      ctx.beginPath();
      ctx.roundRect(x, 1100, width, 110, 24);
      ctx.stroke();
      drawLines({
        ctx,
        text: args.slide.quote,
        x: x + 24,
        y: 1128,
        maxWidth: width - 48,
        maxLines: 3,
        lineHeight: 32,
        color: template.textPrimary,
        fontSize: 28,
        weight: 700,
      });
    }
    if (args.slide.footer?.trim()) {
      drawLines({
        ctx,
        text: args.slide.footer,
        x,
        y: 1238,
        maxWidth: width,
        maxLines: 2,
        lineHeight: 30,
        color: "rgba(247,242,232,0.58)",
        fontSize: 24,
        weight: 500,
      });
    }
  }

  return {
    width: template.width,
    height: template.height,
    buffer: canvas.toBuffer("image/png"),
  };
}

async function renderSlidePng(args: {
  brand: string;
  backgroundImageUrl?: string | null;
  templateKey: CardNewsTemplateKey;
  slide: CardNewsSlideInput;
  slideIndex: number;
  slideCount: number;
}) {
  const template = getCardNewsTemplate(args.templateKey);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2d context unavailable");
  }

  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, template.width, template.height);

  if (args.backgroundImageUrl) {
    const image = await loadRemoteImage(args.backgroundImageUrl);
    const cover = fitCover(image, template.width, template.height);
    ctx.drawImage(image, cover.dx, cover.dy, cover.dw, cover.dh);
  }

  drawOverlay(ctx, template.width, template.height, template.key);

  const pageLabel =
    args.slide.pageLabel?.trim() ||
    `${String(args.slideIndex + 1).padStart(2, "0")} / ${String(args.slideCount).padStart(2, "0")}`;

  ctx.textBaseline = "top";
  setFont(ctx, 18, 600);
  ctx.fillStyle = "rgba(255,255,255,0.56)";
  ctx.fillText(args.brand, 56, 54);
  const pageWidth = ctx.measureText(pageLabel).width;
  ctx.fillText(pageLabel, template.width - 56 - pageWidth, 54);

  let currentY = 168;
  const contentX = 56;
  const contentWidth = template.width - 112;
  const footerTop = template.height - 228;

  if (args.slide.eyebrow?.trim()) {
    currentY = drawLines({
      ctx,
      text: args.slide.eyebrow,
      x: contentX,
      y: currentY,
      maxWidth: contentWidth,
      maxLines: 2,
      lineHeight: 30,
      color: template.accent,
      fontSize: 24,
      weight: 700,
    });
    currentY += 20;
  }

  currentY = drawLines({
    ctx,
    text: args.slide.title,
    x: contentX,
    y: currentY,
    maxWidth: contentWidth,
    maxLines: 3,
    lineHeight: 86,
    color: template.textPrimary,
    fontSize: 88,
    weight: 900,
  });

  if (args.slide.accentTitle?.trim()) {
    currentY = drawLines({
      ctx,
      text: args.slide.accentTitle,
      x: contentX,
      y: currentY,
      maxWidth: contentWidth,
      maxLines: 2,
      lineHeight: 86,
      color: template.accent,
      fontSize: 88,
      weight: 900,
    });
  }

  if (args.slide.subtitle?.trim()) {
    currentY += 20;
    currentY = drawLines({
      ctx,
      text: args.slide.subtitle,
      x: contentX,
      y: currentY,
      maxWidth: contentWidth,
      maxLines: 3,
      lineHeight: 48,
      color: template.textMuted,
      fontSize: 34,
      weight: 500,
    });
  }

  const paragraphs = splitParagraphs(args.slide.body);
  if (paragraphs.length > 0) {
    currentY += 18;
    for (const paragraph of paragraphs.slice(0, 4)) {
      currentY = drawLines({
        ctx,
        text: paragraph,
        x: contentX,
        y: currentY,
        maxWidth: contentWidth,
        maxLines: 4,
        lineHeight: 44,
        color: "rgba(255,255,255,0.82)",
        fontSize: 32,
        weight: 500,
      });
      currentY += 14;
      if (currentY > footerTop - 170) {
        break;
      }
    }
  }

  if (currentY < footerTop - 140) {
    currentY = drawStats({
      ctx,
      slide: args.slide,
      accent: template.accent,
      x: contentX,
      y: currentY + 8,
      width: contentWidth,
    });
  }

  if (args.slide.quote?.trim() && currentY < footerTop - 90) {
    const quoteY = currentY + 18;
    ctx.fillStyle = template.accentSoft;
    drawRoundedRect(ctx, contentX, quoteY, contentWidth, 110, 24);
    ctx.strokeStyle = template.footerBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(contentX, quoteY, contentWidth, 110, 24);
    ctx.stroke();

    drawLines({
      ctx,
      text: args.slide.quote,
      x: contentX + 28,
      y: quoteY + 24,
      maxWidth: contentWidth - 56,
      maxLines: 3,
      lineHeight: 34,
      color: template.textPrimary,
      fontSize: 28,
      weight: 700,
    });
  }

  const footerLineY = template.height - 190;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentX, footerLineY);
  ctx.lineTo(template.width - contentX, footerLineY);
  ctx.stroke();

  if (args.slide.footer?.trim()) {
    drawLines({
      ctx,
      text: args.slide.footer,
      x: contentX,
      y: template.height - 158,
      maxWidth: contentWidth,
      maxLines: 3,
      lineHeight: 34,
      color: template.textMuted,
      fontSize: 26,
      weight: 500,
    });
  }

  drawFooterPill({
    ctx,
    x: contentX,
    y: template.height - 74,
    brand: args.brand,
    accent: template.accent,
    border: template.footerBorder,
    textMuted: template.textMuted,
  });

  return {
    width: template.width,
    height: template.height,
    buffer: canvas.toBuffer("image/png"),
  };
}

export async function renderCardNewsPng(input: CardNewsRenderInput) {
  const brand = input.brand?.trim() || "SBUSIM STUDIO";
  const templateKey = input.templateKey ?? "editorial-story";
  const template = getCardNewsTemplate(templateKey);

  const frames = await Promise.all(
    input.slides.map(async (slide, index) => {
      const rendered =
        template.key === "editorial-story"
          ? await renderEditorialStorySlidePng({
              brand,
              backgroundImageUrl: input.backgroundImageUrl,
              templateKey,
              slide,
              slideIndex: index,
              slideCount: input.slides.length,
            })
          : await renderSlidePng({
              brand,
              backgroundImageUrl: input.backgroundImageUrl,
              templateKey,
              slide,
              slideIndex: index,
              slideCount: input.slides.length,
            });

      return {
        index,
        width: rendered.width,
        height: rendered.height,
        buffer: rendered.buffer,
      };
    })
  );

  return {
    brand,
    template,
    frames,
  };
}
