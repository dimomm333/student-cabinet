import type { Metadata } from "next";
import { WorkspaceLayout } from "@/components/workspace-pages";

export const metadata: Metadata = { title: "Кабинет технического персонала" };
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout role="TECHNICAL_STAFF">{children}</WorkspaceLayout>;
}
