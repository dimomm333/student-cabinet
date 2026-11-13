import { Icon } from "./icon";

// Page-level fallback: unlike the auth boundary above a shared layout, this
// boundary also participates when navigating between pages in the same cabinet.
export default function CabinetPageLoading() {
  return <section className="placeholder-panel" aria-busy="true" aria-label="Загрузка раздела">
    <span className="placeholder-icon"><Icon name="clock" size={38} /></span>
    <p role="status">Открываем раздел кабинета…</p>
  </section>;
}
