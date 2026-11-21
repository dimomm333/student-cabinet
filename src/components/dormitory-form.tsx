"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { runDormAction } from "@/app/dashboard/dormitory/actions";
import { dormActions, type DormAction } from "@/lib/dormitory-shared";

export function DormForm({ action, requestKey, fields = {}, children, label }: {
  action: DormAction; requestKey: string; fields?: Record<string, string | number>; children?: ReactNode; label?: string;
}) {
  const [key, setKey] = useState(requestKey);
  const router = useRouter();
  const [state, submit, pending] = useActionState(async (previous: { ok: boolean; message: string }, form: FormData) => {
    let result: { ok: boolean; message: string };
    if (action === "DOCUMENT" || action === "REPAIR_FILE") {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size) return { ok: false, message: "Выберите файл." };
      const params = new URLSearchParams({ action, key });
      const metadata = new URLSearchParams();
      for (const [name, value] of form) if (typeof value === "string" && name !== "dormAction" && name !== "key" && !name.startsWith("$ACTION")) metadata.set(name, value);
      try {
        const response = await fetch("/api/dormitory?" + params, {
          method: "POST", headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name), "X-Dorm-Fields": metadata.toString() }, body: file,
        });
        const body = await response.json();
        result = { ok: response.ok, message: response.ok ? "Файл загружен." : body.error };
        if (result.ok) router.refresh();
      } catch { result = { ok: false, message: "Загрузка прервана. Повторите попытку." }; }
    } else result = await runDormAction(previous, form);
    if (result.ok) {
      setKey(crypto.randomUUID());
      window.dispatchEvent(new Event("notifications-updated"));
    }
    return result;
  }, { ok: false, message: "" });
  return <form action={submit} className="dorm-form">
    <input type="hidden" name="dormAction" value={action} />
    <input type="hidden" name="key" value={key} />
    {Object.entries(fields).map(([name, value]) => <input type="hidden" key={name} name={name} value={value} />)}
    {children}
    <button className="button button-outline" disabled={pending}>{pending ? "Сохраняем…" : label ?? dormActions[action]}</button>
    {state.message && <p role={state.ok ? "status" : "alert"}>{state.message}</p>}
  </form>;
}
