import type { IconName } from "@/components/icon";
import type { Role } from "@/generated/prisma/enums";

export type WorkspaceRole = Exclude<Role, "STUDENT">;
export type WorkspaceSection = { slug: string; title: string; icon: IconName; description: string };
const profileSection: WorkspaceSection = { slug: "profile", title: "Профиль", icon: "user", description: "Личные данные и сведения об учётной записи." };

export const workspaces: Record<WorkspaceRole, { title: string; description: string; sections: WorkspaceSection[] }> = {
  DEANERY_STAFF: {
    title: "Кабинет деканата",
    description: "Учебная работа в пределах назначенных подразделений.",
    sections: [
      { slug: "students", title: "Студенты", icon: "user", description: "Просмотр студентов назначенных подразделений." },
      { slug: "groups", title: "Учебные группы", icon: "book", description: "Группы назначенных подразделений." },
      { slug: "schedule", title: "Расписание", icon: "calendar", description: "Регулярные занятия, разовые замены и отмены для своих групп." },
      { slug: "grades", title: "Успеваемость", icon: "chart", description: "Контроль успеваемости будет добавлен на следующем этапе." },
      { slug: "requests", title: "Заявки и заявления", icon: "clipboard", description: "Обработка заявлений и исправлений данных будет добавлена на следующем этапе." },
      { slug: "notifications", title: "Уведомления", icon: "bell", description: "Уведомления деканата будут добавлены на следующем этапе." },
      profileSection,
    ],
  },
  TEACHER: {
    title: "Кабинет преподавателя",
    description: "Пространство для преподавания и взаимодействия со студентами.",
    sections: [
      profileSection,
      { slug: "schedule", title: "Расписание", icon: "calendar", description: "Ваши занятия по всем группам, время, аудитории и корпуса." },
      { slug: "disciplines", title: "Дисциплины и группы", icon: "book", description: "Здесь будут закреплённые дисциплины и учебные группы." },
      { slug: "students", title: "Студенты", icon: "user", description: "Здесь появятся студенты закреплённых учебных групп." },
      { slug: "grades", title: "Журнал оценок", icon: "chart", description: "Здесь будет журнал оценок и посещаемости." },
      { slug: "materials", title: "Учебные материалы", icon: "folder", description: "Здесь можно будет размещать учебные материалы." },
      { slug: "consultations", title: "Консультации", icon: "clock", description: "Здесь появятся консультации и запись на них." },
      { slug: "announcements", title: "Объявления", icon: "news", description: "Здесь можно будет публиковать объявления для групп." },
    ],
  },
  TECHNICAL_STAFF: {
    title: "Кабинет технического персонала",
    description: "Пространство для поддержки оборудования и инфраструктуры кампуса.",
    sections: [
      profileSection,
      { slug: "requests", title: "Технические заявки", icon: "clipboard", description: "Здесь появятся технические обращения и их обработка." },
      { slug: "equipment", title: "Оборудование", icon: "grid", description: "Здесь будет учёт оборудования университета." },
      { slug: "rooms", title: "Аудитории", icon: "pin", description: "Здесь появится информация об аудиториях и оснащении." },
      { slug: "tasks", title: "Задачи", icon: "check", description: "Здесь будут рабочие задачи технической службы." },
      { slug: "notifications", title: "Уведомления", icon: "bell", description: "Здесь появятся уведомления технической службы." },
    ],
  },
  ADMIN: {
    title: "Кабинет администратора",
    description: "Пространство для управления университетской системой.",
    sections: [
      profileSection,
      { slug: "users", title: "Пользователи", icon: "user", description: "Здесь будет управление учётными записями и ролями." },
      { slug: "news", title: "Новости", icon: "news", description: "Здесь появится управление публичными новостями." },
      { slug: "requests", title: "Заявки студентов", icon: "clipboard", description: "Здесь будет обработка обращений студентов." },
      { slug: "academic", title: "Учебные данные", icon: "book", description: "Здесь появится управление структурой учебных данных." },
      { slug: "settings", title: "Настройки", icon: "shield", description: "Здесь будут настройки университетской системы." },
    ],
  },
};
