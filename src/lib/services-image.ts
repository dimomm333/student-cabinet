// Client preparation is a convenience, never a substitute for Sharp validation.
const MAX_FILE = 8 * 1024 * 1024;
const MAX_INPUT = 32 * 1024 * 1024;
const HEADER_BYTES = 1024 * 1024;
const SERVER_PIXELS = 20_000_000;
const TARGET_PIXELS = 18_000_000;
const MAX_DECODE_PIXELS = 64_000_000;

function orientation(bytes: Uint8Array, start: number, end: number) {
  if (end - start < 14) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(start) === 0x4949;
  if (!little && view.getUint16(start) !== 0x4d4d) return 1;
  if (view.getUint16(start + 2, little) !== 42) return 1;
  const offset = start + view.getUint32(start + 4, little);
  if (offset < start + 8 || offset + 2 > end) return 1;
  const count = view.getUint16(offset, little);
  for (let i = 0; i < Math.min(count, 512); i++) {
    const tag = offset + 2 + i * 12;
    if (tag + 12 > end) return 1;
    if (view.getUint16(tag, little) === 0x112 && view.getUint16(tag + 2, little) === 3 && view.getUint32(tag + 4, little) === 1) {
      const value = view.getUint16(tag + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

function dimensions(bytes: Uint8Array, mime: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20), rotate: 1 };
  }
  if (mime !== "image/jpeg" || bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Тип файла не совпадает с содержимым PNG/JPEG или изображение повреждено.");
  let offset = 2, width = 0, height = 0, rotate = 1;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 2) === 0x45786966 && view.getUint16(offset + 6) === 0) rotate = orientation(bytes, offset + 8, offset + length);
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); }
    offset += length;
  }
  if (!width || !height) throw new Error("Не удалось прочитать размеры JPEG. Файл повреждён, имеет неподдерживаемый формат или слишком большой заголовок.");
  return { width, height, rotate };
}

export async function prepareServiceImage(file: File): Promise<File> {
  if (!file.size || file.size > MAX_INPUT) throw new Error("Для подготовки выберите PNG/JPEG размером до 32 МиБ; файл не должен быть пустым.");
  const size = dimensions(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer()), file.type);
  if (file.type === "image/png") {
    // Skip pixel data without reading it: eXIf can also follow IDAT chunks.
    let offset = 8, count = 0;
    while (offset + 12 <= file.size) {
      if (++count > 4096) throw new Error("Слишком сложная структура PNG для подготовки в браузере.");
      const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
      const length = header.getUint32(0), type = header.getUint32(4);
      if (offset + length + 12 > file.size) throw new Error("PNG повреждён: некорректная длина блока.");
      if (type === 0x6163544c) throw new Error("Анимированные PNG не поддерживаются. Выберите статическое изображение.");
      if (type === 0x65584966) {
        if (length > 65536) throw new Error("Метаданные ориентации PNG слишком велики.");
        const exif = new Uint8Array(await file.slice(offset + 8, offset + 8 + length).arrayBuffer());
        size.rotate = orientation(exif, 0, exif.length);
      }
      if (type === 0x49454e44) break;
      offset += length + 12;
    }
  }
  const pixels = size.width * size.height;
  if (!pixels || pixels > MAX_DECODE_PIXELS || Math.max(size.width, size.height) > 16000) throw new Error("Изображение слишком велико для безопасной подготовки в браузере: максимум 64 Мп и 16000 пикселей по стороне.");
  if (pixels <= SERVER_PIXELS && file.size <= MAX_FILE) return file;
  if (typeof createImageBitmap !== "function") throw new Error("Этот браузер не поддерживает подготовку больших изображений. Повторите в современном браузере.");
  const scale = pixels > SERVER_PIXELS ? Math.sqrt(TARGET_PIXELS / pixels) : 1;
  const swapped = size.rotate >= 5;
  const width = Math.max(1, Math.floor((swapped ? size.height : size.width) * scale));
  const height = Math.max(1, Math.floor((swapped ? size.width : size.height) * scale));
  let bitmap: ImageBitmap | undefined;
  const canvas = document.createElement("canvas");
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
    if (bitmap.width !== width || bitmap.height !== height) throw new Error("Размер результата не подтверждён браузером.");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { alpha: file.type === "image/png" });
    if (!context) throw new Error("Не удалось выделить память для изображения.");
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, file.type, 0.95));
    if (!blob?.size || blob.type !== file.type) throw new Error("Браузер не смог закодировать изображение в исходный формат.");
    if (blob.size > MAX_FILE) throw new Error("После уменьшения изображение всё ещё превышает 8 МиБ. Качество текста не снижалось; выберите менее объёмное изображение.");
    return new File([blob], file.name, { type: file.type, lastModified: file.lastModified });
  } catch (error) {
    throw new Error(`Не удалось подготовить изображение. ${error instanceof Error ? error.message : "Недостаточно памяти или техническая ошибка браузера."} Повторите выбор файла; документ ещё не отправлен.`);
  } finally { bitmap?.close(); canvas.width = 0; canvas.height = 0; }
}
