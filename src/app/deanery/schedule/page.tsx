import { Suspense } from "react";
import { withDeanery } from "@/lib/deanery";
import { getScheduleEditor } from "@/lib/schedule-editor-repository";
import { parseScheduleQuery } from "@/lib/schedule-calendar";
import { ScheduleEditor } from "@/components/schedule-editor";
import CabinetPageLoading from "@/components/cabinet-page-loading";

async function EditorContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return withDeanery(async (db, actor) => {
    const query = parseScheduleQuery(await searchParams);
    const model = await getScheduleEditor(db, actor, query.selected, query.week, query.day, query.term);
    return <ScheduleEditor model={model} />;
  });
}
export default function DeaneryScheduleEditorPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<CabinetPageLoading />}><EditorContent {...props} /></Suspense>;
}
