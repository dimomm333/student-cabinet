import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { verifyPassword } from "better-auth/crypto";
import { createPrismaClient } from "../src/lib/prisma-client.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";

const base = process.env.AUTH_TEST_URL ?? process.env.BETTER_AUTH_URL;
if (!base) throw new Error("Задайте BETTER_AUTH_URL или AUTH_TEST_URL и запустите приложение.");
const local = existsSync(".env.demo.local") ? parse(readFileSync(".env.demo.local", "utf8")) : {};
const prisma = createPrismaClient();
const homes = { STUDENT: "/dashboard", TEACHER: "/teacher", TECHNICAL_STAFF: "/staff", ADMIN: "/admin" };
const sections = {
  STUDENT: ["profile", "schedule", "session", "grades", "materials", "services", "notifications", "news", "clearance", "useful", "sports", "portfolio", "mail"],
  TEACHER: ["schedule", "disciplines", "students", "grades", "materials", "consultations", "announcements"],
  TECHNICAL_STAFF: ["requests", "equipment", "rooms", "tasks", "notifications"],
  ADMIN: ["users", "news", "requests", "academic", "settings"],
};
const createdSessions = [];
const summary = [];
const runId = randomBytes(4).readUInt32BE() % 200;

async function request(path, { cookie, body, origin = new URL(base).origin, ip = `192.0.2.${runId + 1}`, headers = {} } = {}) {
  return fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: { Origin: origin, "x-forwarded-for": ip, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookieFrom(response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function redirected(path, target, cookie, headers) {
  let response = await request(path, { cookie, headers });
  // Next.js canonicalizes RSC requests with its own cache-key query first.
  const canonical = response.headers.get("location");
  if (response.status === 307 && canonical && new URL(canonical, base).pathname === new URL(path, base).pathname && canonical.includes("_rsc")) {
    await response.text();
    response = await request(canonical, { cookie, headers });
  }
  const html = await response.text();
  const redirected = [303, 307, 308].includes(response.status)
    ? new URL(response.headers.get("location"), base).pathname.replace(/\.rsc$/, "") === target
    : response.status === 200 && html.includes("NEXT_REDIRECT") && html.includes(target);
  assert(redirected, `${path}: ожидался серверный redirect на ${target}, HTTP ${response.status}, Location ${response.headers.get("location")}`);
  assert(!html.includes("Ваше рабочее пространство"), `${path}: содержимое кабинета не должно передаваться`);
  assert(!html.includes("Привет,"), `${path}: персональное приветствие не должно передаваться`);
}

async function currentSession(cookie) {
  const response = await request("/api/auth/get-session", { cookie });
  assert.equal(response.status, 200);
  return response.json();
}

function pass(message) { summary.push(message); console.info(`PASS: ${message}`); }

try {
  const beforeUsers = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const beforeNews = await prisma.news.findMany({ orderBy: { id: "asc" } });
  const beforeAccounts = await prisma.account.findMany({ orderBy: { id: "asc" } });
  const integrity = await prisma.$queryRawUnsafe("PRAGMA integrity_check");
  assert.equal(integrity[0].integrity_check, "ok");
  assert.equal((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")).length, 0);

  if (existsSync(".local/before-auth.json")) {
    const original = JSON.parse(readFileSync(".local/before-auth.json", "utf8"));
    for (const user of original.users) {
      const current = beforeUsers.find((item) => item.id === user.id);
      assert(current, "Исходный User должен сохраниться");
      for (const key of Object.keys(user)) assert.equal(JSON.stringify(current[key]), JSON.stringify(user[key]), `User.${key} изменён`);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(beforeNews)), original.news);
    pass("Исходные User (ID, имя, email, роль, createdAt) и все News сохранены");
  }

  for (const home of Object.values(homes)) {
    await redirected(home, "/login");
    await redirected(home + "/" + sections[Object.keys(homes).find((role) => homes[role] === home)][0], "/login");
  }
  pass("Без сессии все четыре кабинета и вложенные страницы направляют на /login");

  const publicPage = await request("/");
  assert.equal(publicPage.status, 200);
  const publicHtml = await publicPage.text();
  for (const news of beforeNews.slice(0, 3)) assert(publicHtml.includes(news.title), "Публичная новость должна отображаться");
  assert((await (await request("/login")).text()).includes("Университетский email"));
  pass("Публичная главная, новости из SQLite и общая форма входа доступны");

  for (let index = 0; index < demoAccounts.length; index++) {
    const identity = demoAccounts[index];
    const password = process.env[identity.passwordEnv] ?? local[identity.passwordEnv];
    assert(password, `Нужен локальный ${identity.passwordEnv}`);
    const user = beforeUsers.find((item) => item.email === identity.email);
    assert(user && user.role === identity.role, `Аккаунт ${identity.email} и его роль должны существовать`);
    const account = beforeAccounts.find((item) => item.userId === user.id && item.providerId === "credential");
    assert(account?.password && account.password !== password, "В базе должен храниться только хеш");
    assert(await verifyPassword({ hash: account.password, password }), "Хеш должен соответствовать локальному паролю");
    if (identity.role === "STUDENT") assert(await prisma.studentProfile.findUnique({ where: { userId: user.id } }));
    if (identity.role === "TEACHER") assert(await prisma.teacherProfile.findUnique({ where: { userId: user.id } }));
    if (identity.role === "TECHNICAL_STAFF") assert(await prisma.technicalStaffProfile.findUnique({ where: { userId: user.id } }));

    const ip = `198.51.100.${runId + index + 1}`;
    const login = await request("/api/auth/sign-in/email", { body: { email: identity.email, password, role: "ADMIN", userId: "forged", rememberMe: false }, ip });
    assert.equal(login.status, 200, `Вход ${identity.email}`);
    const setCookies = login.headers.getSetCookie();
    assert(setCookies.some((value) => /httponly/i.test(value) && /samesite=lax/i.test(value)), "HttpOnly и SameSite обязательны");
    if (new URL(base).protocol === "https:") assert(setCookies.some((value) => /; secure/i.test(value)), "HTTPS требует Secure cookie");
    const cookie = cookieFrom(login);
    assert(cookie, "Cookie сессии должна быть установлена");
    const session = await currentSession(cookie);
    assert.equal(session.user.id, user.id);
    assert.equal(session.user.role, identity.role, "Роль из запроса входа должна игнорироваться");
    createdSessions.push(session.session.id);
    assert(await prisma.session.findUnique({ where: { id: session.session.id } }), "Сессия должна храниться в SQLite");
    assert(!JSON.stringify(session).includes(account.password), "Хеш не должен попадать в ответ API");
    const home = homes[identity.role];
    const own = await request(home, { cookie });
    assert.equal(own.status, 200);
    assert((await own.text()).includes(user.name.split(" ")[0]), "Кабинет должен отображать текущего пользователя");

    for (const [role, targetHome] of Object.entries(homes)) {
      if (role !== identity.role) {
        await redirected(targetHome, home, cookie);
        await redirected(`${targetHome}/${sections[role][0]}`, home, cookie);
        await redirected(targetHome, home, cookie, { RSC: "1" });
      }
    }
    for (const slug of sections[identity.role]) {
      const section = await request(`${home}/${slug}`, { cookie });
      assert.equal(section.status, 200, `${home}/${slug}: раздел доступен своей роли`);
      assert((await section.text()).includes("следующ"), "Будущий модуль должен быть обозначен как не реализованный");
    }
    await redirected("/login", home, cookie);

    for (const path of ["/api/auth/update-user", "/api/auth/admin/set-role", "/api/auth/sign-up/email"]) {
      const attack = await request(path, { cookie, body: { email: "attacker@example.test", password, name: "Attacker", role: "ADMIN", userId: user.id } });
      assert.equal(attack.status, 404, "Изменение роли и регистрация должны быть недоступны");
    }
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).role, identity.role);

    const maliciousLogout = await request("/api/auth/sign-out", { cookie, body: {}, origin: "https://untrusted.example" });
    assert.equal(maliciousLogout.status, 403, "Cross-origin POST должен отклоняться");
    assert(await currentSession(cookie), "Чужой origin не должен уничтожать сессию");

    const logout = await request("/api/auth/sign-out", { cookie, body: {} });
    assert.equal(logout.status, 200);
    assert.equal(await prisma.session.findUnique({ where: { id: session.session.id } }), null);
    assert.equal(await currentSession(cookie), null, "Повтор старого cookie после выхода недопустим");
    for (const targetHome of Object.values(homes)) await redirected(targetHome, "/login", cookie);
    pass(`${identity.email}: вход, своя навигация, запрет трёх чужих кабинетов и RSC, защита роли и CSRF, выход и отзыв сессии`);
  }

  const first = demoAccounts[0];
  const password = process.env[first.passwordEnv] ?? local[first.passwordEnv];
  const invalid = await request("/api/auth/sign-in/email", { body: { email: first.email, password: randomBytes(24).toString("hex") }, ip: `203.0.113.${runId + 1}` });
  assert.equal(invalid.status, 401, "Неверный пароль должен отклоняться");
  const unknown = await request("/api/auth/sign-in/email", { body: { email: "missing@example.test", password }, ip: `203.0.113.${runId + 2}` });
  assert.equal(unknown.status, 401, "Несуществующий email должен возвращать ту же ошибку");
  const invalidBody = await invalid.json();
  const unknownBody = await unknown.json();
  assert.equal(invalidBody.code, unknownBody.code, "Ошибка не должна раскрывать наличие email");

  const extraLogin = await request("/api/auth/sign-in/email", { body: { email: first.email, password }, ip: `203.0.113.${runId + 3}` });
  assert.equal(extraLogin.status, 200);
  const cookie = cookieFrom(extraLogin);
  const expiring = await currentSession(cookie);
  createdSessions.push(expiring.session.id);
  await prisma.session.update({ where: { id: expiring.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await redirected("/dashboard", "/login", cookie);
  assert.equal(await currentSession(cookie), null);
  await redirected("/dashboard", "/login", "better-auth.session_token=forged.role.ADMIN");
  pass("Неверный пароль, неизвестный email, истёкшая сессия и поддельный cookie отклоняются");

  const rateIp = `203.0.113.${runId + 4}`;
  for (let index = 0; index < 6; index++) {
    const response = await request("/api/auth/sign-in/email", { body: { email: first.email, password: randomBytes(24).toString("hex") }, ip: rateIp });
    assert.equal(response.status, index < 5 ? 401 : 429, "Ограничение пяти попыток в минуту должно работать");
    await response.text();
  }
  pass("Rate limit: шестая попытка входа за минуту возвращает 429");

  const seed = spawnSync(process.execPath, ["--env-file-if-exists=.env", "prisma/seed.ts"], { encoding: "utf8", env: process.env });
  assert.equal(seed.status, 0, "Повторный seed должен завершаться успешно");
  assert.deepEqual(await prisma.user.findMany({ orderBy: { id: "asc" } }), beforeUsers);
  assert.deepEqual(await prisma.news.findMany({ orderBy: { id: "asc" } }), beforeNews);
  assert.deepEqual(await prisma.account.findMany({ orderBy: { id: "asc" } }), beforeAccounts);
  pass("Повторный seed сохраняет пользователей, роли, пароли и новости; SQLite целостна");
  console.info(`Все ${summary.length} групп интеграционных проверок пройдены.`);
} finally {
  // Only sessions created by this verification are removed; user data is untouched.
  await prisma.session.deleteMany({ where: { id: { in: createdSessions } } });
  await prisma.$disconnect();
}
