import { fetchJsonWithRetry } from "@/server/fetchJson";
import { requireEnv } from "@/server/env";
import { normalizeNaverTrendGroup, type NaverTrendGroup } from "@/server/naver/types";

type DatalabSearchResponse = {
  startDate?: string;
  endDate?: string;
  timeUnit?: "date" | "week" | "month";
  results?: Array<Record<string, unknown>>;
};

export async function fetchNaverTrend(args: {
  groups: Array<{ groupName: string; keywords: string[] }>;
  startDate: string;
  endDate: string;
  timeUnit: "date" | "week" | "month";
  device?: "pc" | "mo";
  gender?: "m" | "f";
  ages?: string[];
}) {
  const clientId = requireEnv("NAVER_CLIENT_ID");
  const clientSecret = requireEnv("NAVER_CLIENT_SECRET");
  const url = "https://openapi.naver.com/v1/datalab/search";

  const body = {
    startDate: args.startDate,
    endDate: args.endDate,
    timeUnit: args.timeUnit,
    keywordGroups: args.groups.slice(0, 5).map((group) => ({
      groupName: group.groupName,
      keywords: group.keywords.slice(0, 20),
    })),
    ...(args.device ? { device: args.device } : {}),
    ...(args.gender ? { gender: args.gender } : {}),
    ...(args.ages && args.ages.length > 0 ? { ages: args.ages } : {}),
  };

  const { json } = await fetchJsonWithRetry<DatalabSearchResponse>(
    url,
    {
      method: "POST",
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
    { timeoutMs: 20_000, retries: 2 }
  );

  const groups = (json.results ?? [])
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map(normalizeNaverTrendGroup)
    .filter((group) => group.groupName.length > 0);

  return {
    source: "datalab.search" as const,
    ...body,
    groups: groups as NaverTrendGroup[],
  };
}
