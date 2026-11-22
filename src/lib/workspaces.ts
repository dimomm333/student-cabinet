import type { IconName } from "@/components/icon";
import type { Role } from "@/generated/prisma/enums";

export type WorkspaceRole = Exclude<Role, "STUDENT">;
export type WorkspaceSection = { slug: string; title: string; icon: IconName; description: string };
export const passSection: WorkspaceSection = { slug: "passes", title: "Электронные пропуска", icon: "qr", description: "Операции со студенческими пропусками." };
const profileSection: WorkspaceSection = { slug: "profile", title: "Профиль", icon: "user", description: "Личные данные и сведения об учётной записи." };
const sportsSection: WorkspaceSection = { slug: "sports", title: "Физкультура", icon: "sport", description: "Учебные спортивные группы, посещаемость, нормативы и зачёт." };
const notificationsSection: WorkspaceSection = { slug: "notifications", title: "Уведомления", icon: "bell", description: "Уведомления об учёбе и работе университета." };
const clearanceSection: WorkspaceSection = { slug: "clearance", title: "Обходные листы", icon: "check", description: "Проверки подразделений, замечания и итоговые согласования." };
const dormitorySection: WorkspaceSection = { slug: "dormitory", title: "Общежития", icon: "home", description: "Работа в пределах назначений общежитий." };

export const workspaces: Record<WorkspaceRole, { title: string; description: string; sections: WorkspaceSection[] }> = {
  DEANERY_STAFF: {
    title: "Кабинет деканата",
    description: "Учебная работа в пределах назначенных подразделений.",
    sections: [
      { slug: "students", title: "Студенты", icon: "user", description: "Просмотр студентов назначенных подразделений." },
      { slug: "groups", title: "Учебные группы", icon: "book", description: "Группы назначенных подразделений." },
      { slug: "schedule", title: "Расписание", icon: "calendar", description: "Регулярные занятия, разовые замены и отмены для своих групп." },
      { slug: "consultations", title: "Консультации", icon: "clock", description: "Расписание консультаций для групп назначенных подразделений." },
      sportsSection,
      { slug: "grades", title: "Успеваемость", icon: "chart", description: "Модули, работы, баллы и посещаемость своих групп." },
      { slug: "brs", title: "Планы БРС", icon: "book", description: "Учебные назначения, настройка и публикация планов." },
      { slug: "admissions", title: "Допуски", icon: "check", description: "Подтверждение и отзыв допуска к обычным экзаменам." },
      { slug: "session", title: "Сессия", icon: "calendar", description: "Экзаменационные попытки, итоги и задолженности." },
      { slug: "requests", title: "Заявки и заявления", icon: "clipboard", description: "Очередь заявлений, уточнения, документы и решения в пределах полномочий." },
      { slug: "portfolio", title: "Проверка достижений", icon: "briefcase", description: "Достижения из портфолио студентов назначенных подразделений." },
      clearanceSection,
      notificationsSection,
      profileSection,
    ],
  },
  TEACHER: {
    title: "Кабинет преподавателя",
    description: "Пространство для преподавания и взаимодействия со студентами.",
    sections: [
      notificationsSection,
      profileSection,
      { slug: "schedule", title: "Расписание", icon: "calendar", description: "Ваши занятия по всем группам, время, аудитории и корпуса." },
      sportsSection,
      { slug: "disciplines", title: "Дисциплины и группы", icon: "book", description: "Закреплённые дисциплины и учебные группы." },
      { slug: "students", title: "Студенты", icon: "user", description: "Студенты закреплённых учебных групп." },
      { slug: "grades", title: "Журнал оценок", icon: "chart", description: "Модульный журнал баллов и посещаемости." },
      { slug: "session", title: "Сессия", icon: "book", description: "Допуски, экзаменационные попытки и фиксация итогов." },
      { slug: "materials", title: "Учебные материалы", icon: "folder", description: "Документы, ссылки, папки и публикации для ваших групп." },
      { slug: "consultations", title: "Консультации", icon: "clock", description: "Ближайшие и прошедшие консультации." },
      { slug: "announcements", title: "Объявления", icon: "news", description: "Объявления для учебных групп." },
    ],
  },
  TECHNICAL_STAFF: {
    title: "Кабинет технического персонала",
    description: "Пространство для поддержки оборудования и инфраструктуры кампуса.",
    sections: [
      profileSection,
      { slug: "requests", title: "Технические заявки", icon: "clipboard", description: "Технические обращения и их обработка." },
      { slug: "services", title: "Заявления студентов", icon: "folder", description: "Заявления по назначенным услугам." },
      dormitorySection,
      clearanceSection,
      { slug: "equipment", title: "Оборудование", icon: "grid", description: "Учёт оборудования университета." },
      { slug: "rooms", title: "Аудитории", icon: "pin", description: "Аудитории и их оснащение." },
      { slug: "tasks", title: "Задачи", icon: "check", description: "Рабочие задачи технической службы." },
      notificationsSection,
    ],
  },
  ADMIN: {
    title: "Кабинет администратора",
    description: "Пространство для управления университетской системой.",
    sections: [
      notificationsSection,
      profileSection,
      { slug: "users", title: "Пользователи", icon: "user", description: "Учётные записи и роли пользователей." },
      { slug: "news", title: "Новости", icon: "news", description: "Публикация объявлений для всех студентов или подразделения." },
      dormitorySection,
      { slug: "requests", title: "Заявки студентов", icon: "clipboard", description: "Заявления и документы, доступные по явным полномочиям." },
      { slug: "academic", title: "Учебные данные", icon: "book", description: "Структура учебных данных." },
      sportsSection,
      { slug: "useful", title: "Полезное", icon: "spark", description: "Управление студенческими справочниками, инструкциями и ссылками." },
      { slug: "settings", title: "Настройки", icon: "shield", description: "Настройки университетской системы." },
      clearanceSection,
    ],
  },
};
