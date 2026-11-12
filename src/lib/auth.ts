import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

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
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      // This field can only be assigned by trusted server/database operations.
      role: { type: "string", required: true, defaultValue: "STUDENT", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    // Fixed eight-hour sessions: RSC reads never need to mutate a cookie.
    disableSessionRefresh: true,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 60, max: 5 } },
  },
  advanced: {
    // Local production-build verification can use HTTP; deployments must use HTTPS.
    useSecureCookies: new URL(baseURL).protocol === "https:",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  },
});
