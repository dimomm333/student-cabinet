import "server-only";
import type { Prisma, PrismaClient, Role } from "../generated/prisma/client.ts";
import { isSessionWithinLifetime } from "./session-policy.ts";
import { serviceProcessorScope } from "./services-permissions.ts";
import { materialScope } from "./materials-permissions.ts";
import { clearanceScope } from "./clearance-permissions.ts";
import { allNotificationCategories, safeNotificationHref, serviceNotificationTitles, type NotificationCategory, type NotificationFeed } from "./notifications-shared.ts";

export type NotificationDB = Prisma.TransactionClient;
export type NotificationActor = { id: string; sessionId: string };
export class NotificationError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export async function notificationActor(db: NotificationDB, actor: NotificationActor) {
  const session = await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.id }, include: { user: { select: { id: true, role: true, email: true, emailVerified: true } } } });
  if (!session || !isSessionWithinLifetime(session)) throw new NotificationError("Сессия завершена. Войдите снова.", 401);
  return session.user;
}
export const parseCategories = (value: string) => JSON.parse(value) as NotificationCategory[];
export async function preferences(db: NotificationDB, userId: string) {
  const saved = await db.notificationSettings.findUnique({ where: { userId } });
  return { optionalCategories: saved ? parseCategories(saved.optionalCategoriesJson) : allNotificationCategories,
    emailCategories: saved ? parseCategories(saved.emailCategoriesJson) : [], personalEmail: saved?.personalEmail ?? false };
}
type Recipient = { id: string; role: Role; href: string; groupId?: string | null; departmentId?: string | null };
export type NotificationInput = { sourceKey: string; source: "SERVICES" | "BRS" | "SCHEDULE" | "NEWS" | "SYSTEM" | "MATERIALS" | "CLEARANCE"; clearanceProcessId?: string; sourceId: string; type: string; category: NotificationCategory; title: string; body: string; mandatory: boolean; createdAt?: Date; recipients: Recipient[] };

// Internal server API only. Call within the same transaction as the mutation;
// never expose arbitrary recipients or event content through a client endpoint.
export async function emitNotification(tx: NotificationDB, input: NotificationInput) {
  const { recipients, ...data } = input;
  if (data.source === "MATERIALS" && !(await tx.materialPublication.count({ where: { id: data.sourceId, items: { some: {} } } }))) throw new NotificationError("Публикация учебных материалов недоступна.");
  // An already committed event is complete, including suppressed recipients.
  // A retry after a preference change must not deliver an old event anew.
  const prior = await tx.notificationEvent.findUnique({ where: { sourceKey: data.sourceKey } });
  if (prior) return prior;
  const event = await tx.notificationEvent.create({ data });
  for (const recipient of new Map(recipients.map(r => [r.id, r])).values()) {
    const user = await tx.user.findFirst({ where: { id: recipient.id, role: recipient.role }, select: { id: true } });
    if (!user) continue;
    const settings = await preferences(tx, user.id);
    if (!event.mandatory && !settings.optionalCategories.includes(event.category as NotificationCategory)) continue;
    const existing = await tx.notification.findUnique({ where: { eventId_recipientId: { eventId: event.id, recipientId: user.id } } });
    if (existing) continue;
    const notification = await tx.notification.create({ data: { eventId: event.id, recipientId: user.id, recipientRole: recipient.role, href: safeNotificationHref(recipient.href), scopeGroupId: recipient.groupId, scopeDepartmentId: recipient.departmentId } });
    // Store no destination or private event text in the outbox. Recheck address,
    // source access and preferences immediately before attempting delivery.
    if (settings.personalEmail && settings.emailCategories.includes(event.category as NotificationCategory)) await tx.notificationEmail.create({ data: { notificationSeq: notification.seq } });
  }
  return event;
}
export async function emitServiceNotification(tx: NotificationDB, event: { id: string; requestId: string; recipientId: string; type: string; createdAt: Date }) {
  const recipients: Recipient[] = [{ id: event.recipientId, role: "STUDENT", href: `/dashboard/services?requestId=${encodeURIComponent(event.requestId)}` }];
  if (["SUBMITTED", "RESUBMITTED"].includes(event.type)) {
    const candidates = await tx.user.findMany({ where: { role: { in: ["ADMIN", "TECHNICAL_STAFF", "DEANERY_STAFF"] }, serviceGrants: { some: { active: true } } }, select: { id: true, role: true } });
    for (const user of candidates) {
      if (await tx.serviceRequest.count({ where: { id: event.requestId, deletedAt: null, status: { not: "DRAFT" }, AND: [await serviceProcessorScope(tx, user)] } })) {
        const path = user.role === "ADMIN" ? "/admin/requests" : user.role === "TECHNICAL_STAFF" ? "/staff/services" : "/deanery/requests";
        recipients.push({ id: user.id, role: user.role, href: `${path}?requestId=${encodeURIComponent(event.requestId)}` });
      }
    }
  }
  return emitNotification(tx, { sourceKey: `service:${event.id}`, source: "SERVICES", sourceId: event.requestId, type: event.type, category: "SERVICES", mandatory: true,
    title: serviceNotificationTitles[event.type] ?? "Заявление обновлено", body: "Статус заявления изменился. Подробности доступны в личной карточке.", createdAt: event.createdAt,
    recipients });
}

