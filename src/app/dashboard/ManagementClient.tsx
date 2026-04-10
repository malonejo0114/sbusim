"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type OverviewAccount = {
  id: string;
  label: string | null;
  threadsUserId: string | null;
  threadsUsername: string | null;
  hasProxy: boolean;
  tokenExpiresAt: string;
  stats: {
    totalScheduled: number;
    monthlyScheduled: number;
    monthlyPublished: number;
    pending: number;
    running: number;
    success: number;
    failed: number;
    partialFailed: number;
    engagement: {
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
    };
  };
  followerStats: {
    currentFollowers: number | null;
    dailyDelta: number | null;
    weeklyDelta: number | null;
    weekStartDateKst: string | null;
    weekEndDateKst: string | null;
    latestDateKst: string | null;
    latestCapturedAt: string | null;
    daysTracked: number;
  };
};

type CalendarItem = {
  date: string;
  total: number;
  byAccount: Array<{
    accountId: string;
    accountName: string;
    total: number;
    success: number;
    pending: number;
    failed: number;
  }>;
};

type OverviewResponse = {
  month: string;
  accounts: OverviewAccount[];
  calendarDays: CalendarItem[];
  aiUsage?: {
    daily: {
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      estimatedCostKrw: number;
    };
    weekly: {
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      estimatedCostKrw: number;
    };
    monthly: {
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      estimatedCostKrw: number;
    };
  };
  optimization?: {
    totalPosted: number;
    overallAverageScore: number;
    byHour: Array<{
      key: string;
      label: string;
      posts: number;
      avgViews: number;
      avgScore: number;
      avgEngagementRate: number;
      examples: Array<{
        postId: string;
        accountId: string;
        accountName: string;
        scheduledAt: string;
        text: string;
        views: number;
        interactions: number;
        score: number;
      }>;
    }>;
    byLength: Array<{
      key: string;
      label: string;
      posts: number;
      avgViews: number;
      avgScore: number;
      avgEngagementRate: number;
      examples: Array<{
        postId: string;
        accountId: string;
        accountName: string;
        scheduledAt: string;
        text: string;
        views: number;
        interactions: number;
        score: number;
      }>;
    }>;
    byStyle: Array<{
      key: string;
      label: string;
      posts: number;
      avgViews: number;
      avgScore: number;
      avgEngagementRate: number;
      examples: Array<{
        postId: string;
        accountId: string;
        accountName: string;
        scheduledAt: string;
        text: string;
        views: number;
        interactions: number;
        score: number;
      }>;
    }>;
    recommendations: {
      bestHours: Array<{ key: string; label: string }>;
      bestLength: { key: string; label: string } | null;
      bestStyle: { key: string; label: string } | null;
    };
  };
};

type BulkImportPreviewItem = {
  rowNumber: number;
  accountInput: string;
  accountId: string | null;
  accountName: string | null;
  text: string;
  replies: Array<{ text: string }>;
  mediaType: "TEXT" | "IMAGE" | "VIDEO";
  mediaUrl: string | null;
  scheduledAtInput: string;
  scheduledAtIso: string | null;
  errors: string[];
};

type BulkImportValidItem = {
  rowNumber: number;
  threadsAccountId: string;
  text: string;
  replies: Array<{ text: string }>;
  mediaType: "TEXT" | "IMAGE" | "VIDEO";
  mediaUrl: string | null;
  scheduledAtIso: string | null;
};

type BulkImportPreview = {
  sheetName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  timeMode?: "sheet" | "auto";
  byAccount: Array<{
    accountId: string;
    accountName: string;
    validCount: number;
  }>;
  items: BulkImportPreviewItem[];
  validItems: BulkImportValidItem[];
};

type BulkImportCommitResult = {
  ok: boolean;
  created: number;
  failed: number;
  total: number;
  results: Array<{
    rowNumber: number;
    threadsAccountId: string;
    postId?: string;
    error?: string;
  }>;
};

type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

type IssuePackDraft = {
  draftId: string;
  threadsAccountId: string;
  accountName: string;
  contentType: "INFO" | "CTA";
  text: string;
  scheduledAt: string;
};

type IssuePackResult = {
  ai: {
    provider: string;
    model: string;
  };
  writingAi: {
    provider: string;
    model: string;
  };
  contextSummary: string;
  drafts: IssuePackDraft[];
};

type AiProviderInput = "auto" | "gemini" | "perplexity";

type IssuePackProgress = {
  requestId: string;
  phase: "idle" | "running" | "done" | "error";
  totalTasks: number;
  completedTasks: number;
  message?: string;
  accountName?: string;
  contentType?: "INFO" | "CTA";
  updatedAt: string;
  error?: string;
};

const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-3.0-pro-preview", label: "gemini-3.0-pro-preview" },
  { value: "gemini-3.0-flash-preview", label: "gemini-3.0-flash-preview" },
  { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
  { value: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite" },
];

const PERPLEXITY_MODEL_OPTIONS = [
  { value: "sonar", label: "sonar" },
  { value: "sonar-pro", label: "sonar-pro" },
];

function getModelOptionsByProvider(provider: AiProviderInput) {
  if (provider === "gemini") return GEMINI_MODEL_OPTIONS;
  if (provider === "perplexity") return PERPLEXITY_MODEL_OPTIONS;
  return [] as Array<{ value: string; label: string }>;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map((v) => Number(v));
  return `${y}년 ${m}월`;
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map((v) => Number(v));
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function num(v: number) {
  return Intl.NumberFormat("ko-KR").format(Math.max(0, Math.floor(v)));
}

function signedDelta(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "-";
  const rounded = Math.trunc(v);
  if (rounded > 0) return `+${num(rounded)}`;
  if (rounded < 0) return `-${num(Math.abs(rounded))}`;
  return "0";
}

function signedDeltaClass(v: number | null | undefined) {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.trunc(v) === 0) return "text-slate-900";
  return v > 0 ? "text-emerald-700" : "text-rose-700";
}

function moneyUsd(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(Math.max(0, Number(v) || 0));
}

function moneyKrw(v: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(v) || 0));
}

