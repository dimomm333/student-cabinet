import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { demoAccounts } from "./demo-accounts.ts";
import { ServiceError } from "./services-catalog.ts";
import { liveActor, type ServiceActor } from "./services-repository.ts";
import type { PassCardData } from "./pass-types.ts";

type DB = Prisma.TransactionClient;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function tokenFor(nonce: string) {
  const key = process.env.PASS_TOKEN_KEY || process.env.BETTER_AUTH_SECRET;
  if (!key || key.length < 32) throw new ServiceError("Ключ пропусков не настроен.", 503);
  return "LKS1-" + createHmac("sha256", key).update("lks/student-pass/v1/" + nonce).digest("base64url");
}
const profileSelect = {
  lastName: true, firstName: true, middleName: true, groupName: true, group: { select: { code: true } },
} as const;
type Profile = Prisma.StudentProfileGetPayload<{ select: typeof profileSelect }>;
function identity(user: { name: string; email: string }, profile: Profile | null, photo: string | null) {
  const name = profile?.firstName && profile.lastName ? [profile.lastName, profile.firstName, profile.middleName].filter(Boolean).join(" ") : user.name;
  return { name, group: profile?.group?.code ?? profile?.groupName ?? null, photo,
    sample: process.env.PASS_SAMPLE_MODE === "true" || demoAccounts.some(a => a.email === user.email) };
}
export async function passRights(db: DB, actor: { id: string; role: string }) {
  if (!["TECHNICAL_STAFF", "ADMIN"].includes(actor.role)) return null;
  const grant = await db.passGrant.findUnique({ where: { userId: actor.id }, select: { role: true, canManage: true, canVerify: true } });
  return grant?.role === actor.role && (grant.canManage || grant.canVerify) ? grant : null;
}
async function authorize(db: DB, actor: ServiceActor, right: "canManage" | "canVerify") {
  const user = await liveActor(db, actor);
  if (!(await passRights(db, user))?.[right]) throw new ServiceError("Нет полномочия на эту операцию.", 403);
}
export async function ownPass(db: PrismaClient, actor: ServiceActor): Promise<PassCardData> {
  const result = await db.$transaction(async tx => {
    const user = await liveActor(tx, actor);
    if (user.role !== "STUDENT") throw new ServiceError("Доступ закрыт.", 403);
    const p = await tx.studentProfile.findUnique({ where: { userId: user.id }, select: { ...profileSelect,
      officialPhoto: { select: { userId: true } },
      passes: { orderBy: { id: "desc" }, take: 1, select: { status: true, nonce: true, tokenHash: true } },
    } });
    return { person: identity(user, p, p?.officialPhoto ? "/api/student/profile/photo" : null), pass: p?.passes[0] };
  });
  const status = result.pass?.status ?? "UNISSUED";
  if (result.pass?.status !== "ACTIVE") return { status, person: result.person };
  const token = tokenFor(result.pass.nonce);
  if (digest(token) !== result.pass.tokenHash) throw new ServiceError("Ключ пропуска недоступен. Обратитесь к оператору.", 503);
  return { status, person: result.person, qr: await QRCode.toDataURL(token, { width: 328, margin: 4, errorCorrectionLevel: "M" }) };
}

export async function verifyPass(db: PrismaClient, actor: ServiceActor, token: string): Promise<PassCardData> {
  return db.$transaction(async tx => {
    await authorize(tx, actor, "canVerify");
    const now = new Date();
    await tx.passGrant.updateMany({ where: { userId: actor.id, OR: [{ windowStart: null }, { windowStart: { lte: new Date(+now - 60_000) } }] },
      data: { windowStart: now, checks: 0 } });
    const budget = await tx.passGrant.updateMany({ where: { userId: actor.id, canVerify: true, checks: { lt: 30 } }, data: { checks: { increment: 1 } } });
    if (!budget.count) throw new ServiceError("Лимит проверок исчерпан. Повторите через минуту.", 429);
    if (!/^LKS1-[\w-]{43}$/.test(token)) return { status: "NOT_FOUND" };
    const pass = await tx.studentPass.findUnique({ where: { tokenHash: digest(token) }, select: { status: true, studentId: true } });
    if (!pass) return { status: "NOT_FOUND" };
    if (pass.status !== "ACTIVE") return { status: pass.status };
    const p = await tx.studentProfile.findFirst({ where: { userId: pass.studentId, user: { role: "STUDENT" } },
      select: { ...profileSelect, user: { select: { name: true, email: true } }, officialPhoto: { select: { content: true, mimeType: true } } } });
    if (!p) return { status: "NOT_FOUND" };
    const photo = p.officialPhoto?.mimeType === "image/jpeg" ? "data:image/jpeg;base64," + Buffer.from(p.officialPhoto.content).toString("base64") : null;
    return { status: "ACTIVE", person: identity(p.user, p, photo) };
  });
}

