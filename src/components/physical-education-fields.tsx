import { randomUUID } from "node:crypto";
import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { healthLabels, physicalLimits } from "@/lib/physical-education-rules";
import { formatDateInput } from "@/lib/schedule-calendar";
import { DatePicker } from "./date-picker";
import { PhysicalForm } from "./physical-education-form";
import type { PhysicalWorkspace } from "@/lib/physical-education-queries";

export const prettyDate = (date: string) => date ? formatDateInput(date) : "Дата уточняется";

export function EditForm(props: Omit<ComponentProps<typeof PhysicalForm>, "requestId">) {
  return <PhysicalForm {...props} requestId={randomUUID()} />;
}

export function Section({ id, title, children, open }: { id: string; title: string; children: ReactNode; open?: boolean }) {
  return <details id={id} className="panel pe-section" open={open}><summary><h2>{title}</h2></summary><div id={id + "-content"} className="pe-section-body">{children}</div></details>;
}

export function Choices({ name, label, options, value }: { name: string; label: string; options: { id: string; name: string }[]; value?: string }) {
  return <label>{label}<select required name={name} defaultValue={value ?? ""}><option value="" disabled>Выберите</option>{options.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>;
}

export function Categories({ values, available }: { values?: string[]; available?: string[] }) {
  return <fieldset className="pe-checks"><legend>Допустимые группы здоровья</legend>{Object.entries(healthLabels).filter(([id]) => !available || available.includes(id)).map(([id, label]) =>
    <label key={id}><input type="checkbox" name="category" value={id} defaultChecked={values?.includes(id)} /> {label}</label>)}</fieldset>;
}

export function DateField({ name, label, value, required = true }: { name: string; label: string; value?: string; required?: boolean }) {
  return <DatePicker label={label} name={name} defaultValue={value} required={required} min="2000-01-01" max="2099-12-31" />;
}

export function TimeFields({ suffix = "", start, end }: { suffix?: string; start?: string; end?: string }) {
  return <div className="pe-grid"><label>Начало<input name={"start" + suffix} type="time" defaultValue={start} required /></label><label>Окончание<input name={"end" + suffix} type="time" defaultValue={end} required /></label></div>;
}

export function Weekly({ group }: { group: PhysicalWorkspace["groups"][number] }) {
  return <ul className="pe-clean">{group.weekly.map((slot, index) => <li key={index}>{slot.day}, {slot.start}–{slot.end} · {slot.place}</li>)}</ul>;
}

export function CreditStatus({ ready, visits, score, official }: { ready?: boolean; visits?: number; score?: string; official?: { grade: string; valid: boolean; status: string } | null }) {
  if (official) return official.valid ? official.grade : official.status;
  if (ready) return "Условия выполнены, ожидает утверждения";
  if (visits == null || score == null) return "Ожидает зачисления";
  const missing = [visits < physicalLimits.visits && "посещений", Number(score.replace(",", ".")) * 100 < physicalLimits.minimum && "баллов"].filter(Boolean);
  return "Не хватает " + missing.join(" и ");
}

export function TimetableLink({ role, term }: { role: "student" | "teacher"; term: string }) {
  return <Link href={`${role === "student" ? "/dashboard" : "/teacher"}/schedule?term=${encodeURIComponent(term)}`} className="pe-link">Обычное расписание</Link>;
}
