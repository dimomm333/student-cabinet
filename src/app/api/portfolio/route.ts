import { connection } from "next/server";
import { getCurrentUser } from "@/lib/access";
import { portfolioByteLimit } from "@/lib/portfolio";
import { changePortfolio, portfolioId, readPortfolioFile, savePortfolio } from "@/lib/portfolio-repository";
import { ServiceError } from "@/lib/services-catalog";
import { readServiceBytes } from "@/lib/services-upload";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

async function actor() {
  const user = await getCurrentUser();
  if (!user) throw new ServiceError("Войдите в систему.", 401);
  if (user.role !== "STUDENT" && user.role !== "DEANERY_STAFF") throw new ServiceError("Доступ запрещён.", 403);
  return user;
}

function failure(error: unknown) {
  if (error instanceof ServiceError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error && typeof error === "object" && "code" in error && error.code === "P2034") {
    return Response.json({ error: "Запись уже меняется. Обновите страницу и повторите действие." }, { status: 409, headers });
  }
  console.error("portfolio.operation_failed");
  return Response.json({ error: "Портфолио временно недоступно. Повторите попытку позже." }, { status: 503, headers });
}

export async function GET(request: Request) {
  await connection();
  try {
    const user = await actor();
    const params = new URL(request.url).searchParams;
    const file = await readPortfolioFile(user, portfolioId(params.get("file")));
    const extension = file.mime === "application/pdf" ? "pdf" : file.mime === "image/jpeg" ? "jpg" : file.mime.split("/")[1];
    const encoded = encodeURIComponent(file.name).replace(/[!'()*]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
    const disposition = params.get("download") === "1" ? "attachment" : "inline";
    return new Response(new Uint8Array(file.bytes), { headers: {
      ...headers,
      "Content-Type": file.mime,
      "Content-Disposition": `${disposition}; filename="document.${extension}"; filename*=UTF-8''${encoded}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Length": String(file.bytes.length),
    } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
      || request.headers.get("sec-fetch-site") === "cross-site") throw new ServiceError("Источник запроса не разрешён.", 403);
    const user = await actor();
    const contentType = request.headers.get("content-type") ?? "";
    const mime = contentType.split(";")[0].trim();
    if (mime === "multipart/form-data") {
      if (user.role !== "STUDENT") throw new ServiceError("Доступ запрещён.", 403);
      const bytes = await readServiceBytes(request, portfolioByteLimit + 64 * 1024);
      const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData()
        .catch(() => { throw new ServiceError("Не удалось прочитать форму."); });
      return Response.json({ item: await savePortfolio(await actor(), form) }, { headers });
    }
    if (mime !== "application/json") throw new ServiceError("Неподдерживаемый тип запроса.", 415);
    const bytes = await readServiceBytes(request, 8192);
    let command: unknown;
    try { command = JSON.parse(bytes.toString("utf8")); }
    catch { throw new ServiceError("Некорректный запрос."); }
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new ServiceError("Некорректный запрос.");
    return Response.json({ item: await changePortfolio(await actor(), command as Record<string, unknown>) }, { headers });
  } catch (error) { return failure(error); }
}
