import sharp from "sharp";

export const MAX_OFFICIAL_PHOTO_BYTES = 5 * 1024 * 1024;
const formats: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

// For trusted university processes only. Always validate and re-encode before
// storing: remove EXIF/GPS, embedded payloads and original file names.
export async function prepareOfficialPhoto(input: Uint8Array, mimeType: string) {
  if (!formats[mimeType] || !input.length || input.length > MAX_OFFICIAL_PHOTO_BYTES) {
    throw new Error("Допустимы JPEG, PNG и WebP размером до 5 МиБ.");
  }
  try {
    const image = sharp(input, { limitInputPixels: 16_000_000, failOn: "warning", animated: true });
    const metadata = await image.metadata();
    if (metadata.format !== formats[mimeType] || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) throw new Error();
    const content = await image.rotate().resize({ width: 1200, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#f0f2ed" }).jpeg({ quality: 88 }).toBuffer();
    if (content.length > MAX_OFFICIAL_PHOTO_BYTES) throw new Error();
    return { content: new Uint8Array(content), mimeType: "image/jpeg" };
  } catch {
    throw new Error("Содержимое фотографии повреждено или не соответствует допустимому формату.");
  }
}
