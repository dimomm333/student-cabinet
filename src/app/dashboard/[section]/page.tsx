import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { sections } from "@/lib/demo-data";
import { requireRole } from "@/lib/access";

export function generateStaticParams() {
  return sections.map((section) => ({ section: section.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: sections.find((item) => item.slug === section)?.title ?? "Раздел не найден" };
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  await requireRole("STUDENT");
  const { section: slug } = await params;
  const section = sections.find((item) => item.slug === slug);
  if (!section) notFound();
  return (
    <>
      <div className="dashboard-title">
        <div>
          <span className="eyebrow">{section.group}</span>
          <h1>{section.title}</h1>
          <p>Твоё пространство для учёбы и университетской жизни.</p>
        </div>
      </div>
      <section className="placeholder-panel">
        <span className="placeholder-icon"><Icon name={section.icon} size={38} /></span>
        <span className="demo-badge">Скоро в кабинете</span>
        <h2>Здесь будет раздел «{section.title}»</h2>
        <p>{section.description}</p>
        <div className="placeholder-note">
          <Icon name="help" size={18} />
          <p>Сейчас доступна визуальная демоверсия. Этот раздел будет реализован на следующих этапах. Все данные в кабинете вымышлены.</p>
        </div>
        <Link href="/dashboard" className="button button-primary">
          На главную кабинета <Icon name="arrow" />
        </Link>
      </section>
    </>
  );
}
