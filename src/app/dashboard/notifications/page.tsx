import { requireRole } from "@/lib/access";
import { ServiceNotifications } from "@/components/services-notifications";
export const metadata = { title: "Уведомления" };
export default async function Page() { await requireRole("STUDENT"); return <><div className="dashboard-title"><div><span className="eyebrow">Кабинет студента</span><h1>Уведомления</h1><p>Статусы заявлений и ответы сотрудников.</p></div></div><ServiceNotifications /></>; }
