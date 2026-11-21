import "server-only";
import { ServiceError } from "./services-catalog.ts";

export async function readServiceBytes(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ServiceError("Запрос слишком большой.", 413);
  const reader = request.body?.getReader(); if (!reader) throw new ServiceError("Пустое тело запроса.");
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new ServiceError("Время приёма запроса истекло.", 408)); }, 15000); });
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw new ServiceError("Запрос слишком большой.", 413); } chunks.push(part.value); }
    return Buffer.concat(chunks);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
