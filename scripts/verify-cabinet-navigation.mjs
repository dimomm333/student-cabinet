import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { createClient } from "@libsql/client";
import { hashPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { getDatabaseUrl } from "../src/lib/database-url.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";

const observe = process.argv.includes("--observe"), production = process.argv.includes("--production");
mkdirSync(".local", { recursive: true });
const root = mkdtempSync(resolve(".local/cabinet-navigation-")), project = resolve(root, "project");
const source = createClient({ url: getDatabaseUrl() });
async function fingerprint() {
  const tables = (await source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).rows;
  const rows = [];
  for (const { name } of tables) rows.push([name, (await source.execute(`SELECT * FROM "${name}" ORDER BY 1`)).rows]);
  return createHash("sha256").update(JSON.stringify(rows, (_, v) => typeof v === "bigint" ? String(v) : v)).digest("hex");
}
const before = await fingerprint();
await source.execute({ sql: "VACUUM INTO ?", args: [resolve(root, "test.db")] });
process.env.DATABASE_URL = `file:${resolve(root, "test.db").replaceAll("\\", "/")}`;
const db = createPrismaClient(), password = randomBytes(24).toString("base64url");
await db.account.updateMany({ where: { providerId: "credential" }, data: { password: await hashPassword(password) } });
// Keep the user's running next dev and its build cache untouched as well.
if (!production) {
  mkdirSync(project);
  for (const folder of ["src", "public"]) cpSync(folder, resolve(project, folder), { recursive: true });
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "AGENTS.md", ".gitignore"]) cpSync(file, resolve(project, file));
  writeFileSync(resolve(project, "next.config.ts"), readFileSync("next.config.ts", "utf8").replace("turbopack: {", `turbopack: { root: ${JSON.stringify(resolve(".").replaceAll("\\", "/"))},`));
  symlinkSync(resolve("node_modules"), resolve(project, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}
const port = process.env.CABINET_TEST_PORT ?? "3210";
const base = `http://127.0.0.1:${port}`, results = [], diagnostics = [], browserErrors = [];
let logs = "", browser;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", production ? "start" : "dev", production ? resolve(".") : project, "--hostname", "127.0.0.1", "--port", port], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: production ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1", BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), AUTH_TRUST_PROXY: "false", AUTH_PROXY_SECRET: "" } });
child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; });
const warningPattern = /Next\.js encountered|unstable value|uncached data during|blocking-prerender|Blocking Route|Instant validation/;
const homes = { STUDENT: "/dashboard", ADMIN: "/admin", TEACHER: "/teacher", TECHNICAL_STAFF: "/staff" };
function pass(name, evidence = {}) { results.push({ name, ...evidence }); console.info(`PASS: ${name} ${JSON.stringify(evidence)}`); }
async function settle(page) {
  await page.locator("main h1").first().waitFor({ timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  const overlay = await page.locator("nextjs-portal").allTextContents();
  for (const text of overlay) if (warningPattern.test(text)) diagnostics.push({ url: page.url(), type: "overlay", message: text });
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(base + "/api/auth/get-session", { signal: AbortSignal.timeout(10000) })).ok) { ready = true; break; } } catch { /* compilation */ }
    await new Promise(done => setTimeout(done, 250));
  }
  assert(ready, "Isolated navigation server unavailable");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome", headless: true });
  for (const actor of demoAccounts.filter(a => a.email !== "maria.volkova@example.test")) {
    if (process.argv.includes("--student-only") && actor.role !== "STUDENT") continue;
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: "reduce" });
    const signed = await context.request.post(base + "/api/auth/sign-in/email", { headers: { Origin: base }, data: { email: actor.email, password } });
    assert.equal(signed.status(), 200);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.on("console", message => { if (warningPattern.test(message.text())) diagnostics.push({ url: page.url(), type: message.type(), message: message.text() }); });
    page.on("pageerror", error => { browserErrors.push(error.message); });
    const home = homes[actor.role];
    console.info(`Checking ${actor.role} navigation in ${production ? "next start" : "next dev"}...`);
    await page.goto(base + home); await settle(page);
    const documentTime = await page.evaluate(() => performance.timeOrigin);
    const links = await page.locator(".desktop-sidebar .sidebar-nav a").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")).filter(href => href && href !== location.pathname));
    for (const href of links) {
      await page.locator(`.desktop-sidebar .sidebar-nav a[href="${href}"]`).click({ force: observe });
      await page.waitForURL(base + href); await settle(page);
      await page.locator(`.desktop-sidebar .sidebar-nav a[href="${home}"]`).click({ force: observe });
      await page.waitForURL(base + home); await settle(page);
    }
    assert.equal(await page.evaluate(() => performance.timeOrigin), documentTime, "Menu navigation reloaded the document");
    await page.screenshot({ path: resolve(root, `${actor.role.toLowerCase()}.png`), fullPage: true });
    pass(`${actor.role}: direct visit, menu and return home`, { sections: links.length });
    if (!observe) {
      for (const other of Object.values(homes).filter(path => path !== home)) {
        await page.goto(base + other); await page.waitForURL(base + home); await settle(page);
      }
      // Role updates must take effect on the next request, without a session cache.
      const user = await db.user.findUniqueOrThrow({ where: { email: actor.email } });
      const newRole = actor.role === "ADMIN" ? "TEACHER" : "ADMIN";
      await db.user.update({ where: { id: user.id }, data: { role: newRole } });
      await page.goto(base + home); await page.waitForURL(base + homes[newRole]); await settle(page);
      await db.user.update({ where: { id: user.id }, data: { role: actor.role } });
      await page.goto(base + home); await settle(page);
      const cookie = (await context.cookies()).map(c => `${c.name}=${c.value}`).join("; ");
      await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).filter({ visible: true }).click();
      await page.waitForURL(base + "/login");
      assert.equal((await context.request.get(base + "/api/auth/get-session", { headers: { Cookie: cookie } })).status(), 200);
      assert.equal(await (await context.request.get(base + "/api/auth/get-session", { headers: { Cookie: cookie } })).json(), null);
      await page.goto(base + home); await page.waitForURL(base + "/login");
      pass(`${actor.role}: changed role, foreign cabinets and logout`, { secure: true });
    }
    await context.close();
  }
  assert.equal(await fingerprint(), before, "Source database changed");
  if (!observe) {
    assert.deepEqual(diagnostics, [], "Next.js warnings in browser");
    assert.deepEqual(browserErrors, [], "Browser runtime errors");
    assert(!warningPattern.test(logs), "Next.js warnings in server log");
  }
  pass("Navigation diagnostics", { mode: production ? "production" : "development", observe, browserWarnings: diagnostics.length, browserErrors: browserErrors.length, sourceUnchanged: true });
} finally {
  await browser?.close(); child.kill(); await db.$disconnect(); source.close();
  writeFileSync(resolve(root, "server.log"), logs.replaceAll(password, "[REDACTED]"), { mode: 0o600 });
  writeFileSync(resolve(root, "results.json"), JSON.stringify({ results, diagnostics, browserErrors }, null, 2));
  console.info(`Navigation report: ${root.replaceAll("\\", "/")}/results.json`);
}
