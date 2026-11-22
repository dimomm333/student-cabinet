import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { ConsultationEditor } from "@/components/consultation-editor";
import { withDeanery } from "@/lib/deanery";
import { getConsultationClock, getDeaneryConsultations } from "@/lib/consultations-repository";

async function DeaneryConsultations() {
  const model = await withDeanery(getDeaneryConsultations);
  return <ConsultationEditor model={model} {...getConsultationClock()} />;
}

export default function DeaneryConsultationsPage() {
  return <Suspense fallback={<CabinetPageLoading />}><DeaneryConsultations /></Suspense>;
}
