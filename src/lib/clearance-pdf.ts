import "server-only";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
export type ClearanceSnapshot = { number: string; studentName: string; groupName: string; reason: string; openedAt: string; completedAt: string; completedBy: string; steps: { name: string; status: string; actor: string; date: string; note: string }[] };
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
// Uses the existing PDF/image stack. Pages are printed at 216 dpi, with Pango
// rendering Cyrillic. Linux deployments install fonts-dejavu-core (see docs).
export async function renderClearancePdf(s: ClearanceSnapshot): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Обходной лист " + s.number); doc.setAuthor("Северный университет"); doc.setSubject("Образец. Внутреннее электронное согласование");
  const date = (v: string) => new Date(v).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
  const lines: { text: string; size: number; gap: number }[] = [];
  const add = (text: string, size = 11, gap = 15) => {
    // Bound by approximate glyph width, including unbroken long names.
    const width = Math.floor(480 / (size * .62));
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) { lines.push({ text: line, size, gap }); line = ""; }
      for (let i = 0; i < word.length; i += width) { const part = word.slice(i, i + width); if (part.length === width) lines.push({ text: part, size, gap }); else line += (line ? " " : "") + part; }
    }
    if (line) lines.push({ text: line, size, gap });
  };
  add("СЕВЕРНЫЙ УНИВЕРСИТЕТ", 13, 24); add("Обходной лист", 24, 35); add(s.number, 11, 25);
  add("Студент: " + s.studentName); add("Учебная группа: " + s.groupName); add("Основание: " + s.reason);
  add("Открыт: " + date(s.openedAt)); add("Завершён: " + date(s.completedAt), 11, 28);
  add("Итог: процедура завершена", 14, 30);
  for (const [i, step] of s.steps.entries()) { add(`${i + 1}. ${step.name}`, 12, 18); add(`${step.status}. ${step.actor}. ${date(step.date)}`); if (step.note) add(step.note); lines.push({ text: "", size: 11, gap: 6 }); }
  add("Итоговую проверку выполнил: " + s.completedBy, 11, 28);
  add("Образец. Согласования являются внутренними действиями авторизованных сотрудников. Квалифицированная электронная подпись не применяется.", 9, 14);
  let index = 0, pageNumber = 0;
  while (index < lines.length) {
    let y = 60, content = "";
    while (index < lines.length && y + lines[index].gap < 775) { const l = lines[index++]; content += `<text x="55" y="${y}" font-size="${l.size}" fill="#24382e">${escape(l.text)}</text>`; y += l.gap; }
    content += `<text x="55" y="810" font-size="9" fill="#68746c">Образец · ${escape(s.number)} · ${++pageNumber}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"><rect width="595" height="842" fill="white"/><g font-family="DejaVu Sans,Arial,sans-serif">${content}</g></svg>`;
    const png = await sharp(Buffer.from(svg), { density: 216 }).png().toBuffer();
    const page = doc.addPage([595.28, 841.89]), image = await doc.embedPng(png); page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  return Buffer.from(await doc.save());
}
