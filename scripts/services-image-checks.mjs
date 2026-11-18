import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { expect } from '@playwright/test';

export async function verifyImagePreparation({ page, db, base, root }) {
  await page.goto(base + '/dashboard/services?service=deanery-appeal');
  await page.getByRole('button', { name: 'Создать черновик', exact: true }).click();
  await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy', 'false');
  const id = new URL(page.url()).searchParams.get('requestId'), results = [];
  await page.getByLabel(/^Тема/).fill('Автоматическая подготовка сканов'); await page.getByLabel(/^Вопрос/).fill('Проверка размера и качества');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000"><rect width="6000" height="4000" fill="white"/><rect x="0" y="0" width="200" height="200" fill="red"/><rect x="5800" y="0" width="200" height="200" fill="blue"/><g font-family="DejaVu Sans" fill="black">${[12,16,24,32].map((size,i)=>`<text x="300" y="${300+i*80}" font-size="${size}">Скан документа: мелкий текст 0123456789 / Small document text</text>`).join('')}</g></svg>`);
  const scan = await sharp(svg).jpeg({ quality: 98 }).toBuffer();
  const rotated = await sharp(scan).withMetadata({ orientation: 6 }).jpeg({ quality: 98 }).toBuffer();
  const transparent = await sharp({ create: { width: 6000, height: 4000, channels: 4, background: '#00000000' } }).composite([{ input: Buffer.from('<svg width="300" height="300"><rect width="300" height="300" fill="green"/></svg>'), top: 0, left: 0 }]).withMetadata({ orientation: 6 }).png().toBuffer();
  const normal = await sharp(scan).resize(1200,800).jpeg().toBuffer();
  // Observe preparation itself before the real browser decoder continues.
  await page.evaluate(() => {
    globalThis.originalImageBitmap = globalThis.createImageBitmap; globalThis.createImageBitmap = async (...args) => { await new Promise(r => setTimeout(r, 500)); return globalThis.originalImageBitmap(...args); };
    globalThis.originalImageSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      if (body instanceof File && body.name === 'normal.jpg') globalThis.normalSentHash = body.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes)).then(hash => Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,'0')).join(''));
      return globalThis.originalImageSend.call(this, body);
    };
  });
  const upload = async (name, mime, buffer, viewport) => {
    await page.setViewportSize({ width: viewport, height: 900 });
    const response = page.waitForResponse(r => r.url().includes('upload=1'));
    await page.getByLabel(/^Загрузить:/).setInputFiles({ name, mimeType: mime, buffer });
    if (name !== 'normal.jpg') {
      await expect(page.locator('.services-upload-progress')).toContainText('Подготовка изображения');
      await expect(page.getByRole('progressbar', { name: 'Прогресс загрузки' })).not.toHaveAttribute('value');
    }
    const http = await response; assert.equal(http.status(), 200, await http.text());
    if (name === 'normal.jpg') assert.equal(await page.evaluate(() => globalThis.normalSentHash),createHash('sha256').update(buffer).digest('hex'),'Small JPEG must not be re-encoded by the client');
    await expect(page.locator('.services-file a').filter({ hasText: name })).toBeVisible(); await expect(page.locator('.services-upload-progress')).toHaveCount(0); await expect(page.locator('.services-error')).toHaveCount(0);
    const document = await db.serviceDocument.findFirstOrThrow({ where: { requestId: id, name, removedAt: null } });
    const bytes = readFileSync(resolve(root,'files',document.key)), meta = await sharp(bytes).metadata(), before = await sharp(buffer).metadata();
    assert(meta.width * meta.height <= 20_000_000); assert.equal(document.mime, mime); assert(document.size <= 8*1024*1024);
    results.push({ name, before: [before.width,before.height], after: [meta.width,meta.height], bytes: document.size, viewport, http: http.status() });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    return { bytes, meta };
  };
  const prepared = await upload('scan-24mp.jpg','image/jpeg',scan,360);
  assert.deepEqual([prepared.meta.width,prepared.meta.height],[5196,3464]);
  await sharp(scan).extract({ left: 280, top: 250, width: 1400, height: 380 }).toFile(resolve(root,'scan-before.png'));
  await sharp(prepared.bytes).extract({ left: 242, top: 216, width: 1212, height: 329 }).toFile(resolve(root,'scan-after.png'));
  const oriented = await upload('rotated-24mp.jpg','image/jpeg',rotated,1366);
  assert.deepEqual([oriented.meta.width,oriented.meta.height],[3464,5196]);
  const corner = await sharp(await sharp(oriented.bytes).extract({left:oriented.meta.width-80,top:20,width:40,height:40}).toBuffer()).stats(); assert(corner.channels[0].mean > 200 && corner.channels[1].mean < 80);
  const alpha = await upload('transparent-24mp.png','image/png',transparent,360);
  assert.deepEqual([alpha.meta.width,alpha.meta.height],[3464,5196]);
  assert(alpha.meta.hasAlpha); const pixel=await sharp(alpha.bytes).extract({left:3000,top:3000,width:1,height:1}).raw().toBuffer(); assert.equal(pixel[3],0);
  const green=await sharp(alpha.bytes).extract({left:alpha.meta.width-80,top:20,width:1,height:1}).raw().toBuffer(); assert(green[1] > 80 && green[3] > 200);
  const unchanged = await upload('normal.jpg','image/jpeg',normal,1366); assert.deepEqual([unchanged.meta.width,unchanged.meta.height],[1200,800]);
  await page.evaluate(() => { globalThis.createImageBitmap = globalThis.originalImageBitmap; });
  // Retrying a resized upload after a committed-but-lost response is idempotent.
  let lost = false;
  await page.route('**/api/services?upload=*', async route => { if (!lost) { lost=true; await route.fetch(); await route.abort(); } else await route.continue(); });
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'retry-large.jpg',mimeType:'image/jpeg',buffer:scan});
  await expect(page.locator('.services-upload-progress')).toContainText('Ошибка');
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'retry-large.jpg',mimeType:'image/jpeg',buffer:scan});
  await expect(page.locator('.services-file a').filter({hasText:'retry-large.jpg'})).toBeVisible(); await expect(page.locator('.services-upload-progress')).toHaveCount(0);
  assert.equal(await db.serviceDocument.count({where:{requestId:id,name:'retry-large.jpg'}}),1); await page.unroute('**/api/services?upload=*');
  let writes=0; const count = request => { if(request.url().includes('upload=1')) writes++; }; page.on('request',count);
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'broken.jpg',mimeType:'image/jpeg',buffer:Buffer.from([255,216,255,0])});
  await expect(page.locator('.services-error')).toContainText('Не удалось прочитать размеры JPEG'); assert.equal(writes,0);
  await page.evaluate(() => { globalThis.createImageBitmap = async () => { throw new DOMException('Недостаточно памяти для декодирования','InvalidStateError'); }; });
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'memory.jpg',mimeType:'image/jpeg',buffer:scan});
  await expect(page.locator('.services-error')).toContainText('Недостаточно памяти'); assert.equal(writes,0);
  await page.evaluate(() => { globalThis.createImageBitmap = globalThis.originalImageBitmap; });
  const raw = Buffer.alloc(6000*4000*3,255); randomBytes(6000*1400*3).copy(raw);
  const oversized = await sharp(raw,{raw:{width:6000,height:4000,channels:3}}).png().toBuffer();
  assert(oversized.length < 32*1024*1024);
  await page.getByLabel(/^Загрузить:/).setInputFiles({name:'too-dense.png',mimeType:'image/png',buffer:oversized});
  await expect(page.locator('.services-error')).toContainText('всё ещё превышает 8 МиБ', { timeout: 20000 }); assert.equal(writes,0); page.off('request',count);
  // Bypassing client preparation still cannot bypass the server's pixel limit.
  const version=(await db.serviceRequest.findUniqueOrThrow({where:{id}})).version;
  const direct=await page.context().request.post(base+'/api/services?'+new URLSearchParams({upload:'1',id,version:String(version),requestId:crypto.randomUUID(),slot:'attachment',kind:'STUDENT'}),{headers:{Origin:base,'Content-Type':'image/jpeg','X-File-Name':'bypass.jpg'},data:scan});
  assert.equal(direct.status(),413); assert.match((await direct.json()).error,/20 миллионов пикселей/);
  assert.equal(await db.serviceDocument.count({where:{requestId:id,name:'bypass.jpg'}}),0);
  await page.evaluate(() => { XMLHttpRequest.prototype.send = globalThis.originalImageSend; });
  await page.reload(); await expect(page.locator('.services-detail')).toHaveAttribute('aria-busy','false'); await expect(page.locator('.services-file a').filter({hasText:'scan-24mp.jpg'})).toBeVisible();
  assert.equal(await db.serviceHistory.count({where:{requestId:id,action:'UPLOAD'}}),5);
  writeFileSync(resolve(root,'image-preparation.json'),JSON.stringify({results,serverBypassStatus:direct.status(),failedPreparationUploads:writes,duplicateDocuments:0},null,2));
  console.info('PASS: Browser image preparation: 24 Mp JPEG/EXIF/transparent PNG/text scan, unchanged normal JPEG, failure/no upload, retry, 360/1366 px and unchanged server pixel guard');
}
