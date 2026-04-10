"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ThreadsAccount = {
  id: string;
  label: string | null;
  threadsUserId: string | null;
  threadsUsername: string | null;
  hasProxy: boolean;
  tokenExpiresAt: string;
  followerStats?: {
    currentFollowers: number | null;
    dailyDelta: number | null;
    weeklyDelta: number | null;
    weekStartDateKst: string | null;
    weekEndDateKst: string | null;
    latestDateKst: string | null;
    latestCapturedAt: string | null;
    daysTracked: number;
  };
  workspaceStats?: {
    todayPublishedCount: number;
  };
};

type PostAccount = {
  id: string;
  label: string | null;
  threadsUserId: string | null;
  threadsUsername: string | null;
};

type ScheduledPost = {
  id: string;
  text: string;
  mediaType: "TEXT" | "IMAGE" | "VIDEO";
  mediaUrl: string | null;
  scheduledAt: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL_FAILED";
  remotePostId: string | null;
  remoteCommentId: string | null;
  viewsCount: number;
  likesCount: number;
  repliesCount: number;
  repostsCount: number;
  quotesCount: number;
  insightsUpdatedAt: string | null;
  insightsLastError: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  replies: Array<{
    id: string;
    orderIndex: number;
    text: string;
    status: "PENDING" | "SUCCESS" | "FAILED";
    remoteReplyId: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  account: PostAccount | null;
};

type ReplyDraft = {
  id: string;
  text: string;
};

type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

type DailyTopicPlan = {
  id: string;
  threadsAccountId: string;
  topic: string;
  promptHint: string | null;
  ctaText: string | null;
  contentType: "TOPIC" | "INFO" | "CTA";
  dailyCount: number;
  intervalMinMinutes: number;
  intervalMaxMinutes: number;
  windowStartHour: number;
  windowEndHour: number;
  weekdays: number[];
  infoRatioPercent: number;
  ctaRatioPercent: number;
  similarityThresholdPct: number;
  telegramOnError: boolean;
  enabled: boolean;
  lastGeneratedDate: string | null;
  lastGeneratedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type DailyPlannerRunResult = {
  nowKstKey: string;
  scannedPlans: number;
  processedPlans: number;
  createdPosts: number;
  regeneratedBySimilarity: number;
  highSimilarityWarnings: number;
  skippedPlans: number;
  errors: string[];
  createdPostDetails: Array<{
    postId: string;
    planId: string;
    accountId: string;
    accountName: string;
    topic: string;
    contentType: "TOPIC" | "INFO" | "CTA";
    scheduledAt: string;
    similarityScore: number;
    similarityThreshold: number;
    regeneratedAttempts: number;
    text: string;
  }>;
  omittedDetailCount: number;
};

type GeneratedDraft = {
  id: string;
  text: string;
  scheduledAt: string;
};

function toDatetimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function randomIntBetween(min: number, max: number) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function createReplyDraft(): ReplyDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: "",
  };
}

const GEMINI_MODEL_OPTIONS = [
  { value: "gemini-3.0-pro-preview", label: "gemini-3.0-pro-preview" },
  { value: "gemini-3.0-flash-preview", label: "gemini-3.0-flash-preview" },
  { value: "gemini-2.0-flash", label: "gemini-2.0-flash" },
  { value: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite" },
  { value: "gemini-1.5-flash", label: "gemini-1.5-flash" },
];

const PERPLEXITY_MODEL_OPTIONS = [
  { value: "sonar", label: "sonar" },
  { value: "sonar-pro", label: "sonar-pro" },
];

const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
  { value: 6, label: "토" },
  { value: 7, label: "일" },
];

function badgeClasses(status: ScheduledPost["status"]) {
  switch (status) {
    case "PENDING":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "RUNNING":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "SUCCESS":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "FAILED":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "PARTIAL_FAILED":
      return "bg-amber-50 text-amber-800 border-amber-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function canEditScheduledPost(post: ScheduledPost) {
  return post.status === "PENDING" && !post.remotePostId;
}

function formatSignedDelta(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const n = Math.trunc(value);
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `-${Math.abs(n).toLocaleString()}`;
  return "0";
}

function signedDeltaTextClass(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.trunc(value) === 0) return "text-slate-900";
  return value > 0 ? "text-emerald-700" : "text-rose-700";
}

type Tab = "content" | "performance" | "settings";

