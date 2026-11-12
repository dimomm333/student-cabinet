import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const VERIFIED_IP_HEADER = "x-lks-verified-ip";

export function authProxySettings(baseURL: string) {
  const value = process.env.AUTH_TRUST_PROXY;
  if (value && value !== "true" && value !== "false") throw new Error("AUTH_TRUST_PROXY должен быть true или false.");
  const enabled = value === "true";
  const secret = process.env.AUTH_PROXY_SECRET;
  if (enabled && (!secret || secret.length < 32)) throw new Error("Для доверенного proxy задайте AUTH_PROXY_SECRET длиной не менее 32 символов.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname);
  if (!local && !enabled) throw new Error("Внешний адрес требует AUTH_TRUST_PROXY=true и доверенного reverse proxy.");
  return { enabled, secret };
}

function sameSecret(actual: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

// Web Request has no trustworthy socket peer address. Never infer it from XFF.
export function trustedAuthRequest(request: Request, baseURL: string): Request | null {
  const config = authProxySettings(baseURL);
  const verifiedIP = request.headers.get("x-lks-client-ip");
  if (config.enabled && (!config.secret || !sameSecret(request.headers.get("x-lks-proxy-key") ?? "", config.secret)
    || !verifiedIP || !isIP(verifiedIP))) return null;

  const headers = new Headers(request.headers);
  for (const header of ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip", "true-client-ip", VERIFIED_IP_HEADER, "x-lks-client-ip", "x-lks-proxy-key"]) headers.delete(header);
  if (config.enabled && verifiedIP) headers.set(VERIFIED_IP_HEADER, verifiedIP);
  // Next.js may supply a Request from a different runtime realm. Copy its URL
  // and stream explicitly instead of relying on instanceof Request coercion.
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : request.body;
  return new Request(request.url, { method: request.method, headers, body, signal: request.signal, ...(body ? { duplex: "half" } : {}) });
}
