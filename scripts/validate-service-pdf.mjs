// Runs in a disposable, heap-limited process. Never renders or executes PDF code.
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFInvalidObject, PDFString, PDFHexString, PDFNumber, PDFNull } from 'pdf-lib';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
// pdf-lib 1.17.1 uses this allocator for all decoded streams, including object
// streams parsed during load(). Bound expansion before allocating, not afterwards.
const DecodeStream = require('pdf-lib/cjs/core/streams/DecodeStream.js').default;
const { decodePDFRawStream } = require('pdf-lib/cjs/core/streams/decode.js');
const allocate = DecodeStream.prototype.ensureBuffer;
let allocated = 0;
DecodeStream.prototype.ensureBuffer = function (requested) {
  if (!Number.isSafeInteger(requested) || requested > 16 * 1024 * 1024) throw Error('LIMIT');
  if (requested > this.buffer.byteLength) {
    let capacity = this.minBufferLength;
    while (capacity < requested) capacity *= 2;
    allocated += capacity;
    if (allocated > 64 * 1024 * 1024) throw Error('LIMIT');
  }
  return allocate.call(this, requested);
};
const chunks = []; let size = 0;
for await (const chunk of process.stdin) { size += chunk.length; if (size > 20 * 1024 * 1024) process.exit(1); chunks.push(chunk); }
try {
  const bytes = Buffer.concat(chunks);
  if (!/^%PDF-1\.[0-7][\r\n]/.test(bytes.subarray(0, 10).toString('latin1')) || !/%%EOF\s*$/.test(bytes.subarray(-32).toString('latin1'))) throw Error();
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, capNumbers: true });
  if (pdf.isEncrypted) throw Error('ENCRYPTED');
  const objects = pdf.context.enumerateIndirectObjects();
  if (objects.length > 20000) throw Error('LIMIT');
  const forbidden = new Set(['JavaScript', 'JS', 'AA', 'Launch', 'GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition', 'RichMedia', 'RichMediaExecute', 'Movie', 'Sound', 'EmbeddedFile', 'EmbeddedFiles', 'Filespec', 'EF', 'XFA', 'AcroForm', 'Encrypt', 'JBIG2Decode', 'ObjStm', '3D', '3DD', '3DA', '3DV', 'GoTo3DView', 'Screen', 'Widget', 'PostScript', 'PS', 'OPI', 'Collection', 'ResetForm', 'Hide']);
  const lookup = value => value instanceof PDFRef ? pdf.context.lookup(value) : value;
  const entry = (dict, key) => lookup(dict.get(PDFName.of(key)));
  const name = value => value instanceof PDFName ? value.decodeText() : '';
  const text = value => value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
  const unsupported = () => { throw Error('UNSUPPORTED'); };
  const pages = pdf.getPages();
  const pageObjects = new Set(pages.map(page => page.node));
  function destination(raw) {
    const value = lookup(raw);
    if (value instanceof PDFName || text(value) !== null) {
      if ((name(value) || text(value)).length > 4096) throw Error('LIMIT');
      return; // Named destination: no executable content.
    }
    if (!(value instanceof PDFArray) || value.size() < 2 || value.size() > 6) unsupported();
    if (!pageObjects.has(lookup(value.get(0)))) unsupported();
    const mode = name(lookup(value.get(1)));
    const lengths = { XYZ: 5, Fit: 2, FitH: 3, FitV: 3, FitR: 6, FitB: 2, FitBH: 3, FitBV: 3 };
    if (lengths[mode] !== value.size()) unsupported();
    for (let i=2; i<value.size(); i++) {
      const coordinate = lookup(value.get(i));
      if (coordinate !== PDFNull && !(coordinate instanceof PDFNumber && Number.isFinite(coordinate.asNumber()))) unsupported();
    }
  }
  function httpUri(value, base) {
    const uri = text(value);
    if (!uri || uri.length > 8192 || uri !== uri.trim() || /[\x00-\x1f\x7f\\]/.test(uri) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(uri)) unsupported();
    if (!base && !/^https?:\/\//i.test(uri)) unsupported();
    if (!/^https?:\/\//i.test(uri) && /:|%3a/i.test(uri.split(/[/?#]/)[0])) unsupported();
    let url; try { url = new URL(uri, base); } catch { unsupported(); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) unsupported();
    return url.href;
  }
  let baseUri;
  const uriInfo = entry(pdf.catalog,'URI');
  if (uriInfo) {
    if (!(uriInfo instanceof PDFDict)) unsupported();
    const base = entry(uriInfo,'Base');
    if (base) baseUri = httpUri(base);
  }
  const actionPath = new Set(), checkedActions = new Set(); let actionNodes = 0;
  function action(raw, depth = 0) {
    if (depth > 60 || ++actionNodes > 150000) throw Error('LIMIT');
    const dict = lookup(raw);
    if (!(dict instanceof PDFDict) || actionPath.has(dict)) unsupported();
    if (checkedActions.has(dict)) return;
    actionPath.add(dict);
    const kind = name(entry(dict,'S'));
    const keys = kind === 'URI' ? ['Type','S','URI','IsMap','Next'] : kind === 'GoTo' ? ['Type','S','D','Next'] : kind === 'Named' ? ['Type','S','N','Next'] : [];
    if (!keys.length || dict.keys().some(key => !keys.includes(key.decodeText()))) unsupported();
    if (kind === 'URI') httpUri(entry(dict,'URI'),baseUri);
    if (kind === 'GoTo') destination(dict.get(PDFName.of('D')));
    if (kind === 'Named' && !['NextPage','PrevPage','FirstPage','LastPage'].includes(name(entry(dict,'N')))) unsupported();
    const next = entry(dict,'Next');
    if (next instanceof PDFArray) for (const item of next.asArray()) action(item,depth+1);
    else if (next) action(next,depth+1);
    actionPath.delete(dict); checkedActions.add(dict);
  }
  function classify(dict) {
    if (dict.has(PDFName.of('A'))) {
      const target = entry(dict,'A');
      // /A is also used for non-action structure attributes in tagged PDFs.
      if (target instanceof PDFDict && target.has(PDFName.of('S')) || name(entry(dict,'Type')) === 'Annot' || name(entry(dict,'Subtype')) === 'Link' || dict.has(PDFName.of('Title'))) action(target);
    }
    if (name(entry(dict,'Type')) === 'Action' || ['URI','GoTo','GoToR','GoToE','Named','Launch','JavaScript','SubmitForm','ImportData','SetOCGState','Thread','Trans'].includes(name(entry(dict,'S')))) action(dict);
    if (dict.has(PDFName.of('OpenAction'))) {
      const target = entry(dict,'OpenAction');
      if (target instanceof PDFDict) { if (name(entry(target,'S')) !== 'GoTo' || target.has(PDFName.of('Next'))) unsupported(); action(target); }
      else destination(target);
    }
  }
  // ObjStm containers have already been parsed by pdf-lib; their decoded objects
  // are inspected separately. Reject containers to keep the accepted subset small.
  const visited = new Set(), jpegStreams = []; let nodes = 0;
  function check(object, depth = 0) {
    if (!object || depth > 60 || ++nodes > 150000) throw Error('LIMIT');
    if (object instanceof PDFRef) { const resolved = pdf.context.lookup(object); if (!resolved) throw Error(); return; }
    if (visited.has(object)) return; visited.add(object);
    if (object instanceof PDFInvalidObject) throw Error();
    if (object instanceof PDFName && forbidden.has(object.decodeText())) throw Error('UNSUPPORTED');
    if (object instanceof PDFRawStream) {
      if (object.dict.has(PDFName.of('F'))) throw Error('UNSUPPORTED'); // External stream source.
      if (object.getContentsSize() > 20 * 1024 * 1024) throw Error('LIMIT');
      check(object.dict, depth + 1);
      // Decode embedded JPEG bytes only; the PDF itself never goes to Sharp.
      if (object.dict.lookup(PDFName.of('Filter')) === PDFName.of('DCTDecode')) jpegStreams.push(object.getContents());
      else {
        const filters = object.dict.lookup(PDFName.of('Filter'));
        const supported = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);
        for (const filter of filters instanceof PDFArray ? filters.asArray() : filters ? [filters] : []) {
          if (!(filter instanceof PDFName) || !supported.has(filter.decodeText())) throw Error('UNSUPPORTED');
        }
        decodePDFRawStream(object).getBytes();
      }
    }
    else if (object instanceof PDFDict) { classify(object); for (const [key, value] of object.entries()) { check(key, depth + 1); check(value, depth + 1); } }
    else if (object instanceof PDFArray) for (const value of object.asArray()) check(value, depth + 1);
  }
  for (const [, object] of objects) check(object);
  let pixels = 0;
  for (const bytes of jpegStreams) {
    const image = sharp(bytes, { limitInputPixels: 20000000, failOn: 'warning', animated: false });
    const meta = await image.metadata();
    if (meta.format !== 'jpeg' || !meta.width || !meta.height || (pixels += meta.width * meta.height) > 40000000) throw Error();
    await image.stats();
  }
  if (!pages.length) throw Error();
  if (pages.length > 200) throw Error('LIMIT');
  for (const page of pages) { const { width, height } = page.getSize(); if (!Number.isFinite(width + height) || width <= 0 || height <= 0 || width > 14400 || height > 14400) throw Error(); }
  process.stdout.write('OK');
} catch (error) {
  const code = error.name === 'EncryptedPDFError' ? 'ENCRYPTED' : ['LIMIT', 'UNSUPPORTED', 'ENCRYPTED'].includes(error.message) ? error.message : 'DAMAGED';
  process.stdout.write(code); process.exitCode = 1;
}
