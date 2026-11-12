import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { workspaces } from "../src/lib/workspaces.ts";
import { sections as studentSections } from "../src/lib/demo-data.ts";

const development = process.argv.includes("--development");
const root = resolve(".");
mkdirSync(".local", { recursive: true });
const testRoot = mkdtempSync(resolve(".local/auth-security-"));
const originalURL = getDatabaseUrl();
const isolatedURL = `file:${resolve(testRoot, "test.db").replaceAll("\\", "/")}`;
assert.notEqual(isolatedURL, originalURL);
const original = createPrismaClient();
async function fingerprint(client) {
  const values = {};
  for (const table of ["user", "news", "account", "studentProfile", "teacherProfile", "technicalStaffProfile"]) values[table] = await client[table].findMany({ orderBy: table.endsWith("Profile") ? { userId: "asc" } : { id: "asc" } });
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
const before = await fingerprint(original);
const sqlite = createClient({ url: originalURL });
await sqlite.execute({ sql: "VACUUM INTO ?", args: [resolve(testRoot, "test.db")] });
sqlite.close();
process.env.DATABASE_URL = isolatedURL;
const db = createPrismaClient();
const secret = randomBytes(48).toString("base64url"), proxySecret = randomBytes(48).toString("base64url");
const actors = [];
for (const identity of demoAccounts) {
  const user = await db.user.findUnique({ where: { email: identity.email } });
  assert(user && user.role === identity.role, "Prepare all five demo accounts before testing");
  const password = randomBytes(24).toString("base64url");
  await db.account.updateMany({ where: { userId: user.id, providerId: "credential" }, data: { password: await hashPassword(password) } });
  actors.push({ ...user, password });
}
const tokens = [], results = [];
let child, context, logs = "";
const sleep = ms => new Promise(done => setTimeout(done, ms));
const homes = { STUDENT: "/dashboard", TEACHER: "/teacher", TECHNICAL_STAFF: "/staff", ADMIN: "/admin" };
const sections = { STUDENT: studentSections, ...Object.fromEntries(Object.entries(workspaces).map(([role, value]) => [role, value.sections])) };
const log = (name, evidence) => { results.push({ name, ...evidence }); console.info(`PASS: ${name} ${JSON.stringify(evidence)}`); };
const cookieFrom = response => response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const accountKey = email => "account:" + createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
async function resetLimits() { assert(isolatedURL.includes("/.local/auth-security-")); await db.rateLimit.deleteMany(); }

async function stopServer() {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  child = undefined;
}
async function startServer(proxy = false) {
  const port = proxy ? 3102 : development ? 3103 : 3101;
  const origin = proxy ? `https://localhost:${port}` : `http://127.0.0.1:${port}`;
  let project = root;
  if (development && !proxy) {
    project = resolve(testRoot, "dev-project"); mkdirSync(project);
    for (const dir of ["src", "public"]) cpSync(resolve(root, dir), resolve(project, dir), { recursive: true });
    for (const file of ["package.json", "package-lock.json", "tsconfig.json", "AGENTS.md"]) cpSync(resolve(root, file), resolve(project, file));
    writeFileSync(resolve(project, "next.config.ts"), readFileSync("next.config.ts", "utf8").replace("turbopack: {", `turbopack: { root: ${JSON.stringify(root.replaceAll("\\", "/"))},`));
    symlinkSync(resolve(root, "node_modules"), resolve(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  }
  const mode = development && !proxy ? "dev" : "start";
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", mode, project, "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, NODE_ENV: mode === "dev" ? "development" : "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: isolatedURL, BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, AUTH_TRUST_PROXY: String(proxy), AUTH_PROXY_SECRET: proxy ? proxySecret : "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const capture = chunk => { logs += String(chunk); };
  child.stdout.on("data", capture); child.stderr.on("data", capture);
  context = { base: `http://127.0.0.1:${port}`, origin, proxy };
  let ready = false;
  for (let n = 0; n < 20; n++) {
    if (child.exitCode !== null) break;
    try { if ((await request("/api/auth/get-session")).status === 200) { ready = true; break; } } catch { /* cold compilation */ }
    await sleep(200);
  }
  assert(ready, "Isolated test server did not become ready; see private log");
}
async function request(path, { cookie, body, headers = {}, origin, method } = {}) {
  const target = new URL(path, context.base); assert.equal(target.hostname, "127.0.0.1");
  const response = await fetch(target, {
    method: method ?? (body === undefined ? "GET" : "POST"), redirect: "manual", signal: AbortSignal.timeout(development ? 15000 : 10000),
    headers: { ...(origin === null ? {} : { Origin: origin ?? context.origin }), ...(context.proxy ? { "x-lks-proxy-key": proxySecret, "x-lks-client-ip": "192.0.2.10" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text(); let json;
  try { json = JSON.parse(text); } catch { /* HTML/RSC */ }
  return { status: response.status, headers: response.headers, text, json };
}
async function login(actor, extra = {}, headers = {}) {
  const response = await request("/api/auth/sign-in/email", { body: { email: actor.email, password: actor.password, rememberMe: false, ...extra }, headers });
  assert.equal(response.status, 200, "Valid isolated credential must sign in");
  const cookie = cookieFrom(response), current = await request("/api/auth/get-session", { cookie });
  assert.equal(current.json?.user.id, actor.id); tokens.push(current.json.session.token);
  return { ...response, cookie, session: current.json.session };
}
async function logout(signed) {
  assert.equal((await request("/api/auth/sign-out", { cookie: signed.cookie, body: {} })).status, 200);
  assert.equal((await request("/api/auth/get-session", { cookie: signed.cookie })).json, null);
}
async function denied(path, target, cookie, headers = {}) {
  let response = await request(path, { cookie, headers });
  const location = response.headers.get("location");
  if (response.status === 307 && location?.includes("_rsc") && new URL(location, context.base).pathname === new URL(path, context.base).pathname) response = await request(location, { cookie, headers });
  assert([303, 307, 308].includes(response.status) && new URL(response.headers.get("location"), context.base).pathname === target || response.status === 200 && response.text.includes("NEXT_REDIRECT") && response.text.includes(target), "Server redirect expected");
  assert(!response.text.includes("Ваше рабочее пространство") && !response.text.includes("Привет,"));
}
async function limitTests() {
  await resetLimits(); const actor = actors[0], statuses = [];
  for (let n = 0; n < 6; n++) statuses.push((await request("/api/auth/sign-in/email", { body: { email: actor.email, password: "invalid-test-input" }, headers: { "X-Forwarded-For": "203.0.113.61" } })).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  const window = await db.rateLimit.findUnique({ where: { key: accountKey(actor.email) } });
  const rotated = await request("/api/auth/sign-in/email", { body: { email: actor.email, password: "invalid-test-input" }, headers: { "X-Forwarded-For": "203.0.113.62", "x-lks-verified-ip": "203.0.113.63" } });
  const validBlocked = await request("/api/auth/sign-in/email", { body: { email: actor.email, password: actor.password }, headers: { "X-Forwarded-For": "203.0.113.64" } });
  const normalized = await request("/api/auth/sign-in/email", { body: { email: `  ${actor.email.toUpperCase()}  `, password: actor.password } });
  assert.equal(rotated.status, 429); assert.equal(validBlocked.status, 429); assert.equal(normalized.status, 429);
  assert.equal((await db.rateLimit.findUnique({ where: { key: window.key } })).lastRequest, window.lastRequest);
  const unknownStatuses = []; let unknown;
  for (let n = 0; n < 6; n++) { unknown = await request("/api/auth/sign-in/email", { body: { email: "missing@example.test", password: "invalid-test-input" } }); unknownStatuses.push(unknown.status); }
  assert.deepEqual(unknownStatuses, statuses); assert.deepEqual(unknown.json, rotated.json);
  assert(/^[a-f0-9]{64}$/.test(window.key.slice(8)));
  await db.rateLimit.update({ where: { key: window.key }, data: { lastRequest: BigInt(Date.now() - 60_001) } });
  const recovered = await login(actor); await logout(recovered);
  assert.equal(await db.rateLimit.findUnique({ where: { key: window.key } }), null);
  await resetLimits();
  const concurrent = await Promise.all(Array.from({ length: 6 }, (_, n) => request("/api/auth/sign-in/email", { body: { email: actor.email, password: "invalid-test-input" }, headers: { "X-Forwarded-For": `198.51.100.${n + 1}` } })));
  assert.equal(concurrent.filter(r => r.status === 401).length, 5); assert.equal(concurrent.filter(r => r.status === 429).length, 1);
  await resetLimits();
  assert.equal((await request("/api/auth/sign-in/email", { body: { email: actor.email, password: actor.password }, origin: "https://untrusted.example" })).status, 403);
  assert.equal(await db.rateLimit.findUnique({ where: { key: accountKey(actor.email) } }), null);
  await request("/api/auth/sign-in/email", { body: { email: "capacity-probe@example.test", password: "invalid-test-input" } });
  const ipBucket = await db.rateLimit.findFirst({ where: { key: { endsWith: "|/sign-in/email" } } });
  assert(ipBucket, "IP limiter must run before the account hook");
  await db.rateLimit.update({ where: { id: ipBucket.id }, data: { count: 60, lastRequest: BigInt(Date.now()) } });
  assert.equal((await request("/api/auth/sign-in/email", { body: { email: "capacity-denied@example.test", password: "invalid-test-input" }, headers: { "x-forwarded-for": "198.51.100.99" } })).status, 429);
  assert.equal(await db.rateLimit.findUnique({ where: { key: accountKey("capacity-denied@example.test") } }), null, "IP-denied requests must not allocate account buckets");
  await resetLimits();
  const sessionCount = await db.session.count();
  await db.$executeRawUnsafe("CREATE TRIGGER security_test_throttle_failure BEFORE INSERT ON RateLimit WHEN NEW.key LIKE 'account:%' BEGIN SELECT RAISE(FAIL, 'isolated_throttle_failure'); END;");
  try {
    const storageFailure = await request("/api/auth/sign-in/email", { body: { email: actor.email, password: actor.password } });
    assert.equal(storageFailure.status, 503); assert.equal(storageFailure.headers.getSetCookie().length, 0);
    assert.equal(await db.session.count(), sessionCount);
  } finally { await db.$executeRawUnsafe("DROP TRIGGER security_test_throttle_failure"); }
  await resetLimits();
  log("SEC-01", { mode: development ? "development" : "production", statuses, rotated: rotated.status, correctPasswordAfterRotation: validBlocked.status, normalized: normalized.status, knownAndUnknownIdentical: true, windowNotExtended: true, recovery: true, atomicReservations: "5 accepted + 1 limited", csrfCannotConsumeQuota: true, ipGatePrecedesAccountAllocation: true, limiterStorageFailure: 503 });
}

try {
  await startServer();
  if (!development) {
    let anonymous = 0, allowed = 0, rejected = 0;
    for (const [role, home] of Object.entries(homes)) for (const path of [home, ...sections[role].map(s => `${home}/${s.slug}`)]) { await denied(path, "/login"); anonymous++; }
    for (const actor of actors) {
      const signed = await login(actor, { role: "ADMIN", userId: actors[2].id, id: actors[2].id });
      assert.equal(signed.json.user.role, actor.role);
      assert(signed.headers.getSetCookie().some(c => /httponly/i.test(c) && /samesite=lax/i.test(c)));
      assert(!signed.session.ipAddress || signed.session.ipAddress === "127.0.0.1");
      for (const [role, home] of Object.entries(homes)) {
        for (const path of [home, ...sections[role].map(s => `${home}/${s.slug}`)]) {
          if (role === actor.role) { const r = await request(path, { cookie: signed.cookie }); assert.equal(r.status, 200); assert(!r.text.includes("NEXT_REDIRECT")); allowed++; }
          else { await denied(path, homes[actor.role], signed.cookie); rejected++; }
        }
        if (role !== actor.role) await denied(home, homes[actor.role], signed.cookie, { RSC: "1" });
      }
      for (const path of ["update-user", "admin/set-role", "sign-up/email"]) assert.equal((await request(`/api/auth/${path}`, { cookie: signed.cookie, body: { role: "ADMIN", userId: actors[2].id } })).status, 404);
      assert.equal((await request("/api/auth/sign-out", { cookie: signed.cookie, body: {}, origin: "https://untrusted.example" })).status, 403);
      assert.equal((await request("/api/auth/sign-out", { cookie: signed.cookie, body: {}, origin: null })).status, 403);
      await logout(signed);
      for (const home of Object.values(homes)) await denied(home, "/login", signed.cookie);
    }
    const publicPage = await request("/"); assert.equal(publicPage.status, 200);
    const news = await db.news.findMany({ where: { publishedAt: { lte: new Date() } }, orderBy: [{ publishedAt: "desc" }, { id: "asc" }], take: 3 });
    for (const item of news) assert(publicPage.text.includes(item.title));
    log("Four roles, five accounts, CSRF, logout replay and public news", { anonymous, allowed, rejected, accounts: actors.length });

    for (const rememberMe of [false, true, undefined]) {
      const signed = await login(actors[1], { rememberMe, createdAt: "2099-01-01T00:00:00Z", expiresAt: "2099-01-02T00:00:00Z" });
      assert.equal((new Date(signed.session.expiresAt) - new Date(signed.session.createdAt)) / 3600000, 8);
      const now = Date.now();
      await db.session.update({ where: { id: signed.session.id }, data: { createdAt: new Date(now - 7 * 3600000), expiresAt: new Date(now + 20 * 3600000) } });
      const capped = await request("/api/auth/get-session", { cookie: signed.cookie });
      assert.equal((new Date(capped.json.session.expiresAt) - new Date(capped.json.session.createdAt)) / 3600000, 8);
      await db.session.update({ where: { id: signed.session.id }, data: { createdAt: new Date(Date.now() - 8 * 3600000 - 1), updatedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600000) } });
      assert.equal((await request("/api/auth/get-session", { cookie: signed.cookie })).json, null);
      await denied("/dashboard", "/login", signed.cookie); await logout(signed);
    }
    const legacy = await login(actors[0]);
    await db.session.update({ where: { id: legacy.session.id }, data: { createdAt: new Date(Date.now() - 9 * 3600000), expiresAt: new Date(Date.now() + 15 * 3600000) } });
    const maintenance = spawnSync(process.execPath, ["scripts/harden-sessions.mjs"], { env: { ...process.env, DATABASE_URL: isolatedURL }, encoding: "utf8" });
    assert.equal(maintenance.status, 0);
    const legacyRow = await db.session.findUnique({ where: { id: legacy.session.id } });
    assert.equal((legacyRow.expiresAt - legacyRow.createdAt) / 3600000, 8);
    assert.equal((await request("/api/auth/get-session", { cookie: legacy.cookie })).json, null); await logout(legacy);
    log("SEC-02", { rememberMeVariants: [false, true, "omitted"], ttlHours: 8, legacyAndExtendedRowsRejectedAt8Hours: true, maintenanceCapsLegacyRows: true });

    const admin = await login(actors[2]);
    assert(isolatedURL.includes("/.local/auth-security-"));
    await db.$executeRawUnsafe("CREATE TRIGGER security_test_delete_failure BEFORE DELETE ON Session BEGIN SELECT RAISE(FAIL, 'isolated_test_delete_failure'); END;");
    try {
      const failed = await request("/api/auth/sign-out", { cookie: admin.cookie, body: {} });
      assert.equal(failed.status, 503); assert.equal(failed.json.code, "SIGN_OUT_UNCONFIRMED");
      assert.equal(failed.headers.getSetCookie().length, 0);
      assert(await db.session.findUnique({ where: { id: admin.session.id } }));
      assert.equal((await request("/api/auth/get-session", { cookie: admin.cookie })).json.user.id, actors[2].id);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER security_test_delete_failure"); }
    await logout(admin); assert.equal(await db.session.findUnique({ where: { id: admin.session.id } }), null);
    log("SEC-03", { simulatedDeleteFailure: 503, misleadingSuccess: false, cookieRetainedForRetry: true, retrySucceeds: true });
  }
  await limitTests(); await stopServer();
  if (!development) {
    await resetLimits(); await startServer(true);
    for (const headers of [{ "x-lks-proxy-key": "" }, { "x-lks-proxy-key": "invalid" }, { "x-lks-client-ip": "192.0.2.1,192.0.2.2" }]) assert.equal((await request("/api/auth/sign-in/email", { body: { email: actors[0].email, password: actors[0].password }, headers })).status, 403);
    const trusted = await login(actors[0], {}, { "x-lks-client-ip": "192.0.2.20", "x-forwarded-for": "203.0.113.99", "x-lks-verified-ip": "203.0.113.98" });
    assert.equal(trusted.session.ipAddress, "192.0.2.20");
    assert(trusted.headers.getSetCookie().some(c => /;\s*secure/i.test(c) && /httponly/i.test(c) && /samesite=lax/i.test(c)));
    assert.equal((new Date(trusted.session.expiresAt) - new Date(trusted.session.createdAt)) / 3600000, 8); await logout(trusted);
    log("Trusted proxy and HTTPS cookie issuance", { invalidProxyCredential: 403, trustedClientIPUsed: true, forwardedHeadersIgnored: true, secure: true, tlsTransport: "not tested" });
    const require = createRequire(import.meta.url), estreeRequire = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
    const { minimatch } = estreeRequire("minimatch"); assert.equal(estreeRequire("minimatch/package.json").version, "11.0.1");
    for (const [file, pattern, expected] of [["src/app/page.tsx", "src/**/*.tsx", true], ["src/.hidden.ts", "src/**/*.ts", true], ["src/app/page.js", "src/**/*.ts", false], ["a/b.ts", "**/*.{ts,tsx}", true]]) assert.equal(minimatch(file, pattern, { dot: true }), expected);
    log("DEP-01 compatibility", { minimatch: "11.0.1", commonJSConsumer: true, globCases: 4 });
  }
  assert.equal(await fingerprint(original), before, "Original data must remain unchanged");
  log("Original data preservation", { accounts: actors.length, unchanged: true });
} finally {
  await stopServer();
  for (const value of [secret, proxySecret, ...actors.map(a => a.password), ...tokens]) logs = logs.replaceAll(value, "[REDACTED]");
  writeFileSync(resolve(testRoot, "server.log"), logs, { mode: 0o600 });
  writeFileSync(resolve(testRoot, "results.json"), JSON.stringify({ mode: development ? "development" : "production", results }, null, 2));
  await db.$disconnect(); await original.$disconnect();
  console.info(`Результаты проверки: ${testRoot.replaceAll("\\", "/")}/results.json`);
}
