"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type CardNewsHtmlFrame = {
  index: number;
  width: number;
  height: number;
  html: string;
};

export type CardNewsPngFrame = {
  index: number;
  width: number;
  height: number;
  url: string;
  bytes?: number;
  fileName?: string;
};

export type CardNewsPreviewStageProps = {
  mode: "html" | "png";
  title: string;
  description?: string;
  items: Array<CardNewsHtmlFrame | CardNewsPngFrame>;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  className?: string;
  emptyLabel?: string;
  fitClassName?: string;
};

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

function HtmlFitFrame({ frame, fitClassName }: { frame: CardNewsHtmlFrame; fitClassName?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nextScale = Math.min(rect.width / frame.width, rect.height / frame.height);
      setScale(nextScale);
    };

    updateScale();

    const observer = new ResizeObserver(() => updateScale());
    observer.observe(container);

    return () => observer.disconnect();
  }, [frame.height, frame.width]);

  return (
    <div
      ref={containerRef}
      className={`relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 ${fitClassName ?? ""}`}
    >
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden rounded-[28px] shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
        style={{
          width: frame.width,
          height: frame.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <iframe
          title={`card-frame-${frame.index}`}
          srcDoc={frame.html}
          className="block border-0 bg-slate-100"
          style={{ width: frame.width, height: frame.height }}
        />
      </div>
    </div>
  );
}

function PngFitFrame({ frame, fitClassName }: { frame: CardNewsPngFrame; fitClassName?: string }) {
  return (
    <div className={`relative aspect-[4/5] w-full overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 ${fitClassName ?? ""}`}>
      <Image
        src={frame.url}
        alt={`카드뉴스 PNG ${frame.index + 1}`}
        width={frame.width}
        height={frame.height}
        unoptimized
        className="h-full w-full object-contain"
      />
    </div>
  );
}

export function CardNewsPreviewStage({
  mode,
  title,
  description,
  items,
  activeIndex,
  onActiveIndexChange,
  className,
  emptyLabel = "아직 프리뷰 항목이 없습니다.",
  fitClassName,
}: CardNewsPreviewStageProps) {
  const safeIndex = clampIndex(activeIndex, items.length);
  const activeItem = items[safeIndex] ?? null;

  return (
    <section className={`rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm ${className ?? ""}`}>
      {activeItem ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{mode === "html" ? "HTML preview" : "PNG export"}</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-950">
                {title} {safeIndex + 1} / {items.length}
              </h3>
              {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {"bytes" in activeItem && typeof activeItem.bytes === "number" ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {Math.round(activeItem.bytes / 1024)}KB
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onActiveIndexChange(safeIndex - 1)}
                disabled={safeIndex === 0}
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => onActiveIndexChange(safeIndex + 1)}
                disabled={safeIndex === items.length - 1}
                className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(148,163,184,0.12),_transparent_45%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] p-4 sm:p-6">
            <div className="mx-auto max-w-[460px]">
              {mode === "html" ? (
                <HtmlFitFrame frame={activeItem as CardNewsHtmlFrame} fitClassName={fitClassName} />
              ) : (
                <PngFitFrame frame={activeItem as CardNewsPngFrame} fitClassName={fitClassName} />
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {items.map((item, index) => (
              <button
                key={mode === "html" ? `html-${(item as CardNewsHtmlFrame).index}` : `png-${(item as CardNewsPngFrame).fileName ?? (item as CardNewsPngFrame).index}`}
                type="button"
                onClick={() => onActiveIndexChange(index)}
                className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition ${
                  safeIndex === index
                    ? "bg-amber-500 text-slate-950"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-500">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

