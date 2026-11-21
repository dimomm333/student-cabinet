import "server-only";
import { getCurrentUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NotificationSettings } from "./notification-settings";
import { PasswordSettings } from "./password-settings";
import { ProfileSettingsSection } from "./profile-settings-section";

export async function ProfileSettings() {
  const actor = await getCurrentUser();
  if (!actor) return null;
  // Only the capability boolean crosses the server boundary, never the hash.
  const hasLocalPassword = await prisma.account.count({ where: { userId: actor.id, providerId: "credential", password: { not: null } } }) > 0;
  return <div className="profile-settings">
    <ProfileSettingsSection title="Настройки уведомлений" icon="bell"><NotificationSettings /></ProfileSettingsSection>
    <ProfileSettingsSection title="Безопасность" icon="shield"><PasswordSettings hasLocalPassword={hasLocalPassword} /></ProfileSettingsSection>
  </div>;
}
