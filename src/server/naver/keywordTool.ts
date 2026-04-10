import { searchAdRequestJson } from "@/server/naver/searchadAuth";
import { normalizeSearchAdOverviewRow, type SearchAdKeywordOverview } from "@/server/naver/types";

type SearchAdKeywordToolResponse = {
  keywordList?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
};

export async function fetchNaverKeywordOverview(keywords: string[]) {
  const hintKeywords = keywords.map((item) => item.trim()).filter(Boolean).slice(0, 5);
  const json = await searchAdRequestJson<SearchAdKeywordToolResponse>({
    method: "GET",
    requestUri: "/keywordstool",
    query: {
      hintKeywords: hintKeywords.join(","),
      showDetail: 1,
    },
  });

  const rows = (json.keywordList ?? json.data ?? [])
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map(normalizeSearchAdOverviewRow)
    .filter((row) => row.relKeyword.length > 0);

  return {
    source: "searchad.keywordstool" as const,
    keywords: hintKeywords,
    items: rows as SearchAdKeywordOverview[],
  };
}
