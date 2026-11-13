import Link from "next/link";
import { io } from "next/cache";
import { getCurrentUser } from "@/lib/access";
import { isRole, roleHomes } from "@/lib/roles";
import { Icon } from "./icon";

export function CabinetAction({ href = "/login" }: { href?: string }) {
  return <Link href={href} aria-label="Войти в личный кабинет" className="portal-action portal-action-cabinet"><div className="portal-action-top"><Icon name="user" size={36} /><span>01 / ЛИЧНОЕ ПРОСТРАНСТВО</span></div><h2>Войти в<br />личный кабинет</h2><div className="portal-action-bottom"><span>Для студентов и сотрудников</span><span className="portal-action-arrow"><Icon name="arrow" size={25} /></span></div></Link>;
}

export async function HomeCabinetAction() {
  await io();
  let href = "/login";
  try {
    const user = await getCurrentUser();
    if (user && isRole(user.role)) href = roleHomes[user.role];
  } catch { console.error("portal.session_lookup_failed"); }
  return <CabinetAction href={href} />;
}
