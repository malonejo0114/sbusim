export type SourceLink = {
  name: string;
  url: string;
};

export type MarketInstrumentRow = {
  id: string;
  label: string;
  te_symbol: string;
  category: string;
  enabled: boolean;
  sort: number;
};

export type SnapshotPoint = {
  asofDate: string;
  instrumentId: string;
  last: number;
  dailyPct: number;
  raw: Record<string, unknown>;
};

export type ChartPanelData = {
  label: string;
  current: number;
  dailyPct: number;
  series: number[];
};

export type PostQueueType = "daily_snapshot" | "daily_calendar" | "weekly_cot" | "rss_insight";

export type PostQueueStatus = "queued" | "rendering" | "posting" | "posted" | "failed";
