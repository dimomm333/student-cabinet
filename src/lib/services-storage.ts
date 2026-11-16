import "server-only";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { ServiceError } from "./services-catalog.ts";

export const MAX_SERVICE_FILE = 8 * 1024 * 1024;
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
export async function prepareServiceFile(bytes: Buffer, filename: string, mime: string) {
  if (!bytes.length || bytes.length > MAX_SERVICE_FILE) throw new ServiceError("Размер файла: от 1 байта до 8 МиБ.", 413);
  if (!filename || filename.length > 120 || !/^[\p{L}\p{N} _().-]+\.(png|jpe?g)$/iu.test(filename) || filename.includes("..")) throw new ServiceError("Допустимы имена PNG/JPEG без путей.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const expected = png ? "image/png" : jpeg ? "image/jpeg" : "";
  if (!expected || mime !== expected || (png ? !/\.png$/i.test(filename) : !/\.jpe?g$/i.test(filename))) throw new ServiceError("Тип файла не совпадает с содержимым.");
  let content: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 20000000, failOn: "warning", animated: false });
    const meta = await image.metadata();
    if ((meta.pages ?? 1) > 1 || !["png", "jpeg"].includes(meta.format ?? "")) throw new Error();
    content = await image.rotate().png().toBuffer();
  } catch { throw new ServiceError("Изображение повреждено или слишком большое."); }
  if (content.length > MAX_SERVICE_FILE) throw new ServiceError("Изображение после безопасного преобразования превышает 8 МиБ.", 413);
  return { bytes: content, key: randomUUID(), name: filename.replace(/\.(png|jpe?g)$/i, ".png"), mime: "image/png", size: content.length, sha256: digest(content) };
}
