import DashboardShell from "@/app/dashboard/_components/DashboardShell";
import NaverKeywordClient from "@/app/tools/naver-keywords/NaverKeywordClient";

export default function NaverKeywordsPage() {
  return (
    <DashboardShell
      title="네이버 키워드 인사이트"
      subtitle="검색량, 연관검색어, 경쟁도, PC/MOBILE 입찰가를 한 화면에서 보여주는 분석 모듈입니다."
      showBackToDashboard
    >
      <NaverKeywordClient />
    </DashboardShell>
  );
}
