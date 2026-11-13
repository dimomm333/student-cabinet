import type { Prisma } from "../src/generated/prisma/client.ts";

export const practicalDemoNews = [
  { id: "demo-news-science", category: "Льготы и скидки", isDemo: true, title: "Студенческий билет: льготы и скидки в учебном примере", publishedAt: new Date("2026-11-12T09:00:00Z"), content: "Вымышленное объявление. В демонстрационном кампусе для подтверждения студенческого статуса предусмотрен электронный или бумажный студенческий билет.\n\nВ этом примере скидки доступны в столовой и при посещении культурных событий. Условия, организации и льготы вымышлены. Настоящие условия необходимо уточнять у своего университета и организаторов." },
  { id: "demo-news-community", category: "Доступ в корпуса", isDemo: true, title: "Учебный пример: временное изменение входа в корпус Б", publishedAt: new Date("2026-11-11T12:00:00Z"), content: "Вымышленное объявление. В примере на 14 ноября вход в учебный корпус Б перенесён к центральному вестибюлю из-за обслуживания турникетов.\n\nЗанятия в примере проходят по расписанию. Перед выходом проверьте аудиторию и корпус на странице расписания. Это сценарий для проверки интерфейса, а не действующее распоряжение реального вуза." },
  { id: "demo-news-library", category: "Общежитие и документы", isDemo: true, title: "Документы для общежития: памятка учебного кампуса", publishedAt: new Date("2026-11-10T10:00:00Z"), content: "Вымышленная памятка. В демонстрационном сценарии студент проверяет заявление на заселение, подтверждение обучения и время приёма в службе общежития.\n\nПеречень приведён только как пример публикации. Для реального заселения сверьте документы и сроки с официальными правилами своего вуза. Изменения учебного процесса в этом прототипе отражаются в общем расписании." },
];

