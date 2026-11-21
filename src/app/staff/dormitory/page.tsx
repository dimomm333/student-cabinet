import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { DormitoryStaff } from "@/components/dormitory-staff";
import type { DormSearch } from "@/components/dormitory-student";

export const metadata = { title: "Общежития" };
export default function Page({ searchParams }: { searchParams: DormSearch }) {
  return <Suspense fallback={<CabinetPageLoading />}><DormitoryStaff role="TECHNICAL_STAFF" searchParams={searchParams} /></Suspense>;
}
