import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { BrsError, getBrsWorkspace, serializeWorkspace } from "@/lib/brs-repository";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";
import { BrsWorkspaceView } from "./brs-workspace";
import CabinetPageLoading from "./cabinet-page-loading";

type Props = { role: "STUDENT" | "TEACHER" | "DEANERY_STAFF"; section: "grades" | "session" | "plans" | "admissions"; searchParams: Promise<Record<string, string | string[] | undefined>> };
async function Content({ role, section, searchParams }: Props) {
  const user = await requireRole(role);
  const params = await searchParams;
  if (Array.isArray(params.planId) || (params.planId?.length ?? 0) > 128) notFound();
  let model;
  try {
    model = await getBrsWorkspace(prisma, user, params.planId ?? "");
  } catch (error) {
    if (error instanceof DeaneryAccessDenied || error instanceof BrsError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  return <BrsWorkspaceView initial={serializeWorkspace(model)} section={section} />;
}
export function BrsPage(props: Props) { return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>; }
