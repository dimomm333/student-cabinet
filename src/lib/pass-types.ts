export const passStatusLabels = {
  ACTIVE: "Пропуск действителен",
  REVOKED: "Пропуск отозван",
  REPLACED: "Пропуск заменён",
  NOT_FOUND: "Пропуск не найден",
  UNISSUED: "Пропуск не выдан",
};
export type PassState = keyof typeof passStatusLabels;
export type PassIdentity = { name: string; group: string | null; photo: string | null; sample: boolean };
export type PassCardData = { status: PassState; person?: PassIdentity; qr?: string };
export type PassHistory = {
  person: PassIdentity;
  passes: {
    id: number; status: "ACTIVE" | "REVOKED" | "REPLACED"; issuedAt: string; issuer: { name: string };
    closedAt: string | null; closer: { name: string } | null; reason: string | null; requestId: string | null;
  }[];
  requests: { id: string; completedAt: string | null }[];
};
