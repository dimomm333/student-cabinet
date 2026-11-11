import { Icon } from "@/components/icon";

export default function LoadingSection() {
  return (
    <section className="placeholder-panel" aria-busy="true" aria-label="Загрузка раздела">
      <span className="placeholder-icon"><Icon name="clock" size={38} /></span>
      <p role="status">Открываем раздел кабинета…</p>
    </section>
  );
}
