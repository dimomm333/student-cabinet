import type { Metadata } from "next";
import { WorkspaceLayout } from "@/components/workspace-pages";

export const metadata: Metadata = { title: "Кабинет преподавателя" };
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayout role="TEACHER">{children}</WorkspaceLayout>;
}
