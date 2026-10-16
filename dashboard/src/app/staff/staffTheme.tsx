import { useEffect, useState } from "react";

/** Light or dark mode for the Control Center and Operations Center only (the member site keeps its own themes).
 * The choice is remembered on this device. */
export type StaffTheme = "light" | "dark";
const KEY = "fayfort.staffTheme";

function savedTheme(): StaffTheme {
  try {
    return window.localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function useStaffTheme(): [StaffTheme, (theme: StaffTheme) => void] {
  const [theme, setTheme] = useState<StaffTheme>(savedTheme);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    return () => {
      delete root.dataset.theme;
      root.style.colorScheme = "";
    };
  }, [theme]);
  function choose(next: StaffTheme) {
    setTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
  }
  return [theme, choose];
}

export function StaffThemeToggle({
  theme,
  onChange,
  className = "staff-theme-toggle",
}: {
  theme: StaffTheme;
  onChange: (theme: StaffTheme) => void;
  className?: string;
}) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => onChange(dark ? "light" : "dark")}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        {dark ? (
          <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        )}
      </svg>
      <span>{dark ? "Light" : "Dark"}</span>
    </button>
  );
}
