/** Light or dark, from a theme's page background (WCAG relative luminance). Dark themes switch status colours,
 * native controls, shadows and the logo (styles/tokens.css, .member-theme-runtime[data-theme-tone="dark"]). */
export function luminance(hex: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 1;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function themeTone(pageBackground: string): "light" | "dark" {
  return luminance(pageBackground) < 0.18 ? "dark" : "light";
}
