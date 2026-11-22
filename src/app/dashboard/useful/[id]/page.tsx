import { UsefulPage } from "@/components/useful-page";

export const metadata = { title: "Полезное" };

export default function Page({ params, searchParams }: PageProps<"/dashboard/useful/[id]">) {
  return <UsefulPage params={params} searchParams={searchParams} />;
}
