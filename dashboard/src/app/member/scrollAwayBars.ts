import { useEffect, useState } from "react";

/**
 * Phones and tablets: the top bar, the tab bar and the Chat button slide away while the member scrolls down a
 * section, so the page gets the whole screen, and come back as soon as they scroll up or stop scrolling.
 */
export type ScrollStep = { top: number; previous: number; room: number };

/** "hide", "show" or null (no change) for one scroll step of a section. */
export function barsForScroll({ top, previous, room }: ScrollStep): "hide" | "show" | null {
  const delta = top - previous;
  if (Math.abs(delta) < 4) return null; // sideways scrolling (carousels) and tiny jitters
  if (top < 48 || delta < 0) return "show";
  if (room < 160) return null; // pages that barely scroll keep their bars
  return "hide";
}

const SHOW_AFTER_STOP_MS = 900;
const SETTLE_MS = 350; // the bars' own slide changes the page height; ignore the scroll that causes

export function useScrollAwayBars(enabled: boolean, resetKey: unknown): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [resetKey, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const last = new WeakMap<Element, number>();
    let idle: number | undefined;
    let settleUntil = 0;
    let current = false;
    const set = (next: boolean) => {
      if (next === current) return;
      current = next;
      settleUntil = performance.now() + SETTLE_MS;
      setHidden(next);
    };
    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof Element) || !el.closest(".mapp-content")) return;
      const top = el.scrollTop;
      const previous = last.get(el);
      last.set(el, top);
      if (previous === undefined || performance.now() < settleUntil) return;
      // Leave the bars alone while a notification or cart panel hangs from the top bar.
      if (document.querySelector('.mapp-topbar [aria-expanded="true"]')) return;
      const step = barsForScroll({ top, previous, room: el.scrollHeight - el.clientHeight });
      if (!step) return;
      window.clearTimeout(idle);
      if (step === "show") return set(false);
      set(true);
      idle = window.setTimeout(() => set(false), SHOW_AFTER_STOP_MS);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(idle);
    };
  }, [enabled]);
  return hidden;
}
