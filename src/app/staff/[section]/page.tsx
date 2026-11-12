import { WorkspaceSection } from "@/components/workspace-pages";

export default function StaffSectionPage({ params }: { params: Promise<{ section: string }> }) {
  return <WorkspaceSection role="TECHNICAL_STAFF" params={params} />;
}
