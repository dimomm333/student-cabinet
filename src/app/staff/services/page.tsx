import { ServicesPage } from "@/components/services-page";
export const metadata = { title: "Заявления студентов" };
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <ServicesPage role="TECHNICAL_STAFF" path="/staff/services" searchParams={searchParams} />; }
