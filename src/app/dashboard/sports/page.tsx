import { PhysicalEducationPage } from "@/components/physical-education-page";

export const metadata = { title: "Физкультура" };

export default function Page({ searchParams }: PageProps<"/dashboard/sports">) {
  return <PhysicalEducationPage role="STUDENT" path="/dashboard/sports" searchParams={searchParams} />;
}
