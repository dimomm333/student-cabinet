import { ServicesPage } from "@/components/services-page";
export const metadata = { title: "Услуги" };
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <ServicesPage role="STUDENT" path="/dashboard/services" searchParams={searchParams} />; }
