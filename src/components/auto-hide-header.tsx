"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// Match the existing breakpoint at which the sidebar becomes a mobile dialog.
const mobileQuery = "(max-width: 760px)";
const downThreshold = 32;
const upThreshold = 14;

function scrollContainer(header: HTMLElement): Element {
  for (let node = header.parentElement; node && node !== document.body; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

export function AutoHideHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useLayoutEffect(() => {
    const header = ref.current!;
    const mobile = matchMedia(mobileQuery);
    const viewport = window.visualViewport;
    let root = scrollContainer(header);
    const top = () => Math.max(0, Math.min(root.scrollTop, root.scrollHeight - root.clientHeight));
    let previous = top();
    let anchor = previous;
    let contentHeight = root.scrollHeight;
    let hidden = false;
    let frame = 0;
    let keyboard = false;
    let gestureUntil = 0;
    let viewportWidth = window.innerWidth;
    let fullHeight = viewport?.height ?? window.innerHeight;
    let lastViewportHeight = fullHeight;

    const show = () => {
      hidden = false;
      header.inert = false;
      header.removeAttribute("data-scroll-hidden");
    };
    const reset = () => {
      show();
      root = scrollContainer(header);
      previous = anchor = top();
      contentHeight = root.scrollHeight;
    };
    const locked = () => {
      const active = document.activeElement;
      const form = active instanceof Element && active.closest("input, textarea, select, form, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox]");
      return keyboard || !!form
        || !!(active instanceof Element && header.contains(active) && active.matches(":focus-visible"))
        || !!header.querySelector('[aria-expanded="true"], details[open], [popover]:popover-open')
        || !!document.querySelector("dialog[open]")
        || (viewport?.scale === 1 && fullHeight - viewport.height > 120);
    };
    const update = () => {
      frame = 0;
      const currentRoot = scrollContainer(header);
      if (currentRoot !== root) { root = currentRoot; reset(); return; }
      const y = top();
      if (!mobile.matches || locked() || y <= header.offsetHeight + 8) { reset(); return; }
      if (root.scrollHeight !== contentHeight) {
        // Loading/expanding content can move the scroll anchor without a swipe.
        contentHeight = root.scrollHeight;
        previous = anchor = y;
        return;
      }
      if (performance.now() > gestureUntil) {
        // Ignore focus scrolling, restored history positions and other programmatic
        // movement. They must not hide a freshly revealed navigation bar.
        if (y < previous) show();
        previous = anchor = y;
        return;
      }
      if (hidden) {
        anchor = Math.max(anchor, y);
        if (anchor - y >= upThreshold) { show(); anchor = y; }
      } else {
        anchor = Math.min(anchor, y);
        if (y - anchor >= downThreshold) {
          hidden = true;
          header.dataset.scrollHidden = "true";
          header.inert = true;
          anchor = y;
        }
      }
      previous = y;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const scroll = (event: Event) => {
      const currentRoot = scrollContainer(header);
      // Nested tables, textareas, menus and calendars do not scroll the page.
      if (event.target === document || event.target === currentRoot) schedule();
    };
    const gesture = () => { keyboard = false; gestureUntil = performance.now() + 1500; };
    const pointer = (event: PointerEvent) => {
      keyboard = false;
      if (header.contains(event.target as Node)) reset();
    };
    const key = () => { keyboard = true; gestureUntil = 0; reset(); };
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight;
      const widthChanged = window.innerWidth !== viewportWidth;
      const largeHeightChange = Math.abs(height - lastViewportHeight) > 120;
      lastViewportHeight = height;
      if (widthChanged) {
        viewportWidth = window.innerWidth;
        fullHeight = height;
      } else fullHeight = Math.max(fullHeight, height);
      if (widthChanged || largeHeightChange || locked() || scrollContainer(header) !== root) {
        gestureUntil = 0;
        reset();
      } else {
        // The mobile address bar changes viewport height during a swipe.
        // Preserve visibility instead of flashing the header on every resize.
        previous = anchor = top();
      }
    };
    const navigation = () => { gestureUntil = 0; reset(); };
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link instanceof HTMLAnchorElement && link.origin === location.origin && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) navigation();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "aria-expanded", "data-state"] });
    reset(); // Includes soft navigation and back/forward to an existing document.
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    document.addEventListener("wheel", gesture, { capture: true, passive: true });
    document.addEventListener("touchmove", gesture, { capture: true, passive: true });
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("focusin", schedule, true);
    document.addEventListener("focusout", schedule, true);
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", navigation);
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    mobile.addEventListener("change", navigation);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("wheel", gesture, true);
      document.removeEventListener("touchmove", gesture, true);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", schedule, true);
      document.removeEventListener("focusout", schedule, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", navigation);
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
      mobile.removeEventListener("change", navigation);
      show();
    };
  }, [pathname]);

  return <header ref={ref} className="dashboard-header">{children}</header>;
}
