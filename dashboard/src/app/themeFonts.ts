/**
 * Text fonts a member theme can use (Theme Studio). Same keys as app/accounts/member_themes.py THEME_FONTS.
 * "system" is FayFort's standard stack and loads nothing; the others load once from Google Fonts when used.
 */
export type ThemeFont = "system" | "poppins" | "quicksand" | "nunito" | "montserrat" | "dm-sans" | "playfair" | "lora";

export const THEME_FONTS: { key: ThemeFont; label: string; note: string; family: string; google?: string }[] = [
  { key: "system", label: "FayFort standard", note: "Clean and neutral", family: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { key: "poppins", label: "Poppins", note: "Bold, modern, confident", family: '"Poppins", system-ui, sans-serif', google: "Poppins:wght@400;500;600;700" },
  { key: "quicksand", label: "Quicksand", note: "Soft and rounded", family: '"Quicksand", system-ui, sans-serif', google: "Quicksand:wght@400;500;600;700" },
  { key: "nunito", label: "Nunito", note: "Friendly and easy to read", family: '"Nunito", system-ui, sans-serif', google: "Nunito:wght@400;600;700;800" },
  { key: "montserrat", label: "Montserrat", note: "Geometric and sharp", family: '"Montserrat", system-ui, sans-serif', google: "Montserrat:wght@400;500;600;700" },
  { key: "dm-sans", label: "DM Sans", note: "Compact and tidy", family: '"DM Sans", system-ui, sans-serif', google: "DM+Sans:wght@400;500;700" },
  { key: "playfair", label: "Playfair Display", note: "Elegant serif, fashion feel", family: '"Playfair Display", Georgia, serif', google: "Playfair+Display:wght@400;500;600;700" },
  { key: "lora", label: "Lora", note: "Warm, bookish serif", family: '"Lora", Georgia, serif', google: "Lora:wght@400;500;600;700" },
];

export function themeFont(key: string | null | undefined) {
  return THEME_FONTS.find((font) => font.key === key) || THEME_FONTS[0];
}

/** Adds the Google Fonts stylesheet for a font once per page. Safe to call on every render. */
export function loadThemeFont(key: string | null | undefined) {
  const font = themeFont(key);
  if (!font.google || typeof document === "undefined") return font;
  const id = `fayfort-font-${font.key}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${font.google}&display=swap`;
    document.head.appendChild(link);
  }
  return font;
}