async function findStudent(db: DB, email: string) {
  const student = await db.user.findUnique({ where: { email, role: "STUDENT" },
    select: { id: true, name: true, email: true, studentProfile: { select: profileSelect } } });
  if (!student) throw new ServiceError("Студент с таким адресом не найден.", 404);
  return student;
}
export async function passHistory(db: PrismaClient, actor: ServiceActor, email: string) {
  return db.$transaction(async tx => {
    await authorize(tx, actor, "canManage");
    const student = await findStudent(tx, email);
    const passes = await tx.studentPass.findMany({ where: { studentId: student.id }, orderBy: { id: "desc" }, select: {
      id: true, status: true, issuedAt: true, closedAt: true, reason: true, requestId: true,
      issuer: { select: { name: true } }, closer: { select: { name: true } },
    } });
    const requests = await tx.serviceRequest.findMany({ where: { ownerId: student.id, serviceCode: "pass-reissue",
      deletedAt: null, status: "COMPLETED", issuedPass: null }, orderBy: { completedAt: "desc" }, select: { id: true, completedAt: true } });
    return { person: identity(student, student.studentProfile, null), passes, requests };
  });
}
export type PassChange = { action: "issue" | "revoke" | "replace"; email: string; expected: number | null; reason?: string; requestId?: string };
export async function changePass(db: PrismaClient, actor: ServiceActor, command: PassChange) {
  return db.$transaction(async tx => {
    await authorize(tx, actor, "canManage");
    const student = await findStudent(tx, command.email);
    const last = await tx.studentPass.findFirst({ where: { studentId: student.id }, orderBy: { id: "desc" }, select: { id: true, status: true } });
    if ((last?.id ?? null) !== command.expected) throw new ServiceError("Пропуск изменился. Откройте историю заново.", 409);
    if (command.action === "issue" && last?.status === "ACTIVE") throw new ServiceError("Действующий пропуск уже выдан.", 409);
    if (command.action !== "issue" && last?.status !== "ACTIVE") throw new ServiceError("Действующий пропуск отсутствует.", 409);
    if (command.action === "replace") {
      const request = await tx.serviceRequest.findFirst({ where: { id: command.requestId, ownerId: student.id,
        serviceCode: "pass-reissue", status: "COMPLETED", deletedAt: null, issuedPass: null }, select: { id: true } });
      if (!command.requestId || !request) throw new ServiceError("Выберите исполненное заявление этого студента.", 409);
    }
    if (command.action !== "issue" && last) {
      const reason = command.reason?.trim();
      if (!reason || reason.length > 500) throw new ServiceError("Укажите причину (до 500 символов).");
      const closed = await tx.studentPass.updateMany({ where: { id: last.id, status: "ACTIVE" },
        data: { status: command.action === "revoke" ? "REVOKED" : "REPLACED", activeSlot: null, closedAt: new Date(), closedBy: actor.id, reason } });
      if (!closed.count) throw new ServiceError("Пропуск уже изменён.", 409);
    }
    if (command.action !== "revoke") {
      const nonce = randomBytes(32).toString("hex");
      if (!student.studentProfile) await tx.studentProfile.create({ data: { userId: student.id } });
      await tx.studentPass.create({ data: { studentId: student.id, issuedBy: actor.id, nonce, tokenHash: digest(tokenFor(nonce)),
        requestId: command.action === "replace" ? command.requestId : null } });
    }
    return { ok: true };
  });
}
