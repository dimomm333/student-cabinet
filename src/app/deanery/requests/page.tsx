import { ServicesPage } from "@/components/services-page";
export const metadata = { title: "Заявки и заявления" };
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <ServicesPage role="DEANERY_STAFF" path="/deanery/requests" searchParams={searchParams} />; }
