"use client";
import { useActionState, useEffect, useState } from "react";
import { publishNews } from "@/app/admin/news/actions";
export function AnnouncementForm({ requestId, departments }: { requestId: string; departments: { id: string; name: string; faculty: string }[] }) {
  const [key, setKey] = useState(requestId);
  const [title, setTitle] = useState(""), [content, setContent] = useState(""), [departmentId, setDepartmentId] = useState("");
  const [state, action, pending] = useActionState(async (previous: { success: boolean; message: string }, form: FormData) => {
    const result = await publishNews(previous, form);
    if (result.success) { setKey(crypto.randomUUID()); setTitle(""); setContent(""); setDepartmentId(""); }
    return result;
  }, { success: false, message: "" });
  useEffect(() => { if (state.success) window.dispatchEvent(new Event("notifications-updated")); }, [state]);
  return <form action={action} className="panel notification-settings"><h2>Опубликовать объявление</h2><p>После публикации студенты выбранного подразделения получат уведомление.</p>
    <input type="hidden" name="requestId" value={key} />
    <label>Заголовок<input name="title" required maxLength={180} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Содержание<textarea name="content" required maxLength={10000} rows={6} value={content} onChange={e => setContent(e.target.value)} /></label>
    <label>Получатели<select name="departmentId" value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">Все студенты</option>{departments.map(d => <option value={d.id} key={d.id}>{d.faculty} · {d.name}</option>)}</select></label>
    {state.message && <p role={state.success ? "status" : "alert"}>{state.message}</p>}<button className="button button-primary" disabled={pending}>Опубликовать объявление</button>
  </form>;
}
