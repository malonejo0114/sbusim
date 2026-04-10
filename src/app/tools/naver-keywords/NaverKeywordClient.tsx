"use client";

import { useMemo, useState } from "react";

type NaverCount = {
  raw: string;
  value: number | null;
  underTen: boolean;
};

type OverviewItem = {
  relKeyword: string;
  monthlyPcQcCnt: NaverCount;
  monthlyMobileQcCnt: NaverCount;
  monthlyAvePcClkCnt: number | null;
  monthlyAveMobileClkCnt: number | null;
  monthlyAvePcCtr: number | null;
  monthlyAveMobileCtr: number | null;
  plAvgDepth: number | null;
  compIdx: string | null;
};

type BidsItem = {
  keyword: string;
  pc: Array<{ position: number; bidKrw: number }>;
  mobile: Array<{ position: number; bidKrw: number }>;
};

type TrendGroup = {
  groupName: string;
  keywords: string[];
  data: Array<{ period: string; ratio: number }>;
};

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

function formatCount(count: NaverCount) {
  if (count.raw === "<10") return "<10";
  if (count.value === null) return "-";
  return count.value.toLocaleString("ko-KR");
}

function formatPercent(value: number | null) {
  if (value === null) return "-";
  return `${value.toFixed(2)}%`;
}

