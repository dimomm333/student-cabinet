import type { Metadata } from "next";
import { UserProfile } from "@/components/user-profile";

export const metadata: Metadata = { title: "Профиль" };
export default function StaffProfilePage() { return <UserProfile role="TECHNICAL_STAFF" />; }
