import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { usefulCategories, usefulMaterials, usefulNested } from "../prisma/useful-content.ts";
import { seedUsefulCatalog } from "../prisma/useful-seed.ts";
import { saveUsefulEntry } from "../src/lib/useful-repository.ts";
import { officialHttpUrl, usefulLink } from "../src/lib/useful-catalog.ts";
import { serviceCatalog } from "../src/lib/services-catalog.ts";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { roleHomes } from "../src/lib/roles.ts";

const catalog = "/dashboard/useful", admin = "/admin/useful";
const testUrl = "https://www.prisma.io/docs";
const leafTitle = "Карточка проверочного объединения с длинным названием для узкого экрана";
const heading = (page, name) => page.getByRole("heading", { name, exact: true, level: 1 });

export async function verifyUseful({ browser, db, base, password, root, settle, pass, diagnostics, browserErrors, warningPattern }) {
  const initial = [...usefulCategories, ...usefulMaterials, ...usefulNested];
  assert.equal(usefulMaterials.length, 35);
  assert.equal(new Set(initial.map(row => row.id)).size, initial.length);
  const actual = await db.usefulEntry.findMany();
  assert.equal(actual.length, initial.length);
  for (const expected of initial) {
    const saved = actual.find(row => row.id === expected.id);
    assert.equal(saved.status, "PUBLISHED");
    assert.equal(saved.kind, expected.kind);
    assert.equal(saved.title, expected.title);
    assert.equal(saved.parentId, expected.parentId);
    assert.equal(saved.officialUrl, null);
    if (expected.kind === "ARTICLE") assert(saved.body.length >= 100);
    for (const match of saved.body.matchAll(/\]\(([^)]+)\)/g)) {
      assert.equal(usefulLink(match[1]), match[1]);
      assert(match[1].startsWith("/dashboard/"));
      if (match[1].startsWith(catalog + "/")) assert(initial.some(row => match[1] === catalog + "/" + row.id));
      if (match[1].includes("?service=")) assert(serviceCatalog.some(service => match[1].endsWith("?service=" + service.code)));
    }
  }
  for (const url of ["javascript:alert(1)", "//outside.test", "data:text/html,x", "https://a:b@outside.test", "https://outside.test\\x", "https://", "https:///outside.test"]) {
    assert.equal(officialHttpUrl(url), null);
    assert.equal(usefulLink(url), null);
  }
  assert.equal(officialHttpUrl(testUrl), testUrl);
  assert.equal(officialHttpUrl("http://localhost:3000/a"), "http://localhost:3000/a");
  assert.equal(usefulLink("/dashboard/useful/%2F"), null);
  assert.equal(await seedUsefulCatalog(db), 0);
  pass("Useful fixtures, existing section links, URL validation and repeat seed", { total: initial.length, materials: usefulMaterials.length });

  async function open(role) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
    if (role) {
      const actor = demoAccounts.find(account => account.role === role);
      assert.equal((await context.request.post(base + "/api/auth/sign-in/email", {
        headers: { Origin: base }, data: { email: actor.email, password },
      })).status(), 200);
    }
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(120000);
    page.on("console", message => {
      if (message.type() === "error" || warningPattern.test(message.text())) {
        diagnostics.push({ url: page.url(), message: message.text() });
      }
    });
    page.on("pageerror", error => browserErrors.push(error.message));
    return { page, context };
  }

  const student = await open("STUDENT");
  const editor = await open("ADMIN");
  const page = student.page, edit = editor.page;
  const form = edit.locator("form.useful-editor:visible");
  await page.goto(base + catalog);
  await expect(heading(page, "Полезное")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".useful-card")).toHaveCount(5);

  // Walk all top-level materials in the student cabinet, including every fallback.
  for (const material of usefulMaterials) {
    await page.goto(base + catalog + "/" + material.id);
    await expect(heading(page, material.title)).toBeVisible();
    if (material.kind === "ARTICLE") {
      await expect(page.locator("article time")).toBeVisible();
      await expect(page.locator(".useful-markdown")).not.toBeEmpty();
    }
    if (material.kind === "EXTERNAL") {
      await expect(page.getByText("Официальный ресурс пока не подключён.", { exact: false })).toBeVisible();
      await expect(page.getByRole("link", { name: "Вернуться в «Полезное»" })).toHaveAttribute("href", catalog);
    }
  }

  await page.goto(base + catalog);
  for (const name of ["Студентам", "Студенческие объединения и клубы", "Научно-технические"]) {
    await page.getByRole("link", { name: new RegExp(name) }).click();
    await expect(heading(page, name)).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" }).locator("li")).toHaveText([
    "Полезное", "Студентам", "Студенческие объединения и клубы", "Научно-технические",
  ]);
  await page.goto(base + catalog);
  const search = page.getByRole("searchbox");
  await search.focus();
  await search.fill("ИНЖЕНЕРНЫЕ проекты");
  await search.press("Enter");
  await expect(page.getByRole("link", { name: /Научно-технические/ })).toBeVisible();
  await page.getByLabel("Категория").selectOption("university");
  await page.getByRole("button", { name: "Найти" }).click();
  await expect(page.getByText("Ничего не найдено.", { exact: false })).toBeVisible();
  pass("Student walks catalog materials, third level, breadcrumbs and filtered nested search");

  await edit.goto(base + admin);
  await expect(heading(edit, "Справочник «Полезное»")).toBeVisible();
  await edit.getByRole("link", { name: "Добавить запись" }).click();
  async function fillTitle(title, type = "DIRECTORY", status = "PUBLISHED") {
    await expect(heading(edit, "Новая запись")).toBeVisible();
    await form.getByLabel("Название", { exact: true }).fill(title);
    await form.getByLabel("Тип записи").selectOption(type);
    await form.getByLabel("Публикация").selectOption(status);
  }
  async function save() {
    const response = edit.waitForResponse(item => item.request().method() === "POST" && item.request().headers()["next-action"]);
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await response;
    await expect(edit.getByRole("status").filter({ hasText: "Запись сохранена." })).toBeVisible({ timeout: 15000 });
    return new URL(edit.url()).pathname.split("/").at(-1);
  }
  await fillTitle("Проверочный институт");
  await form.getByLabel("Родительский раздел").selectOption("institutes");
  const institute = await save();
  await edit.getByRole("link", { name: "Добавить вложенную запись" }).click();
  await fillTitle("Проверочная кафедра");
  const department = await db.academicDepartment.findFirstOrThrow();
  await form.getByLabel("Учебное подразделение", { exact: false }).selectOption(department.id);
  const departmentCard = await save();
  assert.equal((await db.usefulEntry.findUniqueOrThrow({ where: { id: departmentCard } })).parentId, institute);
  await page.goto(base + catalog + "/" + institute);
  await page.getByRole("link", { name: department.name, exact: true }).click();
  await expect(heading(page, department.name)).toBeVisible();

  await edit.goto(base + admin + "/new?parent=technical-clubs");
  await fillTitle(leafTitle, "ARTICLE");
  await form.getByLabel("Содержание", { exact: false }).fill(
    "## Как записаться\n\n1. **Откройте** [Расписание](/dashboard/schedule)\n2. [Опасная ссылка](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>",
  );
  await form.getByLabel("Краткое описание").fill("Синхрофазотрон и консультация организатора");
  await form.getByLabel("Публичные контакты").fill("Контакт для проверки");
  await form.getByLabel("Место или адрес").fill("Место встречи для проверки");
  const leaf = await save();
  await page.goto(base + catalog + "/clubs?q=" + encodeURIComponent("синхрофазотрон"));
  await page.getByRole("link", { name: new RegExp(leafTitle) }).click();
  await expect(heading(page, leafTitle)).toBeVisible();
  await expect(page.locator(".useful-markdown li")).toHaveCount(2);
  await expect(page.locator(".useful-markdown ol")).toHaveCSS("list-style-type", "decimal");
  await expect(page.locator(".useful-markdown img")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Опасная ссылка" })).toHaveCount(0);
  await expect(page.locator(".useful-markdown")).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.locator(".useful-facts")).toContainText("Место встречи для проверки");
  await expect(page.locator("article").getByRole("link", { name: "Расписание" })).toHaveAttribute("href", "/dashboard/schedule");

  const widths = [346, 360, 390, 768, 1366];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const [theme, label] of [["light", "Светлая"], ["dark", "Тёмная"]]) {
      await page.locator(".theme-toggle").filter({ visible: true }).click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const [id, title, name] of [[leaf, leafTitle, "article"], ["clubs", "Студенческие объединения и клубы", "catalog"]]) {
        await page.goto(base + catalog + "/" + id);
        await expect(heading(page, title)).toBeVisible();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Useful ${name} overflow at ${width}/${theme}`);
        if (width === 346 || width === 1366) await page.screenshot({ path: resolve(root, `useful-${name}-${width}-${theme}.png`), fullPage: true });
      }
    }
  }
  pass("Useful article and catalog in both themes", { widths });

  await form.getByLabel("Родительский раздел").selectOption("creative-clubs");
  await form.getByLabel("Порядок").fill("-10");
  assert.equal(await save(), leaf);
  await page.goto(base + catalog + "/" + leaf);
  await expect(page.getByRole("navigation", { name: "Хлебные крошки" })).toContainText("Творческие");
  assert.equal((await db.usefulEntry.findUniqueOrThrow({ where: { id: leaf } })).sortOrder, -10);

  await form.getByLabel("Публикация").selectOption("DRAFT");
  assert.equal(await save(), leaf);
  await page.goto(base + catalog + "/" + leaf);
  await expect(heading(page, leafTitle)).toHaveCount(0);
  await page.goto(base + catalog + "/clubs?q=" + encodeURIComponent("синхрофазотрон"));
  await expect(page.getByText("Ничего не найдено.", { exact: false })).toBeVisible();
  assert.equal(await seedUsefulCatalog(db), 0);
  assert.equal((await db.usefulEntry.findUniqueOrThrow({ where: { id: leaf } })).status, "DRAFT");

  await edit.goto(base + admin + "/" + institute);
  await form.getByLabel("Публикация").selectOption("ARCHIVED");
  await expect(form.getByRole("checkbox")).toBeVisible();
  await form.getByRole("checkbox").check();
  await save();
  await page.goto(base + catalog + "/" + departmentCard);
  await expect(heading(page, department.name)).toHaveCount(0);
  assert.equal((await db.usefulEntry.findUniqueOrThrow({ where: { id: departmentCard } })).status, "PUBLISHED");

  const invalid = new FormData();
  for (const [key, value] of Object.entries({ title: "Проверочный институт", parentId: departmentCard, kind: "DIRECTORY", status: "ARCHIVED" })) invalid.set(key, value);
  await assert.rejects(saveUsefulEntry(db, institute, invalid), /собственной ветки/);

  const mail = "/dashboard/mail", mailUrl = "https://university-mail.example.test/";
  const mailLink = page.getByRole("link", { name: "Открыть университетскую почту" });
  const mailUnavailable = page.getByText("Почтовый сервис пока не подключён.", { exact: false });
  await page.goto(base + mail);
  await expect(heading(page, "Университетская почта")).toBeVisible();
  await expect(mailUnavailable).toBeVisible();
  await expect(mailLink).toHaveCount(0);
  await edit.goto(base + admin + "/university-mail");
  await form.getByLabel("Официальный URL").fill(mailUrl);
  assert.equal(await save(), "university-mail");
  await student.context.route(mailUrl, route => route.fulfill({ contentType: "text/plain", body: "Test webmail" }));
  await page.reload();
  await expect(mailLink).toHaveAttribute("href", mailUrl);
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 346, height: 800 });
    await page.evaluate(value => { localStorage.setItem("lks-theme", value); }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(mailLink).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  const popupPromise = page.waitForEvent("popup");
  await mailLink.click();
  const popup = await popupPromise;
  await expect(popup.locator("body")).toHaveText("Test webmail");
  assert.equal(popup.url(), mailUrl);
  await popup.close();
  await form.getByLabel("Официальный URL").fill("");
  await save();
  await page.reload();
  await expect(mailUnavailable).toBeVisible();
  await expect(mailLink).toHaveCount(0);
  pass("University mail reads the administrator's URL and opens the external resource");

  await edit.goto(base + admin + "/university-site");
  await form.getByLabel("Официальный URL").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("HTTP или HTTPS");
  await form.getByLabel("Официальный URL").fill(testUrl);
  const write = edit.waitForRequest(request => request.method() === "POST" && request.headers()["next-action"]);
  await save();
  const request = await write;
  await page.goto(base + catalog + "/university");
  await expect(page.getByRole("link", { name: /Официальный сайт университета/ })).toHaveAttribute("href", testUrl);
  const fallback = await student.context.request.get(base + catalog + "/university-site", { maxRedirects: 0 });
  if (fallback.status() >= 300) assert.equal(fallback.headers().location, testUrl);
  else assert((await fallback.text()).includes(testUrl), "Missing streamed redirect");

  // Repeat an actual form submission while signed in under every unauthorized
  // identity. Change the payload so a missing authorization check is observable.
  const headers = request.headers();
  const mutation = request.postDataBuffer();
  assert(mutation?.includes(Buffer.from(testUrl)), "Expected official URL in form submission");
  const anotherUrl = testUrl.replace("/docs", "/blog");
  const attempted = Buffer.from(mutation.toString().replace(testUrl, anotherUrl));
  const replay = (context, data) => context.request.post(request.url(), {
    headers: { "next-action": headers["next-action"], "content-type": headers["content-type"], Origin: base },
    data, maxRedirects: 0,
  });
  const storedUrl = async () => (await db.usefulEntry.findUniqueOrThrow({ where: { id: "university-site" } })).officialUrl;
  await replay(editor.context, attempted);
  assert.equal(await storedUrl(), anotherUrl);
  await replay(editor.context, mutation);
  assert.equal(await storedUrl(), testUrl);
  for (const role of ["STUDENT", "TEACHER", "TECHNICAL_STAFF", "DEANERY_STAFF", null]) {
    const actor = await open(role);
    await actor.page.goto(base + admin);
    await actor.page.waitForURL(base + (role ? roleHomes[role] : "/login"));
    if (role !== "STUDENT") {
      await actor.page.goto(base + catalog + "/brs");
      await actor.page.waitForURL(base + (role ? roleHomes[role] : "/login"));
    }
    await replay(actor.context, attempted);
    assert.equal(await storedUrl(), testUrl);
    if (role === "DEANERY_STAFF") {
      const dean = await db.user.findFirstOrThrow({ where: { role } });
      const scoped = await db.deaneryDepartmentAssignment.findMany({ where: { userId: dean.id } });
      assert(scoped.length > 0);
      await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.id } });
      await replay(actor.context, attempted);
      assert.equal(await storedUrl(), testUrl);
      await actor.page.goto(base + admin + "/university-site");
      await actor.page.waitForURL(base + roleHomes[role]);
    }
    await actor.context.close();
  }
  await form.getByLabel("Название", { exact: true }).fill("Официальный сайт после редактирования");
  await save();
  assert.equal(await seedUsefulCatalog(db), 0);
  assert.equal((await db.usefulEntry.findUniqueOrThrow({ where: { id: "university-site" } })).title, "Официальный сайт после редактирования");
  pass("Useful administration, explicit visibility, cycle validation, Markdown and authorization", { roles: 5, anonymous: true });
  await settle(page);
  await student.context.close();
  await editor.context.close();
}
