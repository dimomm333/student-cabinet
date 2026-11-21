"use client";
import { useState } from "react";
import { passStatusLabels, type PassHistory, type PassCardData } from "@/lib/pass-types";
import { PassCard } from "./student-pass";

async function command<T>(body: object): Promise<T> {
  const res = await fetch("/api/passes", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Операция недоступна.");
  return result;
}
async function readImage(file: File) {
  if (file.size > 16 * 1024 * 1024) throw new Error("Выберите снимок до 16 МиБ.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Не удалось прочитать снимок.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    const code = jsQR(pixels.data, pixels.width, pixels.height);
    if (!code) throw new Error("QR не распознан. Снимите код целиком при хорошем освещении.");
    return code.data;
  } finally { bitmap.close(); }
}
function Verification() {
  const [result, setResult] = useState<PassCardData>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify(input: File | string) {
    setBusy(true); setResult(undefined); setError("");
    try {
      const token = typeof input === "string" ? input.trim() : await readImage(input);
      setResult(await command<PassCardData>({ action: "verify", token }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel pass-office"><h2>Проверка QR</h2>
    <p>Отсканируйте код и сверьте предъявителя с официальной фотографией.</p>
    <label>Снимок QR-кода<input disabled={busy} type="file" accept="image/*" capture="environment" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (file) void verify(file);
    }} /></label>
    <form method="post" autoComplete="off" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const value = new FormData(form).get("scan"); form.reset(); if (typeof value === "string") void verify(value); }}>
      <label>Код со сканера<input name="scan" type="password" autoComplete="off" required disabled={busy} maxLength={200} onChange={() => { setResult(undefined); setError(""); }} /></label>
      <button disabled={busy} className="button button-primary">Проверить</button>
    </form>
    <div aria-live="polite">{busy && "Проверяем…"}{error}{result && <PassCard data={result} />}</div>
  </section>;
}
const dateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
function Management() {
  const [email, setEmail] = useState("");
  const [history, setHistory] = useState<PassHistory>();
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const last = history?.passes[0];
  async function run(action: "history" | "issue" | "revoke" | "replace") {
    setBusy(true); setMessage("");
    try {
      if (action !== "history") {
        await command({ action, email, expected: last?.id ?? null, ...(action !== "issue" ? { reason } : {}), ...(action === "replace" ? { requestId } : {}) });
        setMessage(action === "issue" ? "Пропуск выдан." : action === "replace" ? "Пропуск перевыпущен." : "Пропуск отозван.");
      }
      setHistory(await command<PassHistory>({ action: "history", email })); setReason(""); setRequestId("");
    } catch (e) { setMessage((e as Error).message); setHistory(undefined); } finally { setBusy(false); }
  }
  return <section className="panel pass-office"><h2>Выдача и история</h2>
    <form method="post" onSubmit={e => { e.preventDefault(); void run("history"); }}>
      <label>Университетская почта студента<input type="email" required value={email} disabled={busy} onChange={e => { setEmail(e.target.value); setHistory(undefined); setMessage(""); }} /></label>
      <button disabled={busy} className="button button-outline">Найти студента</button>
    </form>
    {history && <><div><strong>{history.person.name}</strong><p>{history.person.group || "Группа не указана"}</p></div>
      {last?.status !== "ACTIVE" ? <button className="button button-primary" disabled={busy} onClick={() => void run("issue")}>Выдать пропуск</button> : <>
        <label>Причина отзыва или замены<input value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
        <button className="button button-outline" disabled={busy || !reason.trim()} onClick={() => void run("revoke")}>Отозвать пропуск</button>
        <label>Исполненное заявление на перевыпуск<select value={requestId} disabled={busy} onChange={e => setRequestId(e.target.value)}>
          <option value="">{history.requests.length ? "Выберите заявление" : "Нет доступных заявлений"}</option>
          {history.requests.map(r => <option key={r.id} value={r.id}>{r.completedAt && dateTime(r.completedAt)} · {r.id}</option>)}
        </select></label>
        <button className="button button-primary" disabled={busy || !requestId || !reason.trim()} onClick={() => void run("replace")}>Перевыпустить пропуск</button>
      </>}
      <h3>История пропусков</h3>{!last && <p>Пропуск не выдан</p>}
      <ol>{history.passes.map(p => <li key={p.id}><strong>{passStatusLabels[p.status]}</strong><p>Выдача · {dateTime(p.issuedAt)} · {p.issuer.name}</p>
        {p.requestId && <p>Заявление на перевыпуск · {p.requestId}</p>}
        {p.closedAt && <p>{dateTime(p.closedAt)} · {p.closer?.name} · {p.reason}</p>}</li>)}</ol>
    </>}
    <p role="status">{message}</p>
  </section>;
}
export function PassWorkspace({ canVerify, canManage }: { canVerify: boolean; canManage: boolean }) {
  return <><div className="dashboard-title"><h1>Электронные пропуска</h1></div>
    <div className="pass-offices">{canVerify && <Verification />}{canManage && <Management />}</div></>;
}
