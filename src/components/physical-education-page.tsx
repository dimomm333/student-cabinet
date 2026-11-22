import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { BrsError } from "@/lib/brs-repository";
import { DeaneryAccessDenied } from "@/lib/deanery-repository";
import { prisma } from "@/lib/prisma";
import { physicalStudent, physicalWorkspace } from "@/lib/physical-education-queries";
import CabinetPageLoading from "./cabinet-page-loading";
import { PhysicalStudentView } from "./physical-education-student";
import { PhysicalWorkspaceView } from "./physical-education-workspace";
import "@/app/physical-education.css";

type Props = { role: "STUDENT" | "TEACHER" | "ADMIN" | "DEANERY_STAFF"; path: string; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function read<T>(model: Promise<T>) {
  try { return await model; }
  catch (error) {
    if (error instanceof DeaneryAccessDenied || error instanceof BrsError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
}

async function Content({ role, path, searchParams }: Props) {
  const actor = await requireRole(role);
  const params = await searchParams;
  function field(name: string, max = 128) {
    const value = params[name];
    if (Array.isArray(value) || (value?.length ?? 0) > max) notFound();
    return value?.trim() ?? "";
  }
  if (role === "STUDENT") {
    const model = await read(physicalStudent(prisma, actor, field("term")));
    return <PhysicalStudentView model={model} />;
  }
  const query = field("q", 80), groupQuery = field("groupQuery", 80);
  const model = await read(physicalWorkspace(prisma, actor, field("group"), field("slot"), query));
  return <PhysicalWorkspaceView model={model} role={role} path={path} query={query} groupQuery={groupQuery} />;
}

export function PhysicalEducationPage(props: Props) {
  return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>;
}