function formatKrw(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function parseKeywords(input: string) {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export default function NaverKeywordClient() {
  const [keywordInput, setKeywordInput] = useState("사주, 재물운");
  const [startDate, setStartDate] = useState(thirtyDaysAgo());
  const [endDate, setEndDate] = useState(todayDate());
  const [timeUnit, setTimeUnit] = useState<"date" | "week" | "month">("week");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [bids, setBids] = useState<BidsItem[]>([]);
  const [trend, setTrend] = useState<TrendGroup[]>([]);

  const keywords = useMemo(() => parseKeywords(keywordInput), [keywordInput]);

  async function runLookup() {
    if (keywords.length === 0) {
      setError("키워드를 1개 이상 입력하세요. 쉼표로 여러 개를 비교할 수 있습니다.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const [overviewRes, bidsRes, trendRes] = await Promise.all([
        fetch("/api/naver/keywords/overview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keywords }),
        }),
        fetch("/api/naver/keywords/bids", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ keywords, positions: [1, 2, 3, 4, 5] }),
        }),
        fetch("/api/naver/keywords/trend", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            keywords,
            startDate,
            endDate,
            timeUnit,
          }),
        }),
      ]);

      const [overviewJson, bidsJson, trendJson] = await Promise.all([
        overviewRes.json().catch(() => ({})),
        bidsRes.json().catch(() => ({})),
        trendRes.json().catch(() => ({})),
      ]);

      if (!overviewRes.ok) throw new Error(overviewJson.error ?? `키워드 개요 조회 실패 (HTTP ${overviewRes.status})`);
      if (!bidsRes.ok) throw new Error(bidsJson.error ?? `입찰가 조회 실패 (HTTP ${bidsRes.status})`);
      if (!trendRes.ok) throw new Error(trendJson.error ?? `트렌드 조회 실패 (HTTP ${trendRes.status})`);

      setOverview((overviewJson.items ?? []) as OverviewItem[]);
      setBids((bidsJson.items ?? []) as BidsItem[]);
      setTrend((trendJson.groups ?? []) as TrendGroup[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Input</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">키워드를 넣으면 바로 API 결과를 확인합니다</h2>
          <p className="mt-4 text-sm leading-7 text-slate-600">
            SearchAd Keyword Tool, Estimate API, Datalab을 한 번에 묶어 조회합니다. 쉼표로 최대 5개까지 비교할 수 있습니다.
          </p>

          <div className="mt-6 space-y-4">
            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">키워드</div>
              <input
                value={keywordInput}
                onChange={(event) => setKeywordInput(event.target.value)}
                placeholder="예: 사주, 재물운, 이직운"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-400"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">시작일</div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">종료일</div>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">단위</div>
                <select
                  value={timeUnit}
                  onChange={(event) => setTimeUnit(event.target.value as "date" | "week" | "month")}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                >
                  <option value="date">일간</option>
                  <option value="week">주간</option>
                  <option value="month">월간</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={runLookup}
              disabled={busy}
              className="inline-flex h-11 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "조회 중..." : "검색량 + 입찰가 + 트렌드 조회"}
            </button>
          </div>

          {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[
            "검색량",
            "연관검색어",
            "경쟁도",
            "PC 1~5 입찰가",
            "MOBILE 1~5 입찰가",
          ].map((field, index) => (
            <div key={field} className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-slate-50 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">0{index + 1}</div>
              <div className="mt-3 text-lg font-semibold">{field}</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {field === "검색량"
                  ? "최근 30일 PC/모바일 쿼리 수를 공식 SearchAd 필드로 보여줍니다."
                  : field === "연관검색어"
                    ? "관련 키워드 확장과 비교 키워드 발굴에 씁니다."
                    : field === "경쟁도"
                      ? "공식 compIdx를 그대로 정규화해서 보여줍니다."
                      : "Estimate API로 포지션별 추정 입찰가를 계산합니다."}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Keyword Tool 결과</h3>
            <p className="mt-1 text-sm text-slate-600">연관검색어, 검색량, 클릭/CTR, 경쟁도 요약</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {overview.length} rows
          </span>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-3 font-medium">키워드</th>
                <th className="px-3 py-3 font-medium">PC</th>
                <th className="px-3 py-3 font-medium">모바일</th>
                <th className="px-3 py-3 font-medium">경쟁도</th>
                <th className="px-3 py-3 font-medium">PC CTR</th>
                <th className="px-3 py-3 font-medium">모바일 CTR</th>
              </tr>
            </thead>
            <tbody>
              {overview.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    아직 조회 결과가 없습니다.
                  </td>
                </tr>
              ) : (
                overview.slice(0, 20).map((item) => (
                  <tr key={item.relKeyword} className="border-b border-slate-100 text-slate-700">
                    <td className="px-3 py-3 font-medium text-slate-900">{item.relKeyword}</td>
                    <td className="px-3 py-3">{formatCount(item.monthlyPcQcCnt)}</td>
                    <td className="px-3 py-3">{formatCount(item.monthlyMobileQcCnt)}</td>
                    <td className="px-3 py-3">{item.compIdx ?? "-"}</td>
                    <td className="px-3 py-3">{formatPercent(item.monthlyAvePcCtr)}</td>
                    <td className="px-3 py-3">{formatPercent(item.monthlyAveMobileCtr)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">포지션별 입찰가</h3>
              <p className="mt-1 text-sm text-slate-600">PC 1~5, MOBILE 1~5 추정 입찰가</p>
            </div>
          </div>

          <div className="mt-5 space-y-5">
            {bids.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-400">아직 조회 결과가 없습니다.</div>
            ) : (
              bids.map((item) => (
                <div key={item.keyword} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-base font-semibold text-slate-950">{item.keyword}</div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">PC</div>
                      <div className="space-y-2">
                        {item.pc.map((bid) => (
                          <div key={`pc-${bid.position}`} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm">
                            <span className="text-slate-600">{bid.position}위</span>
                            <strong className="text-slate-950">{formatKrw(bid.bidKrw)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Mobile</div>
                      <div className="space-y-2">
                        {item.mobile.map((bid) => (
                          <div key={`mobile-${bid.position}`} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm">
                            <span className="text-slate-600">{bid.position}위</span>
                            <strong className="text-slate-950">{formatKrw(bid.bidKrw)}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">Datalab 추이</h3>
              <p className="mt-1 text-sm text-slate-600">비교 키워드별 상대 트렌드</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {trend.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm text-slate-400">아직 조회 결과가 없습니다.</div>
            ) : (
              trend.map((group) => {
                const latest = group.data[group.data.length - 1];
                const peak = group.data.reduce((best, point) => (point.ratio > best.ratio ? point : best), group.data[0] ?? { period: "-", ratio: 0 });
                return (
                  <div key={group.groupName} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-950">{group.groupName}</div>
                        <div className="mt-1 text-xs text-slate-500">{group.keywords.join(", ")}</div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                        points {group.data.length}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-500">최신 ratio</div>
                        <div className="mt-1 font-semibold text-slate-950">{latest ? latest.ratio.toFixed(2) : "-"}</div>
                      </div>
                      <div className="rounded-2xl bg-white px-4 py-3 text-sm">
                        <div className="text-slate-500">최고점</div>
                        <div className="mt-1 font-semibold text-slate-950">
                          {peak ? `${peak.ratio.toFixed(2)} (${peak.period})` : "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
