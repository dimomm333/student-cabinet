import { WorkspaceSection } from "@/components/workspace-pages";

export default function TeacherSectionPage({ params }: { params: Promise<{ section: string }> }) {
  return <WorkspaceSection role="TEACHER" params={params} />;
}
