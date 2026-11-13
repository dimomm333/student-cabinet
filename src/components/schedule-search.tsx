"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GroupChoice, PublicChoice } from "@/lib/schedule-repository";
import { scheduleHref, filterScheduleChoices } from "@/lib/schedule-calendar";

type Props = { groups: GroupChoice[]; teachers: PublicChoice[]; view: "group" | "teacher"; selected: string; initialValue: string; week: string; day: number | null };
export function ScheduleSearch(props: Props) {
  const router = useRouter(), id = useId(), input = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const context = `${props.view}:${props.selected}:${props.initialValue}`;
  const [state, setState] = useState({ context, text: props.initialValue, open: false, active: -1 });
  if (state.context !== context) setState({ context, text: props.initialValue, open: false, active: -1 });
  const choices = props.view === "group" ? props.groups : props.teachers;
  const matches = filterScheduleChoices(choices, state.text);
  const visible = matches.slice(0, 50);
  function choose(item: PublicChoice) {
    setState({ context, text: item.name, open: false, active: -1 });
    input.current?.focus({ preventScroll: true });
    router.push(scheduleHref("/schedule", { ...props, selected: item.slug }), { scroll: false });
  }
  function move(delta: number) {
    const active = !state.open || state.active < 0 ? (delta > 0 ? 0 : visible.length - 1) : (state.active + delta + visible.length) % visible.length;
    setState({ ...state, open: true, active: visible.length ? active : -1 });
    const option = list.current?.children[active] as HTMLElement | undefined;
    if (option && list.current) list.current.scrollTop = Math.max(0, option.offsetTop - list.current.offsetTop - list.current.clientHeight / 2);
  }
  return <div className="schedule-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setState(s => ({ ...s, open: false, active: -1 })); }}>
    <label htmlFor={id}>{props.view === "group" ? "Поиск группы" : "Поиск преподавателя"}</label>
    <input ref={input} id={id} role="combobox" type="text" autoComplete="off" maxLength={80} value={state.text}
      aria-autocomplete="list" aria-expanded={state.open} aria-controls={`${id}-list`} aria-describedby={`${id}-help`}
      aria-activedescendant={state.open && state.active >= 0 ? `${id}-option-${state.active}` : undefined}
      placeholder={props.view === "group" ? "Название группы или направления" : "Фамилия преподавателя"}
      onFocus={() => setState(s => ({ ...s, open: true }))}
      onChange={event => setState({ context, text: event.target.value, open: true, active: -1 })}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1); }
        if (event.key === "Enter" && state.open) { event.preventDefault(); const item = visible[state.active >= 0 ? state.active : 0]; if (item) choose(item); }
        if (event.key === "Escape") { event.preventDefault(); setState(s => ({ ...s, open: false, active: -1 })); }
      }} />
    <div id={`${id}-help`} className="schedule-search-summary" role="status">{state.open ? matches.length ? `Найдено: ${matches.length}.${matches.length > 50 ? " Показаны первые 50 — уточните запрос." : ""}` : "Ничего не найдено. Измените запрос." : "Начните вводить название или откройте полный список ниже."}</div>
    <div ref={list} id={`${id}-list`} role="listbox" aria-label={props.view === "group" ? "Учебные группы" : "Преподаватели"} className="schedule-suggestions" hidden={!state.open || !visible.length}>
      {visible.map((item, index) => <div key={item.slug} id={`${id}-option-${index}`} role="option" tabIndex={-1} aria-selected={state.active === index}
        onMouseDown={event => event.preventDefault()} onPointerMove={event => { if (event.pointerType === "mouse") setState(s => ({ ...s, active: index })); }} onClick={() => choose(item)}>
        <strong>{item.name}</strong>{"programme" in item && <small>{String(item.programme)}</small>}
      </div>)}
    </div>
    <details className="schedule-directory"><summary>{props.view === "group" ? "Все учебные группы" : "Все преподаватели"}</summary>
      {props.view === "group" ? <GroupDirectory groups={props.groups} choose={choose} /> : <ul>{props.teachers.map(item => <li key={item.slug}><button type="button" onClick={() => choose(item)}>{item.name}</button></li>)}</ul>}
      {!choices.length && <p>Опубликованный справочник пока пуст.</p>}
    </details>
  </div>;
}

function GroupDirectory({ groups, choose }: { groups: GroupChoice[]; choose: (item: PublicChoice) => void }) {
  const roots = groups.filter(g => !g.parentSlug || !groups.some(parent => parent.slug === g.parentSlug));
  const reachable = new Set<string>();
  function visit(group: GroupChoice) { if (reachable.has(group.slug)) return; reachable.add(group.slug); groups.filter(g => g.parentSlug === group.slug).forEach(visit); }
  roots.forEach(visit);
  for (const group of groups) if (!reachable.has(group.slug)) { roots.push(group); visit(group); }
  const faculties = [...new Set(roots.map(g => g.faculty))];
  function branch(group: GroupChoice, parents: string[] = []) {
    if (parents.includes(group.slug)) return null;
    const children = groups.filter(g => g.parentSlug === group.slug && !parents.includes(g.slug));
    return <li key={group.slug}><button type="button" onClick={() => choose(group)}>{group.name}</button>{children.length > 0 && <details><summary>Подгруппы ({children.length})</summary><ul>{children.map(g => branch(g, [...parents, group.slug]))}</ul></details>}</li>;
  }
  return <div>{faculties.map(faculty => <details key={faculty ?? "unassigned"} open><summary>{faculty ?? "Факультет не указан"}</summary>
    {[...new Set(roots.filter(g => g.faculty === faculty).map(g => g.department))].map(department => <details key={department ?? "unassigned"} open><summary>{department ?? "Кафедра не указана"}</summary>
      {[...new Set(roots.filter(g => g.faculty === faculty && g.department === department).map(g => g.programme))].map(programme => <details key={programme} open><summary>{programme || "Направление не указано"}</summary><ul>{roots.filter(g => g.faculty === faculty && g.department === department && g.programme === programme).map(g => branch(g))}</ul></details>)}
    </details>)}
  </details>)}</div>;
}
