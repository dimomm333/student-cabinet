import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/access";
import { passRights } from "@/lib/student-passes";
import { prisma } from "@/lib/prisma";
import CabinetPageLoading from "./cabinet-page-loading";
import { PassWorkspace } from "./pass-workspace";

type Props = { role: "ADMIN" | "TECHNICAL_STAFF" };
async function Content({ role }: Props) {
  const user = await requireRole(role);
  const rights = await passRights(prisma, user);
  if (!rights) notFound();
  return <PassWorkspace canManage={rights.canManage} canVerify={rights.canVerify} />;
}
export function PassPage(props: Props) {
  return <Suspense fallback={<CabinetPageLoading />}><Content {...props} /></Suspense>;
}