// Match the source's current access rules, including historical BRS results.
// Ownership is always part of the query; clients never supply a recipient ID.
export async function notificationScope(db: NotificationDB, user: { id: string; role: Role }): Promise<Prisma.NotificationWhereInput> {
  const profile = user.role === "STUDENT" ? await db.studentProfile.findUnique({ where: { userId: user.id }, select: { groupId: true, group: { select: { departmentId: true } } } }) : null;
  const plans = user.role === "STUDENT" ? await db.brsPlan.findMany({ where: { publishedAt: { not: null }, OR: [
    { groupId: profile?.groupId ?? "" }, { modules: { some: { events: { some: { results: { some: { studentId: user.id } } } } } } },
    { attempts: { some: { studentId: user.id } } }, { occurrences: { some: { attendance: { some: { studentId: user.id } } } } }, { finals: { some: { studentId: user.id } } },
  ] }, select: { id: true } }) : [];
  const requests = await db.serviceRequest.findMany({ where: { deletedAt: null, ...(user.role === "STUDENT" ? { ownerId: user.id } : { status: { not: "DRAFT" }, AND: [await serviceProcessorScope(db, user)] }) }, select: { id: true } });
  const materialPublications = user.role === "STUDENT" ? await db.materialPublication.findMany({ where: { items: { some: { material: await materialScope(db, user) } } }, select: { id: true } }) : [];
  return { recipientId: user.id, recipientRole: user.role, OR: [
    { event: { source: "CLEARANCE", clearanceProcess: clearanceScope(user) } },
    { event: { source: "SYSTEM" } },
    { event: { source: "SERVICES", sourceId: { in: requests.map(r => r.id) } } },
    ...(user.role === "STUDENT" ? [
      { event: { source: "BRS", sourceId: { in: plans.map(p => p.id) } } },
      { event: { source: "MATERIALS", sourceId: { in: materialPublications.map(p => p.id) } } },
      { event: { source: "SCHEDULE" }, scopeGroupId: profile?.groupId ?? "" },
      { event: { source: "NEWS" }, OR: [{ scopeDepartmentId: null }, { scopeDepartmentId: profile?.group?.departmentId ?? "" }] },
    ] : []),
    ...(user.role === "TEACHER" ? [{ event: { source: "SCHEDULE" } }] : []),
  ] };
}
export async function listNotifications(db: PrismaClient, actor: NotificationActor, before?: number): Promise<NotificationFeed> {
  if (before !== undefined && (!Number.isInteger(before) || before < 1 || before > 2147483647)) throw new NotificationError("Некорректный курсор.");
  return db.$transaction(async tx => {
    const user = await notificationActor(tx, actor), scope = await notificationScope(tx, user);
    const boundary = (await tx.notification.aggregate({ where: scope, _max: { seq: true } }))._max.seq ?? 0;
    const items = await tx.notification.findMany({ where: { AND: [scope, { seq: { lte: boundary, ...(before ? { lt: before } : {}) } }] }, include: { event: true }, orderBy: { seq: "desc" }, take: 31 });
    const unread = await tx.notification.count({ where: { AND: [scope, { readAt: null }] } });
    return { boundary, unread, nextCursor: items.length > 30 ? items[29].seq : null, items: items.slice(0, 30).map(n => ({ id: n.seq, title: n.event.title, body: n.event.body, category: n.event.category as NotificationCategory, mandatory: n.event.mandatory, createdAt: n.event.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null, href: n.href, source: n.event.source })) };
  });
}
export async function markNotifications(db: PrismaClient, actor: NotificationActor, boundary: number, all: boolean) {
  if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary > 2147483647) throw new NotificationError("Некорректный идентификатор.");
  return db.$transaction(async tx => {
    await tx.notificationWriteState.upsert({ where: { id: "inbox" }, create: { id: "inbox", version: 1 }, update: { version: { increment: 1 } } });
    const user = await notificationActor(tx, actor), scope = await notificationScope(tx, user);
    const result = await tx.notification.updateMany({ where: { AND: [scope, { readAt: null, seq: all ? { lte: boundary } : boundary }] }, data: { readAt: new Date() } });
    await tx.notificationAudit.create({ data: { actorId: user.id, action: all ? "READ_ALL" : "READ", boundary } });
    return result.count;
  });
}
export async function savePreferences(db: PrismaClient, actor: NotificationActor, input: { optionalCategories: unknown; emailCategories: unknown; personalEmail: unknown }) {
  const categories = (value: unknown): NotificationCategory[] => {
    if (!Array.isArray(value) || value.length > allNotificationCategories.length || value.some(c => !allNotificationCategories.includes(c))) throw new NotificationError("Некорректные категории.");
    return [...new Set(value)] as NotificationCategory[];
  };
  const optional = categories(input.optionalCategories), email = categories(input.emailCategories);
  if (typeof input.personalEmail !== "boolean") throw new NotificationError("Некорректный канал.");
  return db.$transaction(async tx => {
    const user = await notificationActor(tx, actor);
    await tx.notificationSettings.upsert({ where: { userId: user.id }, create: { userId: user.id, optionalCategoriesJson: JSON.stringify(optional), emailCategoriesJson: JSON.stringify(email), personalEmail: input.personalEmail as boolean }, update: { optionalCategoriesJson: JSON.stringify(optional), emailCategoriesJson: JSON.stringify(email), personalEmail: input.personalEmail as boolean } });
    await tx.notificationAudit.create({ data: { actorId: user.id, action: "SETTINGS" } });
  });
}
