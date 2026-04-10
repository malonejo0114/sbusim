import DashboardShell from "@/app/dashboard/_components/DashboardShell";
import CardNewsStudioClient from "@/app/tools/cards/CardNewsStudioClient";

export default function CardNewsPage() {
  return (
    <DashboardShell
      title="카드뉴스 제작"
      subtitle="배경 이미지를 올리고 슬라이드 문구를 채운 뒤, 프리뷰 확인 후 PNG로 뽑는 카드뉴스 작업 공간입니다."
      showBackToDashboard
    >
      <CardNewsStudioClient />
    </DashboardShell>
  );
}
