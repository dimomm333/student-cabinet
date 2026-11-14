import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MAX_OFFICIAL_PHOTO_BYTES, prepareOfficialPhoto } from '../src/lib/student-photo.ts';

for(const [format,mime] of [['jpeg','image/jpeg'],['png','image/png'],['webp','image/webp']]) {
  const input=await sharp({create:{width:40,height:50,channels:3,background:'#739064'}})[format]().withMetadata().toBuffer();
  const photo=await prepareOfficialPhoto(input,mime);
  const metadata=await sharp(photo.content).metadata();
  assert.equal(metadata.format,'jpeg'); assert.equal(metadata.width,40); assert.equal(metadata.height,50);
  assert.equal(metadata.exif,undefined); assert.equal(photo.mimeType,'image/jpeg');
  await assert.rejects(()=>prepareOfficialPhoto(input, mime==='image/png'?'image/jpeg':'image/png'));
}
for(const input of [Buffer.alloc(0), Buffer.from('not a photo'), Buffer.alloc(MAX_OFFICIAL_PHOTO_BYTES+1), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]) {
  await assert.rejects(()=>prepareOfficialPhoto(input,'image/png'));
}
await assert.rejects(()=>prepareOfficialPhoto(Buffer.from('abc'),'image/svg+xml'));
const large=await sharp({create:{width:4100,height:4100,channels:3,background:'#fff'}}).png().toBuffer();
await assert.rejects(()=>prepareOfficialPhoto(large,'image/png'));
const valid=await sharp({create:{width:400,height:600,channels:3,background:'#fff'}}).png().toBuffer();
await assert.rejects(()=>prepareOfficialPhoto(valid.subarray(0,Math.floor(valid.length/2)),'image/png'));
// Two-frame GIF renamed PNG must fail, as must even a genuine animated WebP.
const frames=Buffer.alloc(20*40*3,255); frames.fill(50,20*20*3);
const animated=await sharp(frames,{raw:{width:20,height:40,channels:3,pageHeight:20}}).webp({loop:0,delay:[100,100]}).toBuffer();
assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2,'Fixture must contain two frames');
await assert.rejects(()=>prepareOfficialPhoto(animated,'image/webp'));
console.info('PASS: JPEG/PNG/WebP decoding, MIME mismatch, EXIF stripping, invalid/truncated/SVG/animated input, byte/pixel limits');
