import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { AnnouncementForm } from "@/components/announcement-form";
import CabinetPageLoading from "@/components/cabinet-page-loading";
async function Content() {
  await requireRole("ADMIN");
  const departments = await prisma.academicDepartment.findMany({ select: { id: true, name: true, faculty: true }, orderBy: { name: "asc" } });
  return <><div className="dashboard-title"><h1>Новости и объявления</h1></div><AnnouncementForm requestId={randomUUID()} departments={departments} /></>;
}
export default function Page() { return <Suspense fallback={<CabinetPageLoading />}><Content /></Suspense>; }
