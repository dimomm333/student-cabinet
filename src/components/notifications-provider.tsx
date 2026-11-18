"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { NotificationFeed } from "@/lib/notifications-shared";

type Snapshot = NotificationFeed & { loading: boolean; error: string; busy: boolean };
const empty: Snapshot = { items: [], unread: 0, boundary: 0, nextCursor: null, loading: true, error: "", busy: false };
export async function notificationFetch<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  } catch { throw new Error("Нет связи с сервером. Уведомления обновятся после восстановления соединения."); }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Не удалось обновить уведомления."), { status: response.status });
  return data;
}
class NotificationStore {
  snapshot = empty;
  listeners = new Set<() => void>();
  chain: Promise<unknown> = Promise.resolve();
  refreshing = false;
  refreshAgain = false;
  pages = 1;
  broadcast: (() => void) | undefined;
  setBroadcast(fn?: () => void) { this.broadcast = fn; }
  invalidate = () => { if (this.refreshing) this.refreshAgain = true; else this.refresh(); };
  get = () => this.snapshot;
  server = () => empty;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update(value: Partial<Snapshot>) { this.snapshot = { ...this.snapshot, ...value }; this.listeners.forEach(l => l()); }
  enqueue<T>(fn: () => Promise<T>): Promise<T> { const next = this.chain.then(fn, fn); this.chain = next.catch(() => {}); return next; }
  refresh = () => {
    if (this.refreshing) return;
    this.refreshing = true;
    void this.enqueue(async () => {
      try {
        const first = await notificationFetch<NotificationFeed>("/api/notifications");
        let cursor = first.nextCursor, items = first.items;
        for (let page = 1; page < this.pages && cursor; page++) {
          const older = await notificationFetch<NotificationFeed>(`/api/notifications?before=${cursor}`);
          items = [...items, ...older.items]; cursor = older.nextCursor;
        }
        this.update({ ...first, items, nextCursor: cursor, loading: false, error: "" });
      } catch (e) {
        if ((e as { status?: number }).status === 401) this.update({ items: [], unread: 0, boundary: 0, nextCursor: null });
        this.update({ loading: false, error: e instanceof Error ? e.message : "Нет связи. Повторим автоматически." });
      } finally { this.refreshing = false; if (this.refreshAgain) { this.refreshAgain = false; this.refresh(); } }
    });
  };
  more = async () => this.enqueue(async () => {
    if (!this.snapshot.nextCursor) return;
    this.update({ busy: true });
    try {
      const page = await notificationFetch<NotificationFeed>(`/api/notifications?before=${this.snapshot.nextCursor}`);
      const items = new Map([...this.snapshot.items, ...page.items].map(n => [n.id, n]));
      this.pages++; this.update({ items: [...items.values()].sort((a,b) => b.id - a.id), nextCursor: page.nextCursor, error: "" });
    } catch (e) { this.update({ error: (e as Error).message }); }
    finally { this.update({ busy: false }); }
  });
  read = async (boundary: number, all: boolean) => this.enqueue(async () => {
    this.update({ busy: true });
    try {
      await notificationFetch("/api/notifications", { operation: all ? "READ_ALL" : "READ", boundary });
      const now = new Date().toISOString();
      this.update({ items: this.snapshot.items.map(n => (all ? n.id <= boundary : n.id === boundary) ? { ...n, readAt: n.readAt ?? now } : n), error: "" });
      this.broadcast?.();
      const feed = await notificationFetch<NotificationFeed>("/api/notifications");
      this.pages = 1; this.update({ ...feed });
    } catch (e) { this.update({ error: (e as Error).message }); }
    finally { this.update({ busy: false }); }
  });
}
const Context = createContext<NotificationStore | null>(null);
export function NotificationsProvider({ identity, children }: { identity: string; children: ReactNode }) {
  const [store] = useState(() => new NotificationStore());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, active = true;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`lks-notifications:${identity}`) : null;
    store.setBroadcast(() => channel?.postMessage("invalidate"));
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible" || !active) return;
      timer = setTimeout(() => { store.refresh(); schedule(); }, 12000);
    };
    const refresh = () => { if (document.visibilityState === "visible") store.refresh(); schedule(); };
    const mutation = () => { if (document.visibilityState === "visible") store.invalidate(); schedule(); store.broadcast?.(); };
    channel?.addEventListener("message", refresh);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("services-updated", mutation); window.addEventListener("notifications-updated", mutation);
    refresh();
    return () => {
      active = false; clearTimeout(timer); channel?.close(); store.setBroadcast();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("services-updated", mutation); window.removeEventListener("notifications-updated", mutation);
    };
  }, [identity, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useNotifications() {
  const store = useContext(Context);
  if (!store) throw new Error("NotificationsProvider missing");
  return { ...useSyncExternalStore(store.subscribe, store.get, store.server), refresh: store.refresh, read: store.read, more: store.more };
}
export function NotificationBadge() {
  const { unread, loading } = useNotifications();
  return <span className="notification-count" aria-label={loading ? "Загружаем число непрочитанных" : `Непрочитанных: ${unread}`} aria-live="polite">{loading ? "…" : unread}</span>;
}
