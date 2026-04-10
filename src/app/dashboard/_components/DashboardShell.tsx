import Link from "next/link";

export default function DashboardShell(props: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  showBackToDashboard?: boolean;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-sm font-bold text-white">S</div>
            <div>
              <div className="text-sm font-semibold leading-5">스부심 (SBUSIM)</div>
              <div className="text-xs text-slate-500">Threads Scheduler</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {props.showBackToDashboard ? (
              <Link
                href="/dashboard"
                className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                관리 홈
              </Link>
            ) : null}
            <Link
              href="/dashboard/settings"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              생성 설정
            </Link>
            <Link
              href="/tools"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              도구 허브
            </Link>
            <Link
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-full border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              랜딩
            </Link>
            <a
              href="/api/auth/logout"
              className="inline-flex h-9 items-center justify-center rounded-full bg-slate-900 px-4 text-xs font-medium text-white hover:bg-slate-800"
            >
              로그아웃
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{props.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{props.subtitle}</p>
        </div>
        {props.children}
      </main>
    </div>
  );
}
