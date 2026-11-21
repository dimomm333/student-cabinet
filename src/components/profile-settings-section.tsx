"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function ProfileSettingsSection({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="panel profile-settings-section" data-open={open}>
    <h2><button type="button" className="profile-settings-trigger" id={`${id}-trigger`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <Icon name={icon} /><span>{title}</span><span className="profile-settings-chevron"><Icon name="chevron" size={18} /></span>
    </button></h2>
    <div className="profile-settings-collapse" id={id} role="region" aria-labelledby={`${id}-trigger`} inert={!open} aria-hidden={!open}>
      <div className="profile-settings-clip"><div className="profile-settings-content">{children}</div></div>
    </div>
  </section>;
}
