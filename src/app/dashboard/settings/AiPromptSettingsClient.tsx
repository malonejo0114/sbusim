"use client";

import { useEffect, useMemo, useState } from "react";

type Settings = {
  dailyTopicInfoGuide: string;
  dailyTopicCtaGuide: string;
  dailyTopicTopicGuide: string;
  dailyTopicCommonRules: string;
  issuePackCommonRules: string;
};

const EMPTY_SETTINGS: Settings = {
  dailyTopicInfoGuide: "",
  dailyTopicCtaGuide: "",
  dailyTopicTopicGuide: "",
  dailyTopicCommonRules: "",
  issuePackCommonRules: "",
};

export default function AiPromptSettingsClient() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [defaults, setDefaults] = useState<Settings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ai-prompt-settings", { method: "GET", cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "설정 조회 실패");
      setSettings(json.settings as Settings);
      setDefaults((json.defaults ?? EMPTY_SETTINGS) as Settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canSave = useMemo(() => !loading && !saving, [loading, saving]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ai-prompt-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "저장 실패");
      setSettings(json.settings as Settings);
      setMessage("저장 완료: 다음 생성부터 즉시 반영됩니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onResetDefaults() {
    if (!confirm("기본값으로 초기화할까요?")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ai-prompt-settings", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "초기화 실패");
      setSettings(json.settings as Settings);
      setMessage("초기화 완료: 기본 시스템 프롬프트로 복원되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-1 text-sm font-semibold text-slate-900">시스템 프롬프트 설정</div>
        <div className="text-xs text-slate-500">
          여기서 수정한 내용이 글 생성 엔진의 기본 규칙으로 사용됩니다. (이슈팩 생성 / 워딩 검토 / 자동 플래너 공통)
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div> : null}

      <div className="grid gap-4">
        <PromptTextarea
          label="INFO 기본 가이드"
          help="정보형 글의 기본 톤/구성 규칙"
          value={settings.dailyTopicInfoGuide}
          defaultValue={defaults.dailyTopicInfoGuide}
          onChange={(value) => setSettings((prev) => ({ ...prev, dailyTopicInfoGuide: value }))}
          disabled={loading || saving}
        />

        <PromptTextarea
          label="CTA 기본 가이드"
          help="CTA 글 강제 규칙 (정보성/수치 금지 등)"
          value={settings.dailyTopicCtaGuide}
          defaultValue={defaults.dailyTopicCtaGuide}
          onChange={(value) => setSettings((prev) => ({ ...prev, dailyTopicCtaGuide: value }))}
          disabled={loading || saving}
        />

        <PromptTextarea
          label="TOPIC 기본 가이드"
          help="주제형 글 기본 규칙"
          value={settings.dailyTopicTopicGuide}
          defaultValue={defaults.dailyTopicTopicGuide}
          onChange={(value) => setSettings((prev) => ({ ...prev, dailyTopicTopicGuide: value }))}
          disabled={loading || saving}
        />

        <PromptTextarea
          label="공통 출력 규칙"
          help="줄바꿈/금지 표현 등 공통 지시"
          value={settings.dailyTopicCommonRules}
          defaultValue={defaults.dailyTopicCommonRules}
          onChange={(value) => setSettings((prev) => ({ ...prev, dailyTopicCommonRules: value }))}
          disabled={loading || saving}
        />

        <PromptTextarea
          label="브리핑 공통 규칙"
          help="이슈 브리핑/이슈팩 공통 규칙"
          value={settings.issuePackCommonRules}
          defaultValue={defaults.issuePackCommonRules}
          onChange={(value) => setSettings((prev) => ({ ...prev, issuePackCommonRules: value }))}
          disabled={loading || saving}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "설정 저장"}
        </button>
        <button
          type="button"
          onClick={onResetDefaults}
          disabled={!canSave}
          className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          기본값 복원
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!canSave}
          className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>
    </div>
  );
}

function PromptTextarea(props: {
  label: string;
  help: string;
  value: string;
  defaultValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-1 text-sm font-semibold text-slate-900">{props.label}</div>
      <div className="mb-2 text-xs text-slate-500">{props.help}</div>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-100"
      />
      <div className="mt-2 text-[11px] text-slate-400">기본값: {props.defaultValue}</div>
    </div>
  );
}
