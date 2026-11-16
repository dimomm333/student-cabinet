"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { serviceFetch } from "@/lib/services-ui";
import { ServiceProfileValues } from "./services-request-screen";
import { Icon } from "./icon";
export function StudentMilitaryRecord() {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    serviceFetch<Record<string, unknown> | null>("/api/services?view=military").then(data => { if (active) { setRecord(data); setError(""); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return <section className="panel profile-panel services-military"><h2><Icon name="shield" size={21} />Воинский учёт</h2>{loading ? <p role="status">Загружаем сведения…</p> : error ? <p role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>Повторить</button></p> : record ? <ServiceProfileValues values={Object.fromEntries(Object.entries(record).filter(([key]) => key !== "updatedAt"))} /> : <p>Сведения не предоставлены</p>}<p className="student-section-note">Официальные сведения доступны только для просмотра. Исправления проходят проверку.</p><Link className="text-link" href="/dashboard/services?service=military-change">Изменить сведения <Icon name="arrow" size={16} /></Link></section>;
}
