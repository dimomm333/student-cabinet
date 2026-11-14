import Link from "next/link";
import type { Role } from "@/generated/prisma/enums";
import { roleHomes, roleLabels } from "@/lib/roles";

export function ProfileLink({ name, role }: { name: string; role: Role }) {
  return <Link href={`${roleHomes[role]}/profile`} className="header-profile" aria-label={`Профиль: ${name}`}>
    <span className="avatar" aria-hidden="true">{name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("")}</span>
    <span className="profile-name">{name}<small>{roleLabels[role]}</small></span>
  </Link>;
}
