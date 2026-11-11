import { Role } from "../src/generated/prisma/enums.ts";
import { createPrismaClient } from "../src/lib/prisma-client.ts";

const prisma = createPrismaClient();

const users = [
  { name: "Александр Смирнов", email: "alexander.smirnov@example.test", role: Role.STUDENT },
  { name: "Мария Волкова", email: "maria.volkova@example.test", role: Role.STUDENT },
  { name: "Ирина Лебедева", email: "irina.lebedeva@example.test", role: Role.ADMIN },
];

const news = [
  {
    id: "demo-news-science",
    title: "Большие идеи начинаются с любопытства",
    content: "Открываем приём заявок на студенческую научную конференцию «Горизонты».\n\nВ демонстрационной программе — цифровые технологии, городская среда и устойчивое развитие. Конференция пройдёт 25 ноября в учебном корпусе. Это вымышленное событие для знакомства с интерфейсом.",
    publishedAt: new Date("2026-11-10T09:00:00.000Z"),
  },
  {
    id: "demo-news-community",
    title: "Найди тех, кто разделяет твои интересы",
    content: "Неделя студенческих объединений: от дебатного клуба до творческой мастерской.\n\nНа демонстрационной неделе объединений можно познакомиться с клубами, найти команду для проекта и попробовать новое хобби. Все объединения и события в прототипе вымышлены.",
    publishedAt: new Date("2026-11-09T09:00:00.000Z"),
  },
  {
    id: "demo-news-library",
    title: "Новое место для твоих открытий",
    content: "В библиотеке кампуса появилось пространство для совместной работы.\n\nВ вымышленной библиотеке оборудованы тихая зона, переговорные и места для работы над командными проектами. Новость создана только для демонстрации кабинета.",
    publishedAt: new Date("2026-11-07T09:00:00.000Z"),
  },
];

async function main() {
  // One transaction, no table cleanup. Repeating the seed preserves edited data.
  await prisma.$transaction([
    ...users.map((user) => prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: user,
    })),
    ...news.map((item) => prisma.news.upsert({
      where: { id: item.id },
      update: {},
      create: item,
    })),
  ]);

  const [userCount, newsCount] = await Promise.all([
    prisma.user.count(),
    prisma.news.count(),
  ]);
  console.info(`База заполнена. Пользователей: ${userCount}; новостей: ${newsCount}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Не удалось заполнить базу данных:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
