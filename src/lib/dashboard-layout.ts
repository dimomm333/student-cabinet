export const dashboardBlocks = ["schedule", "notifications", "study", "announcements"] as const;
export type DashboardBlock = typeof dashboardBlocks[number];
export type DashboardLayout = { order: DashboardBlock[]; hidden: DashboardBlock[] };
export const dashboardBlockLabels: Record<DashboardBlock, string> = {
  schedule: "Расписание", notifications: "Уведомления", study: "Учёба и контроль", announcements: "Объявления",
};
export const defaultDashboardLayout = (): DashboardLayout => ({ order: [...dashboardBlocks], hidden: [] });
export function parseDashboardLayout(value: unknown): DashboardLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная раскладка.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["order", "hidden"].includes(key)) || !Array.isArray(input.order) || !Array.isArray(input.hidden)
    || input.order.length !== dashboardBlocks.length || new Set(input.order).size !== dashboardBlocks.length
    || input.order.some(id => !dashboardBlocks.includes(id)) || input.hidden.length > 3 || new Set(input.hidden).size !== input.hidden.length
    || input.hidden.some(id => id === "schedule" || !dashboardBlocks.includes(id))) throw new Error("Каждый блок указывается один раз; расписание нельзя скрыть.");
  return { order: [...input.order] as DashboardBlock[], hidden: [...input.hidden] as DashboardBlock[] };
}
export function storedDashboardLayout(value: string | null | undefined) {
  try { return parseDashboardLayout(JSON.parse(value ?? "null")); } catch { return defaultDashboardLayout(); }
}
