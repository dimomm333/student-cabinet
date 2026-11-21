"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

type SectionItem = { id: string; label: string; disabled?: boolean };

export function SectionLinks({ label, active, items, className }: {
  label: string; active: string; items: readonly (SectionItem & { href: string; prefetch?: false })[]; className?: string;
}) {
  if (!items.length) return null;
  return <nav className={["section-switch", className].filter(Boolean).join(" ")} aria-label={label}>
    {items.map(item => item.disabled
      ? <span key={item.id} className="section-switch-item" role="link" aria-disabled="true">{item.label}</span>
      : <Link key={item.id} className="section-switch-item" href={item.href} prefetch={item.prefetch}
        aria-current={item.id === active ? "page" : undefined}>{item.label}</Link>)}
  </nav>;
}

export function SectionTabs({ label, active, items, onSelect, className, children }: {
  label: string; active: string; items: readonly SectionItem[]; onSelect: (id: string) => void; className?: string; children: ReactNode;
}) {
  const id = useId();
  const [focused, setFocused] = useState<string | null>(null);
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const list = event.currentTarget.parentElement;
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const index = tabs.indexOf(event.currentTarget);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.focus();
  }
  return <>
    <div className={["section-switch", className].filter(Boolean).join(" ")} role="tablist" aria-label={label}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}>
      {items.map(item => <button key={item.id} id={`${id}-tab-${item.id}`} className="section-switch-item" type="button"
        role="tab" aria-selected={item.id === active} aria-controls={`${id}-panel-${item.id}`}
        tabIndex={(focused ?? active) === item.id ? 0 : -1} disabled={item.disabled}
        onFocus={() => setFocused(item.id)} onKeyDown={moveFocus} onClick={() => onSelect(item.id)}>{item.label}</button>)}
    </div>
    {items.map(item => <div key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel"
      aria-labelledby={`${id}-tab-${item.id}`} hidden={item.id !== active} tabIndex={0}>
      {item.id === active ? children : null}
    </div>)}
  </>;
}
