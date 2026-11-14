import sharp from "sharp";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { prepareOfficialPhoto } from "../src/lib/student-photo.ts";

// Original geometric illustrations, made for this project; no real people or
// third-party photographs. Only explicitly requested demo identities get them.
export async function seedStudentPhotoDemo(db: PrismaClient) {
  for (const [email, colour] of [["alexander.smirnov@example.test", "#536b50"], ["maria.volkova@example.test", "#756380"]]) {
    const user = await db.user.findUnique({ where: { email, role: "STUDENT" }, select: { id: true, studentProfile: { select: { userId: true } } } });
    if (!user?.studentProfile || await db.studentOfficialPhoto.findUnique({ where: { userId: user.id }, select: { userId: true } })) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="576"><rect width="432" height="576" fill="#e8ede2"/><circle cx="216" cy="205" r="85" fill="${colour}"/><path d="M50 510v-40a166 166 0 0 1 332 0v40" fill="${colour}"/><rect y="520" width="432" height="56" fill="#fff"/><text x="216" y="554" font-family="sans-serif" text-anchor="middle" font-size="19" fill="#52614c">ДЕМО · ИЛЛЮСТРАЦИЯ</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const photo = await prepareOfficialPhoto(png, "image/png");
    await db.studentOfficialPhoto.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, ...photo } });
  }
}
