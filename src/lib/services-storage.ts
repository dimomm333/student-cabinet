import "server-only";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { ServiceError } from "./services-catalog.ts";

export const MAX_SERVICE_FILE = 8 * 1024 * 1024;
export const MAX_SERVICE_PDF = 20 * 1024 * 1024;
let pdfProcesses = 0;
async function validatePdf(bytes: Buffer) {
  if (pdfProcesses >= 2) throw new ServiceError("Проверка документов занята. Повторите загрузку позже.", 503);
  pdfProcesses++;
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=128", resolve("scripts/validate-service-pdf.mjs")], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, NODE_OPTIONS: "" } });
      let output = "";
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 8000);
      child.stdout.on("data", data => { output += String(data).slice(0, 16); if (output.length > 16) child.kill(); });
      child.stdin.on("error", () => {});
      child.on("error", () => { clearTimeout(timer); reject(new ServiceError("Проверка PDF недоступна.", 503)); });
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0 && output === "OK") return accept();
        const messages: Record<string, string> = {
          UNSUPPORTED: "PDF содержит опасные действия или неподдерживаемое содержимое. Выберите другой файл без скриптов, вложений и активных форм.",
          ENCRYPTED: "PDF защищён шифрованием или паролем. Предоставьте незашифрованный документ.",
          LIMIT: "PDF превышает ограничения проверки: число страниц, объектов, размеры или объём распакованных данных.",
          DAMAGED: "PDF повреждён или имеет некорректную структуру. Сохраните документ заново.",
        };
        reject(new ServiceError(timedOut ? "Проверка PDF превысила допустимое время. Предоставьте менее сложный документ." : messages[output] ?? "Проверка PDF не завершилась. Повторите позже или предоставьте менее сложный документ.", output === "LIMIT" ? 413 : 400));
      });
      child.stdin.end(bytes);
    });
  } finally { pdfProcesses--; }
}
export const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export interface ServiceStorage { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }
export function localServiceStorage(root = process.env.SERVICES_STORAGE_DIR ?? ".local/service-documents"): ServiceStorage {
  // Private runtime data is provisioned separately; never trace/copy it into a
  // deployment bundle. This also supports an external volume selected by env.
  const base = resolve(/* turbopackIgnore: true */ root), publicDir = resolve("public"), rel = relative(publicDir, base);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) throw new Error("Services storage must be outside public/");
  const path = (key: string) => { if (!/^[a-f0-9-]{36}$/.test(key)) throw new ServiceError("Некорректный ключ файла."); return resolve(base, key); };
  return {
    async put(key, bytes) {
      await mkdir(base, { recursive: true, mode: 0o700 });
      const handle = await open(/* turbopackIgnore: true */ path(key), "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } catch (error) { await handle.close(); await unlink(path(key)).catch(() => {}); throw error; }
      await handle.close();
    },
    async get(key) { return readFile(/* turbopackIgnore: true */ path(key)); },
    async remove(key) { await unlink(path(key)); },
  };
}
// A strict initial allowlist: scanned documents/photos. Decode and re-encode,
// stripping metadata and any trailing executable/polyglot content.
export async function prepareServiceFile(bytes: Buffer, filename: string, mime: string, mode: boolean | "portfolio" = false) {
  const photoOnly = mode === true;
  const allowWebp = photoOnly || mode === "portfolio";
  if (/\.pdf$/i.test(filename) || mime === "application/pdf" || bytes.subarray(0, 5).toString() === "%PDF-") {
    if (photoOnly) throw new ServiceError("Приложите фотографию JPEG, PNG или WebP.", 415);
    if (!bytes.length || bytes.length > MAX_SERVICE_PDF) throw new ServiceError("PDF — от 1 байта до 20 МиБ.", 413);
    if (mime !== "application/pdf" || !/\.pdf$/i.test(filename)) throw new ServiceError("Тип файла не совпадает с содержимым PDF.");
    validateFilename(filename);
    await validatePdf(bytes);
    return { bytes, key: randomUUID(), name: filename, mime: "application/pdf", size: bytes.length, sha256: digest(bytes) };
  }
  if (!bytes.length || bytes.length > MAX_SERVICE_FILE) throw new ServiceError("Размер файла: от 1 байта до 8 МиБ.", 413);
  validateFilename(filename);
  if (!(allowWebp ? /\.(png|jpe?g|webp)$/iu : /\.(png|jpe?g)$/iu).test(filename)) throw new ServiceError(allowWebp ? "Допустимы фотографии JPEG, PNG и WebP." : "Допустимы имена PNG/JPEG без путей.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = allowWebp && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const format = png ? "png" : jpeg ? "jpeg" : webp ? "webp" : null;
  const extension = format === "jpeg" ? /\.jpe?g$/i : format === "png" ? /\.png$/i : /\.webp$/i;
  if (!format || mime !== `image/${format}` || !extension.test(filename)) throw new ServiceError("Тип файла не совпадает с содержимым.");
  let content: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 20000000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1) throw new ServiceError("Многостраничные и анимированные изображения не поддерживаются.");
    if (meta.format !== format) throw new ServiceError("Неподдерживаемый формат изображения.");
    // JPEG -> PNG can inflate an otherwise valid 3 MiB photo beyond the 8 MiB
    // storage limit. Decode/re-encode in its format, stripping all metadata.
    content = await (format === "jpeg" ? image.rotate().jpeg({ quality: 90 }) : format === "png" ? image.rotate().png() : image.rotate().webp({ lossless: true })).toBuffer();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && /exceeds pixel limit/i.test(error.message)) throw new ServiceError("Изображение превышает предел 20 миллионов пикселей. Уменьшите разрешение.", 413);
    throw new ServiceError("Изображение повреждено или содержит неподдерживаемую структуру.");
  }
  if (content.length > MAX_SERVICE_FILE) throw new ServiceError("Изображение после безопасного преобразования превышает 8 МиБ.", 413);
  const name = format === "png" && mode !== "portfolio" ? filename.replace(/\.png$/i, ".png") : filename;
  return { bytes: content, key: randomUUID(), name, mime: `image/${format}`, size: content.length, sha256: digest(content) };
}
function validateFilename(filename: string) {
  if (!filename || filename.length > 255) throw new ServiceError("Имя файла должно содержать от 1 до 255 символов. Сократите имя файла.");
  // Display name only: blobs always use a generated UUID, never this name.
  if (!/^[\p{L}\p{N} _(),&.-]+$/u.test(filename) || filename.includes("..")) throw new ServiceError("Имя файла содержит недопустимые символы или путь. Допустимы буквы, цифры, пробелы и _ ( ) , & . -");
}
