"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CardNewsPreviewStage } from "@/app/tools/cards/components/CardNewsPreviewStage";
import CardNewsSlideInspector from "@/app/tools/cards/components/CardNewsSlideInspector";

type CardTemplate = {
  key: string;
  name: string;
  description: string;
  width: number;
  height: number;
};

type CardSlide = {
  id?: string;
  title: string;
  accentTitle?: string;
  eyebrow?: string;
  subtitle?: string;
  body?: string;
  quote?: string;
  footer?: string;
  pageLabel?: string;
  stats?: Array<{
    label: string;
    value: string;
    tone?: "accent" | "info" | "danger" | "muted";
  }>;
};

type CardFrame = {
  index: number;
  width: number;
  height: number;
  html: string;
};

type PngFrame = {
  index: number;
  width: number;
  height: number;
  fileName: string;
  url: string;
  bytes: number;
};

type CardProject = {
  id: string;
  title: string;
  brand: string | null;
  templateKey: string;
  backgroundImageUrl: string | null;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  slides: CardSlide[];
};

function createDefaultSlides(): CardSlide[] {
  return [
    {
      eyebrow: "FORTUNE INSIGHT",
      title: "유재석은",
      accentTitle: "어떤 사람인가?",
      subtitle: "오래 사랑받는 사람은 재능보다 방향이 먼저 드러납니다.",
      footer: "표지는 한 줄 결론까지 함께 보여주는 4:5 에디토리얼 시작 장입니다.",
    },
    {
      eyebrow: "핵심 인상 4가지",
      title: "오래 남는 건",
      accentTitle: "재능만이 아니다",
      subtitle: "두 번째 장은 핵심 인상을 카드형 지표와 함께 먼저 정리합니다.",
      body: "예능 감각, 배려, 자기관리, 순간 판단처럼 사람이 기억되는 이유를 한 장에서 먼저 묶어 보여줍니다.",
      quote: "이 장은 숫자보다 이미지가 먼저 읽히게 설계합니다.",
      stats: [
        { label: "대중 신뢰", value: "96%", tone: "accent" },
        { label: "배려의 밀도", value: "94%", tone: "info" },
        { label: "자기관리", value: "92%", tone: "accent" },
        { label: "순간 판단", value: "90%", tone: "muted" },
      ],
    },
    {
      eyebrow: "# 첫 인상보다 오래 가는 사람",
      title: "왜 그는",
      accentTitle: "부담스럽지 않은가",
      body: "유재석의 강점은 앞에 나서는 힘보다 상대를 살리는 조절력입니다.\n\n자기 이야기를 과하게 밀기보다, 판을 읽고 다른 사람의 타이밍을 열어줍니다.\n\n그래서 화면 안에서는 가볍고 편해 보여도 실제 구조는 꽤 정교합니다.",
      quote: "눈에 띄는 사람보다 판을 유지하는 사람이 오래 갑니다.",
    },
    {
      eyebrow: "진행력 x 배려 x 리듬",
      title: "왜 모두가",
      accentTitle: "편해하는가",
      body: "유재석은 사람을 몰아붙여 웃기기보다, 긴장을 낮추고 리듬을 조정하는 방식으로 웃음을 만듭니다.\n\n그래서 상대를 작게 만들지 않고도 장면을 살릴 수 있습니다.\n\n이 편안함은 타고난 성격이라기보다 오랫동안 다듬어진 진행 방식에 가깝습니다.",
      quote: "편안함은 분위기가 아니라 설계된 진행 방식입니다.",
      footer: "네 번째 장은 파란 강조색으로 흐름을 한 번 환기합니다.",
    },
    {
      eyebrow: "종합 인상 평가",
      title: "능력보다",
      accentTitle: "방향이 먼저",
      body: "유재석의 인상은 화려한 재능 하나보다 꾸준히 같은 방향을 선택해 온 결과에 가깝습니다.\n\n신뢰, 절제, 균형감이 겹치면서 오래가는 사람의 이미지를 만듭니다.",
      footer: "NEXT → 마지막: 당신은 어떤 사람으로 기억되고 있나요?",
      stats: [
        { label: "대중 신뢰", value: "97%", tone: "accent" },
        { label: "즉흥 진행력", value: "95%", tone: "info" },
        { label: "자기 절제", value: "91%", tone: "accent" },
        { label: "관계 밸런스", value: "89%", tone: "info" },
        { label: "공격성", value: "18%", tone: "danger" },
      ],
    },
    {
      eyebrow: "QUESTION",
      subtitle: "당신은 지금",
      title: "주목을 받는",
      accentTitle: "방향인가요?",
      body: "아니면",
      quote: "오래 신뢰를 쌓는\n방향인가요?",
      footer: "방향은 결국 말투와 선택, 반복에서 드러납니다.",
    },
    {
      eyebrow: "YOUR STORY",
      title: "다음 카드뉴스의 주인공은",
      accentTitle: "누구인가요?",
      body: "인물 분석, 브랜드 스토리, 직업별 캐릭터 카드까지 같은 구조로 확장할 수 있습니다.\n\n표지, 핵심 분석, 해설, 점수, 질문 장만 바꾸면 바로 다른 주제로 재사용할 수 있습니다.",
      quote: "한 사람의 구조를 읽으면, 콘텐츠의 구조도 선명해집니다.",
      footer: "프로젝트 저장 후 문구만 바꿔 다음 카드뉴스에 바로 재사용하세요.",
    },
  ];
}

