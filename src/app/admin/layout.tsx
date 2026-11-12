import type { Metadata } from "next";
import { WorkspaceLayout } from "@/components/workspace-pages";

export const metadata: Metadata = { title: "Кабинет администратора" };
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout role="ADMIN">{children}</WorkspaceLayout>;
}
