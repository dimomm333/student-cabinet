import { UsefulPage } from "@/components/useful-page";

export const metadata = { title: "Полезное" };

export default function Page({ searchParams }: PageProps<"/dashboard/useful">) {
  return <UsefulPage searchParams={searchParams} />;
}
