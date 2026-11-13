import { handleScheduleApi, scheduleApiMethodNotAllowed, scheduleApiOptions } from "@/lib/schedule-api";

export function GET(request: Request) { return handleScheduleApi(request, "groups"); }
export const HEAD = GET;
export const OPTIONS = scheduleApiOptions;
export const POST = scheduleApiMethodNotAllowed;
export const PUT = scheduleApiMethodNotAllowed;
export const PATCH = scheduleApiMethodNotAllowed;
export const DELETE = scheduleApiMethodNotAllowed;
