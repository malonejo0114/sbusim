import { searchAdRequestJson } from "@/server/naver/searchadAuth";
import { normalizeSearchAdBidRow, type SearchAdBidEstimate } from "@/server/naver/types";

type SearchAdEstimateResponse = {
  device?: "PC" | "MOBILE";
  estimate?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
};

export async function fetchNaverKeywordBids(args: { keywords: string[]; positions?: number[] }) {
  const keywords = args.keywords.map((item) => item.trim()).filter(Boolean).slice(0, 20);
  const positions = (args.positions ?? [1, 2, 3, 4, 5]).map((position) => Math.max(1, Math.min(5, Math.floor(position))));

  const request = async (device: "PC" | "MOBILE") => {
    const estimate = await searchAdRequestJson<SearchAdEstimateResponse>({
      method: "POST",
      requestUri: "/estimate/average-position-bid/keyword",
      body: {
        device,
        items: keywords.flatMap((keyword) => positions.map((position) => ({ key: keyword, position }))),
      },
    });

    const items = (estimate.estimate ?? estimate.data ?? [])
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
      .map(normalizeSearchAdBidRow)
      .filter((row) => row.keyword.length > 0);

    const byKeyword = new Map<string, SearchAdBidEstimate[]>();
    for (const row of items) {
      const list = byKeyword.get(row.keyword) ?? [];
      list.push(row);
      byKeyword.set(row.keyword, list);
    }

    return keywords.map((keyword) => ({
      keyword,
      bids: (byKeyword.get(keyword) ?? []).sort((a, b) => a.position - b.position),
    }));
  };

  const [pc, mobile] = await Promise.all([request("PC"), request("MOBILE")]);
  return {
    source: "searchad.estimate" as const,
    positions,
    items: keywords.map((keyword) => ({
      keyword,
      pc: pc.find((item) => item.keyword === keyword)?.bids ?? [],
      mobile: mobile.find((item) => item.keyword === keyword)?.bids ?? [],
    })),
  };
}
