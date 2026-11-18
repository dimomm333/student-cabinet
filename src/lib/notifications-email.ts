import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer, { type SMTPTransportOptions } from "nodemailer";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { notificationScope, preferences } from "./notifications-repository.ts";
import { safeNotificationHref, type NotificationCategory } from "./notifications-shared.ts";

const emailAddress = (s: string) => /^[^\s<>@\r\n]+@[^\s<>@\r\n]+\.[^\s<>@\r\n]+$/.test(s) && s.length <= 254;
export function smtpConfiguration() {
  const host = process.env.NOTIFICATIONS_SMTP_HOST, from = process.env.NOTIFICATIONS_SMTP_FROM, origin = process.env.BETTER_AUTH_URL;
  const port = Number(process.env.NOTIFICATIONS_SMTP_PORT ?? 587), secure = process.env.NOTIFICATIONS_SMTP_SECURE === "true";
  if (!host || /[\s\r\n/]/.test(host) || !from || !emailAddress(from) || !origin || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  let base: URL;
  try { base = new URL(origin); } catch { return null; }
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) return null;
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(host);
  const test = process.env.NOTIFICATIONS_SMTP_LOCAL_TEST === "true" && loopback;
  if (!test && base.protocol !== "https:") return null;
  const user = process.env.NOTIFICATIONS_SMTP_USER, pass = process.env.NOTIFICATIONS_SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) return null;
  return { host, port, secure, from, origin: base.origin, requireTLS: !test && !secure, ...(user && pass ? { auth: { user, pass } } : {}) };
}
export function emailCapability(user: { emailVerified: boolean; email: string }) {
  if (!smtpConfiguration()) return { emailAvailable: false, emailReason: "Email-доставка недоступна: почтовый сервер не настроен.", universityEmailAvailable: false as const };
  if (!user.emailVerified || !emailAddress(user.email)) return { emailAvailable: false, emailReason: "Адрес учётной записи не подтверждён. Самостоятельное подтверждение email пока не подключено.", universityEmailAvailable: false as const };
  return { emailAvailable: true, emailReason: "Доступен подтверждённый email учётной записи. Университетская почта пока не подключена.", universityEmailAvailable: false as const };
}
const copy: Record<string, [string, string]> = {
  STUDY: ["ЛКС — обновлён электронный журнал", "В электронном журнале есть изменения. Откройте ЛКС для просмотра подробностей."],
  SCHEDULE: ["ЛКС — изменилось расписание", "В вашем расписании есть изменения. Откройте ЛКС для просмотра подробностей."],
  SERVICES: ["ЛКС — обновлено заявление", "По вашему заявлению есть обновление. Откройте ЛКС для просмотра подробностей."],
};
export type NotificationMail = { to: string; subject: string; text: string; messageId: string };
export type NotificationMailAdapter = { send(mail: NotificationMail): Promise<void> };
export function smtpAdapter(): NotificationMailAdapter | null {
  const config = smtpConfiguration(); if (!config) return null;
  const options: SMTPTransportOptions = { host: config.host, port: config.port, secure: config.secure, requireTLS: config.requireTLS, auth: config.auth,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true } };
  const transport = nodemailer.createTransport(options);
  return { async send(mail) {
    const receipt = await transport.sendMail({ ...mail, from: config.from });
    if (!receipt.accepted.some(address => String(address).toLowerCase() === mail.to.toLowerCase()) || receipt.rejected.length) throw new Error("SMTP_NOT_ACCEPTED");
  } };
}

// A separate bounded worker, never on the request path. Multiple workers claim
// with a compare-and-set lease; SMTP failure cannot roll back an inbox event.
export async function deliverNotificationEmails(db: PrismaClient, adapter = smtpAdapter(), now = new Date(), limit = 25) {
  if (!adapter) return { available: false, sent: 0, failed: 0 };
  const config = smtpConfiguration(); if (!config) return { available: false, sent: 0, failed: 0 };
  const rows = await db.notificationEmail.findMany({ where: { state: { in: ["pending", "failed"] }, attempts: { lt: 4 }, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, limit)) });
  let sent = 0, failed = 0;
  for (const row of rows) {
    const token = randomUUID();
    const claimed = await db.notificationEmail.updateMany({ where: { id: row.id, attempts: row.attempts, state: { in: ["pending", "failed"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseToken: token, leaseUntil: new Date(now.getTime() + 120000), attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const n = await db.notification.findUniqueOrThrow({ where: { seq: row.notificationSeq }, include: { event: true, recipient: true } });
      const settings = await preferences(db, n.recipientId);
      const authorized = await db.notification.count({ where: { AND: [await notificationScope(db, n.recipient), { seq: n.seq }] } });
      if (row.channel !== "PERSONAL_EMAIL" || !authorized || !n.recipient.emailVerified || !emailAddress(n.recipient.email) || !settings.personalEmail || !settings.emailCategories.includes(n.event.category as NotificationCategory)) {
        await db.notificationEmail.updateMany({ where: { id: row.id, leaseToken: token }, data: { state: "failed", attempts: 4, lastError: "DELIVERY_NOT_ALLOWED", leaseUntil: null, leaseToken: null } }); failed++; continue;
      }
      const [subject, text] = copy[n.event.category] ?? ["ЛКС — новое уведомление", "В ЛКС есть новое уведомление. Откройте личный кабинет для просмотра подробностей."];
      await adapter.send({ to: n.recipient.email, subject, text: `${text}\n\n${config.origin}${safeNotificationHref(n.href)}`, messageId: `<lks-notification-${n.seq}@${new URL(config.origin).hostname}>` });
      await db.notificationEmail.updateMany({ where: { id: row.id, leaseToken: token }, data: { state: "sent", sentAt: new Date(), lastError: null, leaseUntil: null, leaseToken: null } }); sent++;
    } catch {
      // Never persist provider responses/addresses/credentials in errors or logs.
      await db.notificationEmail.updateMany({ where: { id: row.id, leaseToken: token }, data: { state: "failed", lastError: "SMTP_DELIVERY_FAILED", nextAttemptAt: new Date(now.getTime() + 60000 * 2 ** row.attempts), leaseUntil: null, leaseToken: null } }); failed++;
    }
  }
  return { available: true, sent, failed };
}
