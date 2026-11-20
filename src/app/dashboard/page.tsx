import { Suspense } from "react";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getStudentHomeData } from "@/lib/student-home";
import { StudentHome } from "@/components/student-home";
import CabinetPageLoading from "@/components/cabinet-page-loading";

async function Content() {
  const user = await requireRole("STUDENT");
  return <StudentHome key={user.id} initial={await getStudentHomeData(prisma, user)} />;
}
export default function Dashboard() {
  return <Suspense fallback={<CabinetPageLoading />}><Content /></Suspense>;
}
