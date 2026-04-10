import { prisma } from "@/lib/prisma";

export const AI_PROMPT_SETTING_KEYS = [
  "dailyTopicInfoGuide",
  "dailyTopicCtaGuide",
  "dailyTopicTopicGuide",
  "dailyTopicCommonRules",
  "issuePackCommonRules",
] as const;

export type AiPromptSettingKey = (typeof AI_PROMPT_SETTING_KEYS)[number];

export type AiPromptConfig = Record<AiPromptSettingKey, string>;

export const DEFAULT_AI_PROMPT_CONFIG: AiPromptConfig = {
  dailyTopicInfoGuide: "정보성 글: 핵심 사실/배경/체크포인트를 명확히 정리하고, 홍보성 문구는 최소화.",
  dailyTopicCtaGuide:
    "CTA 글: 행동 유도 문장만 작성하세요. 시황/수치/퍼센트/자산 가격/시장 요약은 금지합니다. 첫 문장부터 CTA로 시작하고, 2~4문장으로 짧고 강하게 작성하세요.",
  dailyTopicTopicGuide: "주제형 글: 오늘 관점의 핵심 포인트 2~3개를 균형 있게 정리.",
  dailyTopicCommonRules:
    "본문은 핵심 문장마다 줄바꿈하고, 문장 사이에 빈 줄 1개(\\n\\n)를 사용하세요. 과도한 과장/투자 조언/확정적 표현은 금지.",
  issuePackCommonRules:
    "브리핑/게시글 모두 요청 키워드와 직접 관련된 내용만 작성. 불확실한 사실은 단정 금지.",
};

function sanitizePromptValue(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().slice(0, 5000);
}

export async function getAiPromptConfig(userId: string): Promise<AiPromptConfig> {
  const rows = await prisma.aiPromptSetting.findMany({
    where: {
      userId,
      key: { in: [...AI_PROMPT_SETTING_KEYS] },
    },
    select: {
      key: true,
      value: true,
    },
  });

  const byKey = new Map<string, string>();
  for (const row of rows) {
    byKey.set(row.key, row.value);
  }

  return {
    dailyTopicInfoGuide: byKey.get("dailyTopicInfoGuide") ?? DEFAULT_AI_PROMPT_CONFIG.dailyTopicInfoGuide,
    dailyTopicCtaGuide: byKey.get("dailyTopicCtaGuide") ?? DEFAULT_AI_PROMPT_CONFIG.dailyTopicCtaGuide,
    dailyTopicTopicGuide: byKey.get("dailyTopicTopicGuide") ?? DEFAULT_AI_PROMPT_CONFIG.dailyTopicTopicGuide,
    dailyTopicCommonRules: byKey.get("dailyTopicCommonRules") ?? DEFAULT_AI_PROMPT_CONFIG.dailyTopicCommonRules,
    issuePackCommonRules: byKey.get("issuePackCommonRules") ?? DEFAULT_AI_PROMPT_CONFIG.issuePackCommonRules,
  };
}

export async function upsertAiPromptConfig(userId: string, patch: Partial<AiPromptConfig>) {
  const keys = Object.keys(patch) as AiPromptSettingKey[];
  if (keys.length === 0) {
    return getAiPromptConfig(userId);
  }

  await prisma.$transaction(
    keys.map((key) => {
      const nextRaw = patch[key];
      const nextValue = sanitizePromptValue(nextRaw ?? "");
      return prisma.aiPromptSetting.upsert({
        where: { userId_key: { userId, key } },
        update: { value: nextValue },
        create: { userId, key, value: nextValue },
      });
    })
  );

  return getAiPromptConfig(userId);
}

export async function resetAiPromptConfig(userId: string) {
  await prisma.aiPromptSetting.deleteMany({
    where: {
      userId,
      key: { in: [...AI_PROMPT_SETTING_KEYS] },
    },
  });

  return getAiPromptConfig(userId);
}
