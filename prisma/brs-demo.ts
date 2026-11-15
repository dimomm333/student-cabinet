import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { createDraft, publish } from "../src/lib/brs-commands.ts";
import { calculateStudent, planInclude } from "../src/lib/brs-repository.ts";
import { brsSchedule } from "../src/lib/brs-schedule.ts";

// Only known fictional accounts; a complete existing plan is never reseeded.
export async function seedBrsDemo(db: PrismaClient) {
  const teacher = await db.user.findUnique({ where: { email: "mikhail.sokolov@example.test" } });
  const dean = await db.user.findUnique({ where: { email: "olga.kuznetsova@example.test" } });
  const group = await db.studyGroup.findUnique({ where: { id: "demo-group-pi-24-1" } });
  const term = await db.academicTerm.findUnique({ where: { id: "demo-term-autumn-2026" } });
  if (teacher?.role !== "TEACHER" || dean?.role !== "DEANERY_STAFF" || !group || !term) throw new Error("Сначала подготовьте существующие демонстрационные аккаунты и расписание.");
  const department = group.departmentId && await db.deaneryDepartmentAssignment.findUnique({ where: { userId_departmentId: { userId: dean.id, departmentId: group.departmentId } } });
  if (!department) throw new Error("Нет явного назначения деканата для демонстрационной группы.");
  const students = await db.user.findMany({ where: { email: { in: ["alexander.smirnov@example.test", "maria.volkova@example.test"] }, role: "STUDENT", studentProfile: { groupId: group.id } }, orderBy: { email: "asc" } });
  if (students.length !== 2) throw new Error("Оба известных демостудента должны входить в демонстрационную группу. Seed не меняет их профили.");
  for (const [code, title, control, moduleCount] of [["math", "Математический анализ", "EXAM", 3], ["programming", "Программирование", "CREDIT", 2], ["informatics", "Информатика", "DIFFERENTIATED", 2], ["databases", "Базы данных", "DISTRIBUTED", 3]] as const) {
    if (await db.brsPlan.findFirst({ where: { groupId: group.id, termId: term.id, discipline: { code } } })) continue;
    await db.$transaction(async tx => {
      await tx.scheduleWriteState.upsert({ where: { id: "schedule" }, create: { id: "schedule", revision: 0 }, update: { revision: { increment: 0 } } });
      await tx.brsWriteState.upsert({ where: { id: "brs" }, create: { id: "brs", revision: 1 }, update: { revision: { increment: 1 } } });
      const discipline = await tx.discipline.upsert({ where: { code }, update: {}, create: { id: `demo-discipline-${code}`, code, title } });
      if (await tx.brsPlan.findUnique({ where: { groupId_disciplineId_termId: { groupId: group.id, disciplineId: discipline.id, termId: term.id } } })) return;
      const assignmentKey = { teacherId: teacher.id, groupId: group.id, disciplineId: discipline.id, termId: term.id };
      const assignment = await tx.teachingAssignment.findUnique({ where: { teacherId_groupId_disciplineId_termId: assignmentKey } });
      if (assignment && !assignment.isActive) return; // Re-running seed cannot restore revoked authority.
      if (!assignment) await tx.teachingAssignment.create({ data: assignmentKey });
      const command = { operation: "CREATE_PLAN", requestId: `brs-demo-v1-${code}`, groupId: group.id, disciplineId: discipline.id, termId: term.id, control, moduleCount };
      const created = await createDraft(tx, dean, command);
      let plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: created.id }, include: planInclude });
      const schedule = await brsSchedule(tx, plan);
      // A lab exists only where the actual timetable includes a laboratory.
      if (code === "programming") {
        const brsModule = plan.modules[0], homework = brsModule.events.find(event => event.kind === "HOMEWORK")!;
        const pair = schedule.find(pair => pair.kind === "LAB" && !pair.cancelled && pair.week >= brsModule.startWeek && pair.week <= brsModule.endWeek);
        if (pair) {
          const occurrence = plan.occurrences.find(item => item.sourceKey === pair.sourceKey)!;
          await tx.brsEvent.update({ where: { id: homework.id }, data: { maxScore: brsModule.workMax / 2 } });
          await tx.brsEvent.create({ data: { moduleId: brsModule.id, kind: "LAB", title: "ЛР 1 · демонстрационная защита", number: 1, week: pair.week, plannedOn: new Date(pair.date), occurrenceId: occurrence.id, maxScore: brsModule.workMax / 2, labMinScore: 0, labRequiresDefense: true, required: true } });
        }
      }
      plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
      let published = false;
      // Missing timetable is an explicit draft, never synthetic lesson dates.
      if (plan.modules.every(brsModule => brsModule.events.every(event => event.plannedOn) && schedule.some(pair => !pair.cancelled && ["PRACTICE", "SEMINAR"].includes(pair.kind) && pair.week >= brsModule.startWeek && pair.week <= brsModule.endWeek))) {
        await publish(tx, plan); published = true;
        plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
        for (let index = 0; index < students.length; index++) {
          const student = students[index];
          for (const brsModule of plan.modules) for (const event of brsModule.events) {
            if (index === 1 && event.kind === "HOMEWORK" && brsModule.number === 2) continue;
            const weakHomework = index === 1 && event.kind === "HOMEWORK" && brsModule.number === 1;
            const failedLast = code === "databases" && event.kind === "FINAL" && brsModule.number === plan.modules.length;
            const score = failedLast ? 250 : weakHomework ? Math.floor(event.maxScore * 2 / 5) : Math.floor(event.maxScore * (index ? 7 : 9) / 10);
            const values: Prisma.BrsResultUncheckedCreateInput = { eventId: event.id, studentId: student.id, authorId: teacher.id, score,
              passed: ["INTERIM", "FINAL"].includes(event.kind) ? !failedLast : null,
              labStatus: event.kind === "LAB" ? index ? "COMPLETED" : "DEFENDED" : null,
              submittedOn: event.kind === "HOMEWORK" ? new Date(event.deadline!.getTime() + (index ? 86400000 : -86400000)) : null,
              checkedOn: event.kind === "HOMEWORK" ? new Date(event.deadline!.getTime() + 2 * 86400000) : null,
              performedOn: event.kind === "LAB" ? event.plannedOn : null, defendedOn: event.kind === "LAB" && !index ? event.plannedOn : null,
              comment: index ? "Демонстрационный приватный комментарий преподавателя" : "Демонстрационный результат: работа проверена", commentVisible: index === 0 };
            await tx.brsResult.create({ data: values });
          }
          for (let i = 0; i < plan.occurrences.length; i++) {
            let mark = ["PRESENT", "ACTIVE", "SICK", "ABSENT", "EXCUSED", null][(i + index) % 6];
            if (index === 0 && mark === null && plan.modules.some(item => item.events.some(event => event.kind === "SEMINAR" && event.occurrenceId === plan.occurrences[i].id))) mark = "PRESENT";
            if (mark) await tx.brsAttendance.create({ data: { occurrenceId: plan.occurrences[i].id, studentId: student.id, authorId: teacher.id, mark } });
          }
          if (index === 0 && code === "math") {
            const admission = await tx.brsAdmission.create({ data: { planId: plan.id, studentId: student.id, authorId: dean.id, approved: true, reason: "Демонстрация: академические условия проверены деканатом", basedRevision: 1 } });
            await tx.brsExamAttempt.create({ data: { planId: plan.id, studentId: student.id, authorId: teacher.id, number: 1, score: 2200, passed: true, heldOn: new Date("2026-12-30"), admissionVersion: admission.version, comment: "Демонстрационная экзаменационная попытка", commentVisible: true } });
            await tx.brsAudit.create({ data: { actorId: dean.id, planId: plan.id, objectId: student.id, action: "CONFIRM", requestId: command.requestId + "-admission", commandHash: createHash("sha256").update(JSON.stringify(admission)).digest("hex"), afterJson: JSON.stringify(admission), reason: admission.reason } });
          }
          if (index === 0 && code === "databases") await tx.brsExamAttempt.create({ data: { planId: plan.id, studentId: student.id, authorId: teacher.id, number: 1, score: 625, passed: true, heldOn: new Date("2026-12-30"), comment: "Демонстрационная замена последнего РК", commentVisible: true } });
        }
        await tx.brsModule.updateMany({ where: { planId: plan.id }, data: { state: code === "math" ? "AWAITING" : "CLOSED", closedAt: code === "math" ? null : new Date() } });
        if (code === "programming") {
          plan = await tx.brsPlan.findUniqueOrThrow({ where: { id: plan.id }, include: planInclude });
          const { calculation } = await calculateStudent(tx, plan, students[0].id);
          await tx.brsFinal.create({ data: { planId: plan.id, studentId: students[0].id, authorId: teacher.id, score: calculation.total, rating: calculation.rating, grade: calculation.provisionalGrade, basisJson: JSON.stringify({ demo: true, calculation }), basedRevision: 1 } });
        }
      }
      const snapshot = { plan: await tx.brsPlan.findUnique({ where: { id: plan.id }, include: planInclude }), results: await tx.brsResult.findMany({ where: { event: { module: { planId: plan.id } } } }), attendance: await tx.brsAttendance.findMany({ where: { occurrence: { planId: plan.id } } }), attempts: await tx.brsExamAttempt.findMany({ where: { planId: plan.id } }), finals: await tx.brsFinal.findMany({ where: { planId: plan.id } }) };
      await tx.brsAudit.create({ data: { actorId: dean.id, planId: plan.id, objectId: plan.id, action: "DEMO_INITIALIZE", requestId: command.requestId, commandHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"), afterJson: JSON.stringify(snapshot), reason: "Явная инициализация вымышленных демонстрационных данных; прежние данные не изменены" } });
      console.info(`БРС: ${title} — ${published ? "демоплан опубликован" : "черновик: требуется согласовать расписание"}.`);
    }, { timeout: 60000, maxWait: 10000 });
  }
}