function createTemplateExampleSlides(): CardSlide[] {
  return [
    {
      eyebrow: "🏆 오래 사랑받는 국민 MC의 구조",
      title: "유재석은",
      accentTitle: "어떤 사람인가?",
      subtitle: "웃음을 만드는 능력보다 신뢰를 쌓는 방향이 먼저였던 사람",
      footer: "첫 장은 제목과 한 줄 결론만으로도 테마가 보이게 시작합니다.",
    },
    {
      eyebrow: "핵심 인상 4가지",
      title: "오래 남는 건",
      accentTitle: "재능만이 아니다",
      subtitle: "두 번째 장은 한 번에 읽히는 인상 키워드를 먼저 제시합니다.",
      body: "예능 감각, 배려, 자기관리, 순간 판단처럼 한 사람을 기억하게 만드는 축을 먼저 묶어 보여줍니다.",
      quote: "이 장은 숫자보다 이미지가 먼저 읽히게 설계합니다.",
      stats: [
        { label: "대중 신뢰", value: "96%", tone: "accent" },
        { label: "배려의 밀도", value: "94%", tone: "info" },
        { label: "자기관리", value: "92%", tone: "accent" },
        { label: "순간 판단", value: "90%", tone: "muted" },
      ],
    },
    {
      eyebrow: "# 첫 인상보다 오래 가는 사람",
      title: "왜 그는",
      accentTitle: "부담스럽지 않은가",
      body: "유재석의 강점은 앞에 나서는 힘보다 상대를 살리는 조절력입니다.\n\n자기 이야기를 과하게 밀기보다, 판을 읽고 다른 사람의 타이밍을 열어줍니다.\n\n그래서 화면 안에서는 가볍고 편해 보여도 실제 구조는 꽤 정교합니다.",
      quote: "눈에 띄는 사람보다 판을 유지하는 사람이 오래 갑니다.",
    },
    {
      eyebrow: "진행력 x 배려 x 리듬",
      title: "왜 모두가",
      accentTitle: "편해하는가",
      body: "유재석은 사람을 몰아붙여 웃기기보다, 긴장을 낮추고 리듬을 조정하는 방식으로 웃음을 만듭니다.\n\n그래서 상대를 작게 만들지 않고도 장면을 살릴 수 있습니다.\n\n이 편안함은 타고난 성격이라기보다 오랫동안 다듬어진 진행 방식에 가깝습니다.",
      quote: "편안함은 분위기가 아니라 설계된 진행 방식입니다.",
      footer: "네 번째 장은 파란 강조색으로 흐름을 한 번 환기합니다.",
    },
    {
      eyebrow: "종합 인상 평가",
      title: "능력보다",
      accentTitle: "방향이 먼저",
      body: "유재석의 인상은 화려한 재능 하나보다 꾸준히 같은 방향을 선택해 온 결과에 가깝습니다.\n\n신뢰, 절제, 균형감이 겹치면서 오래가는 사람의 이미지를 만듭니다.",
      footer: "NEXT → 마지막: 당신은 어떤 사람으로 기억되고 있나요?",
      stats: [
        { label: "대중 신뢰", value: "97%", tone: "accent" },
        { label: "즉흥 진행력", value: "95%", tone: "info" },
        { label: "자기 절제", value: "91%", tone: "accent" },
        { label: "관계 밸런스", value: "89%", tone: "info" },
        { label: "공격성", value: "18%", tone: "danger" },
      ],
    },
    {
      eyebrow: "QUESTION",
      subtitle: "당신은 지금",
      title: "주목을 받는",
      accentTitle: "방향인가요?",
      body: "아니면",
      quote: "오래 신뢰를 쌓는\n방향인가요?",
      footer: "방향은 결국 말투와 선택, 반복에서 드러납니다.",
    },
    {
      eyebrow: "YOUR STORY",
      title: "다음 카드뉴스의 주인공은",
      accentTitle: "누구인가요?",
      body: "인물 분석, 브랜드 스토리, 직업별 캐릭터 카드까지 같은 구조로 확장할 수 있습니다.\n\n표지, 핵심 분석, 해설, 점수, 질문 장만 바꾸면 바로 다른 주제로 재사용할 수 있습니다.",
      quote: "한 사람의 구조를 읽으면, 콘텐츠의 구조도 선명해집니다.",
      footer: "프로젝트 저장 후 문구만 바꿔 다음 카드뉴스에 바로 재사용하세요.",
    },
  ];
}

