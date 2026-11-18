import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import type { Role } from "@/generated/prisma/enums";
import { roleHomes } from "@/lib/roles";
import { ServiceNotifications } from "./services-notifications";
import CabinetPageLoading from "./cabinet-page-loading";
async function Content({ role }: { role: Role }) {
  await requireRole(role);
  return <><div className="dashboard-title"><div><h1>Уведомления</h1><p>События вашего личного кабинета. Новые уведомления появляются автоматически.</p></div></div><ServiceNotifications home={roleHomes[role]} /></>;
}
export function NotificationsPage({ role }: { role: Role }) { return <Suspense fallback={<CabinetPageLoading />}><Content role={role} /></Suspense>; }
