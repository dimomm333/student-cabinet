import { Suspense } from "react";
import CabinetPageLoading from "@/components/cabinet-page-loading";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { officialHttpUrl, universityMailDescription, universityMailId, universityMailTitle } from "@/lib/useful-catalog";

export const metadata = { title: universityMailTitle };

async function MailContent() {
  await requireRole("STUDENT");
  const entry = await prisma.usefulEntry.findUnique({
    where: { id: universityMailId, status: "PUBLISHED", kind: "EXTERNAL" },
    select: { officialUrl: true },
  });
  const url = officialHttpUrl(entry?.officialUrl ?? "");

  return <div className="services-workspace">
    <header className="dashboard-title"><div>
      <h1>{universityMailTitle}</h1>
      <p>{universityMailDescription}</p>
    </div></header>
    <section className="panel services-panel">
      {url ? <a className="button button-primary" href={url} target="_blank" rel="noopener noreferrer">Открыть университетскую почту</a>
        : <p>Почтовый сервис пока не подключён. Ссылка на официальный почтовый клиент появится после её добавления администрацией</p>}
    </section>
  </div>;
}

export default function Page() {
  return <Suspense fallback={<CabinetPageLoading />}><MailContent /></Suspense>;
}
