import type { Metadata } from "next";
import { UserProfile } from "@/components/user-profile";
export const metadata: Metadata = { title: "Профиль" };
export default function DeaneryProfilePage() { return <UserProfile role="DEANERY_STAFF" />; }
