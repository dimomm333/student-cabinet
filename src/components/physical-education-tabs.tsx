"use client";

import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { SectionTabs } from "./section-navigation";

const items = [
  { id: "my-group", label: "Моя группа" },
  { id: "choose", label: "Выбор группы" },
  { id: "attendance", label: "Посещаемость" },
  { id: "standards", label: "Нормативы" },
  { id: "control", label: "Рубежный контроль" },
  { id: "makeups", label: "Отработки" },
  { id: "activities", label: "Дополнительные занятия" },
];

function subscribe(change: () => void) {
  const events = ["hashchange", "popstate", "physical-tab-change"];
  for (const event of events) window.addEventListener(event, change);
  return () => { for (const event of events) window.removeEventListener(event, change); };
}

export function PhysicalTabs({ panels, initial }: { panels: Record<string, ReactNode>; initial: string }) {
  const fragment = useSyncExternalStore(subscribe, () => location.hash.slice(1).replace(/-content$/, ""), () => "");
  const active = items.some(item => item.id === fragment) ? fragment : initial;
  return <SectionTabs label="Разделы физкультуры" active={active} items={items} className="pe-tabs"
    onSelect={id => {
      if (id === active) return;
      window.history.pushState(null, "", "#" + id);
      window.dispatchEvent(new Event("physical-tab-change"));
    }}>{panels[active]}</SectionTabs>;
}

export function PhysicalGroupList({ children }: { children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  function move(direction: number) {
    const node = list.current;
    if (node) node.scrollBy({ left: direction * node.clientWidth * .8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return <>
    <div className="pe-scroll-controls">
      <button className="pe-button" type="button" aria-label="Предыдущие группы" onClick={() => move(-1)}>←</button>
      <button className="pe-button" type="button" aria-label="Следующие группы" onClick={() => move(1)}>→</button>
    </div>
    <div ref={list} className="pe-group-list" role="region" aria-label="Спортивные группы" tabIndex={0}>{children}</div>
  </>;
}
