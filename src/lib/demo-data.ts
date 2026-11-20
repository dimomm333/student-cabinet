import type { IconName } from "@/components/icon";

export const sections: { slug: string; title: string; icon: IconName; description: string; group: string }[] = [
  { slug: "profile", title: "Профиль", icon: "user", description: "Личные данные студента и сведения об обучении.", group: "Учёба" },
  { slug: "schedule", title: "Моё расписание", icon: "calendar", description: "Занятия, аудитории и преподаватели.", group: "Учёба" },
  { slug: "session", title: "Сессия", icon: "book", description: "Допуски, экзаменационные попытки, предварительные и утверждённые результаты БРС.", group: "Учёба" },
  { slug: "grades", title: "Успеваемость", icon: "chart", description: "Модули, ДЗ, лабораторные, рубежные контроли, посещаемость и баллы.", group: "Учёба" },
  { slug: "materials", title: "Учебные материалы", icon: "folder", description: "Лекции, задания и опубликованные материалы ваших дисциплин.", group: "Учёба" },
  { slug: "services", title: "Услуги", icon: "grid", description: "Справки, заявления и обращения в службы университета.", group: "Кампус" },
  { slug: "notifications", title: "Уведомления", icon: "bell", description: "Уведомления об учёбе и событиях университета.", group: "Кампус" },
  { slug: "news", title: "Новости", icon: "news", description: "Новости и объявления университета.", group: "Кампус" },
  { slug: "clearance", title: "Обходной лист", icon: "clipboard", description: "Согласование обходного листа в подразделениях университета.", group: "Кампус" },
  { slug: "useful", title: "Полезное", icon: "spark", description: "Ответы на частые вопросы, контакты служб и памятки.", group: "Кампус" },
  { slug: "sports", title: "Физкультура", icon: "sport", description: "Спортивные секции, тренировки и посещаемость.", group: "Кампус" },
  { slug: "portfolio", title: "Портфолио", icon: "briefcase", description: "Проекты, достижения и участие в мероприятиях.", group: "Кампус" },
  { slug: "mail", title: "Почта", icon: "mail", description: "Университетская почта и учебная переписка.", group: "Кампус" },
];

export const news = [
  { id: "science", category: "НАУКА", date: "10 ноября 2026", title: "Большие идеи начинаются с любопытства", excerpt: "Открываем приём заявок на студенческую научную конференцию «Горизонты».", detail: "В демонстрационной программе — цифровые технологии, городская среда и устойчивое развитие. Конференция пройдёт 25 ноября в учебном корпусе. Это вымышленное событие для знакомства с интерфейсом.", art: "science", icon: "spark" as const },
  { id: "community", category: "СООБЩЕСТВО", date: "9 ноября 2026", title: "Найди тех, кто разделяет твои интересы", excerpt: "Неделя студенческих объединений: от дебатного клуба до творческой мастерской.", detail: "На демонстрационной неделе объединений можно познакомиться с клубами, найти команду для проекта и попробовать новое хобби. Все объединения и события в прототипе вымышлены.", art: "community", icon: "user" as const },
  { id: "library", category: "ВОЗМОЖНОСТИ", date: "7 ноября 2026", title: "Новое место для твоих открытий", excerpt: "В библиотеке кампуса появилось пространство для совместной работы.", detail: "В вымышленной библиотеке оборудованы тихая зона, переговорные и места для работы над командными проектами. Новость создана только для демонстрации кабинета.", art: "library", icon: "book" as const },
];

export const notifications = [
  { icon: "calendar" as const, tone: "amber", title: "Изменение аудитории", text: "Программирование сегодня пройдёт в аудитории Б-304.", time: "Сегодня, 08:15" },
  { icon: "folder" as const, tone: "green", title: "Новые учебные материалы", text: "Добавлена лекция по линейной алгебре за 10 ноября.", time: "Вчера, 16:40" },
  { icon: "spark" as const, tone: "blue", title: "Время для новых идей", text: "Открыт приём заявок на конференцию «Горизонты».", time: "Вчера, 12:00" },
];

export const lessonDays = [
  { label: "Сегодня", date: "11 ноября, среда", lessons: [
    { start: "09:00", end: "10:30", title: "Математический анализ", type: "Лекция", teacher: "Анна Сергеевна Белова", room: "А-201", building: "Главный корпус", tone: "green" },
    { start: "10:45", end: "12:15", title: "Программирование", type: "Практика", teacher: "Михаил Игоревич Соколов", room: "Б-304", building: "Учебный корпус Б", tone: "blue" },
    { start: "13:00", end: "14:30", title: "Английский язык", type: "Семинар", teacher: "Елена Андреевна Морозова", room: "А-112", building: "Главный корпус", tone: "amber" },
  ] },
  { label: "Завтра", date: "12 ноября, четверг", lessons: [
    { start: "10:45", end: "12:15", title: "Линейная алгебра", type: "Лекция", teacher: "Анна Сергеевна Белова", room: "А-205", building: "Главный корпус", tone: "green" },
    { start: "13:00", end: "14:30", title: "Введение в проектную деятельность", type: "Практика", teacher: "Михаил Игоревич Соколов", room: "Б-108", building: "Учебный корпус Б", tone: "blue" },
  ] },
];
