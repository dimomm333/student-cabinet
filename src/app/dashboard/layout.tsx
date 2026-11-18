import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import { ProtectedLoading } from "@/components/workspace-pages";
import { NotificationsProvider } from "@/components/notifications-provider";

export const metadata: Metadata = { title: "Кабинет студента" };

async function AuthorizedDashboard({ children }: { children: React.ReactNode }) {
  const user = await requireRole("STUDENT");
  return <NotificationsProvider key={`${user.id}:${user.role}`} identity={`${user.id}:${user.role}`}><DashboardShell name={user.name}>{children}</DashboardShell></NotificationsProvider>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<ProtectedLoading />}><AuthorizedDashboard>{children}</AuthorizedDashboard></Suspense>;
}
