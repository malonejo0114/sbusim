import { getCardNewsTemplate, type CardNewsTemplateDefinition, type CardNewsTemplateKey } from "@/server/cardNews/templates";

export type CardNewsSlideInput = {
  pageLabel?: string;
  eyebrow?: string;
  title: string;
  accentTitle?: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  footer?: string;
  stats?: Array<{
    label: string;
    value: string;
    tone?: "accent" | "info" | "danger" | "muted";
  }>;
};

export type CardNewsRenderInput = {
  brand?: string;
  backgroundImageUrl?: string | null;
  templateKey?: CardNewsTemplateKey;
  slides: CardNewsSlideInput[];
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderBreaks(value?: string) {
  return escapeHtml(value ?? "").replaceAll("\n", "<br />");
}

function renderParagraphs(value?: string) {
  return (value ?? "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => `<p>${escapeHtml(chunk).replaceAll("\n", "<br />")}</p>`)
    .join("");
}

function statToneColor(template: CardNewsTemplateDefinition, tone?: string) {
  if (tone === "info") return "#7cb7ff";
  if (tone === "danger") return "#ff6262";
  if (tone === "muted") return template.textMuted;
  return template.accent;
}

function parsePercent(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  return Math.max(0, Math.min(100, Number(match[1])));
}

function renderStats(template: CardNewsTemplateDefinition, stats?: CardNewsSlideInput["stats"]) {
  if (!stats || stats.length === 0) return "";
  return `
    <div class="stats">
      ${stats
        .map(
          (item) => `
            <div class="stat-row">
              <div class="stat-label">${escapeHtml(item.label)}</div>
              <div class="stat-value" style="color:${statToneColor(template, item.tone)}">${escapeHtml(item.value)}</div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderEditorialMetricGrid(template: CardNewsTemplateDefinition, stats?: CardNewsSlideInput["stats"]) {
  if (!stats || stats.length === 0) return "";
  return `
    <div class="editorial-panel">
      <div class="editorial-panel-grid">
        ${stats
          .slice(0, 6)
          .map(
            (item) => `
              <div class="editorial-chip">
                <div class="editorial-chip-label">${escapeHtml(item.label)}</div>
                <div class="editorial-chip-value" style="color:${statToneColor(template, item.tone)}">${escapeHtml(item.value)}</div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderEditorialScoreBars(template: CardNewsTemplateDefinition, stats?: CardNewsSlideInput["stats"]) {
  if (!stats || stats.length === 0) return "";
  return `
    <div class="score-bars">
      ${stats
        .slice(0, 5)
        .map((item) => {
          const width = parsePercent(item.value);
          return `
            <div class="score-row">
              <div class="score-head">
                <span>${escapeHtml(item.label)}</span>
                <strong style="color:${statToneColor(template, item.tone)}">${escapeHtml(item.value)}</strong>
              </div>
              <div class="score-track">
                <div class="score-fill" style="width:${width}%; background:${statToneColor(template, item.tone)}"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderFrame(args: {
  brand: string;
  backgroundImageUrl?: string | null;
  template: CardNewsTemplateDefinition;
  slide: CardNewsSlideInput;
  slideIndex: number;
  slideCount: number;
}) {
  const { brand, backgroundImageUrl, template, slide, slideIndex, slideCount } = args;
  const pageLabel = slide.pageLabel?.trim() || `${String(slideIndex + 1).padStart(2, "0")} / ${String(slideCount).padStart(2, "0")}`;
  const background = backgroundImageUrl
    ? `background-image:${template.overlay}, url('${backgroundImageUrl}'); background-size:cover; background-position:center;`
    : `background:${template.overlay};`;

  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${template.width}px;
        height: ${template.height}px;
        overflow: hidden;
        background: #05070b;
        font-family: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
      }
      body {
        position: relative;
        ${background}
        color: ${template.textPrimary};
      }
      .frame {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 54px 56px 52px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .topbar, .footer-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 16px;
        letter-spacing: 0.26em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.56);
      }
      .content {
        display: flex;
        flex: 1;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
      }
      .eyebrow {
        font-size: 24px;
        font-weight: 700;
        color: ${template.accent};
      }
      .subtitle {
        font-size: 34px;
        line-height: 1.45;
        color: ${template.textMuted};
      }
      .title {
        font-size: 88px;
        line-height: 0.98;
        font-weight: 900;
        letter-spacing: -0.06em;
        white-space: pre-line;
      }
      .title-accent { color: ${template.accent}; }
      .body {
        margin-top: 12px;
        font-size: 33px;
        line-height: 1.7;
        color: rgba(255,255,255,0.82);
      }
      .body p { margin: 0 0 22px; }
      .quote {
        margin-top: 6px;
        padding: 24px 28px;
        border-radius: 24px;
        border: 1px solid ${template.footerBorder};
        background: ${template.accentSoft};
        font-size: 30px;
        line-height: 1.5;
        font-weight: 700;
      }
      .stats {
        margin-top: 10px;
        display: grid;
        gap: 12px;
      }
      .stat-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        padding: 18px 22px;
        border-radius: 18px;
        background: rgba(0,0,0,0.28);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .stat-label { font-size: 26px; color: rgba(255,255,255,0.72); }
      .stat-value { font-size: 28px; font-weight: 800; }
      .footer {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .footer-copy {
        font-size: 27px;
        line-height: 1.5;
        color: ${template.textMuted};
      }
      .footer-pill {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        max-width: fit-content;
        border-radius: 999px;
        border: 1px solid ${template.footerBorder};
        background: rgba(0,0,0,0.22);
        padding: 14px 20px;
        font-size: 20px;
        color: ${template.textMuted};
      }
      .footer-pill strong {
        color: ${template.accent};
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <main class="frame">
      <div class="topbar">
        <span>${escapeHtml(brand)}</span>
        <span>${escapeHtml(pageLabel)}</span>
      </div>

      <section class="content">
        ${slide.eyebrow ? `<div class="eyebrow">${escapeHtml(slide.eyebrow)}</div>` : ""}
        <div class="title">${escapeHtml(slide.title)}${slide.accentTitle ? `<br /><span class="title-accent">${escapeHtml(slide.accentTitle)}</span>` : ""}</div>
        ${slide.subtitle ? `<div class="subtitle">${escapeHtml(slide.subtitle).replaceAll("\n", "<br />")}</div>` : ""}
        ${slide.body ? `<div class="body">${renderParagraphs(slide.body)}</div>` : ""}
        ${renderStats(template, slide.stats)}
        ${slide.quote ? `<div class="quote">${escapeHtml(slide.quote).replaceAll("\n", "<br />")}</div>` : ""}
      </section>

      <footer class="footer">
        <div class="footer-line"></div>
        ${slide.footer ? `<div class="footer-copy">${escapeHtml(slide.footer).replaceAll("\n", "<br />")}</div>` : ""}
        <div class="footer-pill"><strong>${escapeHtml(brand)}</strong><span>템플릿 기반 카드뉴스 초안</span></div>
      </footer>
    </main>
  </body>
</html>`;
}

function renderEditorialStoryFrame(args: {
  brand: string;
  backgroundImageUrl?: string | null;
  template: CardNewsTemplateDefinition;
  slide: CardNewsSlideInput;
  slideIndex: number;
  slideCount: number;
}) {
  const { brand, backgroundImageUrl, template, slide, slideIndex, slideCount } = args;
  const pageLabel = slide.pageLabel?.trim() || `${String(slideIndex + 1).padStart(2, "0")} / ${String(slideCount).padStart(2, "0")}`;
  const hasImage = Boolean(backgroundImageUrl);
  const background = hasImage
    ? `background-image:
        linear-gradient(180deg, rgba(7,10,16,0.18) 0%, rgba(7,10,16,0.52) 38%, rgba(7,10,16,0.84) 72%, rgba(7,10,16,0.96) 100%),
        url('${backgroundImageUrl}');
       background-size: cover;
       background-position: center;`
    : `background:
        radial-gradient(circle at 70% 12%, rgba(242,183,76,0.18), transparent 28%),
        radial-gradient(circle at 18% 18%, rgba(255,255,255,0.08), transparent 22%),
        linear-gradient(180deg, rgba(13,17,23,0.92) 0%, rgba(9,12,18,0.98) 100%);`;

  const layoutIndex = Math.min(slideIndex, 6);

  const articleBlock = (accentColor: string, noteBackground: string) => `
    <div class="editorial-article">
      ${slide.eyebrow ? `<div class="editorial-kicker" style="color:${accentColor}">${renderBreaks(slide.eyebrow)}</div>` : ""}
      <div class="editorial-heading">
        <div class="editorial-rule" style="background:${accentColor}"></div>
        <div class="editorial-title-stack">
          <div class="editorial-title-main">${renderBreaks(slide.title)}</div>
          ${slide.accentTitle ? `<div class="editorial-title-accent" style="color:${accentColor}">${renderBreaks(slide.accentTitle)}</div>` : ""}
        </div>
      </div>
      ${slide.body ? `<div class="editorial-copy">${renderParagraphs(slide.body)}</div>` : ""}
      ${slide.quote ? `<div class="editorial-note" style="background:${noteBackground}; border-color:${accentColor}33">${renderBreaks(slide.quote)}</div>` : ""}
      ${slide.footer ? `<div class="editorial-footer-copy">${renderBreaks(slide.footer)}</div>` : ""}
    </div>
  `;

  let content = "";
  if (layoutIndex === 0) {
    content = `
      <section class="editorial-cover">
        ${slide.eyebrow ? `<div class="editorial-kicker">${renderBreaks(slide.eyebrow)}</div>` : ""}
        <div class="editorial-cover-title">
          <span>${renderBreaks(slide.title)}</span>
          ${slide.accentTitle ? `<span class="editorial-cover-accent">${renderBreaks(slide.accentTitle)}</span>` : ""}
        </div>
        ${slide.subtitle ? `<div class="editorial-cover-subtitle">${renderBreaks(slide.subtitle)}</div>` : ""}
        ${slide.footer ? `<div class="editorial-cover-footer">${renderBreaks(slide.footer)}</div>` : ""}
      </section>
    `;
  } else if (layoutIndex === 1) {
    content = `
      <section class="editorial-focus">
        ${slide.eyebrow ? `<div class="editorial-kicker">${renderBreaks(slide.eyebrow)}</div>` : ""}
        ${renderEditorialMetricGrid(template, slide.stats)}
        <div class="editorial-focus-title">${renderBreaks(slide.title)}${slide.accentTitle ? `<span class="editorial-focus-accent">${renderBreaks(slide.accentTitle)}</span>` : ""}</div>
        ${slide.subtitle ? `<div class="editorial-focus-subtitle">${renderBreaks(slide.subtitle)}</div>` : ""}
        ${slide.body ? `<div class="editorial-copy">${renderParagraphs(slide.body)}</div>` : ""}
        ${slide.quote ? `<div class="editorial-quote-card">${renderBreaks(slide.quote)}</div>` : ""}
      </section>
    `;
  } else if (layoutIndex === 2) {
    content = articleBlock(template.accent, "rgba(215,160,63,0.12)");
  } else if (layoutIndex === 3) {
    content = articleBlock("#72aef7", "rgba(60,114,197,0.16)");
  } else if (layoutIndex === 4) {
    content = `
      <section class="editorial-score">
        ${slide.eyebrow ? `<div class="editorial-kicker">${renderBreaks(slide.eyebrow)}</div>` : ""}
        <div class="editorial-heading">
          <div class="editorial-rule"></div>
          <div class="editorial-title-stack">
            <div class="editorial-title-main">${renderBreaks(slide.title)}</div>
            ${slide.accentTitle ? `<div class="editorial-title-accent">${renderBreaks(slide.accentTitle)}</div>` : ""}
          </div>
        </div>
        ${slide.body ? `<div class="editorial-copy">${renderParagraphs(slide.body)}</div>` : ""}
        ${renderEditorialScoreBars(template, slide.stats)}
        ${slide.footer ? `<div class="editorial-next-line">${renderBreaks(slide.footer)}</div>` : ""}
      </section>
    `;
  } else if (layoutIndex === 5) {
    content = `
      <section class="editorial-question">
        ${slide.eyebrow ? `<div class="editorial-question-kicker">${renderBreaks(slide.eyebrow)}</div>` : ""}
        <div class="editorial-question-dot"></div>
        ${slide.subtitle ? `<div class="editorial-question-subtitle">${renderBreaks(slide.subtitle)}</div>` : ""}
        <div class="editorial-question-line">${renderBreaks(slide.title)}</div>
        ${slide.accentTitle ? `<div class="editorial-question-accent">${renderBreaks(slide.accentTitle)}</div>` : ""}
        ${slide.body ? `<div class="editorial-question-mid">${renderBreaks(slide.body)}</div>` : ""}
        ${slide.quote ? `<div class="editorial-question-line">${renderBreaks(slide.quote)}</div>` : ""}
        ${slide.footer ? `<div class="editorial-question-footer">${renderBreaks(slide.footer)}</div>` : ""}
        <div class="editorial-pill"><strong>${escapeHtml(brand)}</strong><span>당신의 구조도 같은 방식으로 풀어볼 수 있습니다</span></div>
      </section>
    `;
  } else {
    content = `
      <section class="editorial-ending">
        ${slide.eyebrow ? `<div class="editorial-kicker">${renderBreaks(slide.eyebrow)}</div>` : ""}
        <div class="editorial-ending-title">
          <span>${renderBreaks(slide.title)}</span>
          ${slide.accentTitle ? `<span class="editorial-cover-accent">${renderBreaks(slide.accentTitle)}</span>` : ""}
        </div>
        ${slide.body ? `<div class="editorial-copy">${renderParagraphs(slide.body)}</div>` : ""}
        ${slide.quote ? `<div class="editorial-quote-card">${renderBreaks(slide.quote)}</div>` : ""}
        ${slide.footer ? `<div class="editorial-cover-footer">${renderBreaks(slide.footer)}</div>` : ""}
        <div class="editorial-pill"><strong>${escapeHtml(brand)}</strong><span>다음 카드뉴스의 주인공은 누구인가요?</span></div>
      </section>
    `;
  }

  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${template.width}px;
        height: ${template.height}px;
        overflow: hidden;
        font-family: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
        background: #090c12;
      }
      body {
        position: relative;
        ${background}
        color: ${template.textPrimary};
      }
      body::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 18%, transparent 82%, rgba(255,255,255,0.03) 100%),
          radial-gradient(circle at 15% 86%, rgba(215,160,63,0.12), transparent 18%);
        pointer-events: none;
      }
      .editorial-frame {
        position: relative;
        width: 100%;
        height: 100%;
        padding: 46px 54px 54px;
        display: flex;
        flex-direction: column;
      }
      .editorial-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: rgba(247,242,232,0.58);
        font-size: 15px;
        letter-spacing: 0.34em;
        text-transform: uppercase;
      }
      .editorial-body {
        position: relative;
        flex: 1;
        padding-top: 56px;
      }
      .editorial-kicker,
      .editorial-question-kicker {
        font-size: 20px;
        line-height: 1.4;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: ${template.accent};
      }
      .editorial-cover,
      .editorial-ending {
        display: flex;
        height: 100%;
        flex-direction: column;
        justify-content: flex-end;
      }
      .editorial-cover-title,
      .editorial-ending-title {
        display: flex;
        max-width: 760px;
        flex-direction: column;
        gap: 8px;
        font-size: 102px;
        line-height: 0.95;
        letter-spacing: -0.08em;
        font-weight: 900;
      }
      .editorial-cover-accent {
        color: ${template.accent};
      }
      .editorial-cover-subtitle {
        margin-top: 34px;
        max-width: 820px;
        border-top: 1px solid rgba(255,255,255,0.12);
        padding-top: 24px;
        color: rgba(247,242,232,0.76);
        font-size: 34px;
        line-height: 1.45;
      }
      .editorial-cover-footer {
        margin-top: 18px;
        max-width: 780px;
        color: rgba(247,242,232,0.58);
        font-size: 26px;
        line-height: 1.55;
      }
      .editorial-focus {
        display: flex;
        flex-direction: column;
        gap: 22px;
      }
      .editorial-panel {
        width: 100%;
        border-radius: 28px;
        border: 1px solid rgba(255,255,255,0.08);
        background: rgba(9,11,18,0.84);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
        padding: 28px;
      }
      .editorial-panel-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }
      .editorial-chip {
        min-height: 110px;
        border-radius: 22px;
        padding: 18px 18px 16px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .editorial-chip-label {
        color: rgba(247,242,232,0.58);
        font-size: 18px;
        line-height: 1.4;
      }
      .editorial-chip-value {
        margin-top: 16px;
        font-size: 34px;
        font-weight: 800;
        line-height: 1.05;
      }
      .editorial-focus-title {
        max-width: 760px;
        font-size: 76px;
        line-height: 0.98;
        letter-spacing: -0.06em;
        font-weight: 900;
      }
      .editorial-focus-accent {
        display: block;
        color: ${template.accent};
      }
      .editorial-focus-subtitle {
        max-width: 780px;
        color: rgba(247,242,232,0.72);
        font-size: 28px;
        line-height: 1.5;
      }
      .editorial-heading {
        display: flex;
        align-items: flex-start;
        gap: 22px;
      }
      .editorial-rule {
        width: 6px;
        min-height: 160px;
        border-radius: 999px;
        background: ${template.accent};
        box-shadow: 0 0 18px rgba(215,160,63,0.16);
      }
      .editorial-title-stack {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .editorial-title-main {
        max-width: 720px;
        font-size: 82px;
        line-height: 0.98;
        font-weight: 900;
        letter-spacing: -0.07em;
      }
      .editorial-title-accent {
        font-size: 78px;
        line-height: 0.98;
        font-weight: 900;
        letter-spacing: -0.07em;
        color: ${template.accent};
      }
      .editorial-copy {
        max-width: 860px;
        color: rgba(247,242,232,0.84);
        font-size: 32px;
        line-height: 1.72;
      }
      .editorial-copy p {
        margin: 0 0 20px;
      }
      .editorial-quote-card,
      .editorial-note {
        margin-top: 10px;
        max-width: 850px;
        border-radius: 24px;
        border: 1px solid rgba(215,160,63,0.22);
        background: rgba(215,160,63,0.12);
        padding: 22px 26px;
        color: ${template.textPrimary};
        font-size: 29px;
        line-height: 1.5;
        font-weight: 700;
      }
      .editorial-footer-copy {
        margin-top: 14px;
        max-width: 840px;
        color: rgba(247,242,232,0.62);
        font-size: 24px;
        line-height: 1.5;
      }
      .editorial-score {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .score-bars {
        display: grid;
        gap: 16px;
        margin-top: 8px;
      }
      .score-row {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .score-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        font-size: 24px;
        color: rgba(247,242,232,0.8);
      }
      .score-head strong {
        font-size: 26px;
      }
      .score-track {
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
      }
      .score-fill {
        height: 100%;
        border-radius: 999px;
      }
      .editorial-next-line {
        margin-top: 6px;
        color: rgba(247,242,232,0.6);
        font-size: 20px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .editorial-question {
        display: flex;
        height: 100%;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .editorial-question-kicker {
        color: rgba(247,242,232,0.48);
        font-size: 18px;
        letter-spacing: 0.36em;
        text-transform: uppercase;
      }
      .editorial-question-dot {
        width: 12px;
        height: 12px;
        margin-top: 24px;
        border-radius: 999px;
        background: ${template.accent};
      }
      .editorial-question-subtitle {
        margin-top: 34px;
        color: rgba(247,242,232,0.58);
        font-size: 26px;
      }
      .editorial-question-line,
      .editorial-question-accent {
        max-width: 820px;
        font-size: 82px;
        line-height: 0.98;
        letter-spacing: -0.07em;
        font-weight: 900;
      }
      .editorial-question-accent {
        color: ${template.accent};
      }
      .editorial-question-mid {
        margin: 20px 0;
        color: rgba(247,242,232,0.42);
        font-size: 30px;
      }
      .editorial-question-footer {
        margin-top: 34px;
        max-width: 720px;
        color: rgba(247,242,232,0.56);
        font-size: 26px;
        line-height: 1.5;
      }
      .editorial-pill {
        display: inline-flex;
        align-items: center;
        gap: 16px;
        margin-top: 34px;
        border-radius: 999px;
        border: 1px solid rgba(215,160,63,0.26);
        background: rgba(0,0,0,0.24);
        padding: 16px 22px;
        color: rgba(247,242,232,0.66);
        font-size: 20px;
      }
      .editorial-pill strong {
        color: ${template.accent};
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      @media (max-width: 1080px) {
        .editorial-panel-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    </style>
  </head>
  <body>
    <main class="editorial-frame">
      <div class="editorial-top">
        <span>${escapeHtml(brand)}</span>
        <span>${escapeHtml(pageLabel)}</span>
      </div>
      <section class="editorial-body">${content}</section>
    </main>
  </body>
</html>`;
}

export function renderCardNewsHtml(input: CardNewsRenderInput) {
  const brand = input.brand?.trim() || "SBUSIM STUDIO";
  const template = getCardNewsTemplate(input.templateKey ?? "editorial-story");
  return {
    brand,
    template,
    frames: input.slides.map((slide, index) => ({
      index,
      width: template.width,
      height: template.height,
      html:
        template.key === "editorial-story"
          ? renderEditorialStoryFrame({
              brand,
              backgroundImageUrl: input.backgroundImageUrl,
              template,
              slide,
              slideIndex: index,
              slideCount: input.slides.length,
            })
          : renderFrame({
              brand,
              backgroundImageUrl: input.backgroundImageUrl,
              template,
              slide,
              slideIndex: index,
              slideCount: input.slides.length,
            }),
    })),
  };
}
