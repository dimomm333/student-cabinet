import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icon";
import { NewsCards } from "@/components/news-cards";

export default function Home() {
  return (
    <div className="landing">
      <a className="skip-link" href="#main">Перейти к содержимому</a>
      <header className="public-header page-width">
        <Brand />
        <nav className="public-nav" aria-label="Основная навигация">
          <a href="#possibilities">Возможности</a><a href="#news">Новости</a>
        </nav>
        <Link className="button button-outline header-login" href="/dashboard">Войти в кабинет <Icon name="arrow" /></Link>
      </header>
      <main id="main">
        <section className="hero page-width">
          <div className="hero-copy">
            <span className="eyebrow"><span className="status-dot" /> Твой университет. Всегда рядом.</span>
            <h1>Всё для учёбы.<br /><span>В одном месте.</span></h1>
            <p className="hero-description">Расписание, результаты, важные новости и университетские сервисы — в твоём личном кабинете. Больше времени на то, что интересно.</p>
            <Link href="/dashboard" className="button button-primary">Попробовать деморежим <Icon name="arrow" /></Link>
            <p className="hero-note"><Icon name="shield" /> Без регистрации · На вымышленных данных</p>
            <div className="hero-footnote"><span className="small-rule" /> Пространство для твоего развития</div>
          </div>
          <div className="hero-visual">
            <div className="visual-caption"><span>СЕВЕРНЫЙ УНИВЕРСИТЕТ</span><span>КАМПУС БУДУЩЕГО ↗</span></div>
            <Image className="campus-image" src="/campus.svg" alt="Иллюстрация вымышленного университетского кампуса с зелёным двором" width={720} height={560} priority />
            <div className="floating-class"><span className="icon-tile"><Icon name="calendar" /></span><div><small>Всё под рукой</small><strong>Следующая пара — в кабинете</strong></div><span className="floating-check"><Icon name="check" /></span></div>
            <div className="visual-bottom"><span className="status-dot" /> Учиться. Создавать. Быть собой.</div>
          </div>
        </section>
        <section id="possibilities" className="possibilities page-width">
          <div className="section-heading"><div><span className="eyebrow">МЕНЬШЕ РУТИНЫ, БОЛЬШЕ ВОЗМОЖНОСТЕЙ</span><h2>Университет в твоём ритме</h2></div><p>От первой пары до первого достижения.<br />Важное больше не потеряется.</p></div>
          <div className="feature-grid">
            {[
              { icon: "calendar" as const, number: "01", title: "Планируй свой день", text: "Ближайшие занятия, аудитории и преподаватели — на одном экране." },
              { icon: "chart" as const, number: "02", title: "Видь свой прогресс", text: "Единое пространство для результатов учёбы и личных достижений." },
              { icon: "grid" as const, number: "03", title: "Решай вопросы проще", text: "Учебные материалы, услуги и полезные разделы рядом, когда нужны." },
            ].map((feature) => <article className="feature-card" key={feature.number}><div className="flex items-center justify-between"><span className="icon-tile"><Icon name={feature.icon} /></span><span className="feature-number">{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}
          </div>
        </section>
        <section id="news" className="public-news page-width">
          <div className="section-heading"><div><span className="eyebrow">ЖИЗНЬ КАМПУСА</span><h2>За пределами расписания</h2></div><span className="muted text-sm">Демонстрационные новости</span></div>
          <NewsCards />
        </section>
        <section className="demo-cta page-width"><div><span className="eyebrow">ДАВАЙ ЗНАКОМИТЬСЯ</span><h2>Твой новый учебный день<br />начинается здесь.</h2><p>Посмотри, как устроен кабинет студента.</p></div><Link href="/dashboard" className="button button-light">Открыть демоверсию <Icon name="arrow" /></Link></section>
      </main>
      <footer className="public-footer page-width"><Brand compact /><p>Конкурсный прототип · Все данные вымышлены</p><span>© 2026 Северный университет</span></footer>
    </div>
  );
}
