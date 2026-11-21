import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { DormitoryStudent, type DormSearch } from "@/components/dormitory-student";

export const metadata = { title: "Общежитие" };
export default function Page({ searchParams }: { searchParams: DormSearch }) {
  return <Suspense fallback={<CabinetPageLoading />}><DormitoryStudent searchParams={searchParams} /></Suspense>;
}
