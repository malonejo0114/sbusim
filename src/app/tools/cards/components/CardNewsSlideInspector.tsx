"use client";

import type { ReactNode } from "react";

export type CardNewsSlideStatTone = "accent" | "info" | "danger" | "muted";

export type CardNewsSlideStat = {
  label: string;
  value: string;
  tone?: CardNewsSlideStatTone;
};

export type CardNewsSlide = {
  title: string;
  accentTitle?: string;
  eyebrow?: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  footer?: string;
  pageLabel?: string;
  stats?: CardNewsSlideStat[];
};

type CardNewsSlideInspectorProps = {
  slide: CardNewsSlide;
  slideIndex: number;
  slideCount: number;
  onSlideChange: (patch: Partial<CardNewsSlide>) => void;
  onSlideStatChange: (statIndex: number, patch: Partial<CardNewsSlideStat>) => void;
  onAddStat: () => void;
  onRemoveStat: (statIndex: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onJumpToSlide: (slideIndex: number) => void;
  onAddSlide?: () => void;
  onRemoveSlide?: () => void;
  canRemoveSlide?: boolean;
  className?: string;
  headerSlot?: ReactNode;
};

function ToneSelect({
  value,
  onChange,
}: {
  value?: CardNewsSlideStatTone;
  onChange: (tone: CardNewsSlideStatTone) => void;
}) {
  return (
    <select
      value={value ?? "accent"}
      onChange={(event) => onChange(event.target.value as CardNewsSlideStatTone)}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
    >
      <option value="accent">골드 강조</option>
      <option value="info">블루 강조</option>
      <option value="danger">레드 경고</option>
      <option value="muted">은은하게</option>
    </select>
  );
}

export default function CardNewsSlideInspector({
  slide,
  slideIndex,
  slideCount,
  onSlideChange,
  onSlideStatChange,
  onAddStat,
  onRemoveStat,
  onPrevious,
  onNext,
  onJumpToSlide,
  onAddSlide,
  onRemoveSlide,
  canRemoveSlide = true,
  className = "",
  headerSlot,
}: CardNewsSlideInspectorProps) {
  const safeSlideCount = Math.max(1, slideCount);
  const activePage = `${String(slideIndex + 1).padStart(2, "0")} / ${String(safeSlideCount).padStart(2, "0")}`;

  return (
    <section className={`rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Slide Inspector</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">슬라이드 {activePage}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            지금 선택된 카드 1장만 수정합니다. 이전, 다음, 번호 점프로 흐름을 넘기고 이 패널에서 문구를 바로 고치세요.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {headerSlot}
          <button
            type="button"
            onClick={onPrevious}
            disabled={slideIndex === 0}
            className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            이전
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={slideIndex >= slideCount - 1}
            className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            다음
          </button>
          {onAddSlide ? (
            <button
              type="button"
              onClick={onAddSlide}
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              슬라이드 추가
            </button>
          ) : null}
          {onRemoveSlide ? (
            <button
              type="button"
              onClick={onRemoveSlide}
              disabled={!canRemoveSlide}
              className="inline-flex h-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              슬라이드 삭제
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: slideCount }, (_, index) => (
          <button
            key={`slide-jump-${index}`}
            type="button"
            onClick={() => onJumpToSlide(index)}
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full px-4 text-sm font-medium transition ${
              index === slideIndex
                ? "bg-amber-500 text-slate-950"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">상단 라벨</div>
          <input
            value={slide.eyebrow ?? ""}
            onChange={(event) => onSlideChange({ eyebrow: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">페이지 라벨</div>
          <input
            value={slide.pageLabel ?? ""}
            onChange={(event) => onSlideChange({ pageLabel: event.target.value })}
            placeholder="예: 01 / 06"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">메인 타이틀</div>
          <input
            value={slide.title}
            onChange={(event) => onSlideChange({ title: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">강조 타이틀</div>
          <input
            value={slide.accentTitle ?? ""}
            onChange={(event) => onSlideChange({ accentTitle: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block lg:col-span-2">
          <div className="mb-2 text-sm font-medium text-slate-700">서브 타이틀</div>
          <input
            value={slide.subtitle ?? ""}
            onChange={(event) => onSlideChange({ subtitle: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <div className="mb-2 text-sm font-medium text-slate-700">본문</div>
        <textarea
          value={slide.body ?? ""}
          onChange={(event) => onSlideChange({ body: event.target.value })}
          rows={4}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none focus:border-slate-400"
        />
      </label>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">강조 문구</div>
          <input
            value={slide.quote ?? ""}
            onChange={(event) => onSlideChange({ quote: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="block">
          <div className="mb-2 text-sm font-medium text-slate-700">하단 문구</div>
          <input
            value={slide.footer ?? ""}
            onChange={(event) => onSlideChange({ footer: event.target.value })}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
      </div>

      <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">포인트 / 점수 / 지표</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              패널 장과 점수 바 장에서 쓰는 행입니다. 예: 신뢰 97%, 배려 94%, 공격성 18%
            </p>
          </div>
          <button
            type="button"
            onClick={onAddStat}
            className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            포인트 추가
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {(slide.stats ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
              아직 추가된 포인트가 없습니다. 점수 바나 핵심 지표가 필요한 장이면 추가해서 바로 편집하면 됩니다.
            </div>
          ) : (
            (slide.stats ?? []).map((stat, statIndex) => (
              <div key={`stat-${slideIndex}-${statIndex}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:grid-cols-[1.2fr_0.8fr_0.6fr_auto]">
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">라벨</div>
                  <input
                    value={stat.label}
                    onChange={(event) => onSlideStatChange(statIndex, { label: event.target.value })}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">값</div>
                  <input
                    value={stat.value}
                    onChange={(event) => onSlideStatChange(statIndex, { value: event.target.value })}
                    placeholder="예: 97%"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                </label>
                <label className="block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">톤</div>
                  <ToneSelect value={stat.tone} onChange={(tone) => onSlideStatChange(statIndex, { tone })} />
                </label>
                <button
                  type="button"
                  onClick={() => onRemoveStat(statIndex)}
                  className="inline-flex h-11 items-center justify-center self-end rounded-full border border-rose-200 bg-rose-50 px-4 text-xs font-medium text-rose-700 hover:bg-rose-100"
                >
                  삭제
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
