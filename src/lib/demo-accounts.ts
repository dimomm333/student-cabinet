import { Role } from "../generated/prisma/enums.ts";

// Public identities only. Passwords are supplied through env or generated locally.
export const demoAccounts = [
  { name: "Александр Смирнов", email: "alexander.smirnov@example.test", role: Role.STUDENT, passwordEnv: "DEMO_ALEXANDER_PASSWORD" },
  { name: "Мария Волкова", email: "maria.volkova@example.test", role: Role.STUDENT, passwordEnv: "DEMO_MARIA_PASSWORD" },
  { name: "Ирина Лебедева", email: "irina.lebedeva@example.test", role: Role.ADMIN, passwordEnv: "DEMO_ADMIN_PASSWORD" },
  { name: "Михаил Соколов", email: "mikhail.sokolov@example.test", role: Role.TEACHER, passwordEnv: "DEMO_TEACHER_PASSWORD" },
  { name: "Сергей Петров", email: "sergey.petrov@example.test", role: Role.TECHNICAL_STAFF, passwordEnv: "DEMO_STAFF_PASSWORD" },
];
