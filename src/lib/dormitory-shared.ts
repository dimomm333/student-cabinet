export const dormPermissions = {
  FUND: "Жилой фонд", HOUSING: "Заселение и выселение", REPAIR: "Управление ремонтом",
  TECHNICIAN: "Выполнение ремонта", FINANCE: "Начисления и оплаты", DOCUMENTS: "Документы",
  ANNOUNCEMENTS: "Объявления", GRANTS: "Назначения сотрудников",
} as const;

export const repairCategories = {
  ELECTRICITY: "Электрика", PLUMBING: "Сантехника", FURNITURE: "Мебель",
  APPLIANCE: "Бытовая техника", OTHER: "Другое",
} as const;

export const repairStatuses = {
  NEW: "Новая", ACCEPTED: "Принята", ASSIGNED: "Назначен исполнитель", IN_PROGRESS: "В работе",
  VERIFY: "Ожидает подтверждения", CLOSED: "Закрыта", REWORK: "На доработке",
  REJECTED: "Отклонена", CANCELLED: "Отменена", MERGED: "Объединена",
} as const;

export const documentKinds = {
  CONTRACT: "Договор", RULES: "Правила", INSTRUCTIONS: "Инструкция", RECEIPT: "Квитанция", OTHER: "Другой документ",
} as const;

export const openRepairStatuses = ["NEW", "ACCEPTED", "ASSIGNED", "IN_PROGRESS", "VERIFY", "REWORK"] as const;
export const dormitoryServiceCodes = ["dorm-move-in", "dorm-transfer"] as const;

export const dormActions = {
  DORM_CREATE: "Создать общежитие", DORM_EDIT: "Сохранить настройки", GRANT: "Изменить назначение",
  ROOM_CREATE: "Создать комнату и места", ROOM_STATE: "Изменить состояние комнаты", BED_STATE: "Изменить состояние места",
  RESERVE: "Зарезервировать", RESERVE_CANCEL: "Отменить резерв", CHECK_IN: "Подтвердить заселение",
  LEGACY_MATCH: "Сопоставить после проверки", DEPART: "Оформить выезд", INSPECT: "Подтвердить проверку комнаты",
  CHECK_OUT: "Подтвердить выезд", LOAN: "Выдать", RETURN: "Принять возврат", ASSET: "Добавить имущество",
  ASSET_EDIT: "Обновить имущество", REPAIR_CREATE: "Подать заявку", REPAIR_TRANSITION: "Изменить статус",
  REPAIR_COMMENT: "Добавить комментарий", REPAIR_MERGE: "Объединить дубли", REPAIR_FILE: "Прикрепить фото",
  CHARGE: "Создать начисление", LEDGER: "Подтвердить операцию", DOCUMENT: "Загрузить документ",
  DOCUMENT_ARCHIVE: "Архивировать документ",
} as const;

export type DormAction = keyof typeof dormActions;
export class DormError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function paymentLink(value: string) {
  if (!value) return null;
  if (/[\s\\]/.test(value)) throw new DormError("Укажите полный HTTPS-адрес оплаты.");
  let url: URL;
  try { url = new URL(value); } catch { throw new DormError("Укажите полный HTTPS-адрес оплаты."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new DormError("Укажите HTTPS-адрес оплаты без учётных данных.");
  return url.href;
}
