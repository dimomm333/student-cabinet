import { UsefulAdminPage } from "@/components/useful-admin-page";

export const metadata = { title: "Редактирование справочника «Полезное»" };

export default function Page({ params, searchParams }: PageProps<"/admin/useful/[id]">) {
  return <UsefulAdminPage params={params} searchParams={searchParams} />;
}
