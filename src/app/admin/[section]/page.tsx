import { WorkspaceSection } from "@/components/workspace-pages";

export default function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  return <WorkspaceSection role="ADMIN" params={params} />;
}
