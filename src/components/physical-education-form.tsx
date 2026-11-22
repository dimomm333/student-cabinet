"use client";

import { useActionState, type ReactNode } from "react";
import { physicalAction } from "@/app/physical-education-actions";

export function PhysicalForm({ children, operation, requestId, label, fields = {}, disabled = false }: {
  children?: ReactNode; operation: string; requestId: string; label: string; fields?: Record<string, string | number>; disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(physicalAction, {});
  return <form action={action} className="pe-form">
    <input type="hidden" name="operation" value={operation} />
    <input type="hidden" name="requestId" value={requestId} />
    {Object.entries(fields).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <fieldset disabled={pending || disabled} className="pe-form-fields">
      {children}
      <button className="pe-button" type="submit">{pending ? "Сохранение…" : label}</button>
    </fieldset>
    {state.error && <p className="pe-error" role="alert">{state.error}</p>}
    {state.message && !state.error && <p className="pe-success" role="status">{state.message}</p>}
  </form>;
}
