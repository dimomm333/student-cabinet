import { ServicesPage } from "@/components/services-page";
export const metadata = { title: "Заявки студентов" };
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <ServicesPage role="ADMIN" path="/admin/requests" searchParams={searchParams} />; }
