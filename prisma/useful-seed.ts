import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { usefulCategories, usefulMaterials, usefulNested } from "./useful-content.ts";

export async function seedUsefulCatalog(db: PrismaClient) {
  const entries = [...usefulCategories, ...usefulMaterials, ...usefulNested];
  return db.$transaction(async tx => {
    const existing = new Set((await tx.usefulEntry.findMany({ select: { id: true } })).map(row => row.id));
    let pending = entries.filter(entry => !existing.has(entry.id));
    let inserted = 0;
    while (pending.length) {
      const ready = pending.filter(entry => !entry.parentId || existing.has(entry.parentId));
      if (!ready.length) throw new Error("Не найден родитель исходной записи справочника.");
      const result = await tx.usefulEntry.createMany({ data: ready });
      inserted += result.count;
      for (const entry of ready) existing.add(entry.id);
      pending = pending.filter(entry => !existing.has(entry.id));
    }
    return inserted;
  }, { isolationLevel: "Serializable" });
}
