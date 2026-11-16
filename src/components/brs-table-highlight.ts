"use client";
import { useEffect, useRef } from "react";

// Delegate pointer tracking once per workspace. Changing cells only touches the
// old and new row/column; no React render is scheduled for pointer movement.
export function useBrsTableHighlight(suspended: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current!;
    let current: HTMLTableCellElement | null = null;
    let marked: Element[] = [];
    const clear = () => { for (const el of marked) el.classList.remove("brs-cross-row", "brs-cross-col", "brs-cross-cell"); marked = []; current = null; };
    const over = (event: PointerEvent) => {
      if (suspended || event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      const cell = event.target.closest<HTMLTableCellElement>("td, th");
      const table = cell?.closest<HTMLTableElement>("table.brs-cross-table");
      if (!cell || !table || !host.contains(table) || !cell.closest("tbody")) { clear(); return; }
      if (host.dataset.brsInput !== "pointer") host.dataset.brsInput = "pointer";
      if (cell === current) return;
      clear(); current = cell;
      const index = cell.cellIndex + 1, row = cell.parentElement;
      if (row) { row.classList.add("brs-cross-row"); marked.push(row); }
      if (!table.classList.contains("brs-cross-row-only")) {
        for (const el of table.querySelectorAll(`thead tr:last-child > :nth-child(${index}), tbody tr > :nth-child(${index})`)) { el.classList.add("brs-cross-col"); marked.push(el); }
        cell.classList.add("brs-cross-cell"); marked.push(cell);
      }
    };
    const out = (event: PointerEvent) => { if (event.pointerType === "mouse" && current && !(event.relatedTarget instanceof Element && current.closest("table")?.contains(event.relatedTarget))) clear(); };
    const down = () => { host.dataset.brsInput = "pointer"; clear(); };
    const keyboard = () => { host.dataset.brsInput = "keyboard"; };
    host.addEventListener("pointermove", over); host.addEventListener("pointerout", out); host.addEventListener("pointerdown", down); window.addEventListener("scroll", clear, true); window.addEventListener("keydown", keyboard);
    return () => { clear(); host.removeEventListener("pointermove", over); host.removeEventListener("pointerout", out); host.removeEventListener("pointerdown", down); window.removeEventListener("scroll", clear, true); window.removeEventListener("keydown", keyboard); };
  }, [suspended]);
  return root;
}
