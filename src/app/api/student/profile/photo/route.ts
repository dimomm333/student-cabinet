import { getCurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};

export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return new Response(null, { status: 401, headers: privateHeaders });
  if (actor.role !== "STUDENT") return new Response(null, { status: 403, headers: privateHeaders });
  // There is no selectable owner, even through query parameters.
  if (new URL(request.url).search) return new Response(null, { status: 400, headers: privateHeaders });
  const photo = await prisma.studentOfficialPhoto.findFirst({
    where: { userId: actor.id, student: { user: { role: "STUDENT" } } },
    select: { content: true, mimeType: true },
  });
  if (!photo || photo.mimeType !== "image/jpeg") return new Response(null, { status: 404, headers: privateHeaders });
  return new Response(new Uint8Array(photo.content), { headers: { ...privateHeaders, "Content-Type": photo.mimeType } });
}
