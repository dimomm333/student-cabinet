import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { PersonalConsultations } from "@/components/personal-consultations";

export default function StudentConsultationsPage() {
  return <Suspense fallback={<CabinetPageLoading />}><PersonalConsultations role="STUDENT" /></Suspense>;
}
