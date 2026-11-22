import { PhysicalEducationPage } from "@/components/physical-education-page";

export const metadata = { title: "Физкультура" };

export default function Page({ searchParams }: PageProps<"/admin/sports">) {
  return <PhysicalEducationPage role="ADMIN" path="/admin/sports" searchParams={searchParams} />;
}
