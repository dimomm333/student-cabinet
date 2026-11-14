import "server-only";
import Link from "next/link";
import { Suspense } from "react";
import type { Role } from "@/generated/prisma/enums";
import { requireRole } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { roleHomes, roleLabels } from "@/lib/roles";
import CabinetPageLoading from "./cabinet-page-loading";

type Field = [label: string, value: string | number | null | undefined];
function ProfileFields({ title, fields }: { title: string; fields: Field[] }) {
  return <section className="panel profile-panel"><h2>{title}</h2><dl className="profile-fields">{fields.map(([label, value]) => {
    const filled = value !== null && value !== undefined && String(value).trim() !== "";
    return <div key={label}><dt>{label}</dt><dd className={filled ? undefined : "profile-unfilled"}>{filled ? value : "Не заполнено"}</dd></div>;
  })}</dl></section>;
}

async function ProfileContent({ role }: { role: Exclude<Role, "STUDENT"> }) {
  const actor = await requireRole(role);
  // Ownership and current role are checked next to the read. No client ID,
  // account credentials or session fields enter this projection.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actor.id, role },
    select: {
      name: true, email: true, role: true, emailVerified: true, createdAt: true,
    },
  });
  const teacher = role === "TEACHER" ? await prisma.teacherProfile.findUnique({ where: { userId: actor.id }, select: { department: true, position: true, publicName: true, isSchedulePublic: true } }) : null;
  const staff = role === "TECHNICAL_STAFF" ? await prisma.technicalStaffProfile.findUnique({ where: { userId: actor.id }, select: { department: true, jobTitle: true } }) : null;
  const deanery = role === "DEANERY_STAFF" ? await prisma.deaneryStaffProfile.findUnique({ where: { userId: actor.id }, select: { position: true, departments: { select: { department: { select: { faculty: true, name: true } } }, orderBy: { department: { name: "asc" } } } } }) : null;
  const details: Field[] = role === "TEACHER" ? [
    ["Кафедра", teacher?.department], ["Должность", teacher?.position], ["Имя в публичном расписании", teacher?.publicName],
    ["Публикация в расписании", teacher ? teacher.isSchedulePublic ? "Включена" : "Отключена" : null],
  ] : role === "TECHNICAL_STAFF" ? [["Подразделение", staff?.department], ["Должность", staff?.jobTitle]] : role === "DEANERY_STAFF" ? [
    ["Назначенные подразделения", deanery?.departments.map(item => `${item.department.faculty} · ${item.department.name}`).join("; ")], ["Должность", deanery?.position],
  ] : [];
  return <>
    <div className="dashboard-title"><div><span className="eyebrow">{roleLabels[role]}</span><h1>Профиль</h1><p>Ваши данные из учётной записи университета.</p></div></div>
    <div className="user-profile">
      <ProfileFields title="Учётная запись" fields={[
        ["Имя и фамилия", user.name], ["Электронная почта", user.email], ["Роль", roleLabels[user.role]],
        ["Подтверждение почты", user.emailVerified ? "Подтверждена" : "Не подтверждена"],
        ["Дата регистрации", new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(user.createdAt)],
      ]} />
      {!!details.length && <ProfileFields title="Работа в университете" fields={details} />}
    </div>
    <p className="profile-note">Профиль доступен только для просмотра. Для уточнения данных обратитесь к ответственному сотруднику университета.</p>
    <Link href={roleHomes[role]} className="button button-primary">На главную кабинета</Link>
  </>;
}

export function UserProfile({ role }: { role: Exclude<Role, "STUDENT"> }) {
  return <Suspense fallback={<CabinetPageLoading />}><ProfileContent role={role} /></Suspense>;
}
