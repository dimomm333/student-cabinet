import { PhysicalEducationPage } from "@/components/physical-education-page";

export const metadata = { title: "Физкультура" };

export default function Page({ searchParams }: PageProps<"/teacher/sports">) {
  return <PhysicalEducationPage role="TEACHER" path="/teacher/sports" searchParams={searchParams} />;
}
