import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Close an open menu, popover or drawer when the user taps or clicks outside it, or presses Escape.
 * Pass every element that counts as "inside" (usually the trigger button's wrapper and the popover). */
export function useDismiss(open: boolean, onClose: () => void, inside: RefObject<HTMLElement | null>[]) {
  const close = useRef(onClose);
  close.current = onClose;
  const within = useRef(inside);
  within.current = inside;
  // Listeners attach before paint, so a quick tap or Escape right after the menu appears is never missed. The tap
  // that opened the menu happened earlier, so it's ignored by its timestamp instead of by waiting.
  useLayoutEffect(() => {
    if (!open) return;
    const openedAt = performance.now();
    function outside(event: PointerEvent) {
      if (event.timeStamp && event.timeStamp < openedAt) return;
      const target = event.target as Node | null;
      if (target && within.current.some((ref) => ref.current?.contains(target))) return;
      close.current();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
}

/** True while the media query matches (re-renders on change). */
export function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const change = () => setMatches(list.matches);
    change();
    list.addEventListener?.("change", change);
    return () => list.removeEventListener?.("change", change);
  }, [query]);
  return matches;
}

export const DESKTOP = "(min-width: 1024px)";
