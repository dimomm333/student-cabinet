import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { demoAccounts } from "../src/lib/demo-accounts.ts";
import { currentAcademicDate, DAY_MS, isoDate, mondayOf } from "../src/lib/schedule-calendar.ts";
import { roleHomes } from "../src/lib/roles.ts";

export async function verifyConsultations({ browser, db, base, password, root, pass, restartServer, diagnostics, browserErrors, warningPattern }) {
  const [student, outsider, admin, , staff, dean] = await Promise.all(demoAccounts.map(({ email }) =>
    db.user.findUniqueOrThrow({ where: { email } })));
  const teacher = await db.user.create({ data: {
    name: "Преподаватель консультаций", email: "consultations-teacher@example.test",
    emailVerified: true, role: "TEACHER", teacherProfile: { create: {} },
  } });
  await db.account.create({ data: {
    accountId: teacher.id, userId: teacher.id, providerId: "credential", password: await hashPassword(password),
  } });
  const [department, foreignDepartment] = await Promise.all(["Свои", "Чужие"].map(name =>
    db.academicDepartment.create({ data: { faculty: "Проверка консультаций", name } })));
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.id } });
  const grant = departmentId => db.deaneryDepartmentAssignment.create({ data: { userId: dean.id, departmentId } });
  await grant(department.id);
  const [group, foreignGroup, jointGroup] = await Promise.all([department, foreignDepartment, department].map(({ id: departmentId }, index) =>
    db.studyGroup.create({ data: { slug: `consult-fixture-${index}`, code: `КОНС-0${index + 1}`, programme: "Тест", course: 1, departmentId } })));
  await db.studentProfile.update({ where: { userId: student.id }, data: { groupId: group.id } });
  await db.studentProfile.update({ where: { userId: outsider.id }, data: { groupId: foreignGroup.id } });
  const today = currentAcademicDate();
  const date = new Date(today.getTime() + 3 * DAY_MS);
  const past = new Date(today.getTime() - 2 * DAY_MS);
  const term = await db.academicTerm.create({ data: {
    code: "consultation-fixture", name: "Проверка консультаций", isPublished: true,
    startsOn: today, endsOn: date, firstNumeratorMonday: mondayOf(today),
  } });
  const discipline = await db.discipline.create({ data: { code: "consult-fixture", title: "Консультационная дисциплина" } });
  const building = await db.building.create({ data: { code: "consult-fixture", name: "Учебный корпус К" } });
  const [lessonRoom, room, otherRoom] = await Promise.all(["901", "902", "903"].map(number =>
    db.room.create({ data: { buildingId: building.id, number } })));
  // The target students have no TeachingAssignment or BRS for this subject.
  const lesson = await db.lesson.create({ data: {
    disciplineId: discipline.id, kind: "SEMINAR",
    groups: { create: [{ groupId: group.id }, { groupId: foreignGroup.id }, { groupId: jointGroup.id }] },
    teachers: { create: { teacherId: teacher.id } },
  } });
  const entry = await db.scheduleEntry.create({ data: {
    lessonId: lesson.id, termId: term.id, roomId: lessonRoom.id,
    dayOfWeek: (date.getUTCDay() + 6) % 7 + 1, startMinute: 600, endMinute: 660, isPublished: true,
  } });
  const login = async (user, width = 1360) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    if (user) {
      const response = await context.request.post(base + "/api/auth/sign-in/email", { headers: { Origin: base }, data: { email: user.email, password } });
      assert.equal(response.status(), 200);
    }
    const page = await context.newPage();
    page.on("console", message => { if (warningPattern.test(message.text())) diagnostics.push(message.text()); });
    page.on("pageerror", error => browserErrors.push(error.message));
    return page;
  };
  const path = user => roleHomes[user.role] + "/consultations";
  const open = async (page, user) => {
    await page.goto(base + path(user));
    await expect(page.getByRole("heading", { name: "Консультации", exact: true })).toBeVisible();
  };
  const [deanPage, studentPage, outsiderPage, teacherPage] = await Promise.all([
    login(dean, 360), login(student, 360), login(outsider), login(teacher),
  ]);
  await open(deanPage, dean);
  await deanPage.getByText("Новая консультация", { exact: true }).click();
  const create = deanPage.getByRole("form", { name: "Новая консультация" });
  const putTime = async (form, start, end) => {
    await form.getByLabel("Начало", { exact: true }).fill(start);
    await form.getByLabel("Окончание").fill(end);
  };
  const select = (form, name) => form.getByRole("combobox", { name, exact: true });
  await select(create, "Преподаватель").selectOption(teacher.id);
  await select(create, "Дисциплина").selectOption(discipline.id);
  await select(create, "Корпус").selectOption(building.id);
  await select(create, "Аудитория").selectOption(room.id);
  await create.getByLabel("Дата", { exact: true }).fill(isoDate(date));
  await create.getByLabel(group.code, { exact: true }).check();
  await create.getByLabel(jointGroup.code, { exact: true }).check();
  await expect(create.getByLabel(foreignGroup.code, { exact: true })).toHaveCount(0);
  const add = create.getByRole("button", { name: "Добавить консультацию" });
  await putTime(create, "13:00", "12:00");
  await add.click();
  await expect(create.getByRole("alert")).toContainText("позже начала");
  await putTime(create, "10:30", "11:30");
  await add.click();
  await expect(create.getByRole("alert")).toContainText("Преподаватель занят");
  await putTime(create, "11:00", "12:00");
  await add.click();
  await expect(create.getByRole("status")).toHaveText("Консультация сохранена.");
  const saved = await db.consultation.findFirstOrThrow({ where: { disciplineId: discipline.id } });
  await add.click();
  await expect(create.getByRole("alert")).toContainText("Преподаватель занят");
  // A second eligible teacher exercises the independent room check.
  const substitute = await db.user.create({ data: {
    name: "Преподаватель проверки", email: "consultation-fixture@example.test", role: "TEACHER",
    teacherProfile: { create: {} },
    teachingAssignments: { create: { groupId: group.id, disciplineId: discipline.id, termId: term.id } },
  } });
  await open(deanPage, dean);
  await deanPage.getByText("Новая консультация", { exact: true }).click();
  await select(create, "Преподаватель").selectOption(substitute.id);
  await select(create, "Дисциплина").selectOption(discipline.id);
  await select(create, "Корпус").selectOption(building.id);
  await select(create, "Аудитория").selectOption(lessonRoom.id);
  await create.getByLabel("Дата", { exact: true }).fill(isoDate(date));
  await create.getByLabel(group.code, { exact: true }).check();
  await putTime(create, "10:30", "11:30");
  await add.click();
  await expect(create.getByRole("alert")).toContainText("Аудитория занята");
  await putTime(create, "11:30", "11:45");
  await select(create, "Аудитория").selectOption(room.id);
  await add.click();
  await expect(create.getByRole("alert")).toContainText("Аудитория занята");
  assert.equal(await db.consultation.count({ where: { disciplineId: discipline.id } }), 1);

  for (const [page, user] of [[studentPage, student], [teacherPage, teacher]]) {
    await open(page, user);
    await expect(page.getByRole("heading", { name: discipline.title })).toBeVisible();
    await expect(page.getByText("11:00–12:00")).toBeVisible();
    await expect(page.getByText(`${building.name} · ауд. ${room.number}`)).toBeVisible();
    const cards = page.getByRole("list", { name: "Консультации" });
    await expect(cards.getByText(group.code, { exact: true })).toBeVisible();
    await expect(cards.getByText(jointGroup.code, { exact: true })).toHaveCount(user.role === "TEACHER" ? 1 : 0);
  }
  await open(outsiderPage, outsider);
  await expect(outsiderPage.getByRole("heading", { name: "Консультаций пока нет", exact: true })).toBeVisible();
  await studentPage.getByRole("searchbox").fill("посторонний текст");
  await expect(studentPage.getByRole("heading", { name: "По вашему запросу ничего не найдено" })).toBeVisible();
  await studentPage.getByRole("tabpanel").getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(studentPage.getByRole("searchbox")).toBeFocused();
  await select(studentPage, "Преподаватель").selectOption(teacher.id);
  await select(studentPage, "Дисциплина").selectOption(discipline.id);
  await studentPage.getByLabel("Дата", { exact: true }).fill(isoDate(past));
  await expect(studentPage.getByRole("heading", { name: "По вашему запросу ничего не найдено" })).toBeVisible();
  await studentPage.getByLabel("Дата", { exact: true }).fill(isoDate(date));
  await expect(studentPage.getByRole("heading", { name: discipline.title })).toBeVisible();
  const visualPages = [["student", studentPage], ["teacher", teacherPage], ["deanery", deanPage], ["empty", outsiderPage]];
  for (const [name, page] of visualPages) for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 920 });
    for (const [theme, label] of [["dark", "Тёмная"], ["light", "Светлая"]]) {
      await page.locator(".theme-toggle").filter({ visible: true }).click();
      await page.getByRole("menuitemradio", { name: label, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({ path: resolve(root, `consultations-${name}-${width}-${theme}.png`), fullPage: true, animations: "disabled" });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Consultations overflow: ${name}, ${width}, ${theme}`);
      if (name === "student") {
        const controls = await page.getByRole("region", { name: "Фильтры консультаций" }).locator("input, select")
          .evaluateAll(fields => fields.map(field => {
            const { x, y, width, height } = field.getBoundingClientRect();
            return { x: Math.round(x), y: Math.round(y), width, height };
          }));
        assert(controls.every(control => control.height >= 44 && control.width >= 110),
          `Consultations filter dimensions at ${width}px in ${theme}: ${JSON.stringify(controls)}`);
        if (width === 375) assert.equal(new Set(controls.map(control => control.x)).size, 1);
        if (width === 768) assert.equal(new Set(controls.map(control => control.x)).size, 2);
        if (width === 1440) assert.equal(new Set(controls.map(control => control.y)).size, 1);
      }
    }
  }
  pass("Consultations layout and theme checks", { widths: [375, 768, 1440], themes: ["dark", "light"], views: visualPages.map(([name]) => name) });

  await deanPage.getByText("Редактировать", { exact: true }).click();
  const edit = deanPage.getByRole("form", { name: "Редактирование консультации" });
  await select(edit, "Аудитория").selectOption(otherRoom.id);
  await putTime(edit, "12:15", "12:45");
  const save = edit.getByRole("button", { name: "Сохранить изменения" });
  await save.click();
  await expect(deanPage.getByText("12:15–12:45")).toBeVisible();
  for (const [page, user] of [[studentPage, student], [teacherPage, teacher]]) {
    await open(page, user);
    await expect(page.getByText("12:15–12:45")).toBeVisible();
    await expect(page.getByText(`${building.name} · ауд. ${otherRoom.number}`)).toBeVisible();
  }

  await deanPage.getByText("Редактировать", { exact: true }).click();
  await putTime(edit, "13:00", "13:30");
  // Exercise authorization again from a form rendered before the scope changed.
  await grant(foreignDepartment.id);
  await db.deaneryDepartmentAssignment.delete({ where: { userId_departmentId: { userId: dean.id, departmentId: department.id } } });
  await save.click();
  await expect(edit.getByRole("alert")).toContainText("вне ваших полномочий");
  assert.equal((await db.consultation.findUniqueOrThrow({ where: { id: saved.id } })).startMinute, 735);
  await open(deanPage, dean);
  await expect(deanPage.getByRole("heading", { name: "Консультаций пока нет", exact: true })).toBeVisible();
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.id } });
  await open(deanPage, dean);
  await expect(deanPage.getByText("Вам пока не назначены учебные подразделения.")).toBeVisible();
  await grant(department.id);
  await open(deanPage, dean);
  await deanPage.getByText("Редактировать", { exact: true }).click();
  await edit.getByLabel("Дата", { exact: true }).fill(isoDate(past));
  await save.click();
  await expect(edit).not.toBeVisible();
  await open(teacherPage, teacher);
  await expect(teacherPage.getByRole("heading", { name: "Консультаций пока нет", exact: true })).toBeVisible();
  const upcomingTab = teacherPage.getByRole("tab", { name: "Ближайшие" });
  const pastTab = teacherPage.getByRole("tab", { name: "Прошедшие" });
  await upcomingTab.focus();
  await teacherPage.keyboard.press("ArrowRight");
  await expect(pastTab).toBeFocused();
  await teacherPage.keyboard.press("Enter");
  await expect(pastTab).toHaveAttribute("aria-selected", "true");
  await expect(teacherPage.getByRole("heading", { name: discipline.title })).toBeVisible();

  await deanPage.getByText("Отменить консультацию", { exact: true }).click();
  await deanPage.getByRole("button", { name: "Подтвердить отмену" }).click();
  await expect(deanPage.getByText("Отменена", { exact: true })).toBeVisible();
  for (const [page, user] of [[studentPage, student], [teacherPage, teacher]]) {
    await open(page, user);
    await page.getByRole("tab", { name: "Прошедшие" }).click();
    await expect(page.getByText("Отменена", { exact: true })).toBeVisible();
  }
  for (const user of [null, student, teacher, admin, staff]) {
    const page = await login(user);
    for (const owner of [dean, student, teacher].filter(owner => owner.role !== user?.role)) {
      await page.goto(base + path(owner));
      await page.waitForURL(base + (user ? roleHomes[user.role] : "/login"));
    }
    await page.context().close();
  }
  await restartServer();
  await open(deanPage, dean);
  await expect(deanPage.getByText("Отменена", { exact: true })).toBeVisible();
  assert.deepEqual(await db.scheduleEntry.findUniqueOrThrow({ where: { id: entry.id } }), entry);
  pass("Consultations: lifecycle, timetable and room conflicts, filters, role and department scope, mobile themes, server restart");
}