function createEmptyProject() {
  return {
    projectId: "",
    projectTitle: "새 카드뉴스",
    brand: "FORTUNE INSIGHT",
    templateKey: "editorial-story",
    backgroundImageUrl: "",
    slides: createDefaultSlides(),
  };
}

function mapProjectToEditor(project: CardProject) {
  return {
    projectId: project.id,
    projectTitle: project.title,
    brand: project.brand ?? "FORTUNE INSIGHT",
    templateKey: project.templateKey,
    backgroundImageUrl: project.backgroundImageUrl ?? "",
    slides: project.slides.length > 0 ? project.slides : createDefaultSlides(),
  };
}

export default function CardNewsStudioClient() {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [projectId, setProjectId] = useState("");
  const [projectTitle, setProjectTitle] = useState("새 카드뉴스");
  const [brand, setBrand] = useState("FORTUNE INSIGHT");
  const [templateKey, setTemplateKey] = useState("editorial-story");
  const [backgroundImageUrl, setBackgroundImageUrl] = useState("");
  const [slides, setSlides] = useState<CardSlide[]>(createDefaultSlides());
  const [frames, setFrames] = useState<CardFrame[]>([]);
  const [pngFrames, setPngFrames] = useState<PngFrame[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [stageMode, setStageMode] = useState<"html" | "png">("html");
  const [projects, setProjects] = useState<CardProject[]>([]);
  const [busyAction, setBusyAction] = useState<"preview" | "png" | "save" | "delete" | null>(null);
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [error, setError] = useState("");

  async function fetchProjects(preferredId?: string) {
    const res = await fetch("/api/card-news/projects", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error ?? `프로젝트 목록 조회 실패 (HTTP ${res.status})`);
    }
    const nextProjects = (json.projects ?? []) as CardProject[];
    setProjects(nextProjects);

    if (preferredId) {
      const preferred = nextProjects.find((item) => item.id === preferredId);
      if (preferred) {
        const mapped = mapProjectToEditor(preferred);
        setProjectId(mapped.projectId);
        setProjectTitle(mapped.projectTitle);
        setBrand(mapped.brand);
        setTemplateKey(mapped.templateKey);
        setBackgroundImageUrl(mapped.backgroundImageUrl);
        setSlides(mapped.slides);
        setCurrentSlideIndex(0);
      }
    }
  }

  useEffect(() => {
    let active = true;

    Promise.all([
      fetch("/api/card-news/render", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/card-news/projects", { cache: "no-store" }).then((res) => res.json()),
    ])
      .then(([renderJson, projectJson]) => {
        if (!active) return;

        const nextTemplates = (renderJson.templates ?? []) as CardTemplate[];
        const nextProjects = (projectJson.projects ?? []) as CardProject[];
        setTemplates(nextTemplates);
        setProjects(nextProjects);

        if (renderJson.defaults?.templateKey) {
          setTemplateKey(renderJson.defaults.templateKey);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCurrentSlideIndex((current) => Math.min(current, Math.max(slides.length - 1, 0)));
  }, [slides.length]);

  const selectedTemplate = templates.find((template) => template.key === templateKey) ?? null;
  const activeSlide = slides[currentSlideIndex] ?? null;

  function updateSlide(index: number, patch: Partial<CardSlide>) {
    setSlides((current) => current.map((slide, slideIndex) => (slideIndex === index ? { ...slide, ...patch } : slide)));
  }

  function jumpToSlide(index: number) {
    setCurrentSlideIndex(Math.max(0, Math.min(slides.length - 1, index)));
  }

  function goToPreviousSlide() {
    setCurrentSlideIndex((current) => Math.max(0, current - 1));
  }

  function goToNextSlide() {
    setCurrentSlideIndex((current) => Math.min(slides.length - 1, current + 1));
  }

  function updateSlideStat(index: number, statIndex: number, patch: Partial<NonNullable<CardSlide["stats"]>[number]>) {
    setSlides((current) =>
      current.map((slide, slideIndex) => {
        if (slideIndex !== index) return slide;
        const stats = [...(slide.stats ?? [])];
        const currentStat = stats[statIndex];
        if (!currentStat) return slide;
        stats[statIndex] = { ...currentStat, ...patch };
        return { ...slide, stats };
      })
    );
  }

  function addSlideStat(index: number) {
    setSlides((current) =>
      current.map((slide, slideIndex) =>
        slideIndex === index
          ? {
              ...slide,
              stats: [...(slide.stats ?? []), { label: "새 포인트", value: "90%", tone: "accent" }],
            }
          : slide
      )
    );
  }

  function removeSlideStat(index: number, statIndex: number) {
    setSlides((current) =>
      current.map((slide, slideIndex) =>
        slideIndex === index
          ? {
              ...slide,
              stats: (slide.stats ?? []).filter((_, currentIndex) => currentIndex !== statIndex),
            }
          : slide
      )
    );
  }

  function addSlide() {
    setSlides((current) => {
      const nextIndex = current.length;
      setCurrentSlideIndex(nextIndex);
      return [
        ...current,
        {
          eyebrow: `SLIDE ${current.length + 1}`,
          title: "새 슬라이드",
          body: "새 메시지를 입력하세요.",
        },
      ];
    });
  }

  function removeSlide(index: number) {
    setSlides((current) => {
      if (current.length <= 1) return current;
      const nextSlides = current.filter((_, slideIndex) => slideIndex !== index);
      setCurrentSlideIndex((currentIndex) => {
        if (currentIndex > index) return currentIndex - 1;
        return Math.min(currentIndex, nextSlides.length - 1);
      });
      return nextSlides;
    });
  }

  function resetProject() {
    const next = createEmptyProject();
    setProjectId(next.projectId);
    setProjectTitle(next.projectTitle);
    setBrand(next.brand);
    setTemplateKey(next.templateKey);
    setBackgroundImageUrl(next.backgroundImageUrl);
    setSlides(next.slides);
    setCurrentSlideIndex(0);
    setStageMode("html");
    setFrames([]);
    setPngFrames([]);
    setError("");
  }

  function selectProject(project: CardProject) {
    const next = mapProjectToEditor(project);
    setProjectId(next.projectId);
    setProjectTitle(next.projectTitle);
    setBrand(next.brand);
    setTemplateKey(next.templateKey);
    setBackgroundImageUrl(next.backgroundImageUrl);
    setSlides(next.slides);
    setCurrentSlideIndex(0);
    setStageMode("html");
    setFrames([]);
    setPngFrames([]);
    setError("");
  }

  function projectPayload(overrides?: Partial<ReturnType<typeof createEmptyProject>>) {
    return {
      title: overrides?.projectTitle?.trim() || projectTitle.trim() || "새 카드뉴스",
      brand: overrides?.brand?.trim() || brand.trim() || "FORTUNE INSIGHT",
      templateKey: overrides?.templateKey ?? templateKey,
      backgroundImageUrl: (overrides?.backgroundImageUrl ?? backgroundImageUrl).trim() || null,
      slides: overrides?.slides ?? slides,
    };
  }

  async function requestFrames(output: "html" | "png", overrides?: Partial<ReturnType<typeof createEmptyProject>>) {
    const res = await fetch("/api/card-news/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...projectPayload(overrides),
        output,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error ?? `카드뉴스 렌더 실패 (HTTP ${res.status})`);
    }
    return json;
  }

  async function uploadBackground(file: File) {
    setUploadingBackground(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("seoFileName", `${projectTitle || "card-news"}-background`);

      const res = await fetch("/api/uploads/media", {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `배경 이미지 업로드 실패 (HTTP ${res.status})`);
      }

      setBackgroundImageUrl(String(json.url ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingBackground(false);
    }
  }

  async function saveProject() {
    setBusyAction("save");
    setError("");
    try {
      const payload = projectPayload();
      const res = await fetch(projectId ? `/api/card-news/projects/${projectId}` : "/api/card-news/projects", {
        method: projectId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `프로젝트 저장 실패 (HTTP ${res.status})`);
      }

      const project = json.project as CardProject;
      const next = mapProjectToEditor(project);
      setProjectId(next.projectId);
      setProjectTitle(next.projectTitle);
      setBrand(next.brand);
      setTemplateKey(next.templateKey);
      setBackgroundImageUrl(next.backgroundImageUrl);
      setSlides(next.slides);
      await fetchProjects(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteProject() {
    if (!projectId) {
      resetProject();
      return;
    }

    setBusyAction("delete");
    setError("");
    try {
      const res = await fetch(`/api/card-news/projects/${projectId}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error ?? `프로젝트 삭제 실패 (HTTP ${res.status})`);
      }
      resetProject();
      await fetchProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function renderPreview() {
    setBusyAction("preview");
    setError("");
    try {
      const json = await requestFrames("html");
      setFrames((json.frames ?? []) as CardFrame[]);
      setStageMode("html");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function renderPng() {
    setBusyAction("png");
    setError("");
    try {
      const json = await requestFrames("png");
      setPngFrames((json.frames ?? []) as PngFrame[]);
      setStageMode("png");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function loadTemplateExample() {
    const example = {
      projectId: "",
      projectTitle: "유재석은 어떤 사람인가?",
      brand: "FORTUNE INSIGHT",
      templateKey: "editorial-story",
      backgroundImageUrl: "",
      slides: createTemplateExampleSlides(),
    } as const;

    setProjectId(example.projectId);
    setProjectTitle(example.projectTitle);
    setBrand(example.brand);
    setTemplateKey(example.templateKey);
    setBackgroundImageUrl(example.backgroundImageUrl);
    setSlides(example.slides);
    setCurrentSlideIndex(0);
    setStageMode("html");
    setPngFrames([]);
    setError("");

    setBusyAction("preview");
    try {
      const json = await requestFrames("html", example);
      setFrames((json.frames ?? []) as CardFrame[]);
    } catch (err) {
      setFrames([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,440px)]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Studio</p>
                <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  4:5 에디토리얼 카드뉴스 스튜디오
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
                  카드뉴스를 한 장씩 집중해서 만들고, 같은 화면에서 바로 넘겨보며 흐름을 점검하는 스테이지형 편집기입니다.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">4:5 · 1080x1350</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">
                  슬라이드 {currentSlideIndex + 1} / {slides.length}
                </span>
                {projectId ? (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">saved project</span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">draft</span>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">01</div>
                <div className="mt-2 font-medium text-slate-900">예시 흐름 먼저 보기</div>
                <p className="mt-1 leading-6">유재석 1~7장 예시를 불러와 전체 구조를 한 번에 이해합니다.</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">02</div>
                <div className="mt-2 font-medium text-slate-900">현재 슬라이드만 수정</div>
                <p className="mt-1 leading-6">지금 선택한 1장만 편집하고, 이전/다음으로 넘기며 흐름을 확인합니다.</p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">03</div>
                <div className="mt-2 font-medium text-slate-900">HTML → PNG 순서로 확인</div>
                <p className="mt-1 leading-6">같은 슬라이드 인덱스로 HTML과 PNG 결과를 오가며 비교합니다.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <div className="mb-2 text-sm font-medium text-slate-700">프로젝트 제목</div>
                <input
                  value={projectTitle}
                  onChange={(event) => setProjectTitle(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">브랜드 라벨</div>
                <input
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">템플릿</div>
                <select
                  value={templateKey}
                  onChange={(event) => setTemplateKey(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                >
                  {templates.map((template) => (
                    <option key={template.key} value={template.key}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedTemplate ? (
              <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Selected Template</div>
                    <div className="mt-2 text-base font-semibold text-slate-950">{selectedTemplate.name}</div>
                    <p className="mt-1 max-w-2xl leading-6 text-slate-600">{selectedTemplate.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-700">
                      {selectedTemplate.width}x{selectedTemplate.height}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-700">4:5 ratio</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-3xl border border-slate-200 p-4">
                <div className="mb-3 text-sm font-medium text-slate-700">배경 이미지</div>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
                    {uploadingBackground ? "업로드 중..." : "이미지 업로드"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingBackground || busyAction !== null}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (!file) return;
                        await uploadBackground(file);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setBackgroundImageUrl("")}
                    disabled={uploadingBackground || busyAction !== null || !backgroundImageUrl}
                    className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    배경 지우기
                  </button>
                </div>

                <label className="mt-4 block">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-slate-500">고급: 직접 URL 입력</div>
                  <input
                    value={backgroundImageUrl}
                    onChange={(event) => setBackgroundImageUrl(event.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                </label>
                <p className="mt-3 text-xs leading-6 text-slate-500">
                  로컬 파일을 직접 올리면 자동으로 서버 공개 URL로 변환됩니다. URL 입력은 외부 공개 이미지를 쓸 때만 필요합니다.
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-700">배경 미리보기</div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">현재 슬라이드용 공통 배경</div>
                </div>
                {backgroundImageUrl ? (
                  <Image
                    src={backgroundImageUrl}
                    alt="카드뉴스 배경 미리보기"
                    width={1080}
                    height={1350}
                    unoptimized
                    className="aspect-[4/5] w-full rounded-2xl border border-slate-200 object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/5] w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center text-sm leading-6 text-slate-400">
                    아직 배경 이미지가 없습니다.
                    <br />
                    위에서 이미지를 올리면 여기서 바로 확인할 수 있습니다.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={loadTemplateExample}
                disabled={busyAction !== null || uploadingBackground}
                className="inline-flex h-10 items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                템플릿 보기 · 유재석 1~7장 예시
              </button>
              <button
                type="button"
                onClick={resetProject}
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                새 프로젝트
              </button>
              <button
                type="button"
                onClick={saveProject}
                disabled={busyAction !== null || uploadingBackground}
                className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "save" ? "저장 중..." : "프로젝트 저장"}
              </button>
              <button
                type="button"
                onClick={renderPreview}
                disabled={busyAction !== null || uploadingBackground}
                className="inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "preview" ? "프레임 생성 중..." : "HTML 프레임 생성"}
              </button>
              <button
                type="button"
                onClick={renderPng}
                disabled={busyAction !== null || uploadingBackground}
                className="inline-flex h-10 items-center justify-center rounded-full bg-amber-500 px-4 text-sm font-medium text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "png" ? "PNG 생성 중..." : "PNG 출력"}
              </button>
              <button
                type="button"
                onClick={deleteProject}
                disabled={busyAction !== null || uploadingBackground}
                className="inline-flex h-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "delete" ? "삭제 중..." : "프로젝트 삭제"}
              </button>
            </div>
          </section>

          {activeSlide ? (
            <CardNewsSlideInspector
              slide={activeSlide}
              slideIndex={currentSlideIndex}
              slideCount={slides.length}
              onSlideChange={(patch) => updateSlide(currentSlideIndex, patch)}
              onSlideStatChange={(statIndex, patch) => updateSlideStat(currentSlideIndex, statIndex, patch)}
              onAddStat={() => addSlideStat(currentSlideIndex)}
              onRemoveStat={(statIndex) => removeSlideStat(currentSlideIndex, statIndex)}
              onPrevious={goToPreviousSlide}
              onNext={goToNextSlide}
              onJumpToSlide={jumpToSlide}
              onAddSlide={addSlide}
              onRemoveSlide={() => removeSlide(currentSlideIndex)}
              canRemoveSlide={slides.length > 1}
              headerSlot={
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  편집 중: {currentSlideIndex + 1} / {slides.length}
                </span>
              }
            />
          ) : null}

          {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6 self-start">
          <section className="rounded-3xl border border-slate-200 bg-slate-950 p-5 text-slate-50 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Preview Stage</p>
                <h3 className="mt-3 text-xl font-semibold text-white">{projectTitle || "새 카드뉴스"}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  지금 선택한 슬라이드를 중심으로 HTML과 PNG 결과를 같은 위치에서 번갈아 확인합니다.
                </p>
              </div>
              <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                현재 {currentSlideIndex + 1} / {slides.length}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStageMode("html")}
                className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition ${
                  stageMode === "html"
                    ? "bg-amber-500 text-slate-950"
                    : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
                }`}
              >
                HTML 프리뷰
              </button>
              <button
                type="button"
                onClick={() => setStageMode("png")}
                className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition ${
                  stageMode === "png"
                    ? "bg-amber-500 text-slate-950"
                    : "border border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
                }`}
              >
                PNG 결과
              </button>
            </div>
          </section>

          <CardNewsPreviewStage
            mode={stageMode}
            title={stageMode === "html" ? "슬라이드" : "PNG"}
            description={
              stageMode === "html"
                ? "카드 전체가 한 화면에 보이도록 축소해서 미리봅니다. 좌우 버튼과 번호 점프로 흐름을 확인하세요."
                : "실제 출력된 이미지를 한 장씩 넘겨보며 잘리지 않는지 바로 체크하세요."
            }
            items={stageMode === "html" ? frames : pngFrames}
            activeIndex={currentSlideIndex}
            onActiveIndexChange={jumpToSlide}
            emptyLabel={
              stageMode === "html"
                ? "아직 생성된 HTML 프레임이 없습니다. 왼쪽에서 문구를 고친 뒤 프레임 생성 버튼을 눌러보세요."
                : "아직 PNG 출력 결과가 없습니다. 프레임을 확인한 뒤 PNG 출력을 눌러 실제 이미지를 생성해보세요."
            }
          />

          {stageMode === "png" && pngFrames[currentSlideIndex] ? (
            <a
              href={pngFrames[currentSlideIndex]?.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              현재 PNG 새 탭에서 보기
            </a>
          ) : null}

          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-7 text-slate-50 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Saved</p>
                <h3 className="mt-3 text-xl font-semibold text-white">프로젝트 라이브러리</h3>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">{projects.length} items</span>
            </div>

            <div className="mt-5 space-y-3">
              {projects.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300">
                  아직 저장된 카드뉴스가 없습니다. 초안을 만든 뒤 프로젝트 저장을 눌러두면 재편집이 쉬워집니다.
                </div>
              ) : (
                projects.slice(0, 8).map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => selectProject(project)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      project.id === projectId
                        ? "border-amber-300 bg-amber-400/10"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{project.title}</div>
                      <div className="text-xs text-slate-400">{project.slideCount} slides</div>
                    </div>
                    <div className="mt-2 text-xs text-slate-300">
                      {project.templateKey} · {new Date(project.updatedAt).toLocaleString("ko-KR")}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <section className="rounded-3xl border border-slate-200 bg-slate-950 p-7 text-slate-50 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Build rules</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-200">
              <li>표지, 분석, 해설, 점수, 질문 장이 흐름으로 이어져야 합니다.</li>
              <li>한 장 안에서는 한 메시지만 크게 보이게 두고 나머지는 보조 정보로 둡니다.</li>
              <li>편집과 프리뷰는 같은 슬라이드 인덱스를 공유해서 같이 움직입니다.</li>
              <li>템플릿 보기 버튼을 누르면 유재석 예시 7장이 즉시 로드됩니다.</li>
            </ul>
          </section>
        </aside>
      </section>
    </div>
  );
}
