import DashboardShell from "../_components/DashboardShell";
import AiPromptSettingsClient from "./AiPromptSettingsClient";

export const dynamic = "force-dynamic";

export default function DashboardSettingsPage() {
  return (
    <DashboardShell
      title="생성 엔진 설정"
      subtitle="글 생성에 들어가는 시스템 프롬프트를 직접 수정할 수 있습니다."
      showBackToDashboard
    >
      <AiPromptSettingsClient />
    </DashboardShell>
  );
}
