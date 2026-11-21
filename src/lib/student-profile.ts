import "server-only";
import { requireRole } from "./access";
import { prisma } from "./prisma";

export const educationStatusLabels = {
  STUDYING: "Обучается", ACADEMIC_LEAVE: "В академическом отпуске", EXPELLED: "Отчислен",
  GRADUATED: "Завершил обучение", TRANSFERRED: "Переведён в другой университет",
};
export const residenceStatusLabels = { RESIDENT: "Проживает", NON_RESIDENT: "Не проживает" };

export async function getOwnStudentProfile() {
  const actor = await requireRole("STUDENT");
  return prisma.user.findUniqueOrThrow({
    where: { id: actor.id, role: "STUDENT" },
    select: {
      name: true, email: true, role: true, createdAt: true,
      dormPlacements: {
        where: { status: { in: ["ACTIVE", "ENDED"] } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 1,
        select: { status: true, bed: { select: {
          number: true, room: { select: { number: true, floor: { select: { building: { select: {
            name: true, dormitory: { select: { name: true } },
          } } } } } },
        } } },
      },
      studentProfile: { select: {
        lastName: true, firstName: true, middleName: true, gender: true, citizenship: true, contactPhone: true,
        institute: true, program: true, groupName: true, course: true, studyMode: true,
        educationLevel: true, fundingBasis: true, enrolledAt: true, expectedGraduationYear: true, educationStatus: true,
        personalFileNumber: true, residenceStatus: true, dormitory: true, dormitoryRoom: true,
        group: { select: { code: true, programme: true, course: true, department: { select: { faculty: true } } } },
        officialPhoto: { select: { userId: true } },
      } },
    },
  });
}
