import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import type { Role } from "@/generated/prisma/enums";
import CabinetPageLoading from "./cabinet-page-loading";
import { ClearanceWorkspace } from "./clearance-workspace";
async function Content({ role }: { role: Role }) { await requireRole(role); return <ClearanceWorkspace role={role} />; }
export function ClearancePage({ role }: { role: Role }) { return <Suspense fallback={<CabinetPageLoading />}><Content role={role} /></Suspense>; }
