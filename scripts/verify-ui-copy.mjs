import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { practicalDemoNews } from '../prisma/schedule-seed.ts';
import { presentNews } from '../src/lib/news-presentation.ts';
import { presentAcademicText } from '../src/lib/presentation-copy.ts';
import { serviceCatalog } from '../src/lib/services-catalog.ts';

const snapshot = JSON.stringify(practicalDemoNews);
for (const item of practicalDemoNews) {
  const shown = presentNews(item);
  assert.equal(shown.id, item.id);
  assert.equal(shown.isDemo, true);
  assert.equal(shown.publishedAt, item.publishedAt);
  assert(!/демонстрац|вымышлен|прототип|учебный пример/i.test(shown.title + shown.content));
  assert.equal(presentNews({ ...item, isDemo: false }).content, item.content);
  const edited = { ...item, title: 'Изменённая публикация', content: 'Важное предупреждение. Образец документа.' };
  assert.deepEqual(presentNews(edited), edited);
}
assert.equal(JSON.stringify(practicalDemoNews), snapshot, 'Stored fixtures must stay untouched');
assert(presentNews(practicalDemoNews[1]).content.includes('14 ноября'));
assert(presentNews(practicalDemoNews[2]).content.includes('Сверьте документы и сроки'));
assert.equal(presentAcademicText('Демонстрационная экзаменационная попытка'), 'Экзаменационная попытка');
assert.equal(presentAcademicText('Учебный пример · осень 2026'), 'Осень 2026');
for (const value of ['Образец', 'Образец документа', 'Отказ: отсутствует подтверждение', 'Демонстрационная работа студента', 'Оценка: 42,5', 'Дата экзамена не назначена', '__proto__', 'constructor', 'toString']) {
  assert.equal(presentAcademicText(value), value);
  const unknown = { ...practicalDemoNews[0], id: value };
  assert.equal(presentNews(unknown), unknown);
}
for (const config of serviceCatalog) {
  assert(!/демонстрац/i.test(JSON.stringify(config)));
  assert(config.description.includes('требуют утверждения университетом'), 'Unapproved service requirements must stay explicit');
}
const source = path => readFileSync(path, 'utf8');
for (const path of ['src/components/workspace-pages.tsx', 'src/app/dashboard/[section]/page.tsx']) {
  assert(source(path).includes('Раздел в разработке. Его функции пока недоступны.'));
  assert(!source(path).includes('проверкой прав доступа'));
}
assert(source('src/components/services-request-screen.tsx').includes('Подтверждаю актуальность показанных официальных данных'));
assert(!source('src/components/student-home.tsx').includes('Привет,'));
assert(source('src/components/schedule-editor.tsx').includes('Подтверждаю действие'));
assert(source('src/components/brs-workspace.tsx').includes('defaultValue={dialogAttempt?.comment ?? dialogResult?.comment ?? ""}'), 'Editing must retain original stored comments');
console.info('PASS: exact fixture display aliases, original records/flags, unknown text, service conditions and confirmations preserved');
