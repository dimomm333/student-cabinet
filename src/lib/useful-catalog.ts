import type { UsefulKind, UsefulStatus } from "../generated/prisma/enums.ts";

export const usefulPath = "/dashboard/useful";
export const universityMailId = "university-mail";
export const universityMailTitle = "Университетская почта";
export const universityMailDescription = "Через университетскую почту студенты могут получать официальные сообщения, общаться с преподавателями и сотрудниками университета";
export const usefulAdminPath = "/admin/useful";
export const usefulHref = (id: string) => usefulPath + "/" + encodeURIComponent(id);

export const usefulKinds: Record<UsefulKind, string> = {
  DIRECTORY: "Справочник",
  ARTICLE: "Статья",
  EXTERNAL: "Внешний ресурс",
};

export const usefulStatuses: Record<UsefulStatus, string> = {
  DRAFT: "Скрыта",
  PUBLISHED: "Опубликована",
  ARCHIVED: "В архиве",
};

export function officialHttpUrl(value: string): string | null {
  if (!/^https?:\/\/[^/?#@]+/i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function usefulLink(value: string): string | null {
  if (/^\/dashboard\/(?:schedule|session|grades|dormitory|portfolio|materials|services)(?:\?service=[a-z-]+)?$/.test(value) ||
      /^\/dashboard\/useful(?:\/[a-z0-9-]+)?$/.test(value)) return value;
  return officialHttpUrl(value);
}

export type UsefulNode = {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  kind: UsefulKind;
  status: UsefulStatus;
};

export function usefulTree<T extends UsefulNode>(entries: T[]) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const children = new Map<string | null, T[]>();
  for (const entry of entries) {
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }

  function trail(id: string): T[] {
    const visited = new Set<string>();
    const result: T[] = [];
    let current = byId.get(id);
    while (current) {
      if (visited.has(current.id)) return [];
      visited.add(current.id);
      result.push(current);
      if (!current.parentId) return result.reverse();
      current = byId.get(current.parentId);
    }
    return [];
  }

  function descendants(parentId: string | null): T[] {
    const visited = new Set(parentId ? [parentId] : []);
    const result: T[] = [];
    const pending = [...(children.get(parentId) ?? [])].reverse();
    while (pending.length) {
      const entry = pending.pop()!;
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);
      result.push(entry);
      for (const child of [...(children.get(entry.id) ?? [])].reverse()) pending.push(child);
    }
    return result;
  }

  return { byId, children, trail, descendants };
}

export function searchUseful<T extends UsefulNode>(entries: T[], query: string): T[] {
  const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е");
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter(entry => {
    const text = normalize(entry.title + " " + entry.description);
    return words.every(word => text.includes(word));
  });
}
