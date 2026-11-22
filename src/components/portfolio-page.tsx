import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import { listPortfolio } from "@/lib/portfolio-repository";
import CabinetPageLoading from "./cabinet-page-loading";
import { PortfolioWorkspace } from "./portfolio-workspace";

type Role = "STUDENT" | "DEANERY_STAFF";

async function Content({ role }: { role: Role }) {
  const user = await requireRole(role);
  return <PortfolioWorkspace key={user.id} student={role === "STUDENT"} initialItems={await listPortfolio(user)} />;
}

export function PortfolioPage({ role }: { role: Role }) {
  return <Suspense fallback={<CabinetPageLoading />}><Content role={role} /></Suspense>;
}
