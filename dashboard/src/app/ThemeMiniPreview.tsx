import { useEffect, type CSSProperties } from "react";
import { loadThemeFont, themeFont } from "./themeFonts";
import { themeTone } from "./themeTone";
import { patternImage } from "./themePatterns";
import "./theme-mini.css";

export type MiniThemeColors = {
  page_background: string;
  surface: string;
  text: string;
  muted_text: string;
  accent: string;
  accent_foreground: string;
  border: string;
  focus: string;
};
export type MiniThemeDesign = {
  palette_preset?: string;
  wrapper_style: "clean" | "soft" | "framed";
  colors: MiniThemeColors;
  font_family?: string | null;
  pattern?: string | null;
  pattern_strength?: "subtle" | "bold" | null;
};

/** The status colours the member app uses on this theme (tokens.css swaps them on dark themes). */
function statusColours(dark: boolean) {
  return dark
    ? { success: "#4cd8a0", sale: "#ff9f5a" }
    : { success: "#147964", sale: "#c2410c" };
}

/**
 * A small working picture of the member app drawn in a theme's colours, wrapper and font: the chat with a reply,
 * a product card and the composer. "thumb" is the card-sized version in the theme chooser; "stage" is the big one.
 */
export function ThemeMiniPreview({
  design,
  name,
  size = "stage",
  label,
}: {
  design: MiniThemeDesign;
  name: string;
  size?: "thumb" | "stage";
  label?: string;
}) {
  const fontKey = design.font_family || "system";
  useEffect(() => {
    loadThemeFont(fontKey);
  }, [fontKey]);
  const c = design.colors;
  const dark = themeTone(c.page_background) === "dark";
  const status = statusColours(dark);
  const style = {
    "--tp-page": c.page_background,
    "--tp-surface": c.surface,
    "--tp-text": c.text,
    "--tp-muted": c.muted_text,
    "--tp-accent": c.accent,
    "--tp-accent-text": c.accent_foreground,
    "--tp-border": c.border,
    "--tp-success": status.success,
    "--tp-sale": status.sale,
    "--tp-logo": dark ? "#ffffff" : "#07276c",
    fontFamily: themeFont(fontKey).family,
    ...(patternImage(design.pattern) ? { "--tp-pattern": patternImage(design.pattern) } : {}),
  } as CSSProperties;
  const patterned = Boolean(patternImage(design.pattern));
  return (
    <div
      className={`tp tp-${size} tp-wrap-${design.wrapper_style}${dark ? " tp-dark" : ""}${patterned ? ` tp-patterned tp-pattern-${design.pattern_strength || "subtle"}` : ""}`}
      style={style}
      role="img"
      aria-label={label || `${name}: preview of the member app in this theme`}
    >
      <div className="tp-rail" aria-hidden="true">
        <span className="tp-logo">
          <i />
        </span>
        <span className="tp-nav is-on" />
        <span className="tp-nav" />
        <span className="tp-nav" />
        {size === "stage" && <span className="tp-nav short" />}
      </div>
      <div className="tp-main" aria-hidden="true">
        {patterned && <span className="tp-band" />}
        {size === "stage" && (
          <div className="tp-top">
            <strong>{name}</strong>
            <span className="tp-pill">Delivered</span>
          </div>
        )}
        <div className="tp-msg them">{size === "stage" ? "Can you find this wig in 22 inch?" : ""}</div>
        <div className="tp-msg us">{size === "stage" ? "Yes. Here's the closest match, ready to ship." : ""}</div>
        <div className="tp-card">
          <span className="tp-photo" />
          <span className="tp-card-copy">
            {size === "stage" ? (
              <>
                <b>Body wave wig, 22 inch</b>
                <small>
                  <s>$140</s> <em>$120</em>
                </small>
              </>
            ) : (
              <>
                <b />
                <small />
              </>
            )}
          </span>
          <span className="tp-button">{size === "stage" ? "Add to cart" : ""}</span>
        </div>
        {size === "stage" && (
          <div className="tp-composer">
            <span>Message FayFort</span>
            <i />
          </div>
        )}
      </div>
    </div>
  );
}

/** The six colours of a theme as a row of dots, for the theme cards. */
export function ThemeSwatches({ colors }: { colors: MiniThemeColors }) {
  return (
    <span className="tp-swatches" aria-hidden="true">
      {[colors.page_background, colors.surface, colors.text, colors.muted_text, colors.accent, colors.border].map((value, index) => (
        <i key={index} style={{ background: value }} />
      ))}
    </span>
  );
}
