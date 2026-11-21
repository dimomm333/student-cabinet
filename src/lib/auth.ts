import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getAuthoritativeSessionFromCtx } from "better-auth/api";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyMessages } from "./password-policy";
import { newPasswordError } from "./password-strength";
import { prisma } from "./prisma";
import { authProxySettings, VERIFIED_IP_HEADER } from "./auth-transport";
import { absoluteSessionExpiry, isSessionWithinLifetime, MAX_SESSION_AGE_MS } from "./session-policy";
import { clearSuccessfulLogin, normalizeLoginEmail, reserveLoginAttempt } from "./login-throttle";

// The same request-scoped context is shared by the before/after API hooks.
// Weak keys do not retain aborted requests in module memory.
const loginAttempts = new WeakMap<object, Awaited<ReturnType<typeof reserveLoginAttempt>>>();

function authEnvironment() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32) {
    throw new Error("Задайте случайный BETTER_AUTH_SECRET (не менее 32 символов). Для локального запуска: npm run auth:setup.");
  }
  if (!baseURL || !/^https?:\/\//.test(baseURL)) {
    throw new Error("Задайте BETTER_AUTH_URL: полный адрес приложения. Для локального запуска: npm run auth:setup.");
  }
  const url = new URL(baseURL);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Для внешнего адреса BETTER_AUTH_URL требуется HTTPS. HTTP разрешён только на localhost.");
  }
  authProxySettings(baseURL);
  return { secret, baseURL };
}

const { secret, baseURL } = authEnvironment();

export const auth = betterAuth({
  appName: "Северный университет",
  secret,
  baseURL,
  database: prismaAdapter(prisma, { provider: "sqlite", transaction: true }),
  trustedOrigins: [new URL(baseURL).origin],
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
  },
  user: {
    additionalFields: {
      // This field can only be assigned by trusted server/database operations.
      role: { type: "string", required: true, defaultValue: "STUDENT", input: false },
    },
  },
  session: {
    expiresIn: MAX_SESSION_AGE_MS / 1000,
    // Fixed eight-hour sessions: RSC reads never need to mutate a cookie.
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    // This coarse IP/shared budget complements the independent account limiter.
    customRules: { "/sign-in/email": { window: 60, max: 60 }, "/change-password": { window: 60, max: 5 } },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session, context) => {
          // Better Auth rotates the current cookie when revoking other sessions.
          // Carry the original absolute deadline across that rotation (SEC-02).
          const original = context?.path === "/change-password" ? context.context.session?.session : null;
          if (original) return { data: { ...session, createdAt: new Date(original.createdAt), expiresAt: new Date(Math.min(new Date(original.expiresAt).getTime(), absoluteSessionExpiry(original.createdAt).getTime())) } };
          const createdAt = new Date();
          return { data: { ...session, createdAt, expiresAt: new Date(Math.min(new Date(session.expiresAt).getTime(), createdAt.getTime() + MAX_SESSION_AGE_MS)) } };
        },
      },
      update: {
        before: async (changes, context) => {
          const data = { ...changes };
          delete data.createdAt; // Original creation time is immutable on refresh.
          if (data.expiresAt) {
            const id = context?.context.session?.session.id ?? data.id;
            if (typeof id !== "string") return false;
            const original = await prisma.session.findUnique({ where: { id }, select: { createdAt: true } });
            if (!original) return false;
            data.expiresAt = new Date(Math.min(new Date(data.expiresAt).getTime(), absoluteSessionExpiry(original.createdAt).getTime()));
          }
          return { data };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/change-password") {
        const session = await getAuthoritativeSessionFromCtx(ctx);
        if (!session || !isSessionWithinLifetime(session.session)) throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Требуется вход." });
        if (ctx.body?.currentPassword === ctx.body?.newPassword) throw new APIError("BAD_REQUEST", { code: "PASSWORD_UNCHANGED", message: "Новый пароль должен отличаться от текущего." });
        ctx.body.revokeOtherSessions = true;
      }
      // Better Auth 1.7.22 dispatches both HTTP and auth.api through this hook.
      // setPassword is server-only/pathless; better-call normalizes its hook
      // path to "/". It also takes body.newPassword.
      // Login uses body.password and must never be subject to the new policy.
      const candidate = ctx.path === "/sign-up/email" ? ctx.body?.password
        : ctx.path === "/change-password" || ctx.path === "/reset-password" || ctx.path === "/" ? ctx.body?.newPassword : undefined;
      if (typeof candidate === "string") {
        const code = newPasswordError(candidate);
        if (code) throw new APIError("BAD_REQUEST", { code, message: passwordPolicyMessages[code] });
      }
      if (ctx.path !== "/sign-in/email") return;
      const email = normalizeLoginEmail(ctx.body?.email);
      if (!email) return;
      // HTTP IP limiting has already run before endpoint hooks. Requests denied
      // at that layer cannot allocate an unbounded number of account buckets.
      let attempt: Awaited<ReturnType<typeof reserveLoginAttempt>>;
      try {
        attempt = await reserveLoginAttempt(email, secret);
      } catch {
        console.error("auth.login_limiter_unavailable");
        throw new APIError("SERVICE_UNAVAILABLE", { code: "AUTH_UNAVAILABLE", message: "Сервис входа временно недоступен." });
      }
      if (!attempt.allowed) {
        ctx.setHeader("Retry-After", String(attempt.retryAfter));
        throw new APIError("TOO_MANY_REQUESTS", { code: "TOO_MANY_ATTEMPTS", message: "Слишком много попыток входа. Попробуйте позже." });
      }
      loginAttempts.set(ctx.context, attempt);
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const attempt = loginAttempts.get(ctx.context);
        loginAttempts.delete(ctx.context);
        if (attempt && ctx.context.newSession && !(ctx.context.returned instanceof APIError)) await clearSuccessfulLogin(attempt);
      }
      if (ctx.context.returned instanceof APIError) return;
      if (ctx.path === "/get-session") {
        const value = ctx.context.returned as { session?: { id: string; createdAt: Date; expiresAt: Date } } | null;
        if (value?.session) {
          if (!isSessionWithinLifetime(value.session)) {
            ctx.context.session = null;
            return ctx.json(null);
          }
          // Legacy long-lived rows are capped on their first read as well.
          const cap = absoluteSessionExpiry(value.session.createdAt);
          if (new Date(value.session.expiresAt) > cap) {
            await prisma.session.updateMany({ where: { id: value.session.id, expiresAt: { gt: cap } }, data: { expiresAt: cap } });
            value.session.expiresAt = cap;
            return ctx.json(value);
          }
        }
      }
      if (ctx.path === "/sign-out") {
        try {
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
          if (token && await prisma.session.findUnique({ where: { token }, select: { id: true } })) throw new Error("revocation not confirmed");
        } catch {
          // Better Auth may have already queued cookie expiry after swallowing a
          // deletion error. Keep the browser credential so the user can retry.
          ctx.context.responseHeaders?.delete("set-cookie");
          console.error("auth.sign_out_revocation_unconfirmed");
          throw new APIError("SERVICE_UNAVAILABLE", { code: "SIGN_OUT_UNCONFIRMED", message: "Не удалось подтвердить выход. Повторите попытку." });
        }
      }
    }),
  },
  advanced: {
    ipAddress: { ipAddressHeaders: [VERIFIED_IP_HEADER] },
    // Local production-build verification can use HTTP; deployments must use HTTPS.
    useSecureCookies: new URL(baseURL).protocol === "https:",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  },
});
