import Link from "next/link";
import DashboardShell from "@/app/dashboard/_components/DashboardShell";

const modules = [
  {
    href: "/dashboard",
    title: "Threads 예약발행",
    description: "즉시 발행, 예약 발행, 댓글 체인, 이미지 업로드를 묶은 운영 표면.",
    tag: "Live",
  },
  {
    href: "/tools/cards",
    title: "카드뉴스 제작",
    description: "HTML 템플릿으로 슬라이드를 만들고 PNG로 뽑는 카드뉴스 스튜디오.",
    tag: "Build",
  },
  {
    href: "/tools/naver-keywords",
    title: "네이버 키워드 인사이트",
    description: "검색량, 연관검색어, 경쟁도, 입찰가를 한 번에 보는 분석 모듈.",
    tag: "Research",
  },
] as const;

export default function ToolsHubPage() {
  return (
    <DashboardShell
      title="도구 허브"
      subtitle="Threads 운영, 카드뉴스 제작, 네이버 키워드 인사이트를 한곳에서 고르는 작업 출발점입니다."
      showBackToDashboard
    >
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-7 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Workspace</p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            한 번에 고르고, 바로 작업으로 들어가는 허브.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
            운영, 제작, 리서치를 따로 흩어두지 않고 같은 앱 안에서 이어 붙입니다. 앞으로 추가될 모듈도 이 진입점에서 확장합니다.
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">작업 순서</p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">3 modules</span>
          </div>
          <div className="mt-5 space-y-4 text-sm text-slate-700">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">01</div>
              <div className="mt-1 font-medium text-slate-900">Threads 발행으로 바로 작업</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">02</div>
              <div className="mt-1 font-medium text-slate-900">카드뉴스 템플릿을 돌려 쓰기</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">03</div>
              <div className="mt-1 font-medium text-slate-900">키워드 인사이트로 주제 검증</div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-5 md:grid-cols-3">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {module.tag}
              </span>
              <span className="text-xs text-slate-400 transition group-hover:text-slate-600">Open</span>
            </div>
            <h3 className="mt-5 text-lg font-semibold text-slate-950">{module.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
          </Link>
        ))}
      </section>
    </DashboardShell>
  );
}
