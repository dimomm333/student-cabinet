import { UsefulAdminPage } from "@/components/useful-admin-page";

export const metadata = { title: "Справочник «Полезное»" };

export default function Page({ searchParams }: PageProps<"/admin/useful">) {
  return <UsefulAdminPage searchParams={searchParams} />;
}
