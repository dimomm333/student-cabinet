import Link from "next/link";
import { Icon, type IconName } from "@/components/icon";
import { NewsCards } from "@/components/news-cards";
import { SchedulePreview } from "@/components/schedule-preview";
import { news, notifications } from "@/lib/demo-data";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const quickLinks: { title: string; caption: string; icon: IconName; href: string }[] = [
  { title: "Учебные материалы", caption: "Всё для подготовки", icon: "folder", href: "materials" },
  { title: "Заказать справку", caption: "Университетские услуги", icon: "clipboard", href: "services" },
  { title: "Моё портфолио", caption: "Твои достижения", icon: "briefcase", href: "portfolio" },
];

const stats: {
  href: string;
  icon: IconName;
  label: string;
  value: string;
  unit: string;
  note: string;
  positive?: boolean;
}[] = [
  { href: "schedule", icon: "calendar", label: "Сегодня в расписании", value: "3", unit: "занятия", note: "Первая пара в 09:00" },
  { href: "grades", icon: "chart", label: "Средний балл", value: "4,8", unit: "Отличный результат", note: "По итогам прошлого семестра", positive: true },
  { href: "session", icon: "book", label: "До зимней сессии", value: "61", unit: "день", note: "Начало — 11 января 2027" },
];

export default async function Dashboard() {
  const user = await requireRole("STUDENT");
  const profile = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  return (
    <>
      <div className="dashboard-title">
        <div>
          <span className="eyebrow">СРЕДА, 11 НОЯБРЯ 2026</span>
          <h1>Привет, {user.name.split(/\s+/)[0]} <span className="greeting-dot" aria-hidden="true">✳</span></h1>
          <p>Новый день — новые возможности. Всё важное уже здесь.</p>
        </div>
        <span className="semester-badge"><Icon name="cap" size={18} /> Осенний семестр</span>
      </div>

      <section className="student-banner" aria-label="Информация о студенте">
        <div className="student-banner-copy">
          <span className="banner-overline">ТВОЁ МЕСТО В УНИВЕРСИТЕТЕ</span>
          <h2>Учись. Пробуй. Создавай.</h2>
          <p>{profile?.institute ?? "Профиль обучения не заполнен"}{profile?.program && <><span>·</span>{profile.program}</>}</p>
          <div className="student-tags">
            {profile?.course && <span>{profile.course} курс</span>}{profile?.groupName && <span>Группа {profile.groupName}</span>}{profile?.studyMode && <span>{profile.studyMode}</span>}
          </div>
        </div>
        <div className="banner-art" aria-hidden="true">
          <span className="banner-ring ring-one" /><span className="banner-ring ring-two" />
          <span className="banner-asterisk">✳</span>
          <span className="banner-art-label">БУДУЩЕЕ НАЧИНАЕТСЯ С ТЕБЯ</span>
        </div>
        <Link href="/dashboard/profile" className="banner-profile-link" aria-label="Открыть профиль">
          <Icon name="arrow" />
        </Link>
      </section>

      <div className="stat-grid">
        {stats.map((stat) => (
          <Link href={"/dashboard/" + stat.href} className="stat-card" key={stat.href}>
            <span className="stat-label"><Icon name={stat.icon} size={18} /> {stat.label}</span>
            <div>
              <strong>{stat.value}<small className={stat.positive ? "stat-positive" : undefined}>{stat.unit}</small></strong>
              <Icon name="chevron" size={18} />
            </div>
            <p>{stat.note}</p>
          </Link>
        ))}
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <SchedulePreview />
          <section className="quick-links" aria-labelledby="quick-title">
            <h2 id="quick-title">Быстрый доступ</h2>
            <div className="quick-grid">
              {quickLinks.map((item) => (
                <Link className="quick-card" href={"/dashboard/" + item.href} key={item.href}>
                  <span className="icon-tile"><Icon name={item.icon} /></span>
                  <strong>{item.title}</strong><span>{item.caption}</span>
                  <Icon name="arrow" size={16} />
                </Link>
              ))}
            </div>
          </section>
        </div>

        <aside className="dashboard-secondary">
          <section className="panel notifications-panel" aria-labelledby="notification-title">
            <div className="panel-heading">
              <h2 id="notification-title">Уведомления <span className="count-badge">{notifications.length}</span></h2>
              <Link href="/dashboard/notifications" className="text-link" aria-label="Все уведомления">
                Все <Icon name="arrow" size={16} />
              </Link>
            </div>
            <div className="notification-list">
              {notifications.map((item) => (
                <article key={item.title} className="notification-item">
                  <span className={"notification-icon " + item.tone}><Icon name={item.icon} size={18} /></span>
                  <div>
                    <h3>{item.title}</h3><p>{item.text}</p>
                    <span className="notification-time">{item.time}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="tip-card">
            <span className="icon-tile"><Icon name="spark" /></span>
            <div>
              <h3>Возможности рядом</h3>
              <p>Студенческие клубы, полезные контакты и ответы на твои вопросы.</p>
              <Link href="/dashboard/useful" className="text-link">
                Заглянуть в «Полезное» <Icon name="arrow" size={16} />
              </Link>
            </div>
          </section>
        </aside>
      </div>

      <section className="dashboard-news" aria-labelledby="dashboard-news-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">НАШ КАМПУС</span>
            <h2 id="dashboard-news-title">В университете происходит</h2>
          </div>
          <Link href="/dashboard/news" className="text-link">Все новости <Icon name="arrow" size={16} /></Link>
        </div>
        <NewsCards compact items={news} />
      </section>
    </>
  );
}
