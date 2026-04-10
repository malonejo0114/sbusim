export const CARD_NEWS_TEMPLATE_KEYS = [
  "editorial-story",
  "fortune-cover",
  "question-contrast",
  "analysis-panel",
  "stat-bars",
  "closing-cta",
] as const;

export type CardNewsTemplateKey = (typeof CARD_NEWS_TEMPLATE_KEYS)[number];

export type CardNewsTemplateDefinition = {
  key: CardNewsTemplateKey;
  name: string;
  description: string;
  width: number;
  height: number;
  overlay: string;
  accent: string;
  accentSoft: string;
  textPrimary: string;
  textMuted: string;
  footerBorder: string;
};

export const CARD_NEWS_TEMPLATES: CardNewsTemplateDefinition[] = [
  {
    key: "editorial-story",
    name: "Editorial Story 4:5",
    description: "표지, 핵심 분석, 해설, 점수 바, 질문형 마무리까지 1~7장 흐름으로 이어지는 편집형 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(7,10,16,0.24) 0%, rgba(7,10,16,0.54) 46%, rgba(7,10,16,0.92) 100%)",
    accent: "#d7a03f",
    accentSoft: "rgba(215,160,63,0.16)",
    textPrimary: "#f7f2e8",
    textMuted: "rgba(247,242,232,0.72)",
    footerBorder: "rgba(215,160,63,0.28)",
  },
  {
    key: "fortune-cover",
    name: "Fortune Cover",
    description: "배경 인물 사진 위에 대형 타이틀과 한 줄 메시지를 얹는 표지형 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(7,10,16,0.34) 0%, rgba(7,10,16,0.68) 58%, rgba(7,10,16,0.92) 100%)",
    accent: "#d89a35",
    accentSoft: "rgba(216,154,53,0.18)",
    textPrimary: "#ffffff",
    textMuted: "rgba(255,255,255,0.74)",
    footerBorder: "rgba(216,154,53,0.32)",
  },
  {
    key: "question-contrast",
    name: "Question Contrast",
    description: "질문형 카피와 대비 색상을 크게 쓰는 인터랙션 유도형 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(10,14,24,0.36) 0%, rgba(10,14,24,0.64) 55%, rgba(10,14,24,0.9) 100%)",
    accent: "#f0ab43",
    accentSoft: "rgba(240,171,67,0.16)",
    textPrimary: "#ffffff",
    textMuted: "rgba(255,255,255,0.72)",
    footerBorder: "rgba(240,171,67,0.26)",
  },
  {
    key: "analysis-panel",
    name: "Analysis Panel",
    description: "분석 요약과 핵심 포인트를 패널 안에 정리하는 설명형 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(9,10,15,0.48) 0%, rgba(9,10,15,0.72) 56%, rgba(9,10,15,0.94) 100%)",
    accent: "#d6a041",
    accentSoft: "rgba(214,160,65,0.14)",
    textPrimary: "#ffffff",
    textMuted: "rgba(255,255,255,0.74)",
    footerBorder: "rgba(214,160,65,0.26)",
  },
  {
    key: "stat-bars",
    name: "Stat Bars",
    description: "지표와 비율 바를 강조하는 데이터 설명형 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(9,11,18,0.48) 0%, rgba(9,11,18,0.72) 58%, rgba(9,11,18,0.95) 100%)",
    accent: "#d89a35",
    accentSoft: "rgba(76,135,240,0.14)",
    textPrimary: "#ffffff",
    textMuted: "rgba(255,255,255,0.72)",
    footerBorder: "rgba(76,135,240,0.28)",
  },
  {
    key: "closing-cta",
    name: "Closing CTA",
    description: "요약과 행동 유도 문구를 담는 마지막 장 템플릿",
    width: 1080,
    height: 1350,
    overlay: "linear-gradient(180deg, rgba(8,10,15,0.4) 0%, rgba(8,10,15,0.64) 52%, rgba(8,10,15,0.94) 100%)",
    accent: "#e3a53f",
    accentSoft: "rgba(227,165,63,0.16)",
    textPrimary: "#ffffff",
    textMuted: "rgba(255,255,255,0.72)",
    footerBorder: "rgba(227,165,63,0.26)",
  },
];

export function getCardNewsTemplate(templateKey: string) {
  return CARD_NEWS_TEMPLATES.find((template) => template.key === templateKey) ?? CARD_NEWS_TEMPLATES[0];
}
