"use client";
import { useEffect, useRef } from "react";
export function ClearanceDialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className="clearance-dialog" onCancel={close} aria-label={title}><div className="clearance-dialog-title"><h2>{title}</h2><button type="button" className="clearance-link" onClick={close} aria-label="Закрыть">Закрыть</button></div>{children}</dialog>;
}
