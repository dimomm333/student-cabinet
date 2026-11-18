// Disposable heap/time-limited validator. Never executes/extracts uploaded content.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync, crc32 } from 'node:zlib';
import { createRequire } from 'node:module';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const DecodeStream = require('pdf-lib/cjs/core/streams/DecodeStream.js').default;
const allocate = DecodeStream.prototype.ensureBuffer;
let allocated = 0;
DecodeStream.prototype.ensureBuffer = function (requested) {
  if (requested > 32 * 1048576) throw Error('LIMIT');
  if (requested > this.buffer.byteLength) { let capacity=this.minBufferLength; while(capacity<requested) capacity*=2; allocated+=capacity; if(allocated>128*1048576) throw Error('LIMIT'); }
  return allocate.call(this, requested);
};
const mimeTypes = { pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt:'text/plain; charset=utf-8', jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', zip:'application/zip' };
function invalid() { throw Error('INVALID'); }
function zipEntries(b) {
  if(b.length<22 || ![0x04034b50,0x06054b50].includes(b.readUInt32LE(0))) invalid();
  let end = -1;
  for (let p=b.length-22; p>=Math.max(0,b.length-65557); p--) if (b.readUInt32LE(p)===0x06054b50 && p+22+b.readUInt16LE(p+20)===b.length) { end=p; break; }
  if (end<0 || b.readUInt16LE(end+4) || b.readUInt16LE(end+6)) invalid();
  const count=b.readUInt16LE(end+10), start=b.readUInt32LE(end+16), length=b.readUInt32LE(end+12);
  if (count>2000 || count===65535) throw Error('LIMIT');
  if (b.readUInt16LE(end+8)!==count || start+length!==end) invalid();
  const entries=new Map(); let p=start, total=0;
  for(let i=0;i<count;i++) {
    if(p+46>end || b.readUInt32LE(p)!==0x02014b50) invalid();
    const flags=b.readUInt16LE(p+8), method=b.readUInt16LE(p+10), crc=b.readUInt32LE(p+16), compressed=b.readUInt32LE(p+20), size=b.readUInt32LE(p+24), n=b.readUInt16LE(p+28), extra=b.readUInt16LE(p+30), comment=b.readUInt16LE(p+32), offset=b.readUInt32LE(p+42);
    if(p+46+n+extra+comment>end || flags&1 || ![0,8].includes(method)) invalid();
    const name=b.subarray(p+46,p+46+n).toString('utf8');
    if(!name || /[\\:\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || entries.has(name) || /\.(exe|dll|com|scr|msi|bat|cmd|ps1|vbs)$/i.test(name) || (b.readUInt32LE(p+38)>>>16 & 0xf000)===0xa000) invalid();
    total+=size;
    if(size>64*1048576 || total>128*1048576 || size>Math.max(compressed*200,1048576)) throw Error('LIMIT');
    if(offset+30>start || b.readUInt32LE(offset)!==0x04034b50 || b.readUInt16LE(offset+8)!==method || b.readUInt16LE(offset+6)!==flags) invalid();
    if(!(flags&8) && (b.readUInt32LE(offset+14)!==crc || b.readUInt32LE(offset+18)!==compressed || b.readUInt32LE(offset+22)!==size)) invalid();
    const localNameLength=b.readUInt16LE(offset+26), begin=offset+30+localNameLength+b.readUInt16LE(offset+28);
    if(b.subarray(offset+30,offset+30+localNameLength).toString('utf8')!==name || begin+compressed>start) invalid();
    const raw=b.subarray(begin,begin+compressed), content=method===8 ? inflateRawSync(raw,{maxOutputLength:Math.max(1,Math.min(size+1,64*1048576))}) : raw;
    if(content.length!==size || crc32(content)!==crc) invalid();
    // Retain only bounded XML metadata; nested archives are never expanded.
    if(/\.(zip|7z|rar|gz)$/i.test(name)) invalid();
    entries.set(name, /^(\[Content_Types\]\.xml|word\/document\.xml|ppt\/presentation\.xml|xl\/workbook\.xml)$/.test(name) ? content.subarray(0,1048576).toString('utf8') : '');
    p+=46+n+extra+comment;
  }
  if(p!==end) invalid(); return entries;
}
try {
  const [path,name,limit]=process.argv.slice(2), ext=name.split('.').pop().toLowerCase(); let mime=mimeTypes[ext];
  if(!mime) invalid();
  const b=await readFile(path); if(!b.length || b.length>Number(limit)) throw Error('LIMIT');
  if(ext==='txt') { let text; if(b[0]===255 && b[1]===254) { text=new TextDecoder('utf-16le',{fatal:true}).decode(b); mime='text/plain; charset=utf-16le'; } else if(b[0]===254 && b[1]===255) { text=new TextDecoder('utf-16be',{fatal:true}).decode(b); mime='text/plain; charset=utf-16be'; } else { try { text=new TextDecoder('utf-8',{fatal:true}).decode(b); } catch { text=new TextDecoder('windows-1251',{fatal:true}).decode(b); mime='text/plain; charset=windows-1251'; } } if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) || /^\s*(<!doctype html|<html|<script|<svg|MZ)/i.test(text)) invalid(); }
  else if(['jpg','jpeg','png'].includes(ext)) {
    const image=sharp(b,{limitInputPixels:40000000,failOn:'warning',animated:false}), meta=await image.metadata();
    if(meta.format!==(ext==='png'?'png':'jpeg') || (meta.pages??1)>1) invalid(); await image.stats();
  } else if(ext==='pdf') {
    if(!/^%PDF-[12]\./.test(b.subarray(0,12).toString()) || !/%%EOF\s*$/.test(b.subarray(-1024).toString())) invalid();
    const pdf=await PDFDocument.load(b,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});
    if(pdf.getPageCount()>2000 || pdf.context.enumerateIndirectObjects().length>80000) throw Error('LIMIT');
    const forbidden=new Set(['JavaScript','JS','Launch','EmbeddedFile','EmbeddedFiles','RichMedia','XFA','GoToE','SubmitForm','ImportData']);
    const seen=new Set(); let nodes=0;
    function check(value,depth=0) {
      if(++nodes>300000 || depth>80) throw Error('LIMIT');
      if(!value || seen.has(value)) return; seen.add(value);
      if(value instanceof PDFName && forbidden.has(value.decodeText())) invalid();
      if(value instanceof PDFRawStream) check(value.dict,depth+1);
      else if(value instanceof PDFDict) {
        const uri=pdf.context.lookup(value.get(PDFName.of('URI')));
        if(uri && typeof uri.decodeText==='function' && /^(?:javascript|data|file|vbscript):/i.test(uri.decodeText().replace(/[\x00-\x20]/g,''))) invalid();
        for(const [k,v] of value.entries()) { check(k,depth+1);check(v,depth+1); }
      }
      else if(value instanceof PDFArray) for(const v of value.asArray()) check(v,depth+1);
    }
    for(const [,obj] of pdf.context.enumerateIndirectObjects()) check(obj);
  } else if(['doc','ppt','xls'].includes(ext)) {
    if(!b.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')) || b.length<512 || b.readUInt16LE(28)!==0xfffe || ![9,12].includes(b.readUInt16LE(30))) invalid();
    const sector=2**b.readUInt16LE(30), sectorBytes=id=>{ const offset=(id+1)*sector; if(offset+sector>b.length) invalid(); return b.subarray(offset,offset+sector); };
    const fats=[]; for(let i=0;i<109;i++) { const id=b.readUInt32LE(76+i*4); if(id<0xfffffffa) fats.push(sectorBytes(id)); }
    // Large CFB containers can extend DIFAT; bound and follow those chains too.
    let difat=b.readUInt32LE(68);const seenDifat=new Set();
    while(difat<0xfffffffa) { if(seenDifat.has(difat) || seenDifat.size>256) invalid();seenDifat.add(difat); const block=sectorBytes(difat);for(let i=0;i<sector-4;i+=4) {const id=block.readUInt32LE(i);if(id<0xfffffffa) fats.push(sectorBytes(id));}difat=block.readUInt32LE(sector-4); }
    const directoryEntries=[],seenDirectory=new Set();let directory=b.readUInt32LE(48);
    while(directory<0xfffffffa) {
      if(seenDirectory.has(directory) || seenDirectory.size>2048) invalid();seenDirectory.add(directory);const block=sectorBytes(directory);
      for(let p=0;p+128<=sector;p+=128) {const len=block.readUInt16LE(p+64);directoryEntries.push({name:len>=2&&len<=64?block.subarray(p,p+len-2).toString('utf16le'):'',type:block[p+66],left:block.readUInt32LE(p+68),right:block.readUInt32LE(p+72),child:block.readUInt32LE(p+76)});}
      const fat=fats[Math.floor(directory/(sector/4))];if(!fat) invalid();directory=fat.readUInt32LE(directory%(sector/4)*4);
    }
    if(directoryEntries[0]?.type!==5) invalid();
    const streams=[],seenSiblings=new Set(),pending=[directoryEntries[0].child];
    while(pending.length) {const id=pending.pop();if(id===0xffffffff)continue;if(seenSiblings.has(id)||!directoryEntries[id])invalid();seenSiblings.add(id);const entry=directoryEntries[id];if(entry.type===2)streams.push(entry.name);else if(entry.type!==1)invalid();pending.push(entry.left,entry.right);}
    if(!streams.includes(({doc:'WordDocument',ppt:'PowerPoint Document',xls:'Workbook'})[ext]) && !(ext==='xls' && streams.includes('Book'))) invalid();
  } else {
    const entries=zipEntries(b);
    if(ext!=='zip') {
      const main=({docx:'word/document.xml',pptx:'ppt/presentation.xml',xlsx:'xl/workbook.xml'})[ext];
      const types=entries.get('[Content_Types].xml')??'';
      if(!entries.has(main) || !types.includes('openxmlformats-officedocument') || !types.includes(main) || /macroEnabled|vbaProject/i.test(types) || [...entries.keys()].some(n=>/vbaProject|activeX\//i.test(n))) invalid();
    }
  }
  process.stdout.write(JSON.stringify({mime,sha256:createHash('sha256').update(b).digest('hex')}));
} catch(error) { process.stdout.write(error.message==='LIMIT' || /larger than|buffer length/i.test(error.message)?'LIMIT':'INVALID');process.exitCode=1; }
