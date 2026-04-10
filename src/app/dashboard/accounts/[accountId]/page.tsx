import DashboardShell from "@/app/dashboard/_components/DashboardShell";
import AccountWorkspaceClient from "./AccountWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;

  return (
    <DashboardShell
      title="계정 워크스페이스"
      subtitle="콘텐츠 작성, 성과, 설정을 계정 단위로 관리합니다."
      showBackToDashboard
    >
      <AccountWorkspaceClient accountId={accountId} />
    </DashboardShell>
  );
}
