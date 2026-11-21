import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { AnnouncementForm } from "@/components/announcement-form";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { dormAnnouncementTargets } from "@/lib/dormitory-queries";
import "@/app/dormitory.css";
async function Content() {
  const user = await requireRole("ADMIN");
  const [departments, dormitories, total] = await Promise.all([
    prisma.academicDepartment.findMany({ select: { id: true, name: true, faculty: true }, orderBy: { name: "asc" } }),
    dormAnnouncementTargets(prisma, user),
    prisma.dormitory.count({ where: { archivedAt: null } }),
  ]);
  return <><div className="dashboard-title"><h1>Новости и объявления</h1></div>
    <AnnouncementForm requestId={randomUUID()} departments={departments} dormitories={dormitories} allResidents={total > 0 && total === dormitories.length} />
  </>;
}
export default function Page() { return <Suspense fallback={<CabinetPageLoading />}><Content /></Suspense>; }
