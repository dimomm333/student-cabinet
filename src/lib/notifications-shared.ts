export const notificationCategories = {
  STUDY: "Учёба", SCHEDULE: "Расписание", SERVICES: "Заявления", ANNOUNCEMENTS: "Объявления",
  SYSTEM: "Система", MATERIALS: "Учебные материалы", DORMITORY: "Общежитие",
} as const;
export type NotificationCategory = keyof typeof notificationCategories;
export const allNotificationCategories = Object.keys(notificationCategories) as NotificationCategory[];
export const serviceNotificationTitles: Record<string, string> = {
  SUBMITTED: "Заявление принято", RESUBMITTED: "Уточнение отправлено", IN_REVIEW: "Заявление на рассмотрении",
  CLARIFICATION_REQUIRED: "Требуется уточнение заявления", IN_PROGRESS: "Заявление в работе",
  COMPLETED: "Заявление исполнено", REJECTED: "По заявлению получен отказ", STAFF_REPLY: "Поступил ответ сотрудника",
};
export type NotificationItem = { id: number; title: string; body: string; category: NotificationCategory; mandatory: boolean; createdAt: string; readAt: string | null; href: string; source: string };
export type NotificationFeed = { items: NotificationItem[]; unread: number; boundary: number; nextCursor: number | null };
export type NotificationPreferences = { optionalCategories: NotificationCategory[]; emailCategories: NotificationCategory[]; personalEmail: boolean; emailAvailable: boolean; emailReason: string; universityEmailAvailable: false };

// Only application-owned protected targets. Encoded path separators/control
// characters and protocol-relative URLs are deliberately excluded.
export function safeNotificationHref(href: string) {
  if (!href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]|%0[ad]|%5c|%2f/i.test(href)) throw new Error("Unsafe notification link");
  const url = new URL(href, "https://lks.invalid");
  if (url.origin !== "https://lks.invalid" || !/^\/(dashboard|teacher|deanery|admin|staff)(\/|$)/.test(url.pathname)) throw new Error("Unsafe notification link");
  return href;
}
