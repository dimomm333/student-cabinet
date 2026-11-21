"use client";
import { useEffect, useRef, useState } from "react";
import { passStatusLabels, type PassCardData } from "@/lib/pass-types";
import { Icon } from "./icon";

export function PassCard({ data }: { data: PassCardData }) {
  const p = data.person;
  return <div className="pass-card" data-status={data.status}>
    {p && <div className="pass-identity">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.photo && <img src={p.photo} alt="Официальное фото для сверки" width={64} height={84} />}
      <div><strong>{p.name}</strong><p>{p.group ? "Группа " + p.group : "Группа не указана"}</p>
        {!p.photo && <small>Официальное фото отсутствует</small>}</div>
    </div>}
    <span className="pass-status">{passStatusLabels[data.status]}</span>
    {data.status === "ACTIVE" && p?.sample && <small>Образец</small>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {data.qr && <img className="pass-qr" src={data.qr} alt="QR-код электронного пропуска" width={246} height={246} />}
  </div>;
}
function OwnPass() {
  const [data, setData] = useState<PassCardData>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/passes", { cache: "no-store", signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setData(body);
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message || "Не удалось открыть пропуск."); }
    })();
    return () => controller.abort();
  }, []);
  return data ? <PassCard data={data} /> : <p role="status">{error || "Загружаем пропуск…"}</p>;
}
export function ProfilePass() {
  return <section className="panel profile-panel pass-panel"><h2><Icon name="qr" />Электронный пропуск</h2><OwnPass /></section>;
}
export function HomePass() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <><button type="button" className="button button-outline pass-trigger" aria-label="Пропуск" aria-haspopup="dialog"
    onClick={() => { dialog.current?.showModal(); setOpen(true); }}><Icon name="qr" size={19} /><span>Пропуск</span></button>
    <dialog ref={dialog} className="pass-dialog" aria-labelledby="pass-dialog-title" onClose={() => setOpen(false)}>
      <header><h2 id="pass-dialog-title">Электронный пропуск</h2><button type="button" autoFocus className="icon-button" aria-label="Закрыть пропуск" onClick={() => dialog.current?.close()}><Icon name="close" /></button></header>
      {open && <OwnPass />}
    </dialog></>;
}
