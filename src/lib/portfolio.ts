import type { PortfolioCategory, PortfolioStatus } from "@/generated/prisma/enums";

export const portfolioCategories = {
  PROJECT: "Проекты",
  COMPETITION: "Олимпиады и конкурсы",
  SCIENCE: "Научная деятельность",
  SPORT: "Спорт",
  VOLUNTEERING: "Волонтёрство",
  OTHER: "Другие достижения",
} satisfies Record<PortfolioCategory, string>;

export const portfolioStatuses = {
  SELF_ADDED: "Добавлено самостоятельно",
  PENDING: "На проверке",
  CONFIRMED: "Подтверждено",
  REJECTED: "Отклонено",
} satisfies Record<PortfolioStatus, string>;

export const portfolioFileTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const portfolioFileLimit = 8;
export const portfolioByteLimit = 32 * 1024 * 1024;

export type PortfolioFile = { id: string; name: string; mime: string; size: number };
export type PortfolioItem = {
  id: string;
  version: number;
  title: string;
  category: PortfolioCategory;
  achievedOn: string;
  description: string | null;
  result: string | null;
  link: string | null;
  award: boolean;
  status: PortfolioStatus;
  rejection: string | null;
  owner: string;
  group: string | null;
  attachments: PortfolioFile[];
};
