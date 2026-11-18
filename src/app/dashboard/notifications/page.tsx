import { requireRole } from "@/lib/access";
import { ServiceNotifications } from "@/components/services-notifications";
import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
export const metadata = { title: "Уведомления" };
async function AuthorizedNotifications() { await requireRole("STUDENT"); return <><div className="dashboard-title"><div><span className="eyebrow">Кабинет студента</span><h1>Уведомления</h1><p>События личного кабинета. Новые уведомления появляются автоматически.</p></div></div><ServiceNotifications /></>; }
export default function Page() {
  return <Suspense fallback={<CabinetPageLoading />}><AuthorizedNotifications /></Suspense>;
}