export default function AccountWorkspaceClient({ accountId }: { accountId: string }) {
  const router = useRouter();
  const didInitialLoad = useRef(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("content");

  const [threadsAccounts, setThreadsAccounts] = useState<ThreadsAccount[]>([]);
  const [account, setAccount] = useState<ThreadsAccount | null>(null);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyTopicPlan[]>([]);

  const [accountLabel, setAccountLabel] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  const defaultScheduledAt = useMemo(() => toDatetimeLocalValue(new Date(Date.now() + 5 * 60 * 1000)), []);

  const [text, setText] = useState("");
  const [mediaType, setMediaType] = useState<ScheduledPost["mediaType"]>("TEXT");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<ReplyDraft[]>([]);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [editingPostId, setEditingPostId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editingScheduledAt, setEditingScheduledAt] = useState("");
  const [editingReplyDrafts, setEditingReplyDrafts] = useState<ReplyDraft[]>([]);

  const [templateName, setTemplateName] = useState("");
  const [templatePrompt, setTemplatePrompt] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [issuePrompt, setIssuePrompt] = useState("오늘 이슈 시황 알려줘");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [generateCount, setGenerateCount] = useState("3");
  const [draftIntervalMinMinutes, setDraftIntervalMinMinutes] = useState("45");
  const [draftIntervalMaxMinutes, setDraftIntervalMaxMinutes] = useState("90");
  const [aiProvider, setAiProvider] = useState<"auto" | "gemini" | "perplexity">("auto");
  const [aiModel, setAiModel] = useState("");
  const [aiUsed, setAiUsed] = useState<{ provider: string; model: string } | null>(null);
  const [briefing, setBriefing] = useState("");
  const [generatedDrafts, setGeneratedDrafts] = useState<GeneratedDraft[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [autoTopic, setAutoTopic] = useState("해외선물");
  const [autoPromptHint, setAutoPromptHint] = useState("");
  const [autoCtaText, setAutoCtaText] = useState("");
  const [autoDailyCount, setAutoDailyCount] = useState("8");
  const [autoIntervalMin, setAutoIntervalMin] = useState("60");
  const [autoIntervalMax, setAutoIntervalMax] = useState("90");
  const [autoWindowStartHour, setAutoWindowStartHour] = useState("9");
  const [autoWindowEndHour, setAutoWindowEndHour] = useState("23");
  const [autoInfoRatio, setAutoInfoRatio] = useState("70");
  const [autoCtaRatio, setAutoCtaRatio] = useState("30");
  const [autoSimilarityThreshold, setAutoSimilarityThreshold] = useState("72");
  const [autoWeekdays, setAutoWeekdays] = useState<number[]>([1, 3, 5]);
  const [autoTelegramOnError, setAutoTelegramOnError] = useState(true);
  const [dailyPlannerRunResult, setDailyPlannerRunResult] = useState<DailyPlannerRunResult | null>(null);
  const [planThresholdDrafts, setPlanThresholdDrafts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const [accountRes, postsRes, templatesRes, plansRes] = await Promise.all([
        fetch(`/api/threads-accounts/${accountId}`, { method: "GET", cache: "no-store" }),
        fetch(`/api/scheduled-posts?threadsAccountId=${accountId}`, { method: "GET", cache: "no-store" }),
        fetch("/api/prompt-templates", { method: "GET", cache: "no-store" }),
        fetch(`/api/daily-topic-plans?threadsAccountId=${accountId}`, { method: "GET", cache: "no-store" }),
      ]);

      const accountData = await accountRes.json();
      if (!accountRes.ok) throw new Error(accountData?.error ?? "계정 정보를 불러오지 못했습니다.");

      const postsData = await postsRes.json();
      if (!postsRes.ok) throw new Error(postsData?.error ?? "예약 목록을 불러오지 못했습니다.");

      const templatesData = await templatesRes.json();
      if (!templatesRes.ok) throw new Error(templatesData?.error ?? "템플릿을 불러오지 못했습니다.");
      const plansData = await plansRes.json();
      if (!plansRes.ok) throw new Error(plansData?.error ?? "자동 플랜을 불러오지 못했습니다.");

      const loadedAccount = accountData?.account as ThreadsAccount | undefined;
      if (!loadedAccount) throw new Error("계정을 찾을 수 없습니다.");

      setAccount(loadedAccount);
      setAccountLabel(loadedAccount.label ?? loadedAccount.threadsUsername ?? "");
      setThreadsAccounts((postsData?.threadsAccounts as ThreadsAccount[]) ?? []);
      setPosts((postsData?.posts as ScheduledPost[]) ?? []);

      const templates = (templatesData?.templates as PromptTemplate[]) ?? [];
      setPromptTemplates(templates);
      if (selectedTemplateId && !templates.some((tpl) => tpl.id === selectedTemplateId)) {
        setSelectedTemplateId("");
      }
      if (editingTemplateId && !templates.some((tpl) => tpl.id === editingTemplateId)) {
        setEditingTemplateId("");
      }
      setDailyPlans((plansData?.plans as DailyTopicPlan[]) ?? []);
      setPlanThresholdDrafts((prev) => {
        const next = { ...prev };
        const plans = (plansData?.plans as DailyTopicPlan[]) ?? [];
        for (const plan of plans) {
          if (!next[plan.id]) next[plan.id] = String(plan.similarityThresholdPct ?? 72);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [accountId, selectedTemplateId, editingTemplateId]);

  useEffect(() => {
    if (didInitialLoad.current) return;
    didInitialLoad.current = true;
    void refresh();
  }, [refresh]);

  async function uploadMedia(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/uploads/media", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "업로드 실패");
    if (!data?.url) throw new Error("업로드 URL이 비어 있습니다.");
    return data.url as string;
  }

  async function createScheduledPost(targetScheduledAt: string, options?: { immediate?: boolean }) {
    let resolvedMediaUrl = mediaUrl.trim() || undefined;
    if ((mediaType === "IMAGE" || mediaType === "VIDEO") && !resolvedMediaUrl && mediaFile) {
      resolvedMediaUrl = await uploadMedia(mediaFile);
      setMediaUrl(resolvedMediaUrl);
    }

    const replies = replyDrafts
      .map((reply) => reply.text.trim())
      .filter((replyText) => replyText.length > 0)
      .map((replyText) => ({ text: replyText }));

    const payload = {
      threadsAccountId: accountId,
      text,
      mediaType,
      mediaUrl: resolvedMediaUrl,
      immediate: options?.immediate === true,
      replies,
      scheduledAt: (() => {
        const d = new Date(targetScheduledAt);
        return Number.isNaN(d.getTime()) ? targetScheduledAt : d.toISOString();
      })(),
    };

    const res = await fetch("/api/scheduled-posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "예약 생성 실패");
  }

  function resetComposer() {
    setText("");
    setMediaUrl("");
    setMediaFile(null);
    setReplyDrafts([]);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createScheduledPost(scheduledAt);
      resetComposer();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPublishNow() {
    setBusy(true);
    setError(null);
    try {
      await createScheduledPost(new Date().toISOString(), { immediate: true });
      resetComposer();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRetry(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduled-posts/${id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "재시도 실패");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function addReplyDraft() {
    setReplyDrafts((prev) => [...prev, createReplyDraft()]);
  }

  function updateReplyDraft(id: string, textValue: string) {
    setReplyDrafts((prev) => prev.map((reply) => (reply.id === id ? { ...reply, text: textValue } : reply)));
  }

  function removeReplyDraft(id: string) {
    setReplyDrafts((prev) => prev.filter((reply) => reply.id !== id));
  }

  function startEditScheduledPost(post: ScheduledPost) {
    setEditingPostId(post.id);
    setEditingText(post.text);
    setEditingScheduledAt(toDatetimeLocalValue(new Date(post.scheduledAt)));
    setEditingReplyDrafts(
      post.replies.map((reply) => ({
        id: reply.id,
        text: reply.text,
      }))
    );
  }

  function cancelEditScheduledPost() {
    setEditingPostId("");
    setEditingText("");
    setEditingScheduledAt("");
    setEditingReplyDrafts([]);
  }

  function addEditingReplyDraft() {
    setEditingReplyDrafts((prev) => [...prev, createReplyDraft()]);
  }

  function updateEditingReplyDraft(id: string, textValue: string) {
    setEditingReplyDrafts((prev) => prev.map((reply) => (reply.id === id ? { ...reply, text: textValue } : reply)));
  }

  function removeEditingReplyDraft(id: string) {
    setEditingReplyDrafts((prev) => prev.filter((reply) => reply.id !== id));
  }

  async function saveScheduledPostEdit(postId: string) {
    const replies = editingReplyDrafts
      .map((reply) => reply.text.trim())
      .filter((replyText) => replyText.length > 0)
      .map((replyText) => ({ text: replyText }));

    const res = await fetch(`/api/scheduled-posts/${postId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: editingText,
        replies,
        scheduledAt: (() => {
          const d = new Date(editingScheduledAt);
          return Number.isNaN(d.getTime()) ? editingScheduledAt : d.toISOString();
        })(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "예약 수정 실패");
  }

  async function onSaveScheduledPostEdit(postId: string) {
    setBusy(true);
    setError(null);
    try {
      await saveScheduledPostEdit(postId);
      cancelEditScheduledPost();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteScheduledPost(post: ScheduledPost) {
    const ok = window.confirm("이 예약 글을 삭제할까요? 삭제 후 복구할 수 없습니다.");
    if (!ok) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scheduled-posts/${post.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "예약 삭제 실패");
      if (editingPostId === post.id) cancelEditScheduledPost();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveAccountSettings() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads-accounts/${accountId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: accountLabel, proxyUrl: proxyUrl || "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "계정 설정 저장 실패");
      setProxyUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteAccount() {
    if (!account) return;

    const name = account.label ?? account.threadsUsername ?? account.threadsUserId ?? account.id;
    const firstConfirm = window.confirm(`Threads 계정 "${name}"을 삭제할까요?`);
    if (!firstConfirm) return;

    setBusy(true);
    setError(null);
    try {
      let res = await fetch(`/api/threads-accounts/${accountId}`, { method: "DELETE" });
      let data = await res.json();

      if (res.status === 409) {
        const scheduled = Number(data?.counts?.scheduledPosts ?? 0);
        const secondConfirm = window.confirm(`이 계정에 연결된 예약 ${scheduled}건과 관련 데이터가 함께 삭제됩니다. 계속할까요?`);
        if (!secondConfirm) return;

        res = await fetch(`/api/threads-accounts/${accountId}?force=1`, { method: "DELETE" });
        data = await res.json();
      }

      if (!res.ok) throw new Error(data?.error ?? "계정 삭제 실패");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function resetTemplateForm() {
    setTemplateName("");
    setTemplatePrompt("");
    setEditingTemplateId("");
  }

  async function onSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isEdit = Boolean(editingTemplateId);
      const endpoint = isEdit ? `/api/prompt-templates/${editingTemplateId}` : "/api/prompt-templates";

      const res = await fetch(endpoint, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: templateName, prompt: templatePrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? (isEdit ? "템플릿 수정 실패" : "템플릿 생성 실패"));
      resetTemplateForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onStartEditTemplate(tpl: PromptTemplate) {
    setEditingTemplateId(tpl.id);
    setTemplateName(tpl.name);
    setTemplatePrompt(tpl.prompt);
  }

  function onCancelEditTemplate() {
    resetTemplateForm();
  }

  async function onDeleteTemplate(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompt-templates/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "템플릿 삭제 실패");
      if (editingTemplateId === id) resetTemplateForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onGeneratePosts() {
    setBusy(true);
    setError(null);
    setGenerationError(null);
    setAiUsed(null);
    try {
      if (!issuePrompt.trim()) throw new Error("이슈 질의를 입력하세요.");
      const selectedTemplate = promptTemplates.find((tpl) => tpl.id === selectedTemplateId);
      const minGapRaw = Number(draftIntervalMinMinutes || "0");
      const maxGapRaw = Number(draftIntervalMaxMinutes || "0");
      const minGap = Math.max(0, Math.min(24 * 60, Number.isFinite(minGapRaw) ? minGapRaw : 0));
      const maxGap = Math.max(0, Math.min(24 * 60, Number.isFinite(maxGapRaw) ? maxGapRaw : 0));
      const gapFrom = Math.min(minGap, maxGap);
      const gapTo = Math.max(minGap, maxGap);

      const res = await fetch("/api/content-generation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issuePrompt,
          templatePrompt: selectedTemplate?.prompt ?? undefined,
          extraPrompt: extraPrompt || undefined,
          count: Number(generateCount || "1"),
          aiProvider,
          aiModel: aiModel || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "글 생성 실패");

      setBriefing((data?.briefing as string) ?? "");
      if (typeof data?.ai?.provider === "string" && typeof data?.ai?.model === "string") {
        setAiUsed({ provider: data.ai.provider, model: data.ai.model });
      }
      const base = new Date(Date.now() + 10 * 60 * 1000);
      let offsetMinutes = 0;
      const drafts = ((data?.posts as Array<{ text?: string }>) ?? []).map((item, idx) => {
        if (idx > 0) {
          offsetMinutes += randomIntBetween(gapFrom, gapTo);
        }
        return {
          id: `${Date.now()}-${idx}`,
          text: item.text?.trim() ?? "",
          scheduledAt: toDatetimeLocalValue(new Date(base.getTime() + offsetMinutes * 60 * 1000)),
        };
      });
      setGeneratedDrafts(drafts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGenerationError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(id: string, patch: Partial<GeneratedDraft>) {
    setGeneratedDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function scheduleDraftRequest(draft: GeneratedDraft) {
    const res = await fetch("/api/scheduled-posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        threadsAccountId: accountId,
        text: draft.text,
        mediaType: "TEXT",
        scheduledAt: (() => {
          const d = new Date(draft.scheduledAt);
          return Number.isNaN(d.getTime()) ? draft.scheduledAt : d.toISOString();
        })(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "예약 발행 등록 실패");
  }

  async function onScheduleDraft(draft: GeneratedDraft) {
    setBusy(true);
    setError(null);
    setGenerationError(null);
    try {
      await scheduleDraftRequest(draft);
      setGeneratedDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGenerationError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function onScheduleAllDrafts() {
    const targets = generatedDrafts.filter((draft) => draft.text.trim().length > 0);
    if (targets.length === 0) {
      setGenerationError("예약할 초안이 없습니다. 본문을 확인해 주세요.");
      return;
    }

    setBusy(true);
    setError(null);
    setGenerationError(null);
    try {
      const successIds: string[] = [];
      const failures: string[] = [];

      for (let idx = 0; idx < targets.length; idx += 1) {
        const draft = targets[idx];
        try {
          await scheduleDraftRequest(draft);
          successIds.push(draft.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push(`초안 ${idx + 1}: ${msg}`);
        }
      }

      if (successIds.length > 0) {
        setGeneratedDrafts((prev) => prev.filter((d) => !successIds.includes(d.id)));
        await refresh();
      }

      if (failures.length > 0) {
        const failureText = `일괄 예약 중 ${failures.length}건 실패\n${failures.join("\n")}`;
        setGenerationError(failureText);
        setError(failureText);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onSyncInsights(force = false) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ threadsAccountId: accountId });
      if (force) params.set("force", "1");
      const res = await fetch(`/api/insights/sync?${params.toString()}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "성과 동기화 실패");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleAutoWeekday(day: number) {
    setAutoWeekdays((prev) => {
      if (prev.includes(day)) return prev.filter((v) => v !== day);
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  async function onCreateAutoPlan(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!autoTopic.trim()) throw new Error("자동 발행 주제를 입력하세요.");
      if (autoWeekdays.length === 0) throw new Error("운영 요일을 1개 이상 선택하세요.");

      const res = await fetch("/api/daily-topic-plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadsAccountId: accountId,
          topic: autoTopic.trim(),
          promptHint: autoPromptHint || undefined,
          ctaText: autoCtaText || undefined,
          dailyCount: Number(autoDailyCount || "1"),
          intervalMinMinutes: Number(autoIntervalMin || "60"),
          intervalMaxMinutes: Number(autoIntervalMax || "90"),
          windowStartHour: Number(autoWindowStartHour || "9"),
          windowEndHour: Number(autoWindowEndHour || "23"),
          weekdays: autoWeekdays,
          infoRatioPercent: Number(autoInfoRatio || "70"),
          ctaRatioPercent: Number(autoCtaRatio || "30"),
          similarityThresholdPct: Number(autoSimilarityThreshold || "72"),
          telegramOnError: autoTelegramOnError,
          enabled: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "자동 플랜 생성 실패");

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleDailyPlan(plan: DailyTopicPlan, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-topic-plans/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "자동 플랜 상태 변경 실패");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDailyPlan(planId: string) {
    const ok = window.confirm("이 자동 플랜을 삭제할까요?");
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-topic-plans/${planId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "자동 플랜 삭제 실패");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateDailyPlanThreshold(plan: DailyTopicPlan) {
    const raw = Number(planThresholdDrafts[plan.id] ?? plan.similarityThresholdPct);
    const value = Math.max(30, Math.min(95, Number.isFinite(raw) ? Math.floor(raw) : plan.similarityThresholdPct));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-topic-plans/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ similarityThresholdPct: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.formErrors?.[0] ?? data?.error ?? "유사도 임계값 저장 실패");
      setPlanThresholdDrafts((prev) => ({ ...prev, [plan.id]: String(value) }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRunDailyPlannerNow() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-topic-plans/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadsAccountId: accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "플래너 수동 실행 실패");
      setDailyPlannerRunResult((data?.result as DailyPlannerRunResult) ?? null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const localFilePreview = useMemo(() => {
    if (!mediaFile) return null;
    return URL.createObjectURL(mediaFile);
  }, [mediaFile]);

  useEffect(() => {
    return () => {
      if (localFilePreview) URL.revokeObjectURL(localFilePreview);
    };
  }, [localFilePreview]);

  const previewMediaUrl = mediaUrl.trim() || localFilePreview || "";

  const performanceSummary = useMemo(() => {
    return posts.reduce(
      (acc, post) => {
        acc.views += post.viewsCount;
        acc.likes += post.likesCount;
        acc.replies += post.repliesCount;
        acc.reposts += post.repostsCount;
        acc.quotes += post.quotesCount;
        return acc;
      },
      { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0 }
    );
  }, [posts]);

  const topPosts = useMemo(() => {
    const score = (p: ScheduledPost) => p.viewsCount + p.likesCount * 3 + p.repliesCount * 4 + p.repostsCount * 5;
    return [...posts]
      .filter((p) => Boolean(p.remotePostId))
      .sort((a, b) => score(b) - score(a))
      .slice(0, 10);
  }, [posts]);
  const schedulableDraftCount = useMemo(
    () => generatedDrafts.filter((draft) => draft.text.trim().length > 0).length,
    [generatedDrafts]
  );

  const accountName = account?.label ?? account?.threadsUsername ?? account?.threadsUserId ?? accountId;
  const todayPublishedCount = account?.workspaceStats?.todayPublishedCount ?? 0;
  const weeklyRangeLabel =
    account?.followerStats?.weekStartDateKst && account?.followerStats?.weekEndDateKst
      ? `${account.followerStats.weekStartDateKst} ~ ${account.followerStats.weekEndDateKst}`
      : "월요일 ~ 일요일";
  const modelOptions = useMemo(() => {
    if (aiProvider === "gemini") return GEMINI_MODEL_OPTIONS;
    if (aiProvider === "perplexity") return PERPLEXITY_MODEL_OPTIONS;
    return [];
  }, [aiProvider]);

  useEffect(() => {
    if (aiProvider === "auto") {
      if (aiModel !== "") setAiModel("");
      return;
    }
    if (!modelOptions.some((option) => option.value === aiModel)) {
      setAiModel("");
    }
  }, [aiProvider, aiModel, modelOptions]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Account Workspace</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{accountName}</div>
            <div className="mt-1 text-sm text-slate-600">
              @{account?.threadsUsername ?? "-"} · uid {account?.threadsUserId ?? "-"} · token 만료 {account ? new Date(account.tokenExpiresAt).toLocaleString() : "-"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              새로고침
            </button>
            <a
              href="/api/auth/threads/start"
              className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              계정 추가 연결
            </a>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {threadsAccounts.map((acc) => (
            <Link
              key={acc.id}
              href={`/dashboard/accounts/${acc.id}`}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition ${
                acc.id === accountId
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {acc.label ?? acc.threadsUsername ?? acc.threadsUserId ?? acc.id}
            </Link>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">오늘 발행</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{todayPublishedCount.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-500">오늘 실제 발행된 원글 기준</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">현재 팔로워</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">
              {typeof account?.followerStats?.currentFollowers === "number"
                ? account.followerStats.currentFollowers.toLocaleString()
                : "-"}
            </div>
            <div className="mt-1 text-xs text-slate-500">기준일 {account?.followerStats?.latestDateKst ?? "-"}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">일별 팔로워 증감</div>
            <div className={`mt-1 text-2xl font-semibold ${signedDeltaTextClass(account?.followerStats?.dailyDelta)}`}>
              {formatSignedDelta(account?.followerStats?.dailyDelta)}
            </div>
            <div className="mt-1 text-xs text-slate-500">전일 스냅샷 대비</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-500">이번 주 누적 팔로워 증감</div>
            <div className={`mt-1 text-2xl font-semibold ${signedDeltaTextClass(account?.followerStats?.weeklyDelta)}`}>
              {formatSignedDelta(account?.followerStats?.weeklyDelta)}
            </div>
            <div className="mt-1 text-xs text-slate-500">{weeklyRangeLabel}</div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["content", "콘텐츠"],
            ["performance", "성과"],
            ["settings", "설정"],
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`h-11 rounded-2xl text-sm font-semibold transition ${
                tab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {tab === "content" ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">예약 작성</h2>
            <p className="mt-1 text-sm text-slate-600">이 계정으로만 예약/바로발행 됩니다.</p>

            <form onSubmit={onCreate} className="mt-5 grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">본문 (필수)</label>
                <textarea
                  className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={busy}
                  placeholder="Threads 본문을 입력하세요"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">미디어 타입</label>
                  <select
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={mediaType}
                    onChange={(e) => {
                      const nextType = e.target.value as ScheduledPost["mediaType"];
                      setMediaType(nextType);
                      if (nextType === "TEXT") {
                        setMediaUrl("");
                        setMediaFile(null);
                      }
                    }}
                    disabled={busy}
                  >
                    <option value="TEXT">TEXT</option>
                    <option value="IMAGE">IMAGE</option>
                    <option value="VIDEO">VIDEO</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">미디어 파일(옵션)</label>
                  <input
                    type="file"
                    className="h-10 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                    disabled={busy || mediaType === "TEXT"}
                    accept={mediaType === "VIDEO" ? "video/*" : "image/*"}
                    onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">미디어 URL (옵션)</label>
                  <input
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    disabled={busy || mediaType === "TEXT"}
                    placeholder={mediaType === "TEXT" ? "TEXT는 미디어 없음" : "https://..."}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">예약 시간</label>
                  <input
                    type="datetime-local"
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    disabled={busy}
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold text-slate-500">발행 전 미리보기</div>
                    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-xs text-slate-500">
                        @{account?.threadsUsername ?? "계정"} ·{" "}
                        {scheduledAt ? new Date(scheduledAt).toLocaleString() : "예약 시간 미정"}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap text-sm text-slate-900">
                        {text.trim() || "본문을 입력하면 여기에 미리보기가 표시됩니다."}
                      </div>
                      {mediaType !== "TEXT" && previewMediaUrl ? (
                        mediaType === "VIDEO" ? (
                          <video className="mt-3 max-h-72 w-full rounded-lg border border-slate-200" controls src={previewMediaUrl} />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewMediaUrl}
                            alt="미디어 미리보기"
                            className="mt-3 max-h-72 w-full rounded-lg border border-slate-200 object-contain"
                          />
                        )
                      ) : null}
                      {replyDrafts.some((reply) => reply.text.trim()) ? (
                        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                          {replyDrafts
                            .filter((reply) => reply.text.trim())
                            .map((reply, idx) => (
                              <div key={reply.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">댓글 {idx + 1}</div>
                                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{reply.text.trim()}</div>
                              </div>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">연속 댓글 체인</div>
                    <div className="mt-1 text-xs text-slate-600">본문 발행 뒤 댓글 1, 2, 3 순서로 이어서 게시됩니다.</div>
                  </div>
                  <button
                    type="button"
                    onClick={addReplyDraft}
                    disabled={busy}
                    className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    댓글 추가
                  </button>
                </div>

                {replyDrafts.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {replyDrafts.map((reply, idx) => (
                      <div key={reply.id} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-500">댓글 {idx + 1}</div>
                          <button
                            type="button"
                            onClick={() => removeReplyDraft(reply.id)}
                            disabled={busy}
                            className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                          >
                            삭제
                          </button>
                        </div>
                        <textarea
                          className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                          value={reply.text}
                          onChange={(e) => updateReplyDraft(reply.id, e.target.value)}
                          disabled={busy}
                          placeholder={idx === 0 ? "본문에 대한 추가 설명" : idx === 1 ? "본문에 대한 보강 내용" : "전환 또는 CTA 내용"}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                    댓글 체인이 필요하면 추가해서 함께 예약하세요.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  disabled={busy}
                >
                  발행예약
                </button>
                <button
                  type="button"
                  onClick={onPublishNow}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  disabled={busy}
                >
                  즉시발행
                </button>
              </div>
            </form>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-slate-900">이슈 기반 글 생성 (AI)</h2>
            <p className="mt-1 text-sm text-slate-600">생성된 초안을 바로 이 계정의 예약으로 전환할 수 있습니다.</p>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">프롬프트 템플릿 관리</h3>
                <form onSubmit={onSaveTemplate} className="grid gap-3">
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="템플릿 이름"
                    disabled={busy}
                    required
                  />
                  <textarea
                    className="min-h-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    value={templatePrompt}
                    onChange={(e) => setTemplatePrompt(e.target.value)}
                    placeholder="글 생성 지시문"
                    disabled={busy}
                    required
                  />
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    disabled={busy}
                  >
                    {editingTemplateId ? "템플릿 수정" : "템플릿 저장"}
                  </button>
                  {editingTemplateId ? (
                    <button
                      type="button"
                      onClick={onCancelEditTemplate}
                      className="inline-flex h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      disabled={busy}
                    >
                      수정 취소
                    </button>
                  ) : null}
                </form>

                <div className="space-y-2">
                  {promptTemplates.map((tpl) => (
                    <div key={tpl.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className={`text-left text-sm font-semibold ${
                            selectedTemplateId === tpl.id ? "text-blue-700" : "text-slate-900"
                          }`}
                          onClick={() => setSelectedTemplateId((prev) => (prev === tpl.id ? "" : tpl.id))}
                        >
                          {tpl.name}
                        </button>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => onStartEditTemplate(tpl)}
                            className="text-xs text-slate-600 hover:text-slate-900"
                            disabled={busy}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTemplate(tpl.id)}
                            className="text-xs text-rose-600 hover:text-rose-700"
                            disabled={busy}
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-slate-600">{tpl.prompt}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-900">글 생성</h3>
                <div className="grid gap-3">
                  <input
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                    value={issuePrompt}
                    onChange={(e) => setIssuePrompt(e.target.value)}
                    disabled={busy}
                    placeholder="예: 오늘 이슈 시황 알려줘"
                  />
                  <textarea
                    className="min-h-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                    value={extraPrompt}
                    onChange={(e) => setExtraPrompt(e.target.value)}
                    disabled={busy}
                    placeholder="추가 요청사항"
                  />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <select
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">템플릿 미사용</option>
                      {promptTemplates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={generateCount}
                      onChange={(e) => setGenerateCount(e.target.value)}
                      disabled={busy}
                    />
                    <select
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value as "auto" | "gemini" | "perplexity")}
                      disabled={busy}
                      title="AI 제공자"
                    >
                      <option value="auto">AI 자동 선택</option>
                      <option value="gemini">Gemini</option>
                      <option value="perplexity">Perplexity</option>
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={draftIntervalMinMinutes}
                      onChange={(e) => setDraftIntervalMinMinutes(e.target.value)}
                      disabled={busy}
                      placeholder="최소 간격(분)"
                      title="생성된 초안 예약시간 최소 간격(분)"
                    />
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={draftIntervalMaxMinutes}
                      onChange={(e) => setDraftIntervalMaxMinutes(e.target.value)}
                      disabled={busy}
                      placeholder="최대 간격(분)"
                      title="생성된 초안 예약시간 최대 간격(분)"
                    />
                    <select
                      className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      disabled={busy || aiProvider === "auto"}
                      title="AI 모델 선택"
                    >
                      <option value="">기본 모델</option>
                      {modelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs text-slate-500">
                    초안 예약시간은 생성 시각 기준으로 <span className="font-semibold">최소~최대 간격(분)</span> 안에서 랜덤 배치됩니다.
                  </div>
                  <div className="text-xs text-slate-500">
                    AI 제공자를 <span className="font-semibold">Gemini</span>로 고르면 모델명을 선택할 수 있습니다.
                  </div>
                  <button
                    type="button"
                    onClick={onGeneratePosts}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    글 생성하기
                  </button>
                  {generationError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {generationError}
                    </div>
                  ) : null}
                  {aiUsed ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      사용 모델: {aiUsed.provider} / {aiUsed.model}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {briefing ? (
              <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4">
                <div className="text-xs font-semibold text-sky-700">오늘 이슈 브리핑</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-sky-900">{briefing}</div>
              </div>
            ) : null}

            {generatedDrafts.length > 0 ? (
              <div className="mt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-600">
                    생성된 초안 {generatedDrafts.length}건 · 예약 가능 {schedulableDraftCount}건
                  </div>
                  <button
                    type="button"
                    onClick={onScheduleAllDrafts}
                    disabled={busy || schedulableDraftCount === 0}
                    className="inline-flex h-9 items-center justify-center rounded-full bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    전체 예약발행
                  </button>
                </div>
                <div className="grid gap-3">
                  {generatedDrafts.map((draft, idx) => (
                    <div key={draft.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="mb-3 text-xs font-semibold text-slate-500">초안 {idx + 1}</div>
                      <div className="grid gap-3">
                        <textarea
                          className="min-h-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                          value={draft.text}
                          onChange={(e) => updateDraft(draft.id, { text: e.target.value })}
                          disabled={busy}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <input
                            type="datetime-local"
                            className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                            value={draft.scheduledAt}
                            onChange={(e) => updateDraft(draft.id, { scheduledAt: e.target.value })}
                            disabled={busy}
                          />
                          <button
                            type="button"
                            onClick={() => onScheduleDraft(draft)}
                            disabled={busy || !draft.text.trim()}
                            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            예약발행
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "performance" ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">성과 요약</h2>
                <p className="mt-1 text-sm text-slate-600">조회수/좋아요/댓글/리포스트를 동기화해서 누적 성과를 확인합니다.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onSyncInsights(false)}
                  disabled={busy}
                  className="h-10 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  성과 동기화
                </button>
                <button
                  type="button"
                  onClick={() => onSyncInsights(true)}
                  disabled={busy}
                  className="h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  전체 강제 동기화
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">오늘 발행</div>
                <div className="mt-1 text-2xl font-semibold">{todayPublishedCount.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">조회수</div>
                <div className="mt-1 text-2xl font-semibold">{performanceSummary.views.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">좋아요</div>
                <div className="mt-1 text-2xl font-semibold">{performanceSummary.likes.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">댓글</div>
                <div className="mt-1 text-2xl font-semibold">{performanceSummary.replies.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">리포스트</div>
                <div className="mt-1 text-2xl font-semibold">{performanceSummary.reposts.toLocaleString()}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">인용</div>
                <div className="mt-1 text-2xl font-semibold">{performanceSummary.quotes.toLocaleString()}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">현재 팔로워</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">
                  {typeof account?.followerStats?.currentFollowers === "number"
                    ? account.followerStats.currentFollowers.toLocaleString()
                    : "-"}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">일별 팔로워 증감</div>
                <div className={`mt-1 text-2xl font-semibold ${signedDeltaTextClass(account?.followerStats?.dailyDelta)}`}>
                  {formatSignedDelta(account?.followerStats?.dailyDelta)}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">이번 주 누적 팔로워 증감</div>
                <div className={`mt-1 text-2xl font-semibold ${signedDeltaTextClass(account?.followerStats?.weeklyDelta)}`}>
                  {formatSignedDelta(account?.followerStats?.weeklyDelta)}
                </div>
                <div className="mt-1 text-xs text-slate-500">{weeklyRangeLabel}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">팔로워 기준일</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{account?.followerStats?.latestDateKst ?? "-"}</div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-base font-semibold">상위 성과 게시물</h3>
            <div className="mt-4 space-y-3">
              {topPosts.map((post) => (
                <div key={post.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="line-clamp-2 text-sm text-slate-900">{post.text}</div>
                  <div className="mt-2 text-xs text-slate-600">
                    조회 {post.viewsCount} · 좋아요 {post.likesCount} · 댓글 {post.repliesCount} · 리포스트 {post.repostsCount} · 인용 {post.quotesCount}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">업데이트: {post.insightsUpdatedAt ? new Date(post.insightsUpdatedAt).toLocaleString() : "-"}</div>
                  {post.insightsLastError ? <div className="mt-1 text-[11px] text-rose-600">동기화 오류: {post.insightsLastError}</div> : null}
                </div>
              ))}
              {topPosts.length === 0 ? <div className="text-sm text-slate-500">아직 원글 발행 데이터가 없습니다.</div> : null}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-base font-semibold">게시 기록</h2>
              <div className="text-sm text-slate-500">{posts.length} items</div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="border-b border-slate-200 px-3 py-2">시간</th>
                    <th className="border-b border-slate-200 px-3 py-2">상태</th>
                    <th className="border-b border-slate-200 px-3 py-2">본문</th>
                    <th className="border-b border-slate-200 px-3 py-2">성과</th>
                    <th className="border-b border-slate-200 px-3 py-2">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="text-sm">
                        <td className="whitespace-nowrap border-b border-slate-100 px-3 py-3 text-slate-700">
                          {new Date(p.scheduledAt).toLocaleString()}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClasses(p.status)}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3">
                          <div className="max-w-md space-y-3">
                            <div className="whitespace-pre-wrap">{p.text}</div>
                            {p.mediaType !== "TEXT" && p.mediaUrl ? (
                              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  {p.mediaType === "VIDEO" ? "첨부 영상" : "첨부 이미지"}
                                </div>
                                {p.mediaType === "VIDEO" ? (
                                  <video className="mt-2 max-h-48 w-full rounded-lg border border-slate-200" controls src={p.mediaUrl} />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={p.mediaUrl}
                                    alt="예약 첨부 이미지"
                                    className="mt-2 max-h-48 w-full rounded-lg border border-slate-200 object-contain"
                                  />
                                )}
                              </div>
                            ) : null}
                            {p.replies.length > 0 ? (
                              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  댓글 체인 {p.replies.length}개
                                </div>
                                {p.replies.map((reply) => (
                                  <div key={reply.id} className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] font-semibold text-slate-500">댓글 {reply.orderIndex + 1}</div>
                                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badgeClasses(
                                        reply.status === "FAILED"
                                          ? "FAILED"
                                          : reply.status === "SUCCESS"
                                            ? "SUCCESS"
                                            : "PENDING"
                                      )}`}>
                                        {reply.status}
                                      </span>
                                    </div>
                                    <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{reply.text}</div>
                                    {reply.lastError ? <div className="mt-2 text-xs text-rose-600">{reply.lastError}</div> : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3 text-xs text-slate-600">
                          <div>조회 {p.viewsCount}</div>
                          <div>좋아요 {p.likesCount} · 댓글 {p.repliesCount}</div>
                          <div>리포스트 {p.repostsCount} · 인용 {p.quotesCount}</div>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            {canEditScheduledPost(p) ? (
                              <button
                                type="button"
                                className="h-9 rounded-full border border-blue-200 px-4 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => startEditScheduledPost(p)}
                              >
                                수정
                              </button>
                            ) : null}
                            {(p.status === "FAILED" || p.status === "PARTIAL_FAILED") && (
                              <button
                                type="button"
                                className="h-9 rounded-full border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => onRetry(p.id)}
                              >
                                재시도
                              </button>
                            )}
                            {p.status !== "RUNNING" && p.status !== "SUCCESS" && !p.remotePostId ? (
                              <button
                                type="button"
                                className="h-9 rounded-full border border-rose-200 px-4 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                disabled={busy}
                                onClick={() => onDeleteScheduledPost(p)}
                              >
                                삭제
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {editingPostId === p.id ? (
                        <tr>
                          <td colSpan={5} className="border-b border-slate-100 bg-slate-50 px-3 py-4">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-slate-900">예약 수정</div>
                                  <div className="mt-1 text-xs text-slate-500">발행 전 대기 상태일 때만 본문, 예약시간, 댓글 체인을 수정할 수 있습니다.</div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => onSaveScheduledPostEdit(p.id)}
                                    disabled={busy}
                                    className="inline-flex h-9 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                                  >
                                    수정 저장
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditScheduledPost}
                                    disabled={busy}
                                    className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    취소
                                  </button>
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                                <div className="grid gap-3">
                                  <div className="grid gap-2">
                                    <label className="text-sm font-medium text-slate-700">본문</label>
                                    <textarea
                                      className="min-h-28 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                                      value={editingText}
                                      onChange={(e) => setEditingText(e.target.value)}
                                      disabled={busy}
                                    />
                                  </div>

                                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-slate-900">댓글 체인 수정</div>
                                        <div className="mt-1 text-xs text-slate-600">원글 아래로 이어질 댓글 문구를 발행 전에 바꿀 수 있습니다.</div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={addEditingReplyDraft}
                                        disabled={busy}
                                        className="inline-flex h-8 items-center justify-center rounded-full border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                      >
                                        댓글 추가
                                      </button>
                                    </div>

                                    {editingReplyDrafts.length > 0 ? (
                                      <div className="mt-4 grid gap-3">
                                        {editingReplyDrafts.map((reply, idx) => (
                                          <div key={reply.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                              <div className="text-xs font-semibold text-slate-500">댓글 {idx + 1}</div>
                                              <button
                                                type="button"
                                                onClick={() => removeEditingReplyDraft(reply.id)}
                                                disabled={busy}
                                                className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                                              >
                                                삭제
                                              </button>
                                            </div>
                                            <textarea
                                              className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                                              value={reply.text}
                                              onChange={(e) => updateEditingReplyDraft(reply.id, e.target.value)}
                                              disabled={busy}
                                              placeholder={`댓글 ${idx + 1}`}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                                        현재 연결된 댓글이 없습니다. 필요하면 추가해서 저장하세요.
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-3">
                                  <div className="grid gap-2">
                                    <label className="text-sm font-medium text-slate-700">예약 시간</label>
                                    <input
                                      type="datetime-local"
                                      className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                                      value={editingScheduledAt}
                                      onChange={(e) => setEditingScheduledAt(e.target.value)}
                                      disabled={busy}
                                      required
                                    />
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                    수정 저장 시 기존 예약 큐를 새 시간 기준으로 다시 맞춥니다.
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {posts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-500">
                        아직 예약이 없습니다.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">완전 자동 발행 플랜</h2>
                <p className="mt-1 text-sm text-slate-600">
                  요일/운영시간/랜덤 발행텀/INFO-CTA 비율을 정하면 워커가 자동으로 생성·예약합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={onRunDailyPlannerNow}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                자동 플래너 지금 실행
              </button>
            </div>

            <form onSubmit={onCreateAutoPlan} className="mt-5 grid gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">주제</label>
                <input
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  value={autoTopic}
                  onChange={(e) => setAutoTopic(e.target.value)}
                  disabled={busy}
                  placeholder="예: 해외선물"
                  required
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">추가 지시(옵션)</label>
                <textarea
                  className="min-h-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  value={autoPromptHint}
                  onChange={(e) => setAutoPromptHint(e.target.value)}
                  disabled={busy}
                  placeholder="예: 과장 금지, 오늘 이슈/트렌드 중심, 엔터 두 번 개행 유지"
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">CTA 문구(옵션)</label>
                <input
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  value={autoCtaText}
                  onChange={(e) => setAutoCtaText(e.target.value)}
                  disabled={busy}
                  placeholder="예: 더 궁금하면 프로필 링크 확인"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">일일 생성 건수</label>
                  <input
                    type="number"
                    min={1}
                    max={250}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoDailyCount}
                    onChange={(e) => setAutoDailyCount(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">발행텀 최소(분)</label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoIntervalMin}
                    onChange={(e) => setAutoIntervalMin(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">발행텀 최대(분)</label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoIntervalMax}
                    onChange={(e) => setAutoIntervalMax(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">오류 텔레그램 알림</label>
                  <select
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoTelegramOnError ? "1" : "0"}
                    onChange={(e) => setAutoTelegramOnError(e.target.value === "1")}
                    disabled={busy}
                  >
                    <option value="1">켜기</option>
                    <option value="0">끄기</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">유사도 임계값(%)</label>
                  <input
                    type="number"
                    min={30}
                    max={95}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoSimilarityThreshold}
                    onChange={(e) => setAutoSimilarityThreshold(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="sm:col-span-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  생성 글이 최근 글과 이 임계값 이상으로 비슷하면 자동 재생성합니다.
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-4">
                <div className="grid gap-2">
                  <label className="text-sm font-medium">운영 시작시</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoWindowStartHour}
                    onChange={(e) => setAutoWindowStartHour(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">운영 종료시</label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoWindowEndHour}
                    onChange={(e) => setAutoWindowEndHour(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">INFO 비율(%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoInfoRatio}
                    onChange={(e) => setAutoInfoRatio(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">CTA 비율(%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                    value={autoCtaRatio}
                    onChange={(e) => setAutoCtaRatio(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">운영 요일</label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const selected = autoWeekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleAutoWeekday(day.value)}
                        disabled={busy}
                        className={`h-9 rounded-full border px-4 text-xs font-semibold ${
                          selected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  자동 플랜 저장
                </button>
              </div>
            </form>

            <div className="mt-6 space-y-2">
              {dailyPlans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{plan.topic}</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleDailyPlan(plan, !plan.enabled)}
                        disabled={busy}
                        className={`h-8 rounded-full border px-3 text-xs font-semibold ${
                          plan.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {plan.enabled ? "자동 ON" : "자동 OFF"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteDailyPlan(plan.id)}
                        disabled={busy}
                        className="h-8 rounded-full border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    요일 {plan.weekdays.join(",")} · 운영 {plan.windowStartHour}:00~{plan.windowEndHour}:59 · 텀 {plan.intervalMinMinutes}~{plan.intervalMaxMinutes}분 · 일 {plan.dailyCount}건 · INFO {plan.infoRatioPercent}% / CTA {plan.ctaRatioPercent}% · 유사도 임계값 {plan.similarityThresholdPct}%
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={30}
                      max={95}
                      value={planThresholdDrafts[plan.id] ?? String(plan.similarityThresholdPct)}
                      onChange={(e) =>
                        setPlanThresholdDrafts((prev) => ({
                          ...prev,
                          [plan.id]: e.target.value,
                        }))
                      }
                      className="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-slate-400"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => onUpdateDailyPlanThreshold(plan)}
                      disabled={busy}
                      className="h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      임계값 저장
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    마지막 생성: {plan.lastGeneratedAt ? new Date(plan.lastGeneratedAt).toLocaleString() : "-"}
                  </div>
                  {plan.lastError ? <div className="mt-1 text-xs text-rose-600">최근 오류: {plan.lastError}</div> : null}
                </div>
              ))}
              {dailyPlans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  아직 자동 플랜이 없습니다.
                </div>
              ) : null}
            </div>

            {dailyPlannerRunResult ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">최근 자동 플래너 실행 결과</div>
                  <div className="text-xs text-slate-500">{dailyPlannerRunResult.nowKstKey}</div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    생성 {dailyPlannerRunResult.createdPosts}건
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    유사도 재생성 {dailyPlannerRunResult.regeneratedBySimilarity}회
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    고유사도 경고 {dailyPlannerRunResult.highSimilarityWarnings}건
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    오류 {dailyPlannerRunResult.errors.length}건
                  </div>
                </div>
                {dailyPlannerRunResult.createdPostDetails.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {dailyPlannerRunResult.createdPostDetails.map((item, idx) => (
                      <div key={item.postId} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs text-slate-500">
                          #{idx + 1} · {new Date(item.scheduledAt).toLocaleString()} · {item.contentType} · 유사도 {(item.similarityScore * 100).toFixed(1)}% (기준 {(item.similarityThreshold * 100).toFixed(0)}%) · 재생성 {item.regeneratedAttempts}회
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{item.text}</div>
                      </div>
                    ))}
                    {dailyPlannerRunResult.omittedDetailCount > 0 ? (
                      <div className="text-xs text-slate-500">
                        상세 생략 {dailyPlannerRunResult.omittedDetailCount}건
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">이번 실행에서 생성된 글이 없습니다.</div>
                )}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">계정 설정</h2>
            <p className="mt-1 text-sm text-slate-600">라벨/프록시 URL을 관리하고, 필요 시 계정을 삭제할 수 있습니다.</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">라벨</label>
                <input
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  disabled={busy}
                  placeholder="예: 김프로_운영계정"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Proxy URL (옵션)</label>
                <input
                  className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  disabled={busy}
                  placeholder="http://user:pass@host:port"
                />
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500">프록시 URL을 비우고 저장하면 계정 프록시가 제거됩니다.</div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onSaveAccountSettings}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                계정 설정 저장
              </button>
              <button
                type="button"
                onClick={onDeleteAccount}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-full border border-rose-200 bg-white px-5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                계정 삭제
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
    </div>
  );
}
