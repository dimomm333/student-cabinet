import { Suspense } from "react";
import type { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/access";
import CabinetPageLoading from "./cabinet-page-loading";
import { ServicesWorkspace } from "./services-workspace";

type Props = { role: Role; path: string; searchParams: Promise<Record<string, string | string[] | undefined>> };
async function Content({ role, path, searchParams }: Props) {
  await requireRole(role);
  const query = await searchParams;
  const scalar = (key: string) => typeof query[key] === "string" && query[key].length <= 128 ? query[key] : "";
  return <ServicesWorkspace key={scalar("requestId") || scalar("service") || scalar("tab")} path={path} student={role === "STUDENT"} requestId={scalar("requestId")} serviceCode={scalar("service")} initialTab={scalar("tab")} />;
}
export function ServicesPage(props: Props) { return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>; }
