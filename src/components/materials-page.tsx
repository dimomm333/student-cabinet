import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import CabinetPageLoading from "./cabinet-page-loading";
import { MaterialsWorkspace } from "./materials-workspace";
async function Content({ role }: { role: "STUDENT" | "TEACHER" }) {
  await requireRole(role);
  return <MaterialsWorkspace role={role} />;
}
export function MaterialsPage({ role }: { role: "STUDENT" | "TEACHER" }) { return <Suspense fallback={<CabinetPageLoading />}><Content role={role} /></Suspense>; }
