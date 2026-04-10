import DashboardShell from "./_components/DashboardShell";
import ManagementClient from "./ManagementClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return (
    <DashboardShell
      title="관리 홈"
      subtitle="계정별 예약/발행 현황을 캘린더와 지표로 확인하고, 각 계정 워크스페이스로 이동하세요."
    >
      <ManagementClient />
    </DashboardShell>
  );
}
