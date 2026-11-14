import type { Metadata } from "next";
import { UserProfile } from "@/components/user-profile";

export const metadata: Metadata = { title: "Профиль" };
export default function TeacherProfilePage() { return <UserProfile role="TEACHER" />; }
