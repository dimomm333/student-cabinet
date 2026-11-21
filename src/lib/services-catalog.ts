import { serviceSearchDictionary } from "./services-search-dictionary.ts";
// Demonstration policy, not legal requirements. Retain old versions when adding v2.
export const categories = {
  DOCUMENTS: "Справки и документы", FINANCE: "Финансовые вопросы", ACADEMIC: "Учебные вопросы",
  PERSONAL: "Личные данные, документы, пропуск",
} as const;
export type Category = keyof typeof categories;
export type Field = { key: string; label: string; type: "text" | "date" | "integer" | "money" | "choice"; required?: boolean; options?: string[]; max?: number };
export type DocumentSlot = { key: string; label: string; photoOnly?: boolean; required?: boolean; when?: { field: string; value: string } };
export const servicePhotoMimeTypes = ["image/jpeg", "image/png", "image/webp"];
export const deaneryAppealDescription = "Не нашли подходящую услугу? Опишите свой вопрос или ситуацию в свободной форме — сотрудники деканата рассмотрят ваше обращение.";
export type ServiceConfig = { code: string; version: number; title: string; category: Category | null; description: string; synonyms: string[]; fields: Field[]; documents: DocumentSlot[]; profile: ("name" | "group" | "studentNumber" | "program" | "military")[]; resultDocument: boolean; processing: string };
const text = (key: string, label: string, required = true): Field => ({ key, label, type: "text", required, max: 2000 });
const date = (key: string, label: string): Field => ({ key, label, type: "date", required: true });
const choice = (key: string, label: string, options: string[]): Field => ({ key, label, type: "choice", options, required: true });
const reason = text("reason", "Основание или причина");
const period = [date("startsOn", "Начало периода"), date("endsOn", "Конец периода")];
const proof: DocumentSlot = { key: "proof", label: "Подтверждающий документ", required: true };
const housingPhotos: DocumentSlot = { key: "housing-photos", label: "Приложенные фотографии", photoOnly: true };
const receive = choice("delivery", "Способ получения", ["Лично", "Электронная копия"]);
function service(code: string, title: string, category: Category | null, fields: Field[], documents: DocumentSlot[], synonyms: string[], extra: Partial<ServiceConfig> = {}): ServiceConfig {
  return { code, version: 1, title, category, description: "Условия оказания услуги и перечень приложений требуют утверждения университетом.", synonyms, fields, documents, profile: ["name", "group"], resultDocument: false, processing: category === "FINANCE" ? "Уполномоченный финансовый обработчик" : category === "PERSONAL" ? "Уполномоченный обработчик персональных документов" : "Деканат", ...extra };
}
export const serviceCatalog: readonly ServiceConfig[] = [
  service("study-certificate", "Справка об обучении", "DOCUMENTS", [text("purpose", "Назначение справки"), { key: "copies", label: "Количество экземпляров", type: "integer", required: true, max: 10 }, receive], [], ["учусь", "подтверждение обучения", "справка студент", "место требования"], { resultDocument: true, profile: ["name", "group", "studentNumber", "program"] }),
  service("study-call", "Справка-вызов", "DOCUMENTS", [text("employer", "Работодатель"), text("employerAddress", "Адрес работодателя"), ...period, receive], [], ["работодатель", "учебный отпуск", "вызов сессия"], { resultDocument: true }),
  service("transcript", "Выписка об успеваемости", "DOCUMENTS", [text("purpose", "Назначение"), text("term", "Учебный период"), receive], [], ["оценки", "академическая справка", "выписка баллы"], { resultDocument: true }),
  service("merit-scholarship", "Заявление на повышенную государственную академическую стипендию", "FINANCE", [text("term", "Учебный период"), text("achievements", "Достижения")], [proof], ["пгас", "повышенная стипендия", "достижения"]),
  service("social-scholarship", "Заявление на государственную социальную стипендию", "FINANCE", [reason, ...period], [proof], ["соц стипендия", "социальная помощь", "льгота"]),
  service("material-aid", "Единовременная материальная помощь", "FINANCE", [reason, text("circumstances", "Обстоятельства")], [proof], ["матпомощь", "деньги", "трудная ситуация"]),
  service("dorm-compensation", "Компенсация проживания в общежитии", "FINANCE", [...period, text("dormitory", "Общежитие"), { key: "amount", label: "Расходы, руб.", type: "money", max: 1000000 }], [proof], ["общага", "возмещение жилье", "оплата общежития"]),
  service("dorm-move-in", "Заселение в общежитие", "ACADEMIC", [reason, text("preference", "Пожелания по размещению", false)], [housingPhotos], ["получить место", "жильё", "общежитие"], { description: "После положительного решения сотрудник подберёт место и сообщит о резерве." }),
  service("dorm-transfer", "Переселение в общежитии", "ACADEMIC", [reason, text("preference", "Пожелания по размещению", false)], [housingPhotos], ["сменить комнату", "переехать", "общежитие"], { description: "После положительного решения сотрудник подберёт новое место. Текущее место сохраняется до подтверждения переселения." }),
  service("travel-compensation", "Компенсация проезда домой во время каникул", "FINANCE", [...period, text("route", "Маршрут домой"), { key: "amount", label: "Расходы, руб.", type: "money", max: 1000000 }], [proof], ["билеты", "дорога домой", "возмещение проезда", "каникулы"]),
  service("academic-leave", "Академический отпуск", "ACADEMIC", [reason, ...period], [proof], ["академ", "приостановить обучение"]),
  service("group-transfer", "Перевод в другую учебную группу", "ACADEMIC", [text("targetGroup", "Желаемая группа"), reason], [], ["смена группы", "перевестись"]),
  service("individual-plan", "Индивидуальный учебный план", "ACADEMIC", [text("term", "Учебный период"), reason, text("requestedPlan", "Предлагаемый план")], [{ ...proof, required: false }], ["иуп", "индивидуальный график"]),
  service("withdrawal", "Отчисление по собственному желанию", "ACADEMIC", [reason, date("requestedOn", "Предполагаемая дата"), text("documentDelivery", "Получение документов")], [{ key: "statement", label: "Заявление", required: true }], ["уйти", "забрать документы", "отчислиться"]),
  service("personal-change", "Изменение персональных данных", "PERSONAL", [choice("dataType", "Изменяемые сведения", ["ФИО", "Гражданство", "Иные официальные сведения"]), text("currentValue", "Текущие сведения", false), text("proposedValue", "Предлагаемые изменения")], [proof], ["фамилия", "смена имени", "ошибка профиль", "паспорт"]),
  service("military-change", "Изменение сведений воинского учёта", "PERSONAL", [text("registrationStatus", "Предлагаемые сведения об учёте"), text("office", "Военкомат"), text("documentType", "Вид документа"), text("documentNumber", "Реквизиты подтверждения")], [proof], ["военкомат", "военный билет", "приписное"], { profile: ["name", "group", "military"] }),
  service("pass-reissue", "Перевыпуск студенческого пропуска", "PERSONAL", [reason, choice("photo", "Фотография", ["KEEP", "NEW"])], [{ key: "photo", label: "Новая фотография", required: true, when: { field: "photo", value: "NEW" } }], ["потерял пропуск", "карта", "фото", "пропуск сломан"]),
  service("deanery-appeal", "Обращение в деканат", null, [text("subject", "Тема"), text("message", "Вопрос")], [{ key: "attachment", label: "Приложение", required: false }], ["другой вопрос", "обращение"], { description: deaneryAppealDescription }),
];
export class ServiceError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function configFor(code: string, version?: number) {
  const config = serviceCatalog.filter(item => item.code === code && (version === undefined || item.version === version)).sort((a, b) => b.version - a.version)[0];
  if (!config) throw new ServiceError("Версия услуги недоступна.");
  return config;
}
export function validateFields(config: ServiceConfig, input: unknown, partial: boolean): Record<string, string | number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ServiceError("Требуется объект полей.");
  const data = input as Record<string, unknown>, result: Record<string, string | number> = {};
  if (Object.keys(data).some(key => !config.fields.some(field => field.key === key))) throw new ServiceError("Неизвестное или защищённое поле.");
  for (const field of config.fields) {
    const value = data[field.key];
    if (value === undefined || value === "" || value === null) { if (!partial && field.required) throw new ServiceError(`Заполните: ${field.label}.`); continue; }
    if (field.type === "integer" || field.type === "money") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < (field.type === "integer" ? 1 : 0) || value > (field.max ?? 1000000) || (field.type === "integer" ? !Number.isInteger(value) : Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)) throw new ServiceError(`Некорректное число: ${field.label}.`);
    } else {
      if (typeof value !== "string" || !value.trim() || value.length > (field.max ?? 2000) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ServiceError(`Некорректный текст: ${field.label}.`);
      if (field.type === "choice" && !field.options?.includes(value)) throw new ServiceError(`Выберите: ${field.label}.`);
      if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new ServiceError(`Некорректная дата: ${field.label}.`);
    }
    result[field.key] = typeof value === "string" ? value.trim() : value;
  }
  if (typeof result.startsOn === "string" && typeof result.endsOn === "string" && result.startsOn > result.endsOn) throw new ServiceError("Начало периода позже окончания.");
  return result;
}
export function validateDocuments(config: ServiceConfig, fields: Record<string, unknown>, documents: { slot: string; kind: string; removedAt: Date | null }[]) {
  for (const slot of config.documents) if (slot.required && (!slot.when || fields[slot.when.field] === slot.when.value) && !documents.some(doc => !doc.removedAt && doc.kind === "STUDENT" && doc.slot === slot.key)) throw new ServiceError(`Приложите: ${slot.label}.`);
}
const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function near(a: string, b: string) {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const old = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = old; } }
  return row[b.length] <= 1;
}
export function searchServices(query: string) {
  if (query.length > 1000) throw new ServiceError("Поисковый запрос слишком длинный.");
  const words = normalize(query).split(" ").filter(word => word.length > 2).slice(0, 40);
  return serviceCatalog.filter(service => configFor(service.code).version === service.version).map(service => {
    const title = normalize(service.title), aliases = normalize([...service.synonyms, ...(serviceSearchDictionary[service.code] ?? [])].join(" "));
    const stem = (word: string) => word.length > 5 ? word.replace(/(иями|ами|ого|ему|ому|ить|ать|ять|ов|ев|ам|ям|ах|ях|ой|ей|ая|яя|ое|ые|ий|ый|ую|юю|ы|и|а|я|у|ю|е)$/u, "") : word;
    const tokens = (title + " " + aliases).split(" ");
    const categoryWords = normalize(service.category ? categories[service.category] : "").split(" ");
    const score = [...new Set(words)].reduce((sum, word) => {
      if (["это", "как", "мне", "меня", "хочу", "для", "или", "что", "нужно"].includes(word)) return sum;
      if (["студент", "вопрос", "услуг", "обращени"].includes(stem(word))) return sum;
      const weight = ["дом", "деньги", "документы", "учеба"].includes(word) ? 0.2 : 1;
      return sum + weight * (title.split(" ").includes(word) ? 8 : aliases.split(" ").includes(word) ? 6 : tokens.some(token => stem(token) === stem(word)) ? 5 : tokens.some(token => near(word, token)) ? 3 : categoryWords.some(token => stem(token) === stem(word)) ? 1 : 0);
    }, 0);
    return { service, score };
  }).filter(item => !words.length || item.score > 0).sort((a, b) => b.score - a.score || a.service.code.localeCompare(b.service.code));
}
