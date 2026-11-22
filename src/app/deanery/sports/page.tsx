import { PhysicalEducationPage } from "@/components/physical-education-page";

export const metadata = { title: "Физкультура" };

export default function Page({ searchParams }: PageProps<"/deanery/sports">) {
  return <PhysicalEducationPage role="DEANERY_STAFF" path="/deanery/sports" searchParams={searchParams} />;
}
