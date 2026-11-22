import { randomUUID } from "node:crypto";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { DormForm } from "./dormitory-form";
import { DatePicker } from "./date-picker";
import { dormCalendarDay } from "@/lib/dormitory-state";
import { isoDate } from "@/lib/schedule-calendar";
import { documentKinds } from "@/lib/dormitory-shared";

export function Action(props: Omit<ComponentProps<typeof DormForm>, "requestKey">) { return <DormForm {...props} requestKey={randomUUID()} />; }
export function Card({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return <section id={id} className="panel dorm-card"><h2>{title}</h2>{children}</section>;
}
export function Field({ label, name, type = "text", optional = false, initial, max, min, inputMode, fromToday }: {
  label: string; name: string; type?: string; optional?: boolean; initial?: string | number; max?: number; min?: number; inputMode?: "decimal"; fromToday?: boolean;
}) {
  if (type === "date") return <DatePicker className="dorm-date-field" label={label} name={name}
    min={fromToday ? isoDate(dormCalendarDay(new Date())) : undefined}
    required={!optional} defaultValue={typeof initial === "string" ? initial : undefined} />;
  return <label>{label}<input name={name} type={type} inputMode={inputMode} defaultValue={initial} required={!optional} maxLength={type === "text" ? max ?? 500 : undefined} max={max} min={min} /></label>;
}
export function TextArea({ label, name, optional = false, max = 2000 }: { label: string; name: string; optional?: boolean; max?: number }) {
  return <label>{label}<textarea name={name} required={!optional} maxLength={max} rows={3} /></label>;
}
export function Check({ label, name }: { label: string; name: string }) { return <label className="dorm-check"><input type="checkbox" name={name} /> {label}</label>; }
export function Pick({ label, name, items, optional }: { label: string; name: string; items: [string, string][]; optional?: string }) {
  return <label>{label}<select name={name} required={!optional} defaultValue=""><option value="">{optional ?? "Выберите"}</option>{items.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>;
}
type Location = { number: string; floor: { number: number; building: { name: string; dormitory: { name: string } } }; block: { name: string } | null };
export const roomLabel = (room: Location, whole = false) => [
  whole && room.floor.building.dormitory.name, room.floor.building.name && `корпус ${room.floor.building.name}`,
  `этаж ${room.floor.number}`, room.block && `блок ${room.block.name}`, `комната ${room.number}`,
].filter(Boolean).join(" · ");
export const bedLabel = (bed: { room: Location; number: number }, whole = false) => `${roomLabel(bed.room, whole)} · место ${bed.number}`;
export const dayLabel = (date: Date | null | undefined) => date ? date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "Не указан";
export { formatRubles as moneyLabel } from "@/lib/dormitory-money";
export const fileHref = (id: string) => "/api/dormitory?id=" + encodeURIComponent(id);
export function DocumentLink({ doc }: { doc: { title: string; kind: keyof typeof documentKinds; file: { id: string } } }) {
  return <a className="text-link" href={fileHref(doc.file.id)}>{doc.title} · {documentKinds[doc.kind]}</a>;
}
export function Pages({ href, page, more, anchor = "", param = "page" }: { href: string; page: number; more: boolean; anchor?: string; param?: string }) {
  if (page === 0 && !more) return null;
  const url = (n: number) => href + (href.includes("?") ? "&" : "?") + param + "=" + n + anchor;
  return <nav aria-label="Страницы раздела" className="dorm-links">{page > 0 && <Link href={url(page - 1)}>Назад</Link>}<span>Страница {page + 1}</span>{more && <Link href={url(page + 1)}>Далее</Link>}</nav>;
}