export async function seedSchedule(tx: Prisma.TransactionClient) {
  const teacherIds: Record<string, string> = {};
  for (const [email, name, slug] of [
    ["mikhail.sokolov@example.test", "Михаил Соколов", "mikhail-sokolov"],
    ["anna.belova@example.test", "Анна Белова", "anna-belova"],
    ["elena.morozova@example.test", "Елена Морозова", "elena-morozova"],
  ]) {
    const user = await tx.user.upsert({ where: { email }, update: {}, create: { name, email, role: "TEACHER" } });
    if (user.role !== "TEACHER") throw new Error("Seed не меняет роль существующей учётной записи преподавателя.");
    const profile = await tx.teacherProfile.findUnique({ where: { userId: user.id } });
    await tx.teacherProfile.upsert({ where: { userId: user.id }, update: profile?.scheduleSlug ? {} : { scheduleSlug: slug, publicName: name, isSchedulePublic: true }, create: { userId: user.id, scheduleSlug: slug, publicName: name, isSchedulePublic: true, department: "Учебная кафедра" } });
    teacherIds[slug] = user.id;
    // Additional teachers have no credential Account and cannot sign in.
  }
  const groupIds: Record<string, string> = {};
  for (const [slug, code, programme] of [["pi-24-1", "ПИ-24-1", "Прикладная информатика"], ["pi-24-2", "ПИ-24-2", "Прикладная информатика"], ["it-25-1", "ИТ-25-1", "Информационные технологии"]]) {
    const group = await tx.studyGroup.upsert({ where: { slug }, update: {}, create: { id: `demo-group-${slug}`, slug, code, programme, course: 2, isPublic: true } });
    groupIds[slug] = group.id;
    await tx.studentProfile.updateMany({ where: { groupId: null, groupName: code }, data: { groupId: group.id } });
  }
  const disciplineIds: Record<string, string> = {};
  for (const [code, title] of [["math", "Математический анализ"], ["programming", "Программирование"], ["databases", "Базы данных"], ["english", "Английский язык"], ["algorithms", "Основы алгоритмизации"]]) {
    const discipline = await tx.discipline.upsert({ where: { code }, update: {}, create: { id: `demo-discipline-${code}`, code, title } }); disciplineIds[code] = discipline.id;
  }
  const buildingIds: Record<string, string> = {};
  for (const code of ["a", "b"]) {
    const building = await tx.building.upsert({ where: { code }, update: {}, create: { id: `demo-building-${code}`, code, name: `Учебный корпус ${code === "a" ? "А" : "Б"}`, isPublic: true } }); buildingIds[code] = building.id;
  }
  const roomIds: Record<string, string> = {};
  for (const [key, building, number] of [["a201", "a", "201"], ["a112", "a", "112"], ["b304", "b", "304"], ["b108", "b", "108"]]) {
    const room = await tx.room.upsert({ where: { buildingId_number: { buildingId: buildingIds[building], number } }, update: {}, create: { id: `demo-room-${key}`, buildingId: buildingIds[building], number, isPublic: true } }); roomIds[key] = room.id;
  }
  const term = await tx.academicTerm.upsert({ where: { code: "demo-autumn-2026" }, update: {}, create: { id: "demo-term-autumn-2026", code: "demo-autumn-2026", name: "Учебный пример · осень 2026", startsOn: new Date("2026-09-01T00:00:00Z"), endsOn: new Date("2026-12-31T00:00:00Z"), firstNumeratorMonday: new Date("2026-08-31T00:00:00Z"), isPublished: true } });
  type Row = [string, string, "LECTURE" | "PRACTICE" | "SEMINAR" | "LAB", string[], string, number, number, string, "EVERY" | "NUMERATOR" | "DENOMINATOR"];
  const rows: Row[] = [
    ["math-shared", "math", "LECTURE", ["pi-24-1", "pi-24-2"], "anna-belova", 1, 540, "a201", "EVERY"],
    ["programming-pi1", "programming", "PRACTICE", ["pi-24-1"], "mikhail-sokolov", 1, 645, "b304", "EVERY"],
    ["lab-pi1", "programming", "LAB", ["pi-24-1"], "mikhail-sokolov", 2, 780, "b304", "NUMERATOR"],
    ["db-pi1", "databases", "PRACTICE", ["pi-24-1"], "mikhail-sokolov", 2, 780, "b108", "DENOMINATOR"],
    ["english-pi1", "english", "SEMINAR", ["pi-24-1"], "elena-morozova", 3, 540, "a112", "EVERY"],
    ["math-pi1", "math", "PRACTICE", ["pi-24-1"], "anna-belova", 5, 645, "a201", "EVERY"],
    ["math-pi2", "math", "PRACTICE", ["pi-24-2"], "anna-belova", 1, 645, "a201", "EVERY"],
    ["programming-pi2", "programming", "PRACTICE", ["pi-24-2"], "mikhail-sokolov", 4, 645, "b304", "EVERY"],
    ["english-pi2", "english", "SEMINAR", ["pi-24-2"], "elena-morozova", 5, 540, "a112", "EVERY"],
    ["algorithms-it1", "algorithms", "LECTURE", ["it-25-1"], "mikhail-sokolov", 3, 645, "b108", "EVERY"],
    ["math-it1", "math", "LECTURE", ["it-25-1"], "anna-belova", 4, 540, "a201", "EVERY"],
    ["lab-it1", "algorithms", "LAB", ["it-25-1"], "mikhail-sokolov", 5, 780, "b304", "DENOMINATOR"],
  ];
  for (const [key, discipline, kind, groups, teacher, dayOfWeek, startMinute, room, weekPattern] of rows) {
    const id = `demo-lesson-${key}`;
    await tx.lesson.upsert({ where: { id }, update: {}, create: { id, disciplineId: disciplineIds[discipline], kind } });
    for (const slug of groups) await tx.lessonGroup.upsert({ where: { lessonId_groupId: { lessonId: id, groupId: groupIds[slug] } }, update: {}, create: { lessonId: id, groupId: groupIds[slug] } });
    await tx.lessonTeacher.upsert({ where: { lessonId_teacherId: { lessonId: id, teacherId: teacherIds[teacher] } }, update: {}, create: { lessonId: id, teacherId: teacherIds[teacher] } });
    await tx.scheduleEntry.upsert({ where: { id: `demo-entry-${key}` }, update: {}, create: { id: `demo-entry-${key}`, lessonId: id, termId: term.id, roomId: roomIds[room], dayOfWeek, startMinute, endMinute: startMinute + 90, weekPattern, isPublished: true } });
  }
}
