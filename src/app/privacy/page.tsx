import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 스부심(SBUSIM)",
  description: "스부심(SBUSIM) 개인정보처리방침",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">개인정보처리방침</h1>
            <p className="mt-2 text-sm text-slate-600">
              시행일: 2026년 3월 6일
              <br />
              최종 업데이트: 2026년 3월 6일
            </p>
          </div>

          <section className="space-y-4 text-sm leading-7 text-slate-700">
            <p>
              스부심(SBUSIM)은 Threads 공식 Graph API를 통해 예약 발행 및 운영 자동화 기능을 제공하며, 서비스 운영을 위해 최소한의
              개인정보를 처리합니다.
            </p>

            <h2 className="pt-3 text-base font-semibold text-slate-900">1. 수집하는 정보</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>운영자 로그인 정보: 서비스 접속 식별용 아이디</li>
              <li>Threads 연동 정보: Threads 사용자 ID, 권한 토큰(암호화 저장), 토큰 만료시각</li>
              <li>게시 운영 정보: 예약 본문, 미디어 URL, 예약 시각, 발행 결과/오류 로그</li>
              <li>성과 지표 정보: 조회수, 좋아요, 댓글, 리포스트, 인용 지표</li>
            </ul>

            <h2 className="pt-3 text-base font-semibold text-slate-900">2. 이용 목적</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Threads 계정 연동, 예약 발행, 발행 결과 확인</li>
              <li>예약/실패/재시도 처리 및 서비스 안정성 확보</li>
              <li>성과 통계 제공 및 운영 자동화 기능 제공</li>
            </ul>

            <h2 className="pt-3 text-base font-semibold text-slate-900">3. 보관 기간</h2>
            <p>
              연동 정보 및 운영 데이터는 서비스 제공 기간 동안 보관하며, 이용자가 연동 해제/삭제를 요청하거나 서비스 목적 달성 시 지체 없이
              파기합니다. 법령상 보존 의무가 있는 경우 해당 기간 동안 보관 후 파기합니다.
            </p>

            <h2 className="pt-3 text-base font-semibold text-slate-900">4. 제3자 제공 및 처리 위탁</h2>
            <p>
              서비스 기능 제공을 위해 Meta(Threads API)로 게시 관련 데이터가 전송됩니다. 또한 인프라 제공 과정에서 호스팅/데이터베이스
              사업자가 기술적으로 데이터를 처리할 수 있습니다. 법령상 근거 또는 이용자 동의 없이 판매/양도 목적의 제3자 제공은 하지 않습니다.
            </p>

            <h2 className="pt-3 text-base font-semibold text-slate-900">5. 정보주체 권리</h2>
            <p>
              이용자는 연동 해제, 데이터 삭제, 처리 정지를 요청할 수 있습니다. Threads 데이터 삭제 요청 엔드포인트는 아래와 같습니다.
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
              https://app.sbusim.co.kr/api/auth/threads/data-deletion
            </p>

            <h2 className="pt-3 text-base font-semibold text-slate-900">6. 안전성 확보 조치</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Threads access token 암호화 저장(AES-GCM)</li>
              <li>서버 측 권한 검증 및 최소 권한 원칙 적용</li>
              <li>운영 로그 기반 장애/보안 이상 모니터링</li>
            </ul>

            <h2 className="pt-3 text-base font-semibold text-slate-900">7. 문의</h2>
            <p>개인정보 관련 문의: support@sbusim.co.kr</p>
          </section>

          <div className="mt-8 border-t border-slate-200 pt-5">
            <Link href="/" className="text-sm font-medium text-slate-700 underline underline-offset-4">
              홈으로 이동
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
