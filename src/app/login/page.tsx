import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { AUTH_COOKIE_NAME } from "@/server/auth";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage(props: LoginPageProps) {
  const store = await cookies();
  if (store.get(AUTH_COOKIE_NAME)?.value) {
    redirect("/dashboard");
  }

  const searchParams = (await props.searchParams) ?? {};
  const nextParam = searchParams.next;
  const nextPath = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : "/dashboard";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#dbeafe_0%,#e2e8f0_35%,#0f172a_100%)] px-6 py-10 text-zinc-100">
      <div className="mx-auto flex min-h-[80vh] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/20 bg-white/10 shadow-2xl backdrop-blur-xl md:grid-cols-2">
          <div className="bg-gradient-to-br from-cyan-400/20 via-sky-500/15 to-blue-900/30 p-10">
            <div className="inline-flex items-center rounded-full border border-white/25 px-3 py-1 text-xs font-semibold tracking-wide">
              SBUSIM ACCESS
            </div>
            <h1 className="mt-6 text-3xl font-semibold leading-tight">Threads 운영 센터 로그인</h1>
            <p className="mt-4 text-sm leading-7 text-zinc-200/90">
              계정 연결, 예약 발행, 이슈 기반 글 생성을 위해 먼저 운영자 인증이 필요합니다.
            </p>
            <div className="mt-8 grid gap-3 text-xs text-zinc-200/80">
              <div className="rounded-xl border border-white/15 bg-black/20 px-3 py-2">공식 Threads Graph API만 사용</div>
              <div className="rounded-xl border border-white/15 bg-black/20 px-3 py-2">계정별 프록시/멀티계정 운영 가능</div>
              <div className="rounded-xl border border-white/15 bg-black/20 px-3 py-2">예약 + 즉시 발행 통합 관리</div>
            </div>
          </div>

          <div className="bg-white p-10 text-zinc-900">
            <h2 className="text-xl font-semibold">로그인</h2>
            <p className="mt-2 text-sm text-zinc-600">운영자 아이디와 비밀번호를 입력하세요.</p>
            <div className="mt-8">
              <LoginForm nextPath={nextPath} />
            </div>
            <div className="mt-6 text-xs text-zinc-500">
              개인정보처리방침:{" "}
              <a href="/privacy" className="underline underline-offset-4">
                https://app.sbusim.co.kr/privacy
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
