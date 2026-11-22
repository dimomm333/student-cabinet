import { requireRole } from "@/lib/access";
import { getConsultationClock, getPersonalConsultations } from "@/lib/consultations-repository";
import { prisma } from "@/lib/prisma";
import { ConsultationHeading, PersonalConsultationList } from "./consultation-list";

export async function PersonalConsultations({ role }: { role: "STUDENT" | "TEACHER" }) {
  const actor = await requireRole(role);
  const rows = await getPersonalConsultations(prisma, actor);
  const student = role === "STUDENT";
  return <div className="consultations-workspace">
    <ConsultationHeading description={student ? "Расписание консультаций для вашей учебной группы." : "Ваше расписание консультаций."} />
    <PersonalConsultationList rows={rows} student={student} {...getConsultationClock()} />
  </div>;
}
