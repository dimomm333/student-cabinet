import "server-only";
import Link from "next/link";
import { Suspense } from "react";
import { getOwnStudentProfile, educationStatusLabels, residenceStatusLabels } from "@/lib/student-profile";
import { roleLabels } from "@/lib/roles";
import CabinetPageLoading from "./cabinet-page-loading";
import { Icon, type IconName } from "./icon";
import { StudentMilitaryRecord } from "./student-military-record";
import { ProfileSettings } from "./profile-settings";
import { ProfilePass } from "./student-pass";

type Field = [string, string | number | null | undefined];
function Details({ title, icon, fields, children }: { title: string; icon: IconName; fields: Field[]; children?: React.ReactNode }) {
  return <section className="panel profile-panel"><h2><Icon name={icon} size={21} />{title}</h2>
    {children}<dl className="profile-fields">{fields.map(([label, value]) => {
      const filled = value != null && String(value).trim() !== "";
      return <div key={label}><dt>{label}</dt><dd className={filled ? undefined : "profile-unfilled"}>{filled ? value : "Не указано"}</dd></div>;
    })}</dl></section>;
}
const date = (value: Date | null | undefined) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" }).format(value) : null;

async function ProfileContent() {
  const user = await getOwnStudentProfile();
  const p = user.studentProfile;
  const group = p?.group?.code ?? p?.groupName;
  const fullName = [p?.lastName, p?.firstName, p?.middleName].filter(Boolean).join(" ");
  // Preserve the existing account display name without guessing its components.
  const displayName = p?.lastName && p?.firstName ? fullName : user.name;
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  const status = p?.educationStatus ? educationStatusLabels[p.educationStatus] : "Не указано";
  const resident = p?.residenceStatus === "RESIDENT";
  return <div className="student-profile">
    <div className="dashboard-title"><div><span className="eyebrow">Кабинет студента</span><h1>Профиль</h1><p>Личные данные и сведения об обучении в университете.</p></div></div>
    <section className="panel student-profile-hero" aria-label="Студент">
      <div className="student-portrait">
        {p?.officialPhoto ? <>
          {/* Authenticated URL must bypass the public Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/api/student/profile/photo" alt={`Официальная фотография: ${displayName}`} width={144} height={192} />
        </> : <div className="student-portrait-placeholder" role="img" aria-label="Официальная фотография отсутствует"><span>{initials || "—"}</span><small>Фото отсутствует</small></div>}
      </div>
      <div className="student-profile-identity"><h2>{displayName}</h2><p className="student-group"><Icon name="cap" />{group ? `Группа ${group}` : "Учебная группа: не указано"}</p><span className={`student-status${p?.educationStatus === "STUDYING" ? " student-status-active" : ""}`}>Статус обучения: {status}</span><p className="student-official-note"><Icon name="shield" size={16} />Данные доступны только для просмотра</p></div>
    </section>
    <ProfileSettings />
    <ProfilePass />
    <div className="user-profile student-profile-grid">
      <Details title="Личные данные" icon="user" fields={[
        ["Фамилия", p?.lastName], ["Имя", p?.firstName], ["Отчество", p?.middleName],
        ["Пол", p?.gender === "MALE" ? "Мужской" : p?.gender === "FEMALE" ? "Женский" : null], ["Гражданство", p?.citizenship],
        ...(p?.contactPhone?.trim() ? [["Контактный телефон", p.contactPhone] as Field] : []), ["Университетская электронная почта", user.email],
      ]} />
      <Details title="Обучение" icon="cap" fields={[
        ["Институт", p?.group?.department?.faculty ?? p?.institute], ["Образовательная программа", p?.group?.programme ?? p?.program],
        ["Уровень образования", p?.educationLevel], ["Учебная группа", group], ["Курс", p?.group?.course ?? p?.course],
        ["Форма обучения", p?.studyMode], ["Основа обучения", p?.fundingBasis], ["Дата зачисления", date(p?.enrolledAt)],
        ["Предполагаемый год окончания", p?.expectedGraduationYear], ["Статус обучения", status],
      ]} />
      <Details title="Документы" icon="folder" fields={[["Номер личного дела", p?.personalFileNumber]]} />
      <StudentMilitaryRecord />
      <Details title="Общежитие" icon="home" fields={[
        ["Статус проживания", p?.residenceStatus ? residenceStatusLabels[p.residenceStatus] : "Нет данных"],
        ["Общежитие", resident ? p?.dormitory : null], ["Комната", resident ? p?.dormitoryRoom : null],
      ]}>{!p?.residenceStatus && <p className="student-section-note">Сведения о проживании не предоставлены университетом.</p>}</Details>
      <Details title="Учётная запись" icon="shield" fields={[
        ["Роль", roleLabels[user.role]], ["Дата регистрации", new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(user.createdAt)],
      ]} />
    </div>
    <section className="student-profile-help"><span className="student-help-icon"><Icon name="help" size={25} /></span><div><h2>Нашли ошибку в данных?</h2><p>Изменения официальных данных и фотографии выполняются уполномоченными сотрудниками университета после проверки заявления.</p><Link href="/dashboard/services?service=personal-change" className="text-link">Изменить персональные данные <Icon name="arrow" size={17} /></Link></div></section>
  </div>;
}

export function StudentProfile() {
  return <Suspense fallback={<CabinetPageLoading />}><ProfileContent /></Suspense>;
}
