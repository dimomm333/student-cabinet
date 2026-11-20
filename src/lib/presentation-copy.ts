// Exact aliases for bundled example wording. Never sanitize arbitrary input or
// write these labels back to academic records, forms, history or the database.
const academicCopies: Record<string, string> = {
  "Учебный пример · осень 2026": "Осень 2026",
  "ЛР 1 · демонстрационная защита": "ЛР 1 · защита",
  "ЛР1 · демонстрационная защита": "ЛР1 · защита",
  "Демонстрационный результат: работа проверена": "Работа проверена",
  "Демонстрационный приватный комментарий преподавателя": "Комментарий преподавателя",
  "Демонстрационная экзаменационная попытка": "Экзаменационная попытка",
  "Демонстрационная замена последнего РК": "Замена последнего РК",
  "Демонстрация: академические условия проверены деканатом": "Академические условия проверены деканатом",
};

export function presentAcademicText(value: string): string {
  return Object.hasOwn(academicCopies, value) ? academicCopies[value] : value;
}