function buildCalendarCells(month: string) {
  const [y, m] = month.split("-").map((v) => Number(v));
  const firstDay = new Date(y, m - 1, 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }).map((_, idx) => {
    const d = new Date(start);
    d.setDate(start.getDate() + idx);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return {
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === m - 1,
    };
  });
}

function toDatetimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function fromIsoToDatetimeLocalValue(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return toDatetimeLocalValue(d);
}

export default function ManagementClient() {
  const [month, setMonth] = useState(currentMonthKey);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUseAutoSchedule, setImportUseAutoSchedule] = useState(true);
  const [importStartAt, setImportStartAt] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 10 * 60 * 1000)));
  const [importMinGapMinutes, setImportMinGapMinutes] = useState("45");
  const [importMaxGapMinutes, setImportMaxGapMinutes] = useState("90");
  const [importPreview, setImportPreview] = useState<BulkImportPreview | null>(null);
  const [importCommitResult, setImportCommitResult] = useState<BulkImportCommitResult | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [packScheduleBusy, setPackScheduleBusy] = useState(false);
  const [packProgress, setPackProgress] = useState<IssuePackProgress | null>(null);
  const [selectedPackTemplateId, setSelectedPackTemplateId] = useState("");
  const [packTemplatePrompt, setPackTemplatePrompt] = useState("");
  const [packTemplateBusy, setPackTemplateBusy] = useState(false);
  const [packTemplateMessage, setPackTemplateMessage] = useState<string | null>(null);
  const [packSourceContext, setPackSourceContext] = useState("");
  const [packCountPerAccount, setPackCountPerAccount] = useState("3");
  const [packMinGapMinutes, setPackMinGapMinutes] = useState("45");
  const [packMaxGapMinutes, setPackMaxGapMinutes] = useState("90");
  const [packCtaRatioMin, setPackCtaRatioMin] = useState("30");
  const [packCtaRatioMax, setPackCtaRatioMax] = useState("40");
  const [packWritingAiProvider, setPackWritingAiProvider] = useState<AiProviderInput>("gemini");
  const [packWritingAiModel, setPackWritingAiModel] = useState("gemini-2.0-flash");
  const [packStartAt, setPackStartAt] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 10 * 60 * 1000)));
  const [selectedPackAccountIds, setSelectedPackAccountIds] = useState<string[]>([]);
  const [packResult, setPackResult] = useState<IssuePackResult | null>(null);
  const [packScheduleResult, setPackScheduleResult] = useState<{ created: number; failed: number; errors: string[] } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [overviewRes, templatesRes] = await Promise.all([
        fetch(`/api/dashboard/overview?month=${month}`, { cache: "no-store" }),
        fetch("/api/prompt-templates", { cache: "no-store" }),
      ]);

      const overviewJson = (await overviewRes.json()) as OverviewResponse | { error?: string };
      if (!overviewRes.ok) throw new Error((overviewJson as { error?: string }).error ?? "개요를 불러오지 못했습니다.");
      setData(overviewJson as OverviewResponse);

      const templatesJson = (await templatesRes.json()) as { templates?: PromptTemplate[]; error?: string };
      if (!templatesRes.ok) throw new Error(templatesJson.error ?? "프롬프트 템플릿을 불러오지 못했습니다.");
      const templates = templatesJson.templates ?? [];
      setPromptTemplates(templates);
      if (selectedPackTemplateId && !templates.some((tpl) => tpl.id === selectedPackTemplateId)) {
        setSelectedPackTemplateId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [month, selectedPackTemplateId]);

  async function onPreviewBulkImport() {
    if (!importFile) {
      setImportError("엑셀(.xlsx/.csv) 파일을 선택하세요.");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    setImportCommitResult(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      form.append("timeMode", importUseAutoSchedule ? "auto" : "sheet");
      if (importUseAutoSchedule) {
        form.append("startAtIso", importStartAt ? new Date(importStartAt).toISOString() : "");
        form.append("minGapMinutes", importMinGapMinutes || "45");
        form.append("maxGapMinutes", importMaxGapMinutes || "90");
      }

      const res = await fetch("/api/scheduled-posts/import/preview", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { error?: string; preview?: BulkImportPreview };
      if (!res.ok) throw new Error(data?.error ?? "엑셀 미리보기 생성 실패");
      if (!data.preview) throw new Error("미리보기 응답이 비어 있습니다.");
      setImportPreview(data.preview);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }

  async function onCommitBulkImport() {
    if (!importPreview || importPreview.validItems.length === 0) {
      setImportError("예약할 유효 행이 없습니다.");
      return;
    }
    if (importPreview.validItems.some((item) => !item.scheduledAtIso)) {
      setImportError("일부 행의 예약시간이 비어 있습니다. 자동 배정 또는 엑셀 시간을 확인 후 다시 미리보기 해주세요.");
      return;
    }

    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch("/api/scheduled-posts/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: importPreview.validItems }),
      });
      const data = (await res.json()) as BulkImportCommitResult | { error?: string };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "일괄 예약 등록 실패");
      setImportCommitResult(data as BulkImportCommitResult);
      await load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }

  function togglePackAccount(accountId: string) {
    setSelectedPackAccountIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]
    );
  }

  function updatePackDraft(draftId: string, patch: Partial<IssuePackDraft>) {
    setPackResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        drafts: prev.drafts.map((draft) => (draft.draftId === draftId ? { ...draft, ...patch } : draft)),
      };
    });
  }

  function removePackDraft(draftId: string) {
    setPackResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        drafts: prev.drafts.filter((draft) => draft.draftId !== draftId),
      };
    });
  }

  async function onSavePackTemplatePrompt() {
    if (!selectedPackTemplateId) {
      setPackError("저장할 템플릿을 먼저 선택하세요.");
      return;
    }
    const currentTemplate = promptTemplates.find((tpl) => tpl.id === selectedPackTemplateId);
    if (!currentTemplate) {
      setPackError("선택한 템플릿을 찾지 못했습니다.");
      return;
    }
    if (!packTemplatePrompt.trim()) {
      setPackError("템플릿 프롬프트는 비워둘 수 없습니다.");
      return;
    }

    setPackTemplateBusy(true);
    setPackTemplateMessage(null);
    setPackError(null);
    try {
      const res = await fetch(`/api/prompt-templates/${selectedPackTemplateId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: currentTemplate.name,
          prompt: packTemplatePrompt.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string; template?: PromptTemplate };
      if (!res.ok) throw new Error(json.error ?? "템플릿 저장 실패");
      if (!json.template) throw new Error("템플릿 응답이 비어 있습니다.");
      setPromptTemplates((prev) => prev.map((tpl) => (tpl.id === json.template!.id ? json.template! : tpl)));
      setPackTemplateMessage("템플릿 프롬프트를 저장했습니다.");
    } catch (err) {
      setPackError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackTemplateBusy(false);
    }
  }

  async function onGenerateIssuePack() {
    if (selectedPackAccountIds.length === 0) {
      setPackError("최소 1개 계정을 선택하세요.");
      return;
    }
    if (!packSourceContext.trim()) {
      setPackError("오늘 자료를 입력하세요.");
      return;
    }

    setPackBusy(true);
    setPackError(null);
    setPackTemplateMessage(null);
    setPackScheduleResult(null);
    setPackResult(null);
    setPackProgress(null);
    let pollTimer: number | null = null;
    try {
      const requestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const totalTasks = selectedPackAccountIds.length * Number(packCountPerAccount || "3");
      setPackProgress({
        requestId,
        phase: "running",
        totalTasks,
        completedTasks: 0,
        message: `총 ${totalTasks}건 초안 생성 시작`,
        updatedAt: new Date().toISOString(),
      });

      const poll = async () => {
        const progressRes = await fetch(`/api/content-pack/generate?requestId=${encodeURIComponent(requestId)}`, {
          cache: "no-store",
        });
        if (!progressRes.ok) return;
        const progressJson = (await progressRes.json()) as { progress?: IssuePackProgress };
        if (progressJson.progress) setPackProgress(progressJson.progress);
      };

      pollTimer = window.setInterval(() => {
        void poll();
      }, 1200);
      void poll();

      const res = await fetch("/api/content-pack/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          accountIds: selectedPackAccountIds,
          sourceContext: packSourceContext,
          templatePrompt: packTemplatePrompt.trim() || undefined,
          countPerAccount: Number(packCountPerAccount || "3"),
          minGapMinutes: Number(packMinGapMinutes || "45"),
          maxGapMinutes: Number(packMaxGapMinutes || "90"),
          ctaRatioMinPercent: Number(packCtaRatioMin || "30"),
          ctaRatioMaxPercent: Number(packCtaRatioMax || "40"),
          aiProvider: packWritingAiProvider,
          aiModel: packWritingAiModel || undefined,
          writingAiProvider: packWritingAiProvider,
          writingAiModel: packWritingAiModel || undefined,
          startAt: packStartAt ? new Date(packStartAt).toISOString() : undefined,
        }),
      });
      if (pollTimer) window.clearInterval(pollTimer);
      await poll();
      const json = (await res.json()) as { error?: string; result?: IssuePackResult };
      if (!res.ok) throw new Error(json.error ?? "이슈팩 생성 실패");
      if (!json.result) throw new Error("이슈팩 응답이 비어 있습니다.");
      setPackResult(json.result);
      setPackProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: "done",
              completedTasks: prev.totalTasks,
              message: "초안 생성 완료",
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
    } catch (err) {
      setPackError(err instanceof Error ? err.message : String(err));
      setPackProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: "error",
              error: err instanceof Error ? err.message : String(err),
              message: "초안 생성 실패",
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
    } finally {
      if (pollTimer) window.clearInterval(pollTimer);
      setPackBusy(false);
    }
  }

  async function onScheduleAllPackDrafts() {
    if (!packResult || packResult.drafts.length === 0) {
      setPackError("예약할 초안이 없습니다.");
      return;
    }

    setPackScheduleBusy(true);
    setPackError(null);
    try {
      let created = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const draft of packResult.drafts) {
        const trimmedText = draft.text.trim();
        if (!trimmedText) {
          failed += 1;
          errors.push(`${draft.accountName}: 본문이 비어 있습니다.`);
          continue;
        }
        const res = await fetch("/api/scheduled-posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            threadsAccountId: draft.threadsAccountId,
            text: trimmedText,
            mediaType: "TEXT",
            scheduledAt: draft.scheduledAt,
          }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) {
          failed += 1;
          errors.push(`${draft.accountName}: ${json.error ?? "예약 실패"}`);
        } else {
          created += 1;
        }
      }

      setPackScheduleResult({ created, failed, errors });
      if (created > 0) {
        await load();
      }
    } catch (err) {
      setPackError(err instanceof Error ? err.message : String(err));
    } finally {
      setPackScheduleBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ids = (data?.accounts ?? []).map((acc) => acc.id);
    if (ids.length === 0) return;
    setSelectedPackAccountIds((prev) => (prev.length === 0 ? ids : prev.filter((id) => ids.includes(id))));
  }, [data?.accounts]);

  useEffect(() => {
    if (packWritingAiProvider === "auto") {
      if (packWritingAiModel !== "") setPackWritingAiModel("");
      return;
    }
    const options = getModelOptionsByProvider(packWritingAiProvider);
    const exists = options.some((opt) => opt.value === packWritingAiModel);
    if (!exists) {
      setPackWritingAiModel(options[0]?.value ?? "");
    }
  }, [packWritingAiProvider, packWritingAiModel]);

  useEffect(() => {
    if (!selectedPackTemplateId) return;
    const selected = promptTemplates.find((tpl) => tpl.id === selectedPackTemplateId);
    if (!selected) return;
    setPackTemplatePrompt((prev) => (prev.trim() ? prev : selected.prompt));
  }, [selectedPackTemplateId, promptTemplates]);

  const calendarMap = useMemo(() => {
    const map = new Map<string, CalendarItem>();
    for (const item of data?.calendarDays ?? []) {
      map.set(item.date, item);
    }
    return map;
  }, [data?.calendarDays]);

  const selectedSummary = calendarMap.get(selectedDay);
  const cells = useMemo(() => buildCalendarCells(month), [month]);

  const totalOverview = useMemo(() => {
    const accounts = data?.accounts ?? [];
    return {
      accounts: accounts.length,
      monthlyScheduled: accounts.reduce((sum, acc) => sum + acc.stats.monthlyScheduled, 0),
      monthlyPublished: accounts.reduce((sum, acc) => sum + acc.stats.monthlyPublished, 0),
      pending: accounts.reduce((sum, acc) => sum + acc.stats.pending + acc.stats.running, 0),
      failed: accounts.reduce((sum, acc) => sum + acc.stats.failed + acc.stats.partialFailed, 0),
      views: accounts.reduce((sum, acc) => sum + acc.stats.engagement.views, 0),
      likes: accounts.reduce((sum, acc) => sum + acc.stats.engagement.likes, 0),
      replies: accounts.reduce((sum, acc) => sum + acc.stats.engagement.replies, 0),
      reposts: accounts.reduce((sum, acc) => sum + acc.stats.engagement.reposts, 0),
    };
  }, [data?.accounts]);

  const packWritingModelOptions = useMemo(
    () => getModelOptionsByProvider(packWritingAiProvider),
    [packWritingAiProvider]
  );
  const packGenerationEstimate = useMemo(() => {
    const accountCount = selectedPackAccountIds.length;
    const countPerAccount = Math.max(1, Math.min(10, Number(packCountPerAccount || "0") || 0));
    const totalTasks = accountCount * countPerAccount;
    if (totalTasks <= 0) return null;

    const baseSecPerTask = packWritingAiProvider === "perplexity" ? 9 : 6;
    const parallel = 4;
    const minMinutes = Math.max(1, Math.ceil((totalTasks * baseSecPerTask * 0.8) / parallel / 60));
    const maxMinutes = Math.max(minMinutes + 1, Math.ceil((totalTasks * baseSecPerTask * 1.8) / parallel / 60));

    return {
      totalTasks,
      minMinutes,
      maxMinutes,
    };
  }, [selectedPackAccountIds.length, packCountPerAccount, packWritingAiProvider]);

  const aiUsage = data?.aiUsage ?? {
    daily: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
    weekly: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
    monthly: { requestCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, estimatedCostKrw: 0 },
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">연결 계정</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.accounts}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">이번 달 예약</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.monthlyScheduled}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">이번 달 발행 성공</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{totalOverview.monthlyPublished}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">대기/진행</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">{totalOverview.pending}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">실패/부분실패</div>
          <div className="mt-1 text-2xl font-semibold text-rose-700">{totalOverview.failed}</div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">AI 소모량 (일별 · KST)</div>
          <div className="mt-1 text-sm text-slate-700">요청 {num(aiUsage.daily.requestCount)}회</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{num(aiUsage.daily.totalTokens)} 토큰</div>
          <div className="mt-1 text-xs text-slate-600">
            예상 비용 {moneyUsd(aiUsage.daily.estimatedCostUsd)} · {moneyKrw(aiUsage.daily.estimatedCostKrw)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">AI 소모량 (주별 · KST)</div>
          <div className="mt-1 text-sm text-slate-700">요청 {num(aiUsage.weekly.requestCount)}회</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{num(aiUsage.weekly.totalTokens)} 토큰</div>
          <div className="mt-1 text-xs text-slate-600">
            예상 비용 {moneyUsd(aiUsage.weekly.estimatedCostUsd)} · {moneyKrw(aiUsage.weekly.estimatedCostKrw)}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">AI 소모량 (월별 · KST)</div>
          <div className="mt-1 text-sm text-slate-700">요청 {num(aiUsage.monthly.requestCount)}회</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{num(aiUsage.monthly.totalTokens)} 토큰</div>
          <div className="mt-1 text-xs text-slate-600">
            예상 비용 {moneyUsd(aiUsage.monthly.estimatedCostUsd)} · {moneyKrw(aiUsage.monthly.estimatedCostKrw)}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">도구 허브</h2>
            <p className="mt-1 text-sm text-slate-700">
              Threads 예약발행 외에도 카드뉴스 제작, 네이버 키워드 인사이트 같은 기능을 한곳에서 선택해 진입합니다.
            </p>
          </div>
          <Link
            href="/tools"
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            도구 허브 열기
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">수동 자료 기반 다계정 초안 생성</h2>
            <p className="mt-1 text-sm text-slate-600">
              저장 프롬프트 + 오늘 자료를 입력하면 계정별 INFO/CTA 초안을 만들고, 검토 후 한 번에 예약합니다.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setSelectedPackAccountIds((data?.accounts ?? []).map((acc) => acc.id))}
              disabled={packBusy || packScheduleBusy || (data?.accounts ?? []).length === 0}
            >
              전체 선택
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setSelectedPackAccountIds([])}
              disabled={packBusy || packScheduleBusy || selectedPackAccountIds.length === 0}
            >
              선택 해제
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">계정 선택</div>
            <div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
              {(data?.accounts ?? []).map((acc) => {
                const name = acc.label ?? acc.threadsUsername ?? acc.threadsUserId ?? acc.id;
                const checked = selectedPackAccountIds.includes(acc.id);
                return (
                  <label key={acc.id} className="flex cursor-pointer items-center justify-between gap-2 text-sm text-slate-700">
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePackAccount(acc.id)}
                        disabled={packBusy || packScheduleBusy}
                      />
                      <span>{name}</span>
                    </span>
                    <span className="text-xs text-slate-500">@{acc.threadsUsername ?? "-"}</span>
                  </label>
                );
              })}
              {(data?.accounts ?? []).length === 0 ? (
                <div className="text-xs text-slate-500">연결된 계정이 없습니다.</div>
              ) : null}
            </div>
            <div className="text-xs text-slate-500">선택 {selectedPackAccountIds.length}개 계정</div>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">저장 프롬프트 템플릿</div>
              <select
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                value={selectedPackTemplateId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedPackTemplateId(nextId);
                  const selected = promptTemplates.find((tpl) => tpl.id === nextId);
                  setPackTemplatePrompt(selected?.prompt ?? "");
                  setPackTemplateMessage(null);
                }}
                disabled={packBusy || packScheduleBusy}
              >
                <option value="">템플릿 미사용 (직접 입력만 사용)</option>
                {promptTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-slate-500">템플릿은 계정 워크스페이스에서 저장한 글작성 지시문입니다.</div>
              <textarea
                className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                value={packTemplatePrompt}
                onChange={(e) => {
                  setPackTemplatePrompt(e.target.value);
                  setPackTemplateMessage(null);
                }}
                disabled={packBusy || packScheduleBusy}
                placeholder="이번 생성에 사용할 프롬프트를 여기서 바로 수정하세요."
              />
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500">현재 {packTemplatePrompt.length} / 4000자</div>
                <button
                  type="button"
                  onClick={onSavePackTemplatePrompt}
                  disabled={packBusy || packScheduleBusy || packTemplateBusy || !selectedPackTemplateId}
                  className="inline-flex h-8 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {packTemplateBusy ? "저장 중..." : "선택 템플릿에 저장"}
                </button>
              </div>
              {packTemplateMessage ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">{packTemplateMessage}</div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">오늘 자료 입력(필수)</div>
              <textarea
                className="min-h-48 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                value={packSourceContext}
                onChange={(e) => setPackSourceContext(e.target.value)}
                disabled={packBusy || packScheduleBusy}
                placeholder="오늘 조사한 뉴스/메모/지표를 그대로 붙여넣으세요."
              />
              <div className="text-[11px] text-slate-500">현재 {packSourceContext.length} / 12000자</div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">생성 설정</div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">계정당 생성 수</div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packCountPerAccount}
                  onChange={(e) => setPackCountPerAccount(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">첫 예약 시작 시각</div>
                <input
                  type="datetime-local"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packStartAt}
                  onChange={(e) => setPackStartAt(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">최소 간격(분)</div>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packMinGapMinutes}
                  onChange={(e) => setPackMinGapMinutes(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">최대 간격(분)</div>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packMaxGapMinutes}
                  onChange={(e) => setPackMaxGapMinutes(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">CTA 최소 비율(%)</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packCtaRatioMin}
                  onChange={(e) => setPackCtaRatioMin(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">CTA 최대 비율(%)</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packCtaRatioMax}
                  onChange={(e) => setPackCtaRatioMax(e.target.value)}
                  disabled={packBusy || packScheduleBusy}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">글작성 AI</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packWritingAiProvider}
                  onChange={(e) => setPackWritingAiProvider(e.target.value as AiProviderInput)}
                  disabled={packBusy || packScheduleBusy}
                >
                  <option value="perplexity">Perplexity</option>
                  <option value="gemini">Gemini</option>
                  <option value="auto">AI 자동 선택</option>
                </select>
                <select
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={packWritingAiModel}
                  onChange={(e) => setPackWritingAiModel(e.target.value)}
                  disabled={packBusy || packScheduleBusy || packWritingAiProvider === "auto"}
                >
                  <option value="">기본 모델</option>
                  {packWritingModelOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={onGenerateIssuePack}
              disabled={packBusy || packScheduleBusy || selectedPackAccountIds.length === 0}
              className="inline-flex h-10 w-full items-center justify-center rounded-full bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {packBusy ? "초안 생성 중..." : "초안 생성"}
            </button>
            {packGenerationEstimate ? (
              <div className="text-[11px] text-slate-500">
                현재 설정: 총 {packGenerationEstimate.totalTasks}건 생성 예정 · 예상 {packGenerationEstimate.minMinutes}~{packGenerationEstimate.maxMinutes}분
              </div>
            ) : null}
            {packProgress ? (
              <div className="space-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>
                    진행률 {packProgress.completedTasks}/{packProgress.totalTasks}
                  </span>
                  <span className="font-semibold">
                    {packProgress.totalTasks > 0
                      ? Math.min(100, Math.round((packProgress.completedTasks / packProgress.totalTasks) * 100))
                      : 0}
                    %
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${
                      packProgress.phase === "error" ? "bg-rose-500" : packProgress.phase === "done" ? "bg-emerald-500" : "bg-blue-500"
                    }`}
                    style={{
                      width: `${
                        packProgress.totalTasks > 0
                          ? Math.min(100, Math.round((packProgress.completedTasks / packProgress.totalTasks) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  {packProgress.message ?? "-"}
                  {packProgress.accountName ? ` · ${packProgress.accountName}` : ""}
                  {packProgress.contentType ? ` · ${packProgress.contentType}` : ""}
                </div>
              </div>
            ) : null}
            <div className="text-[11px] text-slate-500">
              생성 후에는 아래 미리보기에서 내용을 확인하고, &quot;선택 계정 전체 예약&quot; 버튼으로 예약 목록에 등록하세요.
            </div>
          </div>
        </div>

        {packResult ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">생성 요약</div>
                <div className="text-xs text-slate-600">
                  AI {packResult.ai.provider}/{packResult.ai.model} · 글작성 AI {packResult.writingAi.provider}/{packResult.writingAi.model}
                </div>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{packResult.contextSummary || "-"}</div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-slate-700">생성 초안 {packResult.drafts.length}건</div>
              <button
                type="button"
                onClick={onScheduleAllPackDrafts}
                disabled={packScheduleBusy || packBusy || packResult.drafts.length === 0}
                className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                선택 계정 전체 예약
              </button>
            </div>

            <div className="space-y-3">
              {packResult.drafts.map((draft, idx) => (
                <div key={draft.draftId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1">#{idx + 1}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1">{draft.accountName}</span>
                      <span
                        className={`rounded-full px-2 py-1 ${
                          draft.contentType === "CTA" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {draft.contentType}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-7 items-center justify-center rounded-full border border-rose-200 px-2.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
                      onClick={() => removePackDraft(draft.draftId)}
                      disabled={packScheduleBusy || packBusy}
                    >
                      초안 제거
                    </button>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-[200px_1fr]">
                    <div className="text-[11px] text-slate-500">예약 시각</div>
                    <input
                      type="datetime-local"
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs outline-none focus:border-slate-400"
                      value={fromIsoToDatetimeLocalValue(draft.scheduledAt)}
                      onChange={(e) => {
                        const parsed = new Date(e.target.value);
                        if (Number.isNaN(parsed.getTime())) return;
                        updatePackDraft(draft.draftId, { scheduledAt: parsed.toISOString() });
                      }}
                      disabled={packScheduleBusy || packBusy}
                    />
                  </div>

                  <textarea
                    className="mt-2 min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                    value={draft.text}
                    maxLength={500}
                    onChange={(e) => updatePackDraft(draft.draftId, { text: e.target.value })}
                    disabled={packScheduleBusy || packBusy}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">본문 {draft.text.length} / 500자</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {packScheduleResult ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            예약 결과: 성공 {packScheduleResult.created}건 / 실패 {packScheduleResult.failed}건
            {packScheduleResult.errors.length > 0 ? (
              <div className="mt-1 space-y-1 text-xs text-rose-700">
                {packScheduleResult.errors.slice(0, 10).map((err) => (
                  <div key={err}>• {err}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {packError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{packError}</div> : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">계정별 워크스페이스</h2>
            <p className="mt-1 text-sm text-slate-600">글 작성은 계정 카드를 클릭해서 진입한 상세 페이지에서만 진행합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/tools"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              도구 허브
            </Link>
            <a
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800"
              href="/api/auth/threads/start"
            >
              Threads 계정 추가 연결
            </a>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {(data?.accounts ?? []).map((acc) => {
            const name = acc.label ?? acc.threadsUsername ?? acc.threadsUserId ?? acc.id;
            return (
              <Link
                key={acc.id}
                href={`/dashboard/accounts/${acc.id}`}
                className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-300 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold text-slate-900">{name}</div>
                    <div className="mt-1 text-xs text-slate-500">@{acc.threadsUsername ?? "-"} · uid {acc.threadsUserId ?? "-"}</div>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700 group-hover:bg-blue-600 group-hover:text-white">
                    열기
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">이번달 예약</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{acc.stats.monthlyScheduled}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">이번달 발행</div>
                    <div className="mt-1 text-sm font-semibold text-emerald-700">{acc.stats.monthlyPublished}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">대기/진행</div>
                    <div className="mt-1 text-sm font-semibold text-amber-700">{acc.stats.pending + acc.stats.running}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">실패/부분실패</div>
                    <div className="mt-1 text-sm font-semibold text-rose-700">{acc.stats.failed + acc.stats.partialFailed}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">팔로워</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">
                      {typeof acc.followerStats.currentFollowers === "number" ? num(acc.followerStats.currentFollowers) : "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">일별 팔로워 증감</div>
                    <div className={`mt-1 text-sm font-semibold ${signedDeltaClass(acc.followerStats.dailyDelta)}`}>
                      {signedDelta(acc.followerStats.dailyDelta)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">이번 주 누적 팔로워 증감</div>
                    <div className={`mt-1 text-sm font-semibold ${signedDeltaClass(acc.followerStats.weeklyDelta)}`}>
                      {signedDelta(acc.followerStats.weeklyDelta)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="text-slate-500">팔로워 기준일</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{acc.followerStats.latestDateKst ?? "-"}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-600">
                  <span className="rounded-full bg-slate-200 px-2 py-1">프록시 {acc.hasProxy ? "설정" : "미설정"}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-1">조회 {acc.stats.engagement.views}</span>
                  <span className="rounded-full bg-slate-200 px-2 py-1">좋아요 {acc.stats.engagement.likes}</span>
                </div>
              </Link>
            );
          })}
          {(data?.accounts ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              아직 계정이 없습니다. 상단의 &quot;Threads 계정 추가 연결&quot; 버튼으로 시작하세요.
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">엑셀 일괄 예약 (다계정)</h2>
            <p className="mt-1 text-sm text-slate-600">
              엑셀 1개에 여러 계정을 넣어 미리보기 후 일괄 예약할 수 있습니다.
            </p>
          </div>
          <a
            className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            href="/templates/scheduled-posts-import-template.csv"
            download
          >
            템플릿 CSV 다운로드
          </a>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setImportFile(file);
              setImportError(null);
              setImportCommitResult(null);
              setImportPreview(null);
            }}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium"
            disabled={importBusy}
          />
          <button
            type="button"
            onClick={onPreviewBulkImport}
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={importBusy || !importFile}
          >
            미리보기
          </button>
          <button
            type="button"
            onClick={onCommitBulkImport}
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={importBusy || !importPreview || importPreview.validItems.length === 0}
          >
            일괄 예약 등록
          </button>
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={importUseAutoSchedule}
              onChange={(e) => {
                setImportUseAutoSchedule(e.target.checked);
                setImportPreview(null);
                setImportCommitResult(null);
              }}
              disabled={importBusy}
            />
            <span className="font-medium">엑셀 시간 무시하고 자동 시간 배정 사용</span>
          </label>
          {importUseAutoSchedule ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">첫 예약 시작 시각</div>
                <input
                  type="datetime-local"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={importStartAt}
                  onChange={(e) => {
                    setImportStartAt(e.target.value);
                    setImportPreview(null);
                    setImportCommitResult(null);
                  }}
                  disabled={importBusy}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">최소 간격(분)</div>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={importMinGapMinutes}
                  onChange={(e) => {
                    setImportMinGapMinutes(e.target.value);
                    setImportPreview(null);
                    setImportCommitResult(null);
                  }}
                  disabled={importBusy}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-slate-600">최대 간격(분)</div>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                  value={importMaxGapMinutes}
                  onChange={(e) => {
                    setImportMaxGapMinutes(e.target.value);
                    setImportPreview(null);
                    setImportCommitResult(null);
                  }}
                  disabled={importBusy}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-2 text-xs text-slate-500">
          필수 컬럼: <span className="font-semibold">account, text</span>
          {" "}· 선택 컬럼: <span className="font-semibold">reply1, reply2, reply3 ...</span>
          {importUseAutoSchedule ? (
            <>
              {" "}
              · <span className="font-semibold">scheduledAt는 비워도 자동 배정</span>
            </>
          ) : (
            <>
              {" "}
              · <span className="font-semibold">scheduledAt 필수</span> · 시간 형식 예:{" "}
              <span className="font-semibold">2026-03-01 09:30 / 2026.3.1 오전 9:30 / 2026-03-01</span>
            </>
          )}
        </div>

        {importPreview ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                전체 행 <span className="ml-1 font-semibold text-slate-900">{importPreview.totalRows}</span>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                유효 행 <span className="ml-1 font-semibold">{importPreview.validRows}</span>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                오류 행 <span className="ml-1 font-semibold">{importPreview.invalidRows}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">계정별 예약 건수(유효 행)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {importPreview.byAccount.length > 0 ? (
                  importPreview.byAccount.map((item) => (
                    <span key={item.accountId} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700">
                      {item.accountName}: {item.validCount}건
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500">유효한 계정 매칭이 없습니다.</span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-2 text-left">행</th>
                    <th className="px-2 py-2 text-left">계정</th>
                    <th className="px-2 py-2 text-left">예약시간</th>
                    <th className="px-2 py-2 text-left">본문</th>
                    <th className="px-2 py-2 text-left">댓글</th>
                    <th className="px-2 py-2 text-left">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.items.slice(0, 200).map((row) => (
                    <tr key={`${row.rowNumber}-${row.accountInput}-${row.scheduledAtInput}`} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2 text-slate-500">{row.rowNumber}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium text-slate-900">{row.accountName ?? "-"}</div>
                        <div className="text-[11px] text-slate-500">{row.accountInput || "(빈값)"}</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-slate-700">{row.scheduledAtInput || (importPreview.timeMode === "auto" ? "자동 배정" : "-")}</div>
                        <div className="text-[11px] text-slate-500">{row.scheduledAtIso ? new Date(row.scheduledAtIso).toLocaleString() : "-"}</div>
                      </td>
                      <td className="max-w-[420px] px-2 py-2">
                        <div className="whitespace-pre-wrap break-words text-slate-700">{row.text || "-"}</div>
                      </td>
                      <td className="max-w-[320px] px-2 py-2">
                        {row.replies.length > 0 ? (
                          <div className="space-y-2">
                            {row.replies.map((reply, index) => (
                              <div key={`${row.rowNumber}-reply-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                <div className="text-[11px] font-semibold text-slate-500">댓글 {index + 1}</div>
                                <div className="mt-1 whitespace-pre-wrap break-words text-slate-700">{reply.text}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">없음</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {row.errors.length === 0 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">유효</span>
                        ) : (
                          <div className="space-y-1">
                            {row.errors.map((err) => (
                              <div key={err} className="text-[11px] text-rose-700">
                                • {err}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importPreview.items.length > 200 ? (
              <div className="text-xs text-slate-500">미리보기는 200행까지만 표시됩니다. (전체 검증/등록은 모두 반영)</div>
            ) : null}
          </div>
        ) : null}

        {importCommitResult ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">
              일괄 등록 결과: 성공 {importCommitResult.created}건 / 실패 {importCommitResult.failed}건 / 총 {importCommitResult.total}건
            </div>
            {importCommitResult.failed > 0 ? (
              <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                {importCommitResult.results
                  .filter((item) => item.error)
                  .slice(0, 50)
                  .map((item) => (
                    <div key={`${item.rowNumber}-${item.threadsAccountId}-${item.error}`}>
                      행 {item.rowNumber}: {item.error}
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {importError ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{importError}</div> : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">월간 발행 캘린더</h2>
            <p className="mt-1 text-sm text-slate-600">날짜를 클릭하면 계정별 예약/성공/실패 수를 확인할 수 있습니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
              className="h-9 rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              disabled={busy}
            >
              이전달
            </button>
            <div className="min-w-28 text-center text-sm font-semibold text-slate-800">{monthLabel(month)}</div>
            <button
              type="button"
              onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
              className="h-9 rounded-full border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              disabled={busy}
            >
              다음달
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-500">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {cells.map((cell) => {
            const summary = calendarMap.get(cell.key);
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => setSelectedDay(cell.key)}
                className={`min-h-[86px] rounded-xl border px-2 py-2 text-left transition ${
                  cell.inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-400"
                } ${selectedDay === cell.key ? "ring-2 ring-blue-500" : "hover:border-slate-300"}`}
              >
                <div className="text-xs font-semibold">{cell.day}</div>
                <div className="mt-2 text-[11px] text-slate-600">{summary ? `총 ${summary.total}건` : ""}</div>
                {summary?.byAccount?.[0] ? (
                  <div className="mt-1 truncate text-[10px] text-slate-500">{summary.byAccount[0].accountName}</div>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">{selectedDay} 계정별 현황</div>
          <div className="mt-3 space-y-2">
            {(selectedSummary?.byAccount ?? []).map((item) => (
              <div key={item.accountId} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="text-sm font-medium text-slate-900">{item.accountName}</div>
                <div className="mt-1 text-xs text-slate-600">
                  예약 {item.total} · 성공 {item.success} · 대기 {item.pending} · 실패 {item.failed}
                </div>
              </div>
            ))}
            {!selectedSummary ? (
              <div className="text-xs text-slate-500">선택한 날짜의 예약 데이터가 없습니다.</div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">누적 조회수</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.views.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">누적 좋아요</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.likes.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">누적 댓글</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.replies.toLocaleString()}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">누적 리포스트</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{totalOverview.reposts.toLocaleString()}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">성과 기반 자동 최적화 (전체 계정 통합)</h2>
            <p className="mt-1 text-sm text-slate-600">
              최근 발행 글 전체를 기준으로 시간대/글 길이/글 타입 성과를 집계합니다.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            표본 {data?.optimization?.totalPosted ?? 0}건 · 평균 점수 {(data?.optimization?.overallAverageScore ?? 0).toFixed(1)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="text-xs font-semibold text-emerald-700">추천 시간대 TOP3</div>
            <div className="mt-1 text-emerald-900">
              {(data?.optimization?.recommendations.bestHours ?? []).map((item) => item.label).join(", ") || "-"}
            </div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
            <div className="text-xs font-semibold text-blue-700">추천 글 길이</div>
            <div className="mt-1 text-blue-900">{data?.optimization?.recommendations.bestLength?.label ?? "-"}</div>
          </div>
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
            <div className="text-xs font-semibold text-violet-700">추천 글 타입</div>
            <div className="mt-1 text-violet-900">{data?.optimization?.recommendations.bestStyle?.label ?? "-"}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          {[
            { title: "시간대 성과", rows: data?.optimization?.byHour ?? [] },
            { title: "글 길이 성과", rows: data?.optimization?.byLength ?? [] },
            { title: "글 타입 성과", rows: data?.optimization?.byStyle ?? [] },
          ].map((section) => (
            <div key={section.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold text-slate-900">{section.title}</div>
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="border-b border-slate-200 px-2 py-2 text-left">구분</th>
                      <th className="border-b border-slate-200 px-2 py-2 text-right">표본</th>
                      <th className="border-b border-slate-200 px-2 py-2 text-right">평균 조회</th>
                      <th className="border-b border-slate-200 px-2 py-2 text-right">평균 반응률</th>
                      <th className="border-b border-slate-200 px-2 py-2 text-right">평균 점수</th>
                      <th className="border-b border-slate-200 px-2 py-2 text-left">워딩 샘플</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.slice(0, 8).map((row, idx) => (
                      <tr key={row.key} className={idx === 0 ? "bg-amber-50/70" : ""}>
                        <td className="border-b border-slate-100 px-2 py-2 text-slate-700">{row.label}</td>
                        <td className="border-b border-slate-100 px-2 py-2 text-right text-slate-700">{row.posts}</td>
                        <td className="border-b border-slate-100 px-2 py-2 text-right text-slate-700">
                          {Math.round(row.avgViews).toLocaleString()}
                        </td>
                        <td className="border-b border-slate-100 px-2 py-2 text-right text-slate-700">{pct(row.avgEngagementRate)}</td>
                        <td className="border-b border-slate-100 px-2 py-2 text-right font-semibold text-slate-900">
                          {row.avgScore.toFixed(1)}
                        </td>
                        <td className="border-b border-slate-100 px-2 py-2 align-top">
                          {row.examples?.length ? (
                            <details className="max-w-[360px]">
                              <summary className="cursor-pointer text-[11px] font-medium text-blue-700 hover:text-blue-800">
                                상위 워딩 {Math.min(3, row.examples.length)}개 보기
                              </summary>
                              <div className="mt-2 space-y-2">
                                {row.examples.slice(0, 3).map((sample, sampleIndex) => (
                                  <div key={sample.postId} className="rounded-lg border border-slate-200 bg-white p-2">
                                    <div className="text-[10px] text-slate-500">
                                      {sampleIndex + 1}. {sample.accountName} · {new Date(sample.scheduledAt).toLocaleDateString()} ·
                                      {" "}조회 {sample.views} · 점수 {sample.score.toFixed(1)}
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-700">{sample.text}</div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          ) : (
                            <span className="text-[11px] text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {section.rows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-4 text-center text-slate-500">
                          성과 집계 데이터가 없습니다.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
    </div>
  );
}
