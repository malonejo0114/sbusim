import Link from "next/link";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "@/server/auth";

export default async function Home() {
  const store = await cookies();
  const isAuthed = Boolean(store.get(AUTH_COOKIE_NAME)?.value);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-100 text-zinc-950">
      <main className="mx-auto max-w-5xl px-6 py-20">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="inline-flex items-center rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-sm text-zinc-700 shadow-sm backdrop-blur">
              Threads Scheduler MVP
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              스부심(SBUSIM)
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-700">
              Threads 예약 발행, 카드뉴스 제작, 네이버 키워드 인사이트를 한 화면에서 다루는 작업 도구.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <Link
              href={isAuthed ? "/dashboard" : "/login"}
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800"
            >
              {isAuthed ? "대시보드로 이동" : "로그인"}
            </Link>
            <Link
              href={isAuthed ? "/tools" : "/login"}
              className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-200 bg-white/70 px-5 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur hover:bg-white"
            >
              도구 허브 보기
            </Link>
          </div>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">Threads 예약 발행</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-700">
              계정별 예약, 즉시 발행, 댓글 체인, 이미지 업로드를 한 흐름으로 다룹니다.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">카드뉴스 제작</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-700">
              HTML 템플릿으로 슬라이드를 만들고 PNG로 뽑는 편집 스튜디오로 확장합니다.
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold">네이버 키워드 인사이트</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-700">
              검색량, 연관검색어, 경쟁도, 입찰가를 한 번에 보는 키워드 리서치 화면입니다.
            </p>
          </div>
        </div>

        <div className="mt-12 text-sm text-zinc-600">
          로컬 실행 방법은 <code className="rounded bg-zinc-100 px-1.5 py-0.5">README.md</code>를 참고하세요.
        </div>
        <div className="mt-3 text-sm text-zinc-600">
          개인정보처리방침:{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            /privacy
          </Link>
        </div>
      </main>
    </div>
  );
}
