import "server-only";
import { mkdir, open, unlink, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { MaterialError } from "./materials-shared.ts";
export function maxMaterialBytes() {
  const size = Number(process.env.MATERIALS_MAX_FILE_MB ?? 32);
  if (!Number.isInteger(size) || size < 1 || size > 128) throw new MaterialError("Некорректный лимит файлов на сервере.", 503);
  return size * 1024 * 1024;
}
export function materialPath(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new MaterialError("Некорректный ключ файла.");
  const base = resolve(/* turbopackIgnore: true */ process.env.MATERIALS_STORAGE_DIR ?? ".local/material-files");
  const rel = relative(resolve("public"), base);
  if (!rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))) throw new MaterialError("Хранилище должно находиться вне public.", 503);
  return { base, file: resolve(base, key) };
}
export type MaterialBlob = { key: string; name: string; mime: string; size: number; sha256: string };
let validators = 0;
export async function receiveMaterialFile(request: Request): Promise<MaterialBlob> {
  let name: string;
  try { name = decodeURIComponent(request.headers.get("x-file-name") ?? ""); } catch { throw new MaterialError("Некорректное имя файла."); }
  if (!name || name.length > 240 || /[\/\\:\u0000-\u001f\u007f]/.test(name) || name === "." || name.includes("..") || /[. ]$/.test(name)) throw new MaterialError("Имя файла должно быть без путей и управляющих символов, до 240 символов.");
  const limit = maxMaterialBytes();
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new MaterialError(`Размер файла превышает ${limit / 1048576} МиБ.`, 413);
  if (validators >= 2) throw new MaterialError("Загрузка занята. Повторите через несколько секунд.", 503);
  const key = randomUUID(), { base, file } = materialPath(key);
  const reader = request.body?.getReader(); if (!reader) throw new MaterialError("Файл пуст.");
  validators++;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let size = 0;
  try {
    await mkdir(base, { recursive: true, mode: 0o700 });
    handle = await open(/* turbopackIgnore: true */ file, "wx", 0o600);
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new MaterialError("Время загрузки истекло (5 минут). Повторите попытку.", 408)); }, 300000); });
    for (;;) {
      const part = await Promise.race([reader.read(), timeout]); if (part.done) break;
      size += part.value.length;
      if (size > limit) { await reader.cancel(); throw new MaterialError(`Размер файла превышает ${limit / 1048576} МиБ.`, 413); }
      await handle.writeFile(part.value);
    }
    await handle.sync(); await handle.close(); handle = undefined;
    if (!size) throw new MaterialError("Файл пуст.");
    const metadata = await new Promise<{ mime: string; sha256: string }>((accept, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=256", resolve("scripts/validate-material-file.mjs"), file, name, String(limit)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, NODE_OPTIONS: "" } });
      let output = "";
      const watchdog = setTimeout(() => { child.kill(); reject(new MaterialError("Проверка файла превысила допустимое время.", 413)); }, 20000);
      child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 2048) child.kill(); });
      child.on("error", () => { clearTimeout(watchdog); reject(new MaterialError("Проверка файлов недоступна.", 503)); });
      child.on("close", code => { clearTimeout(watchdog); if (code !== 0) return reject(new MaterialError(output === "LIMIT" ? "Архив или документ превышает ограничения распаковки." : "Формат не поддерживается, повреждён или не совпадает с расширением. Проверьте файл.", output === "LIMIT" ? 413 : 400)); try { accept(JSON.parse(output)); } catch { reject(new MaterialError("Проверка файла не завершилась.", 503)); } });
    });
    return { key, name, size, ...metadata };
  } catch (error) { if (handle) await handle.close().catch(() => {}); await unlink(file).catch(() => {}); throw error; }
  finally { validators--; if (timer) clearTimeout(timer); reader.releaseLock(); }
}
export async function removeMaterialBlob(key: string) { await unlink(materialPath(key).file).catch(() => {}); }
export function materialDownload(key: string) { return Readable.toWeb(createReadStream(/* turbopackIgnore: true */ materialPath(key).file)) as ReadableStream<Uint8Array>; }
// Used by isolated tests; application downloads always stream.
export async function readMaterialBlob(key: string) { return readFile(/* turbopackIgnore: true */ materialPath(key).file); }
