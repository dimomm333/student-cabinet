"use client";
import { useActionState, useEffect, useState } from "react";
import { publishNews } from "@/app/admin/news/actions";
export function AnnouncementForm({ requestId, departments, dormitories = [], localOnly = false, allResidents = false }: {
  requestId: string; departments: { id: string; name: string; faculty: string }[];
  dormitories?: { id: string; name: string; buildings: { id: string; name: string }[] }[];
  localOnly?: boolean; allResidents?: boolean;
}) {
  const [key, setKey] = useState(requestId);
  const [title, setTitle] = useState(""), [content, setContent] = useState(""), [departmentId, setDepartmentId] = useState("");
  const [audience, setAudience] = useState(localOnly ? "local" : "academic");
  const [state, action, pending] = useActionState(async (previous: { success: boolean; message: string }, form: FormData) => {
    const result = await publishNews(previous, form);
    if (result.success) { setKey(crypto.randomUUID()); setTitle(""); setContent(""); setDepartmentId(""); }
    return result;
  }, { success: false, message: "" });
  useEffect(() => { if (state.success) window.dispatchEvent(new Event("notifications-updated")); }, [state]);
  return <form action={action} className="panel notification-settings"><h2>Опубликовать объявление</h2>
    <input type="hidden" name="requestId" value={key} />
    <label>Заголовок<input name="title" required maxLength={180} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Содержание<textarea name="content" required maxLength={10000} rows={6} value={content} onChange={e => setContent(e.target.value)} /></label>
    {localOnly ? <input type="hidden" name="audience" value="local" /> : <label>Аудитория<select name="audience" value={audience} onChange={e => setAudience(e.target.value)}>
      <option value="academic">Студенты университета или подразделения</option>{allResidents && <option value="residents">Все проживающие в общежитиях</option>}
      {dormitories.length > 0 && <option value="local">Выбранные общежития и корпуса</option>}
    </select></label>}
    {audience === "academic" && <label>Получатели<select name="departmentId" value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">Все студенты</option>{departments.map(d => <option value={d.id} key={d.id}>{d.faculty} · {d.name}</option>)}</select></label>}
    {audience === "local" && <fieldset key={key}><legend>Получатели</legend>
      {dormitories.map(dorm => <div key={dorm.id} className="dorm-audience">
        <label><input type="checkbox" name="dormitoryId" value={dorm.id} /> {dorm.name}</label>
        {dorm.buildings.map(building => <label key={building.id}><input type="checkbox" name="buildingId" value={building.id} /> {dorm.name} · корпус {building.name}</label>)}
      </div>)}
    </fieldset>}
    {state.message && <p role={state.success ? "status" : "alert"}>{state.message}</p>}<button className="button button-primary" disabled={pending}>Опубликовать объявление</button>
  </form>;
}
