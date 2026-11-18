import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createClient } from '@libsql/client';
import { hashPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { navigationPdf, actionPdf } from './service-pdf-fixtures.mjs';
import { createPrismaClient } from '../src/lib/prisma-client.ts';
import { getDatabaseUrl } from '../src/lib/database-url.ts';
import { fingerprint, integrity } from './database-snapshot.mjs';
import { serviceCatalog, validateFields, validateDocuments, searchServices, configFor } from '../src/lib/services-catalog.ts';
import { seedServices, executeServiceCommand, getServiceRequest, listServiceRequests, downloadServiceDocument, getMilitaryRecord, militaryEligibility } from '../src/lib/services-repository.ts';
import { localServiceStorage, prepareServiceFile } from '../src/lib/services-storage.ts';

mkdirSync('.local', { recursive: true });
const root = mkdtempSync(resolve('.local/services-test-'));
const source = createClient({ url: getDatabaseUrl() }), before = await fingerprint(source);
process.env.DATABASE_URL = 'file:' + resolve(root, 'test.db').replaceAll('\\', '/');
const migration = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, encoding: 'utf8', windowsHide: true });
assert.equal(migration.status, 0, migration.stderr);
const db = createPrismaClient(), storage = localServiceStorage(resolve(root, 'files')), results = [];
let child;
const pass = name => { results.push(name); console.info('PASS: ' + name); };
const command = (actor, body) => executeServiceCommand(db, actor, { requestId: randomUUID(), ...body });
async function user(role, groupId) {
  const user = await db.user.create({ data: { role, name: 'Test ' + role, email: randomUUID() + '@example.test', ...(role === 'STUDENT' ? { studentProfile: { create: { groupId, firstName: 'Тест', lastName: 'Студент' } } } : {}), ...(role === 'DEANERY_STAFF' ? { deaneryStaffProfile: { create: {} } } : {}) } });
  const session = await db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  return { ...user, sessionId: session.id };
}
async function submit(actor, state) { const detail = await getServiceRequest(db, actor, state.id); return command(actor, { operation: 'SUBMIT', ...state, confirmed: true, confirmationHash: detail.profilePreview.confirmationHash }); }
async function attach(actor, state, slot, kind = 'STUDENT') {
  const file = await prepareServiceFile(await sharp({ create: { width: 20, height: 20, channels: 3, background: '#123456' } }).png().toBuffer(), 'scan.png', 'image/png');
  await storage.put(file.key, file.bytes);
  const { bytes, ...metadata } = file; assert(bytes.length);
  return executeServiceCommand(db, actor, { operation: 'UPLOAD', requestId: randomUUID(), ...state, slot, kind }, metadata);
}
function sample(config) {
  return Object.fromEntries(config.fields.filter(field => field.required).map(field => [field.key, field.type === 'integer' ? 1 : field.type === 'money' ? 100.25 : field.type === 'choice' ? field.options[0] : field.type === 'date' ? '2026-11-20' : 'Демонстрационные сведения']));
}
try {
  await seedServices(db); await seedServices(db); assert.equal(await db.serviceDefinition.count(), 16);
  const department = await db.academicDepartment.create({ data: { faculty: 'Test', name: 'Services' } });
  const otherDepartment = await db.academicDepartment.create({ data: { faculty: 'Test', name: 'Other' } });
  const group = await db.studyGroup.create({ data: { code: 'TEST-1', slug: 'test-1', programme: 'Test', course: 1, departmentId: department.id } });
  const student = await user('STUDENT', group.id), other = await user('STUDENT', group.id), dean = await user('DEANERY_STAFF'), empty = await user('DEANERY_STAFF'), tech = await user('TECHNICAL_STAFF'), admin = await user('ADMIN'), teacher = await user('TEACHER');
  await db.deaneryDepartmentAssignment.create({ data: { userId: dean.id, departmentId: department.id } });
  for (const config of serviceCatalog) {
    await db.serviceRoute.create({ data: { serviceCode: config.code, sourceDepartmentId: department.id, departmentId: department.id } });
    await db.serviceGrant.create({ data: { userId: dean.id, departmentId: department.id, serviceCode: config.code, readFiles: true, readMilitary: true } });
    const fields = sample(config);
    assert.deepEqual(validateFields(config, {}, true), {});
    assert.throws(() => validateFields(config, {}, false));
    assert.throws(() => validateFields(config, { name: 'Подмена' }, true));
    let state = await command(student, { operation: 'CREATE', code: config.code });
    assert.deepEqual((await getServiceRequest(db, student, state.id)).fields, {});
    await assert.rejects(() => submit(student, state));
    state = await command(student, { operation: 'SAVE', ...state, fields });
    for (const slot of config.documents.filter(slot => slot.required && (!slot.when || fields[slot.when.field] === slot.when.value))) state = await attach(student, state, slot.key);
    state = await submit(student, state);
    const detail = await getServiceRequest(db, student, state.id);
    assert.equal(detail.status, 'SUBMITTED'); assert(detail.profileSnapshot.name);
    assert(!JSON.stringify(detail.profileSnapshot).includes('passport'));
    await assert.rejects(() => command(student, { operation: 'SAVE', ...state, fields }), /недоступно/);
    await assert.rejects(() => getServiceRequest(db, other, state.id), /недоступно/);
    for (const denied of [tech, admin, teacher, empty]) await assert.rejects(() => getServiceRequest(db, denied, state.id), /недоступно/);
  }
  pass('All 16 schemas, partial drafts, required fields/documents, ownership and five roles');
  assert.equal(searchServices('матпомощь')[0].service.code, 'material-aid');
  assert.equal(searchServices('военкомат')[0].service.code, 'military-change');
  assert(searchServices('справкка').some(x => x.service.category === 'DOCUMENTS'));
  assert(searchServices('потерял пропуск').some(x => x.service.code === 'pass-reissue'));
  for (const [query, code] of Object.entries({ 'с места учебы': 'study-certificate', 'отпуск на сессию': 'study-call', 'зачетка': 'transcript', 'повышенка': 'merit-scholarship', 'социалка': 'social-scholarship', 'матпомощ': 'material-aid', 'комнаты': 'dorm-compensation', 'поезд': 'travel-compensation', 'академка': 'academic-leave', 'перейти в другую группу': 'group-transfer', 'свободное посещение': 'individual-plan', 'уйти из универа': 'withdrawal', 'новый паспорт': 'personal-change', 'армия': 'military-change', 'студак': 'pass-reissue', 'помогите разобраться': 'deanery-appeal' })) assert(searchServices(query).some(x => x.service.code === code), query);
  assert(searchServices('дом').every(x => x.score < 3), 'Ambiguous words must not trigger a warning');
  assert(searchServices('Обычный вопрос студента').filter(x => x.service.code !== 'deanery-appeal').every(x => x.score < 3));
  assert.throws(() => validateFields(configFor('study-call'), { startsOn: '2026-02-30' }, true));
  assert.throws(() => validateDocuments(configFor('pass-reissue'), { photo: 'NEW' }, []));
  pass('Synonyms, local typo search, date validation and conditional new photo');
  let state = await command(student, { operation: 'CREATE', code: 'study-certificate', fields: { purpose: 'Работа', copies: 1, delivery: 'Лично' } });
  const detailBefore = await getServiceRequest(db, student, state.id);
  await assert.rejects(() => command(student, { operation: 'SUBMIT', ...state, confirmed: true, confirmationHash: 'stale' }), /подтвердите/);
  const submitCommand = { operation: 'SUBMIT', ...state, requestId: randomUUID(), confirmed: true, confirmationHash: detailBefore.profilePreview.confirmationHash };
  state = await executeServiceCommand(db, student, submitCommand);
  assert((await executeServiceCommand(db, student, submitCommand)).replayed);
  assert.equal(await db.serviceEvent.count({ where: { requestId: state.id } }), 1);
  await assert.rejects(() => executeServiceCommand(db, student, { ...submitCommand, confirmationHash: 'changed' }), /Ключ/);
  await assert.rejects(() => command(dean, { operation: 'TRANSITION', ...state, status: 'COMPLETED', text: 'Нельзя' }), /запрещён/);
  state = await command(dean, { operation: 'TRANSITION', ...state, status: 'IN_REVIEW' });
  for (let cycle = 0; cycle < 2; cycle++) {
    await assert.rejects(() => command(dean, { operation: 'TRANSITION', ...state, status: 'CLARIFICATION_REQUIRED', clarificationFields: ['purpose'] }), /комментарий/);
    state = await command(dean, { operation: 'TRANSITION', ...state, status: 'CLARIFICATION_REQUIRED', text: 'Уточните назначение', clarificationFields: ['purpose'] });
    await assert.rejects(() => command(student, { operation: 'SAVE', ...state, fields: { copies: 2 } }), /уточнения/);
    state = await command(student, { operation: 'SAVE', ...state, fields: { purpose: 'Уточнение ' + cycle } });
    state = await submit(student, state);
  }
  state = await command(dean, { operation: 'TRANSITION', ...state, status: 'IN_PROGRESS' });
  state = await attach(dean, state, 'result', 'RESULT');
  const resultFileId = state.documentId;
  assert((await downloadServiceDocument(db, student, resultFileId, storage)).bytes.length);
  await assert.rejects(() => downloadServiceDocument(db, other, resultFileId, storage), /недоступно/);
  state = await command(dean, { operation: 'TRANSITION', ...state, status: 'COMPLETED', text: 'Документ подготовлен' });
  await assert.rejects(() => command(dean, { operation: 'TRANSITION', ...state, status: 'IN_REVIEW' }), /запрещён/);
  await assert.rejects(() => command(dean, { operation: 'REMOVE_FILE', ...state, documentId: resultFileId }), /недоступно/);
  const completed = await getServiceRequest(db, student, state.id); assert.equal(completed.completedBy, dean.id); assert.deepEqual(completed.profileSnapshot, detailBefore.profilePreview.values);
  pass('Submission replay, two clarification cycles, immutable snapshot, result download, terminal completion');
  let rejected = await command(student, { operation: 'CREATE', code: 'deanery-appeal', fields: { subject: 'Вопрос', message: 'Текст' } });
  rejected = await submit(student, rejected); rejected = await command(dean, { operation: 'TRANSITION', ...rejected, status: 'IN_REVIEW' });
  await assert.rejects(() => command(dean, { operation: 'TRANSITION', ...rejected, status: 'REJECTED', text: ' ' }), /комментарий/);
  rejected = await command(dean, { operation: 'TRANSITION', ...rejected, status: 'REJECTED', text: 'Причина отказа' });
  assert.equal((await getServiceRequest(db, student, rejected.id)).resultText, 'Причина отказа');
  const draftCommand = { operation: 'CREATE', requestId: randomUUID(), code: 'deanery-appeal' };
  let draft = await executeServiceCommand(db, student, draftCommand); assert((await executeServiceCommand(db, student, draftCommand)).replayed);
  const saves = await Promise.allSettled([command(student, { operation: 'SAVE', ...draft, fields: { subject: 'A' } }), command(student, { operation: 'SAVE', ...draft, fields: { subject: 'B' } })]);
  assert.equal(saves.filter(r => r.status === 'fulfilled').length, 1);
  draft = saves.find(r => r.status === 'fulfilled').value;
  draft = await attach(student, draft, 'attachment');
  const removedId = draft.documentId;
  draft = await command(student, { operation: 'REMOVE_FILE', ...draft, documentId: removedId });
  assert((await getServiceRequest(db, student, draft.id)).documents.find(d => d.id === removedId).removedAt);
  const deleteCommand = { operation: 'DELETE', ...draft, requestId: randomUUID() };
  await executeServiceCommand(db, student, deleteCommand); assert((await executeServiceCommand(db, student, deleteCommand)).replayed);
  await assert.rejects(() => getServiceRequest(db, student, draft.id), /недоступно/);
  pass('Reasoned rejection, duplicate prevention, concurrent writes, attachment removal and draft deletion');
  const statuses = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CLARIFICATION_REQUIRED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'];
  const allowed = { SUBMITTED: ['IN_REVIEW'], IN_REVIEW: ['CLARIFICATION_REQUIRED', 'IN_PROGRESS', 'REJECTED'], IN_PROGRESS: ['CLARIFICATION_REQUIRED', 'COMPLETED', 'REJECTED'] };
  for (const from of statuses) for (const to of statuses) {
    const fixture = await db.serviceRequest.create({ data: { ownerId: student.id, serviceCode: 'deanery-appeal', schemaVersion: 1, departmentId: department.id, status: from } });
    const move = () => command(dean, { operation: 'TRANSITION', id: fixture.id, version: 1, status: to, text: 'Проверка перехода', clarificationFields: ['message'] });
    if (allowed[from]?.includes(to)) assert.equal((await db.serviceRequest.findUniqueOrThrow({ where: { id: (await move()).id } })).status, to);
    else await assert.rejects(move);
  }
  const comment = { operation: 'COMMENT', ...state, requestId: randomUUID(), text: '<script>alert(1)</script>\nОбычный текст' };
  await assert.rejects(() => executeServiceCommand(db, student, comment), /закрыта/);
  let talk = await command(student, { operation: 'CREATE', code: 'deanery-appeal', fields: { subject: 'Переписка', message: 'Вопрос' } });
  talk = await submit(student, talk);
  talk = await command(dean, { operation: 'TRANSITION', ...talk, status: 'IN_REVIEW' });
  const reply = { operation: 'COMMENT', id: talk.id, version: talk.version, requestId: randomUUID(), text: '<b>Ответ</b>\nВторая строка' };
  const response = await executeServiceCommand(db, dean, reply); assert((await executeServiceCommand(db, dean, reply)).replayed);
  const talkDetail = await getServiceRequest(db, student, response.id);
  assert.equal(talkDetail.history.at(-1).text, reply.text);
  assert.equal(await db.serviceEvent.count({ where: { requestId: talk.id, type: 'STAFF_REPLY' } }), 1);
  pass('All 49 staff status pairs, plain-text correspondence and deduplicated staff-reply event');
  const legacy = await command(student, { operation: 'CREATE', code: 'deanery-appeal' });
  const auditRows = Array.from({ length: 180 }, (_, i) => ({ requestId: legacy.id, actorId: student.id, actorName: student.name, action: i % 3 === 0 ? 'COMMENT' : 'SAVE', text: i % 3 === 0 ? 'Архивное сообщение ' + i : null, snapshotJson: JSON.stringify({ version: i + 2 }), createdAt: new Date(Date.now() + i + 1) }));
  await db.serviceHistory.createMany({ data: auditRows });
  const auditBefore = await db.serviceHistory.findMany({ where: { requestId: legacy.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const visible0 = await getServiceRequest(db, student, legacy.id, 0), visible1 = await getServiceRequest(db, student, legacy.id, 1);
  assert.equal(visible0.history.length, 50); assert.equal(visible0.historyHasMore, true);
  assert.equal(visible1.history.length, 11); assert.equal(visible1.historyHasMore, false);
  assert.equal(new Set([...visible0.history, ...visible1.history].map(h => h.id)).size, 61);
  assert([...visible0.history, ...visible1.history].every(h => h.action !== 'SAVE'));
  assert.deepEqual(await db.serviceHistory.findMany({ where: { requestId: legacy.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }), auditBefore);
  assert.equal((await getServiceRequest(db, student, legacy.id, 2)).history.length, 0);
  const exactPage = await command(student, { operation: 'CREATE', code: 'deanery-appeal' });
  await db.serviceHistory.createMany({ data: auditRows.filter(h => h.action !== 'SAVE').slice(0, 49).map(h => ({ ...h, requestId: exactPage.id })) });
  const exact = await getServiceRequest(db, student, exactPage.id); assert.equal(exact.history.length, 50); assert.equal(exact.historyHasMore, false);
  pass('Visible history filters SAVE before pagination, preserves legacy audit rows and handles exactly 50 events');
  const protectedRecords = async () => ({
    profiles: await db.studentProfile.findMany({ orderBy: { userId: 'asc' } }),
    users: await db.user.findMany({ orderBy: { id: 'asc' } }),
    photos: await db.studentOfficialPhoto.findMany(),
    military: await db.militaryRecord.findMany(),
  });
  const protectedBefore = await protectedRecords();
  for (const code of ['personal-change', 'military-change', 'withdrawal', 'pass-reissue', 'material-aid']) {
    let critical = await db.serviceRequest.findFirstOrThrow({ where: { serviceCode: code, status: 'SUBMITTED' } });
    critical = await command(dean, { operation: 'TRANSITION', id: critical.id, version: critical.version, status: 'IN_REVIEW' });
    critical = await command(dean, { operation: 'TRANSITION', ...critical, status: 'IN_PROGRESS' });
    await command(dean, { operation: 'TRANSITION', ...critical, status: 'COMPLETED', text: 'Тестовое исполнение без изменения других разделов' });
  }
  assert.deepEqual(await protectedRecords(), protectedBefore);
  pass('Completing data/military changes, withdrawal, pass reissue and aid preserves all official records');
  const first = (await listServiceRequests(db, student, { page: 0 })).items.find(x => x.status === 'SUBMITTED');
  await db.serviceGrant.updateMany({ where: { userId: dean.id }, data: { active: false } });
  await assert.rejects(() => getServiceRequest(db, dean, first.id), /недоступно/);
  await db.serviceGrant.updateMany({ where: { userId: dean.id }, data: { active: true, readFiles: false } });
  const militaryRequest = await db.serviceRequest.findFirstOrThrow({ where: { serviceCode: 'military-change' } });
  await db.serviceGrant.updateMany({ where: { userId: dean.id }, data: { readMilitary: false } });
  await assert.rejects(() => getServiceRequest(db, dean, militaryRequest.id), /недоступно/);
  await assert.rejects(() => downloadServiceDocument(db, dean, resultFileId, storage), /недоступно/);
  await db.deaneryDepartmentAssignment.deleteMany({ where: { userId: dean.id } });
  assert.equal((await listServiceRequests(db, dean, { page: 0 })).total, 0);
  await db.serviceGrant.create({ data: { userId: tech.id, departmentId: otherDepartment.id, category: 'FINANCE', readFiles: true } });
  assert.equal((await listServiceRequests(db, tech, { page: 0 })).total, 0);
  const authorityFile = resolve(root, 'authority.json');
  const authority = { routes: [{ serviceCode: 'material-aid', sourceDepartmentId: department.id, departmentId: department.id, active: true }], grants: [{ userId: tech.id, departmentId: department.id, category: 'FINANCE', readFiles: false, readMilitary: false, active: true }] };
  const provision = () => { writeFileSync(authorityFile, JSON.stringify(authority)); const result = spawnSync(process.execPath, ['--conditions=react-server', 'scripts/configure-services.mjs', authorityFile], { env: process.env, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); };
  provision(); provision();
  assert.equal(await db.serviceGrant.count({ where: { userId: tech.id, departmentId: department.id, category: 'FINANCE' } }), 1);
  const financialQueue = await listServiceRequests(db, tech, { page: 0 }); assert(financialQueue.total > 0);
  const financeDetail = await getServiceRequest(db, tech, financialQueue.items[0].id); assert.equal(financeDetail.category, 'FINANCE'); assert.deepEqual(financeDetail.documents, []);
  authority.grants[0].active = false; provision();
  assert.equal((await listServiceRequests(db, tech, { page: 0 })).total, 0);
  pass('Provisioning CLI is idempotent; explicit financial processor works and live revocation closes access');
  await db.militaryRecord.create({ data: { userId: student.id, departmentId: department.id, office: 'Изолированные сведения' } });
  assert.equal((await getMilitaryRecord(db, student, student.id)).office, 'Изолированные сведения');
  await assert.rejects(() => getMilitaryRecord(db, teacher, student.id), /недоступны/);
  await assert.rejects(() => getMilitaryRecord(db, admin, student.id), /недоступны/);
  pass('Live grant/department revocation, cross-department denial, file and military permissions');
  assert.equal(await militaryEligibility(db, other.id), 'UNKNOWN');
  await db.studentProfile.update({ where: { userId: other.id }, data: { gender: 'FEMALE' } });
  assert.equal(await militaryEligibility(db, other.id), 'UNKNOWN');
  const historical = await command(other, { operation: 'CREATE', code: 'military-change' });
  await db.militaryRecord.create({ data: { userId: other.id, departmentId: department.id, registrationStatus: 'NOT_REQUIRED', verifiedAt: new Date() } });
  assert.equal(await militaryEligibility(db, other.id), 'NOT_REQUIRED');
  await assert.rejects(() => command(other, { operation: 'CREATE', code: 'military-change' }), /не требуется/);
  await assert.rejects(() => submit(other, historical), /не требуется/);
  assert.equal((await getServiceRequest(db, other, historical.id)).id, historical.id);
  await db.militaryRecord.update({ where: { userId: other.id }, data: { registrationStatus: 'REQUIRED: подтверждённая ВУС' } });
  assert.equal(await militaryEligibility(db, other.id), 'REQUIRED');
  await command(other, { operation: 'CREATE', code: 'military-change' });
  pass('Verified military exemption only, female specialty, unknown status and historical ownership');
  const pdf = await PDFDocument.create(); pdf.addPage([200, 200]);
  const pdfBytes = Buffer.from(await pdf.save());
  const preparedPdf = await prepareServiceFile(pdfBytes, 'scan.pdf', 'application/pdf');
  const navigation = await navigationPdf();
  assert((await prepareServiceFile(navigation,'navigation.pdf','application/pdf')).bytes.equals(navigation));
  for (const [kind,value,variant] of [
    ['URI','javascript:alert(1)'], ['URI','data:text/html,test'], ['URI','file:///tmp/test'], ['URI','mailto:test@example.test'],
    ['URI',' javaScript:alert(1)'], ['URI','https://user:password@example.test'], ['URI','https://example.test/%0aevil'],
    ['Launch'], ['GoToR'], ['JavaScript'], ['SubmitForm'], ['Named'],
    ['URI','https://example.test','next'], ['GoTo',null,'cycle'], ['URI','https://example.test','open'],
  ]) await assert.rejects(() => actionPdf(kind,value,variant).then(bytes => prepareServiceFile(bytes,'danger.pdf','application/pdf')), /неподдерживаемое содержимое/);
  assert.equal((await prepareServiceFile(await actionPdf('GoTo',null,'open'),'internal-open.pdf','application/pdf')).mime,'application/pdf');
  pass('PDF classification accepts HTTP/HTTPS, outlines, internal destinations, notes and tagged attributes; denies unsafe schemes, scripts, actions, automatic external links and chains');
  const longName = 'Руководство HONOR & инструкция, (русская версия) ' + 'подробное описание '.repeat(6) + '.pdf';
  assert.equal((await prepareServiceFile(pdfBytes, longName, 'application/pdf')).name, longName);
  for (const name of ['../scan.pdf', 'folder\\scan.pdf', 'bad\u0000.pdf', 'bad\u202e.pdf', 'x'.repeat(256) + '.pdf']) await assert.rejects(() => prepareServiceFile(pdfBytes, name, 'application/pdf'));
  assert.equal(preparedPdf.mime, 'application/pdf'); assert(preparedPdf.bytes.equals(pdfBytes));
  await assert.rejects(() => prepareServiceFile(pdfBytes, 'scan.png', 'image/png'));
  await assert.rejects(() => prepareServiceFile(Buffer.from('%PDF-1.7\ninvalid\n%%EOF'), 'broken.pdf', 'application/pdf'), /повреждён/);
  await assert.rejects(() => prepareServiceFile(Buffer.from('%PDF-1.7'), 'truncated.pdf', 'application/pdf'), /повреждён/);
  await assert.rejects(() => prepareServiceFile(Buffer.alloc(20 * 1024 * 1024 + 1), 'large.pdf', 'application/pdf'), e => e.status === 413);
  const largePdf = await PDFDocument.create(), largePage = largePdf.addPage([200, 200]);
  largePage.node.set(PDFName.of('Contents'), largePdf.context.register(largePdf.context.stream(Buffer.alloc(19 * 1024 * 1024, 32))));
  const largeBytes = Buffer.from(await largePdf.save({ useObjectStreams: false }));
  assert(largeBytes.length > 19 * 1024 * 1024 && largeBytes.length < 20 * 1024 * 1024);
  assert.equal((await prepareServiceFile(largeBytes, 'large.pdf', 'application/pdf')).size, largeBytes.length);
  const bomb = await PDFDocument.create(), bombPage = bomb.addPage([200, 200]);
  bombPage.node.set(PDFName.of('Contents'), bomb.context.register(bomb.context.flateStream(Buffer.alloc(17 * 1024 * 1024, 32))));
  await assert.rejects(async () => prepareServiceFile(Buffer.from(await bomb.save()), 'bomb.pdf', 'application/pdf'), /превышает ограничения/);
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: 'JavaScript', JS: PDFString.of('alert(1)') }));
  await assert.rejects(async () => prepareServiceFile(Buffer.from(await pdf.save()), 'active.pdf', 'application/pdf'), /неподдерживаемое содержимое/);
  pass('Original PDF preserved, compressed objects parsed, active/corrupt/spoofed/oversize PDF rejected');
  for (const [data, name, mime] of [[Buffer.from('<script/>'), 'file.png', 'image/png'], [Buffer.from('MZ'), 'file.exe', 'image/png']]) await assert.rejects(() => prepareServiceFile(data, name, mime));
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const photo = await sharp(randomBytes(2000 * 1800 * 3), { raw: { width: 2000, height: 1800, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  assert(photo.length < 3.2 * 1024 * 1024); assert((await sharp(photo).png().toBuffer()).length > 8 * 1024 * 1024);
  const cleanedPhoto = await prepareServiceFile(Buffer.concat([photo, Buffer.from('<script>trailing</script>')]), 'photo.jpg', 'image/jpeg');
  assert.equal(cleanedPhoto.mime, 'image/jpeg'); assert.equal(cleanedPhoto.name, 'photo.jpg'); assert(cleanedPhoto.size < 8 * 1024 * 1024);
  assert(!cleanedPhoto.bytes.includes(Buffer.from('<script>trailing</script>'))); assert.equal((await sharp(cleanedPhoto.bytes).metadata()).format, 'jpeg');
  const tooManyPixels = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#71826a' } }).jpeg().toBuffer();
  await assert.rejects(() => prepareServiceFile(tooManyPixels, 'pixels.jpg', 'image/jpeg'), e => e.status === 413 && /20 миллионов пикселей/.test(e.message));
  await assert.rejects(() => prepareServiceFile(png, '../scan.png', 'image/png'));
  await assert.rejects(() => prepareServiceFile(png, 'scan.png', 'image/jpeg'));
  await assert.rejects(() => prepareServiceFile(Buffer.alloc(8 * 1024 * 1024 + 1), 'big.png', 'image/png'));
  assert.throws(() => localServiceStorage('public/uploads'));
  const brokenStorage = localServiceStorage(resolve(root, 'missing'));
  await assert.rejects(() => downloadServiceDocument(db, student, resultFileId, brokenStorage));
  assert.equal(await db.studentOfficialPhoto.count(), 0);
  assert.equal((await db.studentProfile.findUniqueOrThrow({ where: { userId: student.id } })).educationStatus, null);
  await db.user.update({ where: { id: student.id }, data: { role: 'TEACHER' } });
  await assert.rejects(() => getServiceRequest(db, student, state.id), /недоступно/);
  await db.user.update({ where: { id: student.id }, data: { role: 'STUDENT' } });
  const revoked = await db.session.create({ data: { userId: student.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  await db.session.delete({ where: { id: revoked.id } });
  await assert.rejects(() => getServiceRequest(db, { id: student.id, sessionId: revoked.id }, state.id), /Войдите/);
  pass('MIME/path/size/active content defenses, missing blob errors, no profile/photo/status side effects');

  // Real HTTP boundary, Better Auth, CSRF and binary upload/download against production build.
  const password = randomBytes(24).toString('base64url');
  await db.account.create({ data: { userId: student.id, accountId: student.id, providerId: 'credential', password: await hashPassword(password) } });
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r));
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { windowsHide: true, stdio: 'ignore', env: { ...process.env, BETTER_AUTH_URL: base, BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'), AUTH_TRUST_PROXY: 'false', AUTH_PROXY_SECRET: '', SERVICES_STORAGE_DIR: resolve(root, 'files') } });
  for (let n = 0; n < 120; n++) { try { if ((await fetch(base + '/login')).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  assert.equal((await fetch(base + '/api/services')).status, 401);
  const login = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: student.email, password }) }); assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
  const post = body => fetch(base + '/api/services', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/services', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const catalogue = await fetch(base + '/api/services?q=матпомощь', { headers: { Cookie: cookie } }); assert.equal(catalogue.headers.get('cache-control'), 'private, no-store'); assert.equal((await catalogue.json()).items[0].code, 'material-aid');
  const created = await post({ operation: 'CREATE', code: 'deanery-appeal', requestId: randomUUID() }); assert.equal(created.status, 200); let httpDraft = await created.json();
  const url = base + '/api/services?' + new URLSearchParams({ upload: '1', id: httpDraft.id, version: String(httpDraft.version), requestId: randomUUID(), slot: 'attachment', kind: 'STUDENT' });
  const uploaded = await fetch(url, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('Документ.png') }, body: png }); assert.equal(uploaded.status, 200); httpDraft = await uploaded.json();
  const downloaded = await fetch(base + '/api/services?view=file&id=' + httpDraft.documentId, { headers: { Cookie: cookie } }); assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get('content-type'), 'image/png'); assert(downloaded.headers.get('content-disposition').startsWith('attachment;')); assert((await downloaded.arrayBuffer()).byteLength);
  for (const denied of [other, tech, admin, teacher, empty, dean]) {
    await db.account.create({ data: { userId: denied.id, accountId: denied.id, providerId: 'credential', password: await hashPassword(password) } });
    const signed = await fetch(base + '/api/auth/sign-in/email', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: denied.email, password }) }); assert.equal(signed.status, 200);
    const deniedCookie = signed.headers.getSetCookie().map(x => x.split(';')[0]).join('; ');
    for (const view of ['request', 'file']) {
      const id = view === 'request' ? httpDraft.id : httpDraft.documentId;
      assert.equal((await fetch(base + '/api/services?' + new URLSearchParams({ view, id }), { headers: { Cookie: deniedCookie } })).status, 404, denied.role + ' HTTP denial');
    }
  }
  assert.equal((await fetch(base + '/api/services?view=request&id=' + randomUUID(), { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await post({ operation: 'SAVE', ...httpDraft, fields: { passport: 'forged' }, requestId: randomUUID(), replayed: undefined })).status, 400);
  const filesDir = resolve(root, 'files'), heldDir = resolve(root, 'files-held');
  assert(filesDir.startsWith(root + '\\') || filesDir.startsWith(root + '/'));
  const metadataBefore = await db.serviceDocument.count();
  renameSync(filesDir, heldDir); writeFileSync(filesDir, 'Test storage failure');
  try {
    const brokenUrl = base + '/api/services?' + new URLSearchParams({ upload: '1', id: httpDraft.id, version: String(httpDraft.version), requestId: randomUUID(), slot: 'attachment', kind: 'STUDENT' });
    const failed = await fetch(brokenUrl, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png', 'X-File-Name': 'scan.png' }, body: png });
    assert.equal(failed.status, 503); assert.equal(await db.serviceDocument.count(), metadataBefore);
  } finally { unlinkSync(filesDir); renameSync(heldDir, filesDir); }
  pass('Actual storage write failure returns 503 and commits no document metadata');
  pass('Production HTTP: Better Auth, anonymous denial, CSRF, private catalogue, upload/download and foreign IDs');
  const inspected = createClient({ url: process.env.DATABASE_URL });
  try { await integrity(inspected); } finally { inspected.close(); }
  assert.equal(await fingerprint(source), before, 'Main database changed');
  writeFileSync(resolve(root, 'results.json'), JSON.stringify({ passed: results, mainDatabaseUnchanged: true }, null, 2), { mode: 0o600 });
  console.info('Services verification passed; report: ' + root);
} finally { if (child) { child.kill(); await new Promise(r => child.once('exit', r)); } await db.$disconnect(); source.close(); }
