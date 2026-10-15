import { type RefObject, useEffect, useRef, useState } from "react";

/** Close an open menu, popover or drawer when the user taps or clicks outside it, or presses Escape.
 * Pass every element that counts as "inside" (usually the trigger button's wrapper and the popover). */
export function useDismiss(open: boolean, onClose: () => void, inside: RefObject<HTMLElement | null>[]) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && inside.some((ref) => ref.current?.contains(target))) return;
      close.current();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    // Attach after the opening click has finished so it doesn't close the menu straight away.
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", escape);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
