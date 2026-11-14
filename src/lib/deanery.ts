import "server-only";
import { notFound } from "next/navigation";
import { requireRole } from "./access";
import { prisma } from "./prisma";
import { DeaneryAccessDenied, type DeaneryActor } from "./deanery-repository";

// Shared entry point for current/future deanery pages and server operations.
// Repository functions must still apply their scoped predicates at each read.
export async function withDeanery<T>(read: (db: typeof prisma, actor: DeaneryActor) => Promise<T>) {
  const actor = await requireRole("DEANERY_STAFF");
  try { return await read(prisma, actor); }
  catch (error) { if (error instanceof DeaneryAccessDenied) notFound(); throw error; }
}
