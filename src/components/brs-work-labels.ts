import { workTitle as originalTitle } from "@/lib/brs-rules";
import { presentAcademicText } from "@/lib/presentation-copy";

export function workTitle(...args: Parameters<typeof originalTitle>) {
  return presentAcademicText(originalTitle(...args));
}
