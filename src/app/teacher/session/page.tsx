import { BrsPage } from "@/components/brs-page";
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <BrsPage role="TEACHER" section="session" searchParams={searchParams} />;
}
