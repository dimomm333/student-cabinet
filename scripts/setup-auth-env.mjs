import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";

const path = ".env";
const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
const local = parse(contents);
const defaults = {
  DATABASE_URL: "file:./prisma/dev.db",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
};

for (const [key, fallback] of Object.entries(defaults)) {
  if (!local[key] && !process.env[key]) {
    if (Object.hasOwn(local, key)) throw new Error(`Удалите пустую строку ${key} из .env и повторите команду.`);
    appendFileSync(path, `\n${key}=${JSON.stringify(fallback)}\n`, { mode: 0o600 });
  }
}
console.info("Локальное окружение авторизации готово. Существующие настройки сохранены; секреты не выводятся.");
