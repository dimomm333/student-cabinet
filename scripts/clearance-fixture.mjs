import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { executeClearanceCommand, clearanceDetail } from '../src/lib/clearance-repository.ts';

export const clearanceIdentities = [
  { key: 'STUDENT', email: 'clearance.student@example.test', name: 'Даниил Андреевич Северин', role: 'STUDENT' },
  { key: 'DEAN', email: 'clearance.dean@example.test', name: 'Елена Павловна Лескова', role: 'DEANERY_STAFF' },
  { key: 'LIBRARY', email: 'clearance.library@example.test', name: 'Анна Викторовна Книжнова', role: 'TECHNICAL_STAFF' },
  { key: 'ACCOUNTING', email: 'clearance.accounting@example.test', name: 'Игорь Сергеевич Счётников', role: 'TECHNICAL_STAFF' },
  { key: 'ACADEMIC', email: 'clearance.academic@example.test', name: 'Вера Николаевна Учебная', role: 'TECHNICAL_STAFF' },
  { key: 'ACCESS', email: 'clearance.access@example.test', name: 'Павел Олегович Пропусков', role: 'TECHNICAL_STAFF' },
  { key: 'DORMITORY', email: 'clearance.dormitory@example.test', name: 'Ольга Ивановна Кампусова', role: 'TECHNICAL_STAFF' },
];
export async function fixtureActor(db, userId) { const s = await db.session.create({ data: { userId, token: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) } }); return { id: userId, sessionId: s.id }; }
export async function configureClearance(db) {
  const definitions = [
    ['library', 'Библиотека', 'Возврат библиотечных изданий.', 'Библиотека, корпус А, кабинет 101', 'ALWAYS'],
    ['accounting', 'Бухгалтерия', 'Сверка подтверждённых финансовых обязательств.', 'Бухгалтерия, корпус А, кабинет 204', 'ALWAYS'],
    ['academic', 'Выпускающая кафедра', 'Возврат учебных материалов и имущества кафедры.', 'Учебный корпус, кабинет 301', 'ALWAYS'],
    ['access', 'Бюро пропусков', 'Возврат или прекращение действия пропуска.', 'Главный вход, бюро пропусков', 'ALWAYS'],
    ['dormitory', 'Общежитие', 'Проверка обязательств по проживанию.', 'Общежитие № 1, комендант', 'DORMITORY'],
    ['contracts', 'Договорной отдел', 'Проверка исполнения договора обучения.', 'Корпус А, кабинет 206', 'PAID'],
    ['equipment', 'Лаборатория и материальная служба', 'Возврат выданного оборудования.', 'Учебный корпус, кабинет 104', 'EQUIPMENT'],
    ['practice', 'Отдел практик', 'Проверка завершения выпускной практики.', 'Учебный корпус, кабинет 305', 'GRADUATION'],
    ['deanery', 'Деканат', 'Итоговая проверка и завершение процедуры.', 'Деканат, кабинет 201', 'FINAL'],
  ];
  for (const [i, [code, name, description, contact]] of definitions.entries()) await db.clearanceDepartment.upsert({ where: { code }, update: {}, create: { code, name, description, contact, sortOrder: i * 10 } });
  const departments = await db.clearanceDepartment.findMany();
  for (const reason of ['WITHDRAWAL', 'GRADUATION', 'TRANSFER']) {
    const templateId = 'clearance-standard-' + reason.toLowerCase();
    await db.clearanceTemplate.upsert({ where: { id: templateId }, update: {}, create: { id: templateId, name: 'Стандартный обходной лист', reason, rules: { create: definitions.map(([code, , , , rule]) => ({ departmentId: departments.find(d => d.code === code).id, rule })) } } });
  }
  return departments;
}
// Called automatically only by isolated tests. CLI requires an explicit --apply
// and a password for every identity; it never changes existing credentials.
export async function seedClearanceDemo(db, passwords) {
  const users = {};
  for (const identity of clearanceIdentities) {
    const existing = await db.user.findUnique({ where: { email: identity.email } });
    if (existing && existing.role !== identity.role) throw new Error('Synthetic identity role changed. Refusing to overwrite.');
    if (existing) {
      if (existing.id !== 'clearance-demo-' + identity.key.toLowerCase()) throw new Error('Synthetic email belongs to an unmanaged account.');
      users[identity.key] = existing; continue;
    }
    const password = passwords[identity.key];
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Supply CLEARANCE_' + identity.key + '_PASSWORD (12–128 characters).');
    const encoded = await hashPassword(password);
    users[identity.key] = await db.user.create({ data: { id: 'clearance-demo-' + identity.key.toLowerCase(), email: identity.email, name: identity.name, role: identity.role, accounts: { create: { providerId: 'credential', accountId: 'clearance-demo-' + identity.key.toLowerCase(), password: encoded } } } });
  }
  const department = await db.academicDepartment.upsert({ where: { faculty_name: { faculty: 'Институт демонстрационных программ', name: 'Учебный отдел демонстрации обходного листа' } }, update: {}, create: { id: 'clearance-demo-academic', faculty: 'Институт демонстрационных программ', name: 'Учебный отдел демонстрации обходного листа' } });
  const group = await db.studyGroup.upsert({ where: { slug: 'clearance-demo-26' }, update: {}, create: { slug: 'clearance-demo-26', code: 'ДЕМО-26', programme: 'Информатика', course: 2, departmentId: department.id } });
  await db.deaneryStaffProfile.upsert({ where: { userId: users.DEAN.id }, update: {}, create: { userId: users.DEAN.id, position: 'Специалист деканата' } });
  await db.deaneryDepartmentAssignment.upsert({ where: { userId_departmentId: { userId: users.DEAN.id, departmentId: department.id } }, update: {}, create: { userId: users.DEAN.id, departmentId: department.id } });
  await db.studentProfile.upsert({ where: { userId: users.STUDENT.id }, update: {}, create: { userId: users.STUDENT.id, firstName: 'Даниил', middleName: 'Андреевич', lastName: 'Северин', studentNumber: 'CLEARANCE-DEMO-26', groupId: group.id, groupName: group.code, course: 2, program: 'Информатика', studyMode: 'Очная', fundingBasis: 'Бюджет', educationStatus: 'STUDYING', residenceStatus: 'RESIDENT', dormitory: 'Общежитие № 1' } });
  const departments = await configureClearance(db);
  for (const key of ['LIBRARY', 'ACCOUNTING', 'ACADEMIC', 'ACCESS', 'DORMITORY']) {
    await db.technicalStaffProfile.upsert({ where: { userId: users[key].id }, update: {}, create: { userId: users[key].id, department: departments.find(d => d.code === key.toLowerCase()).name, jobTitle: 'Ответственный за обходные листы' } });
    await db.clearanceGrant.upsert({ where: { userId_departmentId: { userId: users[key].id, departmentId: departments.find(d => d.code === key.toLowerCase()).id } }, update: {}, create: { userId: users[key].id, departmentId: departments.find(d => d.code === key.toLowerCase()).id } });
  }
  const prior = await db.clearanceProcess.findFirst({ where: { studentId: users.STUDENT.id }, orderBy: { createdAt: 'asc' } });
  if (prior) return { users, processId: prior.id, departments };
  const actors = {}, sessions = [];
  try {
    for (const key of ['DEAN', 'LIBRARY', 'ACCOUNTING', 'ACADEMIC', 'ACCESS', 'DORMITORY']) { actors[key] = await fixtureActor(db, users[key].id); sessions.push(actors[key].sessionId); }
    const created = await executeClearanceCommand(db, actors.DEAN, { operation: 'CREATE', requestId: randomUUID(), studentId: users.STUDENT.id, templateId: 'clearance-standard-withdrawal', basisNote: 'Начата подготовка к отчислению по собственному желанию. Приказ ещё не издан.', startsOn: new Date().toISOString().slice(0, 10) });
    const run = async (key, operation, extra = {}) => { const p = await clearanceDetail(db, actors.DEAN, created.id); return executeClearanceCommand(db, actors[key], { operation, requestId: randomUUID(), id: p.id, version: p.version, ...extra }); };
    let p = await clearanceDetail(db, actors.DEAN, created.id);
    for (const s of p.steps.filter(s => s.needsClarification)) await run('DEAN', 'APPLICABILITY', { stepId: s.id, required: false, confirmed: true, text: s.rule === 'PAID' ? 'Деканат сверил синтетическое личное дело: бюджетное обучение, договорных обязательств нет.' : 'Деканат проверил синтетический журнал выдачи: оборудование не выдавалось, обязательств нет.' });
    await run('DEAN', 'OPEN');
    p = await clearanceDetail(db, actors.DEAN, created.id);
    for (const key of ['ACCOUNTING', 'ACADEMIC', 'ACCESS', 'DORMITORY']) await run(key, 'APPROVE', { stepId: p.steps.find(s => s.departmentId === departments.find(d => d.code === key.toLowerCase()).id).id, text: 'Ответственный проверил синтетические сведения: обязательства исполнены.' });
    await run('LIBRARY', 'REMARK', { stepId: p.steps.find(s => s.departmentId === departments.find(d => d.code === 'library').id).id, category: 'Возврат книги', description: 'Не возвращена книга «Высшая математика».', requiredAction: 'Верните издание в библиотеку и сообщите об устранении замечания.' });
    return { users, processId: created.id, departments };
  } finally { await db.session.deleteMany({ where: { id: { in: sessions } } }); }
}
